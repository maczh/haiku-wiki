// Package netdisk 统一「外部网盘 / NAS 怎么访问」这件事，对上层屏蔽
// SMB / FTP / WebDAV / 百度网盘 / 阿里云盘 的差异。
//
// 定位与 server/internal/storage 完全同构：都是「对一种存储介质的适配」，
// 独立成包可以单独写单测、不被 service 层的业务逻辑污染。
package netdisk

import (
	"context"
	"io"
	"time"
)

// 协议类型（与前端 lib/netdisk/constants.ts 的 NETDISK_KINDS 逐字一致）。
const (
	KindSMB    = "smb"
	KindFTP    = "ftp"
	KindWebDAV = "webdav"
	KindBaidu  = "baidu"
	KindAliyun = "aliyun"
	// KindQuark 夸克网盘：官方未开放第三方 API，仅作 UI 占位，永不入库。
	KindQuark = "quark"
)

// Kinds 全部已知类型（不含 quark，quark 不可创建）。
var Kinds = []string{KindSMB, KindFTP, KindWebDAV, KindBaidu, KindAliyun}

// Driver 一种网盘协议的客户端。所有实现必须是「会话级」对象：
// 由 SessionPool 持有并复用，Close() 由池决定是真关还是还池。
type Driver interface {
	// Kind 协议类型：smb | ftp | webdav | baidu | aliyun
	Kind() string
	// Caps 能力位（上层据此决定 UI 是否开放某操作、是否发 Range 请求）
	Caps() Caps
	// Test 测试连接（列一次根目录即可）
	Test(ctx context.Context) error
	// List 列目录。path 是绝对路径（'/' 分隔，根为 "/"）
	List(ctx context.Context, path string) ([]Entry, error)
	// Stat 单条目元信息
	Stat(ctx context.Context, path string) (*Entry, error)
	// Mkdir 新建目录（父目录必须已存在）
	Mkdir(ctx context.Context, path string) error
	// Rename 改名（newName 不含路径）
	Rename(ctx context.Context, path, newName string) error
	// Move 移动到 targetDir 下（同名冲突由实现返回 ErrConflict）
	Move(ctx context.Context, path, targetDir string) error
	// Remove 删除；recursive=true 时删非空目录
	Remove(ctx context.Context, path string, recursive bool) error
	// Open 流式读（下载 / 预览 / 导入取字节）
	Open(ctx context.Context, path string) (io.ReadCloser, error)
	// OpenRange 分段读，返回 [offset, offset+size) 的流与文件总长。
	// 不支持 Range 的实现返回 ErrRangeUnsupported（上层退化为全量 Open）
	OpenRange(ctx context.Context, path string, offset, size int64) (io.ReadCloser, int64, error)
	// Write 写入文件（上传）；size<0 表示长度未知
	Write(ctx context.Context, path string, r io.Reader, size int64) error
	// Close 释放会话
	Close() error
}

// Caps 协议能力位。
type Caps struct {
	RangeRead       bool   // 是否支持分段读（视频 seek）
	NativeMove      bool   // 是否有原生 move（false → 上层做「复制 + 删源」）
	RecursiveRemove bool   // 是否支持递归删目录
	NeedProxy       bool   // true = 无直链，预览/下载必须后端代理（SMB/FTP/WebDAV）
	RootPath        string // 固定根目录（百度 = /apps/<appname>；其余为 "/"）
}

// Entry 目录项。前后端字段名逐字对齐（见设计文档 §8 共享知识）。
type Entry struct {
	Name    string    `json:"name"`
	Path    string    `json:"path"`
	IsDir   bool      `json:"is_dir"`
	Size    int64     `json:"size"`
	ModTime time.Time `json:"mod_time"`
}

// KindEntry 用于 JSON 输出的目录项（保持与方法名 Entry 一致的结构，仅字段名不同）。
// 保留类型别名以便上层按需使用。
type KindEntry = Entry

// Config 连接配置（**不含凭据**）。由 model.NetdiskConnection 的非敏感字段映射而来，
// 驱动只依赖本结构，便于单测里脱离数据库直接构造。
type Config struct {
	ID       uint64 `json:"id"`
	UserID   uint64 `json:"user_id"`
	Name     string `json:"name"`
	Kind     string `json:"kind"`
	Host     string `json:"host"`
	Port     int    `json:"port"`
	Share    string `json:"share"`
	RootPath string `json:"root_path"`
	// Mode FTP 连接模式：passive | active
	Mode string `json:"mode"`
	// Encoding FTP 文件名编码：utf-8 | gbk
	Encoding string `json:"encoding"`
	// Extra JSON 扩展（阿里云盘 drive_id 等）
	Extra string `json:"extra"`
}

// Credentials 凭据（明文）。只在进程内传递，绝不进日志、绝不进响应体。
type Credentials struct {
	Username     string    `json:"username,omitempty"`
	Password     string    `json:"password,omitempty"`
	Domain       string    `json:"domain,omitempty"`
	AccessToken  string    `json:"access_token,omitempty"`
	RefreshToken string    `json:"refresh_token,omitempty"`
	TokenExpire  time.Time `json:"token_expire,omitempty"`
}

// IsEmpty 是否「完全没有凭据」（SMB/FTP 的匿名访问场景）。
func (c *Credentials) IsEmpty() bool {
	if c == nil {
		return true
	}
	return c.Username == "" && c.Password == "" && c.Domain == "" &&
		c.AccessToken == "" && c.RefreshToken == ""
}

// HasToken 是否持有 OAuth token。
func (c *Credentials) HasToken() bool {
	return c != nil && c.AccessToken != ""
}

// HasPassword 是否持有口令凭据。
func (c *Credentials) HasPassword() bool {
	return c != nil && c.Password != ""
}

// New 按协议类型构造驱动。未实现的 kind 返回 CodeUnsupported（42008）。
//
// 凭据以独立参数传入（不塞进 Config）：Config 会被日志记录，Credentials 绝不会。
func New(kind string, cfg Config, creds *Credentials) (Driver, error) {
	if creds == nil {
		creds = &Credentials{}
	}
	c := cfg
	c.Kind = kind
	switch kind {
	case KindSMB:
		return NewSMB(c, creds)
	case KindFTP:
		return NewFTP(c, creds)
	case KindWebDAV:
		return NewWebDAV(c, creds)
	case KindBaidu:
		return NewBaidu(c, creds)
	case KindAliyun:
		return NewAliyun(c, creds)
	default:
		return nil, Unsupported("暂不支持的网盘类型：" + kind)
	}
}

// DefaultRootPath 某协议的默认根目录（百度为 /apps/<appname>，其余为 /）。
func DefaultRootPath(kind, appName string) string {
	if kind == KindBaidu {
		name := appName
		if name == "" {
			name = "haiku-wiki"
		}
		return "/apps/" + name
	}
	return "/"
}
