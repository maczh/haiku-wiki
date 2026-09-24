// Package config 负责加载服务配置。
//
// 配置来源按优先级从低到高：内置默认值 → conf/application.yml → 环境变量。
// YAML 是主配置文件（Docker 镜像里映射为 /app/conf），环境变量用于容器化场景下
// 对个别项做覆盖（沿用历史部署的 PORT / JWT_SECRET / DATA_DIR / DB_DRIVER / DB_DSN）。
//
// 配置文件不存在时不报错，直接走「默认值 + 环境变量」：本机开发、以及只靠环境变量
// 启动的老部署都不受影响。迁移功能（见 internal/service/migrate*.go）会在切换
// 数据库/存储时改写这个 YAML 文件，改写走 yaml.Node 以保留原有注释。
package config

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"gopkg.in/yaml.v3"
)

// 枚举值
const (
	StorageLocal = "local" // 本地文件系统
	StorageS3    = "s3"    // S3 兼容对象存储

	DBSQLite = "sqlite"
	DBMySQL  = "mysql"
)

// Config 运行时生效配置（由 YAML + 环境变量合成后的最终值）。
//
// 这里刻意保持扁平结构：历史代码（repository.Connect / router.Register）就是按
// 扁平字段消费的，改成嵌套会让全仓跟着改一遍。YAML 侧的嵌套结构由 fileConfig 表达。
type Config struct {
	Port      string // HTTP 监听端口
	GINMode   string // gin 运行模式 debug | release
	JWTSecret string // JWT 签名密钥
	DBDriver  string // sqlite | mysql
	DBDSN     string // 数据库连接串
	DataDir   string // 本地数据目录（SQLite 文件 + local 存储的 uploads/）

	// StorageType 存储方式：local | s3。为 s3 时上传文件、派生预览图、导入的 HTML 包
	// 全部落对象存储，不再写本地磁盘。
	StorageType string
	S3          S3Config

	// MaxUploadMB 单文件上限（MB）。<=0 时用默认 64。
	MaxUploadMB int

	// WeChat 扫码登录（网站应用 / 公众号）。三项都非空时视为已配置（WeChatEnabled=true）。
	WeChatAppID       string
	WeChatAppSecret   string
	WeChatRedirectURI string
	WeChatEnabled     bool // 由上面三项是否齐全推导，免得散落判断

	// Path 生效的配置文件绝对路径；"" 表示没有配置文件（纯环境变量模式），
	// 此时迁移功能无法自动改写配置，只能在响应里提示用户手工处理。
	Path string
}

// S3Config S3 兼容对象存储配置（同时适用于 MinIO、Ceph RGW、腾讯云 COS 等）。
type S3Config struct {
	Endpoint  string `yaml:"endpoint"`   // 自托管 MinIO 填 http://minio:9000；AWS 留空
	Region    string `yaml:"region"`     // 如 ap-guangzhou
	Bucket    string `yaml:"bucket"`     // 桶名
	AccessKey string `yaml:"access_key"` // AccessKeyID
	SecretKey string `yaml:"secret_key"` // SecretAccessKey
	Prefix    string `yaml:"prefix"`     // 对象键前缀，如 haiku/（可留空）
	// ForcePathStyle 自托管 MinIO 通常需要 true（用 path-style 而非 virtual-host-style）。
	ForcePathStyle bool `yaml:"force_path_style"`
	// PresignTTLMinutes 私有桶下临时访问链接的有效期（分钟），0 用默认 60。
	PresignTTLMinutes int `yaml:"presign_ttl"`
	// PublicRead 桶已设为公开读时置 true：直接拼公开 URL，不再逐次生成预签名链接。
	PublicRead bool `yaml:"public_read"`
}

// ---------- YAML 文件结构（与 conf/application.yml 一一对应） ----------

type fileConfig struct {
	Server   serverSection   `yaml:"server"`
	JWT      jwtSection      `yaml:"jwt"`
	Database databaseSection `yaml:"database"`
	Storage  storageSection  `yaml:"storage"`
	S3       S3Config        `yaml:"s3"`
	Upload   uploadSection   `yaml:"upload"`
	Wechat   wechatSection   `yaml:"wechat"`
}

type wechatSection struct {
	AppID       string `yaml:"app_id"`
	AppSecret   string `yaml:"app_secret"`
	RedirectURI string `yaml:"redirect_uri"`
}

type serverSection struct {
	Port string `yaml:"port"`
	Mode string `yaml:"mode"`
}

type jwtSection struct {
	Secret string `yaml:"secret"`
}

// databaseSection 同时支持两种写法：
//   - 直接给 dsn（sqlite 路径或 mysql 完整 DSN）
//   - 拆成 host/port/user/password/name（迁移功能切换数据库时按字段改写更可靠）
type databaseSection struct {
	Driver   string `yaml:"driver"`
	DSN      string `yaml:"dsn"`
	Host     string `yaml:"host"`
	Port     int    `yaml:"port"`
	User     string `yaml:"user"`
	Password string `yaml:"password"`
	Name     string `yaml:"name"`
}

type storageSection struct {
	Type  string      `yaml:"type"`
	Local localSubSec `yaml:"local"`
}

type localSubSec struct {
	Dir string `yaml:"dir"`
}

type uploadSection struct {
	MaxSizeMB int `yaml:"max_size_mb"`
}

// ---------- 路径 ----------

// Dir 配置文件所在目录：环境变量 CONF_DIR 优先，其次 ./conf，最后是 Docker 里的 /app/conf。
func Dir() string {
	if v := os.Getenv("CONF_DIR"); v != "" {
		return v
	}
	if d, err := os.Stat("conf"); err == nil && d.IsDir() {
		return "conf"
	}
	return "/app/conf"
}

// FilePath 配置文件完整路径。
func FilePath() string { return filepath.Join(Dir(), "application.yml") }

// ---------- 运行时引用 ----------

// current 最近一次 Load 得到的生效配置（供系统配置编辑、迁移等运行时读取）。
var current *Config

// fileCfg 最近一次解析出的原始文件配置（供 ToEditable 还原 host/port/user/password/name 拆分字段）。
var fileCfg fileConfig

// Current 返回最近一次 Load 的生效配置；未加载时返回 nil。
func Current() *Config { return current }

// ---------- 加载 ----------

func getenv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

// Load 读取 conf/application.yml 并用环境变量覆盖，返回最终生效配置。
func Load() *Config {
	cfg := defaults()

	if raw, err := os.ReadFile(FilePath()); err == nil {
		var fc fileConfig
		if err := yaml.Unmarshal(raw, &fc); err == nil {
			applyFile(cfg, &fc)
			cfg.Path = FilePath()
			fileCfg = fc
		}
		// YAML 解析失败不阻断启动：回退「环境变量 + 默认值」，
		// 避免一处笔误就让整个服务起不来（配置错误应在日志里可见，而非致命）。
	}
	applyEnv(cfg)

	// MySQL 拆分字段 → DSN 拼装：必须等 driver 终态（文件 + 环境变量）确定后进行，
	// 且只对 mysql 生效。放在这里同时覆盖两种来源组合：文件写 driver: mysql，
	// 以及文件只给拆分字段、由 DB_DRIVER=mysql 环境变量切驱动的部署。
	if cfg.DBDSN == "" && cfg.DBDriver == DBMySQL && fileCfg.Database.Name != "" {
		cfg.DBDSN = MySQLDSN(fileCfg.Database)
	}

	// SQLite 未显式给 DSN 时落在数据目录
	if cfg.DBDriver == DBSQLite && cfg.DBDSN == "" {
		cfg.DBDSN = filepath.Join(cfg.DataDir, "haiku.db")
	}
	current = cfg
	return cfg
}

// ---------- 可编辑视图 ----------

// EditableConfig 系统配置的可编辑视图，与 conf/application.yml 的嵌套结构对齐，
// 也直接对应前端「系统配置」表单字段。Save 时由 ApplyEditable 落回文件。
type EditableConfig struct {
	Server struct {
		Port string `json:"port"`
		Mode string `json:"mode"`
	} `json:"server"`
	JWT struct {
		Secret string `json:"secret"`
	} `json:"jwt"`
	Database struct {
		Driver   string `json:"driver"` // sqlite | mysql
		DSN      string `json:"dsn"`
		Host     string `json:"host"`
		Port     int    `json:"port"`
		User     string `json:"user"`
		Password string `json:"password"`
		Name     string `json:"name"`
	} `json:"database"`
	Storage struct {
		Type     string `json:"type"` // local | s3
		LocalDir string `json:"local_dir"`
	} `json:"storage"`
	S3     S3Config `json:"s3"`
	Upload struct {
		MaxSizeMB int `json:"max_size_mb"`
	} `json:"upload"`
}

// ToEditable 把生效配置翻成可编辑视图。
// 拆分字段（host/port/user/password/name）优先取文件原始值（fileCfg），
// 缺失时回退到生效配置（current）的扁平值，保证表单能回填当前实际生效的配置。
func (c *Config) ToEditable() EditableConfig {
	var e EditableConfig
	e.Server.Port = c.Port
	e.Server.Mode = c.GINMode
	e.JWT.Secret = c.JWTSecret
	e.Database.Driver = c.DBDriver
	e.Database.DSN = fileCfg.Database.DSN
	if e.Database.DSN == "" {
		e.Database.DSN = c.DBDSN // 回退到生效值（如默认 sqlite 路径）
	}
	e.Database.Host = fileCfg.Database.Host
	e.Database.Port = fileCfg.Database.Port
	e.Database.User = fileCfg.Database.User
	e.Database.Password = fileCfg.Database.Password
	e.Database.Name = fileCfg.Database.Name
	// 回退：文件未给拆分字段但生效的是 mysql（dsn 由字段拼成）时，从 dsn 反解以便展示
	if e.Database.Driver == DBMySQL && e.Database.User == "" && e.Database.Name == "" && c.DBDSN != "" {
		if u, h, p, n := splitMySQLDSN(c.DBDSN); u != "" || n != "" {
			e.Database.User = u
			e.Database.Password = p
			e.Database.Host = h
			e.Database.Name = n
		}
	}
	e.Storage.Type = c.StorageType
	e.Storage.LocalDir = fileCfg.Storage.Local.Dir
	if e.Storage.LocalDir == "" {
		e.Storage.LocalDir = c.DataDir
	}
	e.S3 = c.S3
	e.Upload.MaxSizeMB = c.MaxUploadMB
	return e
}

// splitMySQLDSN 尽力从 MySQL DSN 反解出 user/password/host/name（仅用于配置编辑回显）。
// 支持形如 user:password@tcp(host:port)/name?charset=... 的常见写法。
func splitMySQLDSN(dsn string) (user, host, password, name string) {
	at := strings.Index(dsn, "@tcp(")
	if at < 0 {
		return
	}
	userPass := dsn[:at]
	if i := strings.Index(userPass, ":"); i >= 0 {
		user = userPass[:i]
		password = userPass[i+1:]
	} else {
		user = userPass
	}
	rest := dsn[at+len("@tcp("):]
	end := strings.Index(rest, ")")
	if end < 0 {
		return
	}
	hostPort := rest[:end]
	if i := strings.LastIndex(hostPort, ":"); i >= 0 {
		host = hostPort[:i]
	} else {
		host = hostPort
	}
	after := rest[end+1:]
	if strings.HasPrefix(after, "/") {
		after = after[1:]
	}
	if i := strings.Index(after, "?"); i >= 0 {
		after = after[:i]
	}
	name = after
	return
}

func defaults() *Config {
	return &Config{
		Port:        "8080",
		GINMode:     "debug",
		JWTSecret:   "haiku-wiki-dev-secret-change-me",
		DBDriver:    DBSQLite,
		DataDir:     "./data",
		StorageType: StorageLocal,
		MaxUploadMB: 64,
	}
}

func applyFile(cfg *Config, fc *fileConfig) {
	if v := strings.TrimSpace(fc.Server.Port); v != "" {
		cfg.Port = v
	}
	if fc.Server.Mode != "" {
		cfg.GINMode = fc.Server.Mode
	}
	if fc.JWT.Secret != "" {
		cfg.JWTSecret = fc.JWT.Secret
	}
	if fc.Database.Driver != "" {
		cfg.DBDriver = strings.ToLower(strings.TrimSpace(fc.Database.Driver))
	}
	// 显式 dsn 直接生效；拆分字段（host/port/user/password/name）**不在这里**拼
	// MySQL DSN —— 此刻 driver 还可能被环境变量改写，且 sqlite 部署的 yml 里常残留
	// 之前试 MySQL 留下的 host/user/password/name 字段，在这里拼会把空 dsn 误占位，
	// 导致 driver=sqlite 却拿着 mysql 连接串去 open 的怪错（glebarez 报成
	// "out of memory (14)"，极具迷惑性）。拼装挪到 Load() 末尾 driver 终态确定后。
	if fc.Database.DSN != "" {
		cfg.DBDSN = fc.Database.DSN
	}
	if fc.Storage.Type != "" {
		cfg.StorageType = strings.ToLower(strings.TrimSpace(fc.Storage.Type))
	}
	if fc.Storage.Local.Dir != "" {
		cfg.DataDir = fc.Storage.Local.Dir
	}
	cfg.S3 = fc.S3
	if fc.Upload.MaxSizeMB > 0 {
		cfg.MaxUploadMB = fc.Upload.MaxSizeMB
	}
	if fc.Wechat.AppID != "" {
		cfg.WeChatAppID = fc.Wechat.AppID
	}
	if fc.Wechat.AppSecret != "" {
		cfg.WeChatAppSecret = fc.Wechat.AppSecret
	}
	if fc.Wechat.RedirectURI != "" {
		cfg.WeChatRedirectURI = fc.Wechat.RedirectURI
	}
	cfg.WeChatEnabled = cfg.WeChatAppID != "" && cfg.WeChatAppSecret != "" && cfg.WeChatRedirectURI != ""
}

func applyEnv(cfg *Config) {
	cfg.Port = getenv("PORT", cfg.Port)
	cfg.GINMode = getenv("GIN_MODE", cfg.GINMode)
	cfg.JWTSecret = getenv("JWT_SECRET", cfg.JWTSecret)
	cfg.DBDriver = strings.ToLower(getenv("DB_DRIVER", cfg.DBDriver))
	cfg.DataDir = getenv("DATA_DIR", cfg.DataDir)
	if v := os.Getenv("DB_DSN"); v != "" {
		cfg.DBDSN = v
	}
	if v := os.Getenv("STORAGE_TYPE"); v != "" {
		cfg.StorageType = strings.ToLower(v)
	}
	// S3 常用项也允许环境变量覆盖（容器化部署不便改文件时很有用）
	cfg.S3.Endpoint = getenv("S3_ENDPOINT", cfg.S3.Endpoint)
	cfg.S3.Region = getenv("S3_REGION", cfg.S3.Region)
	cfg.S3.Bucket = getenv("S3_BUCKET", cfg.S3.Bucket)
	cfg.S3.AccessKey = getenv("S3_ACCESS_KEY", cfg.S3.AccessKey)
	cfg.S3.SecretKey = getenv("S3_SECRET_KEY", cfg.S3.SecretKey)
	// 微信扫码登录（仅当文件/默认值未给时环境变量才生效，优先级低于文件）
	if v := os.Getenv("WECHAT_APPID"); v != "" {
		cfg.WeChatAppID = v
	}
	if v := os.Getenv("WECHAT_APPSECRET"); v != "" {
		cfg.WeChatAppSecret = v
	}
	if v := os.Getenv("WECHAT_REDIRECT_URI"); v != "" {
		cfg.WeChatRedirectURI = v
	}
	cfg.WeChatEnabled = cfg.WeChatAppID != "" && cfg.WeChatAppSecret != "" && cfg.WeChatRedirectURI != ""

	if cfg.Port == "" {
		cfg.Port = "8080"
	}
	if cfg.StorageType != StorageS3 {
		// 未知值一律回落本地：宁可用本地盘，也不要启动后存储整体不可用
		cfg.StorageType = StorageLocal
	}
}

// MySQLDSN 由拆分字段拼 MySQL 连接串。
// parseTime/Loc 必须带上：GORM 的 time.Time 字段与 gorm.DeletedAt 依赖它。
func MySQLDSN(d databaseSection) string {
	host := d.Host
	if host == "" {
		host = "127.0.0.1"
	}
	port := d.Port
	if port == 0 {
		port = 3306
	}
	return d.User + ":" + d.Password + "@tcp(" + host + ":" + strconv.Itoa(port) + ")/" +
		d.Name + "?charset=utf8mb4&parseTime=True&loc=Local"
}

// UploadMaxBytes 单文件上限（字节）。
func (c *Config) UploadMaxBytes() int64 {
	mb := c.MaxUploadMB
	if mb <= 0 {
		mb = 64
	}
	return int64(mb) << 20
}

// UseS3 当前是否走对象存储。
func (c *Config) UseS3() bool { return c.StorageType == StorageS3 }
