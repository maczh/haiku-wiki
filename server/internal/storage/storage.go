// Package storage 统一「文件存到哪」这件事，对上层屏蔽 local 与 S3 的差异。
//
// 设计取舍：
//  1. **key 一律是相对路径**（如 uploads/2026/09/uuid.png），不含前导斜杠、不含协议。
//     数据库里存的仍然是历史形态的 URL（/uploads/...），两者只差一个前导斜杠，
//     这样存储从 local 切到 S3 时**不需要改写任何一条业务数据**——迁移的现实可行性
//     比接口优雅更重要。
//  2. **对外暴露的 URL 由 store 自己决定**：local 返回相对路径走静态路由；
//     S3 + 公开桶返回完整 https 链接；S3 私有桶仍返回相对路径，由 /uploads 路由代理
//     （代理时才生成短期预签名/直读），避免把会过期的签名链接写进数据库。
//  3. 需要**本地真实文件**才能工作的流程（PDF/PNG 导出、CAD 转换、pptx 改写）统一走
//     LocalPath：local 直接给路径，S3 下载到临时目录，调用方用完必须 cleanup。
package storage

import (
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"haiku-wiki/server/internal/config"
	hkerr "haiku-wiki/server/internal/pkg"
)

// Store 存储后端。
type Store interface {
	// Kind 后端类型：local | s3（用于日志与迁移时区分源/目标）。
	Kind() string

	// Put 写入对象（覆盖式）。contentType 为空时后端按扩展名猜。
	Put(key string, data []byte, contentType string) error
	// Read 读出全部内容（小文件）；大文件请用 Open 流式读。
	Read(key string) ([]byte, error)
	// Open 流式读取，调用方负责 Close。
	Open(key string) (io.ReadCloser, error)
	// Delete 删除；对象不存在时返回 nil（幂等，便于清理流程无脑调用）。
	Delete(key string) error
	// Exists 是否存在。
	Exists(key string) (bool, error)
	// List 列出 prefix 下的全部对象（迁移用，需处理分页）。
	List(prefix string) ([]Info, error)
	// URL 对外可访问链接（见包注释第 2 点）。
	URL(key string) string
	// LocalPath 保证返回一个可读的本地文件路径。S3 会先下载到临时目录，
	// 调用方**必须**在用完后调用 cleanup，否则临时文件会堆积。
	LocalPath(key string) (path string, cleanup func(), err error)
}

// Info 对象元信息。
type Info struct {
	Key      string
	Size     int64
	Modified time.Time
}

// ---------- 全局单例 ----------

var (
	mu     sync.RWMutex
	def    Store
	defCfg *config.Config
)

// Init 按配置初始化全局后端。local 失败会 panic（磁盘不可写等同于服务不可用）。
func Init(cfg *config.Config) {
	s, err := New(cfg)
	if err != nil {
		panic("[storage] 存储初始化失败: " + err.Error())
	}
	mu.Lock()
	def, defCfg = s, cfg
	mu.Unlock()
}

// InitLocal 用本地目录初始化全局后端（测试与迁移流程用；服务启动走 Init）。
func InitLocal(dir string) {
	s, err := NewLocal(dir)
	if err != nil {
		panic("[storage] 本地存储初始化失败: " + err.Error())
	}
	mu.Lock()
	def = s
	mu.Unlock()
}

// New 按配置构造后端（迁移功能会同时构造源与目标两个，所以不能只提供单例）。
func New(cfg *config.Config) (Store, error) {
	if cfg.UseS3() {
		s, err := NewS3(cfg.S3)
		if err != nil {
			return nil, err
		}
		return s, nil
	}
	return NewLocal(cfg.DataDir)
}

// Default 当前全局后端；未初始化时返回一个指向 ./data 的 local 后端，
// 让只跑单测的场景不至于 nil panic。
func Default() Store {
	mu.RLock()
	s := def
	mu.RUnlock()
	if s != nil {
		return s
	}
	return &localStore{root: "./data"}
}

// Cfg 当前生效配置（迁移与上传限制读取用）。
func Cfg() *config.Config {
	mu.RLock()
	defer mu.RUnlock()
	return defCfg
}

// ---------- key / URL 的通用换算 ----------

// KeyFromURL 把 "/uploads/2026/09/x.png" 或 "uploads/2026/09/x.png" 规范成 key。
// 非 /uploads 开头的绝对路径原样去掉前导斜杠（历史数据里有少量其它前缀）。
func KeyFromURL(u string) string {
	k := strings.TrimSpace(u)
	k = strings.TrimPrefix(k, "/")
	if k == "" {
		return ""
	}
	return filepath.ToSlash(filepath.Clean(k))
}

// URLFromKey key → 对外 URL（默认加前导斜杠；S3 公开桶由具体实现覆盖）。
func URLFromKey(key string) string { return "/" + strings.TrimPrefix(key, "/") }

// ---------- 通用校验 ----------

// safeKey 拒绝目录穿越：key 不得为绝对路径、不得含 .. 段。
// 所有后端在拼路径/拼对象键前都必须过这一关——URL 来自用户输入（附件地址可伪造）。
//
// ⚠️ 前导斜杠必须在 Clean **之前**判掉：先 TrimPrefix("/") 再 Clean 会把
// "/etc/passwd" 洗成 "etc/passwd"，看起来像个正常的相对键，绝对路径就这样漏过去了。
func safeKey(key string) (string, error) {
	raw := strings.TrimSpace(key)
	if raw == "" {
		return "", hkerr.Param("存储键无效")
	}
	if strings.HasPrefix(raw, "/") {
		return "", hkerr.Param("存储键无效：不接受绝对路径")
	}
	k := filepath.ToSlash(filepath.Clean(filepath.FromSlash(raw)))
	if k == "." || k == ".." || k == "/" {
		return "", hkerr.Param("存储键无效")
	}
	if strings.HasPrefix(k, "../") || strings.HasSuffix(k, "/..") || strings.Contains(k, "/../") {
		return "", hkerr.Param("存储键无效")
	}
	return k, nil
}

// listPrefix 列举用的前缀规范化：空前缀表示「根」，其余按 safeKey 严格校验。
func listPrefix(prefix string) string {
	p := strings.TrimSpace(prefix)
	if p == "" {
		return ""
	}
	k, err := safeKey(p)
	if err != nil {
		return ""
	}
	return k
}

// MimeByExt 按扩展名猜 Content-Type（两个后端共用）。
func MimeByExt(key string) string {
	switch strings.ToLower(filepath.Ext(key)) {
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".gif":
		return "image/gif"
	case ".webp":
		return "image/webp"
	case ".svg":
		return "image/svg+xml"
	case ".bmp":
		return "image/bmp"
	case ".tif", ".tiff":
		return "image/tiff"
	case ".pdf":
		return "application/pdf"
	case ".html", ".htm":
		return "text/html; charset=utf-8"
	case ".css":
		return "text/css; charset=utf-8"
	case ".js":
		return "application/javascript; charset=utf-8"
	case ".json":
		return "application/json; charset=utf-8"
	case ".zip":
		return "application/zip"
	case ".md", ".txt":
		return "text/plain; charset=utf-8"
	default:
		return "application/octet-stream"
	}
}

// TempDir 临时目录（S3 下载、导出中间产物）。放在数据目录下，避免容器 /tmp 过小。
func TempDir() string {
	if c := Cfg(); c != nil && c.DataDir != "" {
		return filepath.Join(c.DataDir, "tmp", "storage")
	}
	return filepath.Join(os.TempDir(), "haiku-storage")
}
