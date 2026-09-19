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
		}
		// YAML 解析失败不阻断启动：回退「环境变量 + 默认值」，
		// 避免一处笔误就让整个服务起不来（配置错误应在日志里可见，而非致命）。
	}
	applyEnv(cfg)

	// SQLite 未显式给 DSN 时落在数据目录
	if cfg.DBDriver == DBSQLite && cfg.DBDSN == "" {
		cfg.DBDSN = filepath.Join(cfg.DataDir, "haiku.db")
	}
	return cfg
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
	if fc.Database.DSN != "" {
		cfg.DBDSN = fc.Database.DSN
	} else if fc.Database.Name != "" {
		cfg.DBDSN = MySQLDSN(fc.Database)
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
