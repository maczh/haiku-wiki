package config

// 本文件负责「改写 conf/application.yml」——系统迁移功能切换数据库或存储后，
// 要把新配置落回文件，实现无缝对接（下次启动直接生效）。
//
// 关键点：**必须保留用户写的注释**。直接 yaml.Unmarshal → 改结构 → Marshal 会把
// 全部注释、空行、键顺序洗掉，用户精心标注的配置说明瞬间消失。因此这里全程在
// yaml.Node 层操作：Node 会原样携带 HeadComment/LineComment/FootComment。

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"gopkg.in/yaml.v3"
)

// Update 原子改写配置文件中的若干键（点号路径，如 "database.driver"）。
// 键不存在时按路径自动创建中间节点并追加到所在 mapping 末尾。
// 文件不存在时用内置模板创建（需目录可写）。
func Update(pairs map[string]interface{}) error {
	path := FilePath()
	raw, err := os.ReadFile(path)
	if err != nil {
		if !os.IsNotExist(err) {
			return fmt.Errorf("读取配置文件失败: %w", err)
		}
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			return fmt.Errorf("创建配置目录失败: %w", err)
		}
		raw = []byte(Template())
	}

	var doc yaml.Node
	if err := yaml.Unmarshal(raw, &doc); err != nil {
		return fmt.Errorf("解析配置文件失败: %w", err)
	}
	root := &doc
	if doc.Kind == yaml.DocumentNode && len(doc.Content) > 0 {
		root = doc.Content[0]
	}
	if root.Kind != yaml.MappingNode {
		root.Kind = yaml.MappingNode
		root.Content = nil
	}

	for k, v := range pairs {
		if err := setPath(root, k, v); err != nil {
			return fmt.Errorf("设置 %s 失败: %w", k, err)
		}
	}

	var sb strings.Builder
	enc := yaml.NewEncoder(&sb)
	enc.SetIndent(2)
	if err := enc.Encode(&doc); err != nil {
		return fmt.Errorf("序列化配置失败: %w", err)
	}
	if err := enc.Close(); err != nil {
		return fmt.Errorf("序列化配置失败: %w", err)
	}

	// 先写同目录临时文件再 rename：避免写到一半崩溃留下半截配置，直接服务起不来。
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, []byte(sb.String()), 0o644); err != nil {
		return fmt.Errorf("写入临时配置失败: %w", err)
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return fmt.Errorf("替换配置文件失败: %w", err)
	}
	return nil
}

// setPath 在 mapping 树上按点号路径写入值，缺失的中间层自动创建。
func setPath(cur *yaml.Node, path string, v interface{}) error {
	parts := strings.Split(path, ".")
	for i, p := range parts {
		last := i == len(parts)-1

		var found *yaml.Node
		for j := 0; j+1 < len(cur.Content); j += 2 {
			if cur.Content[j].Value == p {
				found = cur.Content[j+1]
				break
			}
		}

		if last {
			nv, err := scalarNode(v)
			if err != nil {
				return err
			}
			if found == nil {
				cur.Content = append(cur.Content,
					&yaml.Node{Kind: yaml.ScalarNode, Tag: "!!str", Value: p}, nv)
				return nil
			}
			*found = *nv
			return nil
		}

		if found == nil {
			m := &yaml.Node{Kind: yaml.MappingNode}
			cur.Content = append(cur.Content,
				&yaml.Node{Kind: yaml.ScalarNode, Tag: "!!str", Value: p}, m)
			cur = m
			continue
		}
		if found.Kind != yaml.MappingNode {
			// 原值是标量/序列：就地改造成 mapping（覆盖旧值）
			found.Kind = yaml.MappingNode
			found.Tag = ""
			found.Value = ""
			found.Content = nil
		}
		cur = found
	}
	return nil
}

// scalarNode 把任意 Go 值编码为 yaml 标量节点（自动推断 tag）。
func scalarNode(v interface{}) (*yaml.Node, error) {
	n := &yaml.Node{}
	if err := n.Encode(v); err != nil {
		return nil, err
	}
	return n, nil
}

// ApplyEditable 把可编辑视图翻译成点号路径 map 后写回配置文件（保留注释）。
// 与 config.Load 的解析规则一致：dsn 非空时写 dsn 并清空拆分字段，否则写拆分字段；
// storage 仅 local 时写 local.dir，s3 时写 s3.* 全部字段。
func ApplyEditable(e EditableConfig) error {
	pairs := map[string]interface{}{
		"server.port":        e.Server.Port,
		"server.mode":        e.Server.Mode,
		"jwt.secret":         e.JWT.Secret,
		"database.driver":    e.Database.Driver,
		"storage.type":       e.Storage.Type,
		"storage.local.dir":  e.Storage.LocalDir,
		"upload.max_size_mb": e.Upload.MaxSizeMB,
	}
	if e.Database.DSN != "" {
		pairs["database.dsn"] = e.Database.DSN
		// 清空拆分字段，避免两套字段并存导致解析歧义
		pairs["database.host"] = ""
		pairs["database.port"] = 0
		pairs["database.user"] = ""
		pairs["database.password"] = ""
		pairs["database.name"] = ""
	} else {
		pairs["database.dsn"] = ""
		pairs["database.host"] = e.Database.Host
		pairs["database.port"] = e.Database.Port
		pairs["database.user"] = e.Database.User
		pairs["database.password"] = e.Database.Password
		pairs["database.name"] = e.Database.Name
	}
	if e.Storage.Type == StorageS3 {
		pairs["s3.endpoint"] = e.S3.Endpoint
		pairs["s3.region"] = e.S3.Region
		pairs["s3.bucket"] = e.S3.Bucket
		pairs["s3.access_key"] = e.S3.AccessKey
		pairs["s3.secret_key"] = e.S3.SecretKey
		pairs["s3.prefix"] = e.S3.Prefix
		pairs["s3.force_path_style"] = e.S3.ForcePathStyle
		pairs["s3.public_read"] = e.S3.PublicRead
		pairs["s3.presign_ttl"] = e.S3.PresignTTLMinutes
	}
	return Update(pairs)
}

// Template 内置配置模板（文件缺失时用于创建，注释即文档）。
func Template() string {
	return `# 寄海文库（haiku-wiki）主配置文件
#
# 读取位置：环境变量 CONF_DIR 指定目录，其次 ./conf，Docker 镜像内为 /app/conf。
# 优先级：环境变量 > 本文件 > 内置默认值。
# 本文件由「系统迁移」功能自动改写时会保留你的注释与键顺序。

server:
  # HTTP 监听端口
  port: 8080
  # gin 运行模式：debug | release（Docker 部署由环境变量 GIN_MODE=release 覆盖）
  mode: debug

jwt:
  # 登录令牌签名密钥，生产环境务必修改
  secret: haiku-wiki-dev-secret-change-me

database:
  # sqlite | mysql
  driver: sqlite
  # 留空时：sqlite 自动落在 storage.local.dir 下的 haiku.db
  dsn: ""
  # MySQL 可直接给 dsn：
  # dsn: "root:password@tcp(127.0.0.1:3306)/haiku_wiki?charset=utf8mb4&parseTime=True&loc=Local"
  # 也可拆成下面这些字段，由程序拼装（dsn 为空时生效；迁移功能按字段改写）
  host: 127.0.0.1
  port: 3306
  user: root
  password: ""
  name: haiku_wiki

storage:
  # local | s3
  type: local
  local:
    # 本地存储根目录（上传文件落在 <dir>/uploads/）；Docker 部署由 DATA_DIR=/app/data 覆盖
    dir: ./data

# storage.type 为 s3 时生效（兼容 MinIO / Ceph RGW / 腾讯云 COS 等）
s3:
  endpoint: ""
  region: ap-guangzhou
  bucket: haiku-wiki
  access_key: ""
  secret_key: ""
  # 对象键前缀，可留空
  prefix: haiku/
  # 自托管 MinIO 需要 true（path-style）；AWS S3 用 false
  force_path_style: false
  # 桶已公开读时置 true：直接拼公开 URL，不再每次生成预签名链接
  public_read: false
  # 私有桶预签名链接有效期（分钟）
  presign_ttl: 60

upload:
  # 单文件上限（MB）
  max_size_mb: 64
`
}
