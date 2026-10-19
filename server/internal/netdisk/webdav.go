package netdisk

import (
	"context"
	"io"
	"strings"
	"sync"

	"github.com/studio-b12/gowebdav"
)

// webdavDriver 通用 WebDAV 驱动（studio-b12/gowebdav）。
//
// WebDAV 是无开放 API 的网盘最通用的接入方式：坚果云、ownCloud/Nextcloud、
// 群晖/威联通的 WebDAV 服务、以及部分自建对象存储网关都支持。
//
// 并发安全由 SessionPool 的 entry.mu 保证。
type webdavDriver struct {
	cfg  Config
	caps Caps

	mu     sync.Mutex
	client *gowebdav.Client
	closed bool
}

// NewWebDAV 建立 WebDAV 客户端并探测连通性。
func NewWebDAV(cfg Config, creds *Credentials) (Driver, error) {
	host := strings.TrimSpace(cfg.Host)
	if host == "" {
		return nil, ConfigInvalid("WebDAV 服务地址不能为空")
	}
	if !strings.Contains(host, "://") {
		// 没给协议时默认 http（内网 NAS 的 WebDAV 多数不开 TLS）
		host = "http://" + host
	}
	host = strings.TrimRight(host, "/")
	if creds == nil {
		creds = &Credentials{}
	}
	client := gowebdav.NewClient(host, creds.Username, creds.Password)
	client.SetTimeout(dialTimeout)
	if err := client.Connect(); err != nil {
		return nil, mapWebDAVError(err)
	}
	root := cfg.RootPath
	if root == "" {
		root = "/"
	}
	return &webdavDriver{
		cfg:    cfg,
		caps:   Caps{RangeRead: true, NativeMove: true, RecursiveRemove: true, NeedProxy: true, RootPath: root},
		client: client,
	}, nil
}

// mapWebDAVError 401/403 → 认证失败；404 → 路径不存在；其余走通用归类。
func mapWebDAVError(err error) error {
	if err == nil {
		return nil
	}
	if IsAppError(err) {
		return err
	}
	msg := err.Error()
	switch {
	case strings.Contains(msg, "401"), strings.Contains(msg, "403"):
		return AuthFailed("WebDAV 认证失败，请检查用户名或密码")
	case strings.Contains(msg, "404"):
		return PathNotFound("WebDAV 路径不存在：" + msg)
	case strings.Contains(msg, "405"), strings.Contains(msg, "409"):
		return ConfigInvalid("WebDAV 操作被拒绝（可能是路径不是目录或已存在）：" + msg)
	default:
		return MapError(err)
	}
}

// Kind 协议类型。
func (d *webdavDriver) Kind() string { return KindWebDAV }

// Caps 能力位。
func (d *webdavDriver) Caps() Caps { return d.caps }

// webdavPath 统一口径 '/a/b' → gowebdav 的相对路径 'a/b'（根为 "/"）。
func webdavPath(p string) string {
	c, err := CleanPath(p)
	if err != nil {
		return "/"
	}
	return c
}

// Test 列一次根目录。
func (d *webdavDriver) Test(ctx context.Context) error {
	_, err := d.List(ctx, d.caps.RootPath)
	return err
}

// List 列目录。
func (d *webdavDriver) List(ctx context.Context, path string) ([]Entry, error) {
	c, err := CleanPath(path)
	if err != nil {
		return nil, err
	}
	d.mu.Lock()
	infos, err := d.client.ReadDir(webdavPath(c))
	d.mu.Unlock()
	if err != nil {
		return nil, mapWebDAVError(err)
	}
	return fileInfosToEntries(infos, c), nil
}

// Stat 单条目元信息。
func (d *webdavDriver) Stat(ctx context.Context, path string) (*Entry, error) {
	c, err := CleanPath(path)
	if err != nil {
		return nil, err
	}
	d.mu.Lock()
	fi, err := d.client.Stat(webdavPath(c))
	d.mu.Unlock()
	if err != nil {
		return nil, mapWebDAVError(err)
	}
	if fi == nil {
		return nil, PathNotFound("WebDAV 路径不存在：" + c)
	}
	return &Entry{
		Name:    BaseName(c),
		Path:    c,
		IsDir:   fi.IsDir(),
		Size:    fi.Size(),
		ModTime: fi.ModTime(),
	}, nil
}

// Mkdir 新建目录。
func (d *webdavDriver) Mkdir(ctx context.Context, path string) error {
	c, err := CleanPath(path)
	if err != nil {
		return err
	}
	d.mu.Lock()
	err = d.client.Mkdir(webdavPath(c), 0o755)
	d.mu.Unlock()
	if err != nil {
		return mapWebDAVError(err)
	}
	return nil
}

// Rename 改名。
func (d *webdavDriver) Rename(ctx context.Context, path, newName string) error {
	target, err := Join(Parent(path), newName)
	if err != nil {
		return err
	}
	return d.moveTo(path, target)
}

// Move 移动到 targetDir 下。
func (d *webdavDriver) Move(ctx context.Context, path, targetDir string) error {
	target, err := Join(targetDir, BaseName(path))
	if err != nil {
		return err
	}
	return d.moveTo(path, target)
}

// moveTo WebDAV 的 MOVE 同时承担改名与移动。
func (d *webdavDriver) moveTo(from, to string) error {
	oldP, err := CleanPath(from)
	if err != nil {
		return err
	}
	newP, err := CleanPath(to)
	if err != nil {
		return err
	}
	if oldP == newP {
		return nil
	}
	// overwrite=false：目标已存在时服务端返回 412，这里翻译成 42005
	d.mu.Lock()
	err = d.client.Rename(webdavPath(oldP), webdavPath(newP), false)
	d.mu.Unlock()
	if err != nil {
		msg := err.Error()
		if strings.Contains(msg, "412") {
			return AlreadyExists("目标位置已存在同名文件或目录")
		}
		return mapWebDAVError(err)
	}
	return nil
}

// Remove 删除（WebDAV 的 DELETE 对非空目录即递归删）。
func (d *webdavDriver) Remove(ctx context.Context, path string, recursive bool) error {
	c, err := CleanPath(path)
	if err != nil {
		return err
	}
	d.mu.Lock()
	err = d.client.RemoveAll(webdavPath(c))
	d.mu.Unlock()
	if err != nil {
		return mapWebDAVError(err)
	}
	return nil
}

// Open 流式读。
func (d *webdavDriver) Open(ctx context.Context, path string) (io.ReadCloser, error) {
	c, err := CleanPath(path)
	if err != nil {
		return nil, err
	}
	d.mu.Lock()
	r, err := d.client.ReadStream(webdavPath(c))
	d.mu.Unlock()
	if err != nil {
		return nil, mapWebDAVError(err)
	}
	return r, nil
}

// OpenRange 分段读（ReadStreamRange：服务端不支持时库会自行退化为跳过 + 截断）。
func (d *webdavDriver) OpenRange(ctx context.Context, path string, offset, size int64) (io.ReadCloser, int64, error) {
	c, err := CleanPath(path)
	if err != nil {
		return nil, 0, err
	}
	d.mu.Lock()
	fi, serr := d.client.Stat(webdavPath(c))
	d.mu.Unlock()
	if serr != nil || fi == nil {
		return nil, 0, ErrRangeUnsupported
	}
	total := fi.Size()
	d.mu.Lock()
	r, err := d.client.ReadStreamRange(webdavPath(c), offset, size)
	d.mu.Unlock()
	if err != nil {
		return nil, 0, mapWebDAVError(err)
	}
	return r, total, nil
}

// Write 写入文件（长度已知时走 WriteStreamWithLength，避免库把整份内容读进内存）。
func (d *webdavDriver) Write(ctx context.Context, path string, r io.Reader, size int64) error {
	c, err := CleanPath(path)
	if err != nil {
		return err
	}
	d.mu.Lock()
	if size >= 0 {
		err = d.client.WriteStreamWithLength(webdavPath(c), r, size, 0o644)
	} else {
		err = d.client.WriteStream(webdavPath(c), r, 0o644)
	}
	d.mu.Unlock()
	if err != nil {
		return mapWebDAVError(err)
	}
	return nil
}

// Close WebDAV 无连接可关（每次请求独立），仅置标记。
func (d *webdavDriver) Close() error {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.closed = true
	return nil
}

// 编译期断言：WebDAV 驱动实现 Driver。
var _ Driver = (*webdavDriver)(nil)
