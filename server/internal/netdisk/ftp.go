package netdisk

import (
	"context"
	"io"
	"net"
	"strconv"
	"strings"
	"sync"

	"github.com/jlaffaye/ftp"
	"golang.org/x/text/encoding/simplifiedchinese"
	"golang.org/x/text/transform"
)

// ftpDriver FTP 驱动（jlaffaye/ftp，**仅被动模式 PASV/EPSV**）。
//
// 主动模式（PORT）在 New 阶段就返回 ErrFTPActiveMode：Go 生态主流 FTP 客户端库
// 均不支持主动模式，且它要求服务端反向连回部署机，云主机 / NAT 环境几乎不可用
// （详见 errors.go 的 ErrFTPActiveMode 注释与设计文档 §1.5）。
//
// 非并发安全：一个控制连接同时只能跑一个数据连接，由 SessionPool 串行化。
type ftpDriver struct {
	cfg  Config
	caps Caps

	mu     sync.Mutex
	conn   *ftp.ServerConn
	gbk    bool
	closed bool
}

// NewFTP 建立 FTP 控制连接并登录。
func NewFTP(cfg Config, creds *Credentials) (Driver, error) {
	if strings.TrimSpace(cfg.Host) == "" {
		return nil, ConfigInvalid("FTP 主机地址不能为空")
	}
	// ⚠️ 主动模式在入口就拒掉，不留任何「以为生效其实没生效」的空间
	if strings.EqualFold(strings.TrimSpace(cfg.Mode), "active") {
		return nil, ErrFTPActiveMode()
	}
	if creds == nil {
		creds = &Credentials{}
	}
	port := cfg.Port
	if port <= 0 {
		port = 21
	}
	addr := net.JoinHostPort(strings.TrimSpace(cfg.Host), strconv.Itoa(port))

	ctx, cancel := context.WithTimeout(context.Background(), dialTimeout)
	defer cancel()

	c, err := ftp.Dial(addr, ftp.DialWithTimeout(dialTimeout), ftp.DialWithContext(ctx))
	if err != nil {
		return nil, ConnectFailed("无法连接到 FTP 主机 " + addr + "：" + err.Error())
	}
	user := creds.Username
	pass := creds.Password
	if user == "" {
		// 匿名访问（PRD Q14 的建议值）：用户名密码都留空即匿名
		user, pass = "anonymous", "anonymous"
	}
	if err := c.Login(user, pass); err != nil {
		_ = c.Quit()
		return nil, AuthFailed("FTP 登录失败：" + err.Error())
	}
	root := cfg.RootPath
	if root == "" {
		root = "/"
	}
	return &ftpDriver{
		cfg:  cfg,
		caps: Caps{RangeRead: true, NativeMove: true, RecursiveRemove: true, NeedProxy: true, RootPath: root},
		conn: c,
		gbk:  strings.EqualFold(strings.TrimSpace(cfg.Encoding), "gbk"),
	}, nil
}

// Kind 协议类型。
func (d *ftpDriver) Kind() string { return KindFTP }

// Caps 能力位。
func (d *ftpDriver) Caps() Caps { return d.caps }

// Test 列一次根目录。
func (d *ftpDriver) Test(ctx context.Context) error {
	_, err := d.List(ctx, d.caps.RootPath)
	return err
}

// encodePath 发给服务端前的路径编码（gbk 时 UTF-8 → GBK）。
func (d *ftpDriver) encodePath(p string) (string, error) {
	c, err := CleanPath(p)
	if err != nil {
		return "", err
	}
	if !d.gbk {
		return c, nil
	}
	s, _, err := transform.String(simplifiedchinese.GBK.NewEncoder(), c)
	if err != nil {
		// 转不出来就用原串（GBK 无法表示的部分会变成 '?'，总比直接失败好）
		return c, nil
	}
	return s, nil
}

// decodeName 服务端返回名称 → UTF-8。
func (d *ftpDriver) decodeName(s string) string {
	if !d.gbk || s == "" {
		return s
	}
	out, _, err := transform.String(simplifiedchinese.GBK.NewDecoder(), s)
	if err != nil {
		return s
	}
	return out
}

// List 列目录。
func (d *ftpDriver) List(ctx context.Context, path string) ([]Entry, error) {
	sp, c, err := d.prep(path)
	if err != nil {
		return nil, err
	}
	d.mu.Lock()
	items, err := d.conn.List(sp)
	d.mu.Unlock()
	if err != nil {
		return nil, MapError(err)
	}
	out := make([]Entry, 0, len(items))
	for _, it := range items {
		name := d.decodeName(ftpBaseName(it.Name))
		if name == "" || name == "." || name == ".." {
			continue
		}
		p, err := Join(c, name)
		if err != nil {
			continue
		}
		out = append(out, Entry{
			Name:    name,
			Path:    p,
			IsDir:   it.Type == ftp.EntryTypeFolder,
			Size:    int64(it.Size),
			ModTime: it.Time,
		})
	}
	sortEntries(out)
	return out, nil
}

// Stat 单条目元信息（优先用 MLST，服务端不支持时退化为在父目录里找）。
func (d *ftpDriver) Stat(ctx context.Context, path string) (*Entry, error) {
	sp, c, err := d.prep(path)
	if err != nil {
		return nil, err
	}
	d.mu.Lock()
	e, err := d.conn.GetEntry(sp)
	d.mu.Unlock()
	if err == nil && e != nil {
		return &Entry{
			Name:    BaseName(c),
			Path:    c,
			IsDir:   e.Type == ftp.EntryTypeFolder,
			Size:    int64(e.Size),
			ModTime: e.Time,
		}, nil
	}
	// 退化：列父目录，按名称匹配
	parent := Parent(c)
	list, lerr := d.List(ctx, parent)
	if lerr != nil {
		if err != nil {
			return nil, MapError(err)
		}
		return nil, lerr
	}
	for _, it := range list {
		if it.Path == c {
			cp := it
			return &cp, nil
		}
	}
	return nil, PathNotFound("FTP 路径不存在：" + c)
}

// prep 统一做「CleanPath + 编码」，返回服务端路径与规范路径。
func (d *ftpDriver) prep(path string) (string, string, error) {
	c, err := CleanPath(path)
	if err != nil {
		return "", "", err
	}
	sp, err := d.encodePath(c)
	if err != nil {
		return "", "", err
	}
	if sp == "" {
		sp = "/"
	}
	return sp, c, nil
}

// Mkdir 新建目录。
func (d *ftpDriver) Mkdir(ctx context.Context, path string) error {
	sp, _, err := d.prep(path)
	if err != nil {
		return err
	}
	d.mu.Lock()
	err = d.conn.MakeDir(sp)
	d.mu.Unlock()
	if err != nil {
		return MapError(err)
	}
	return nil
}

// Rename 改名。
func (d *ftpDriver) Rename(ctx context.Context, path, newName string) error {
	target, err := Join(Parent(path), newName)
	if err != nil {
		return err
	}
	return d.moveTo(path, target)
}

// Move 移动到 targetDir 下。
func (d *ftpDriver) Move(ctx context.Context, path, targetDir string) error {
	target, err := Join(targetDir, BaseName(path))
	if err != nil {
		return err
	}
	return d.moveTo(path, target)
}

// moveTo FTP 的 RNFR/RNTO 同时承担改名与移动。
func (d *ftpDriver) moveTo(from, to string) error {
	oldP, _, err := d.prep(from)
	if err != nil {
		return err
	}
	newP, _, err := d.prep(to)
	if err != nil {
		return err
	}
	if oldP == newP {
		return nil
	}
	d.mu.Lock()
	err = d.conn.Rename(oldP, newP)
	d.mu.Unlock()
	if err != nil {
		return MapError(err)
	}
	return nil
}

// Remove 删除；recursive=true 时用库自带的 RemoveDirRecur。
func (d *ftpDriver) Remove(ctx context.Context, path string, recursive bool) error {
	sp, _, err := d.prep(path)
	if err != nil {
		return err
	}
	d.mu.Lock()
	if recursive {
		err = d.conn.RemoveDirRecur(sp)
		if err != nil {
			// 非目录（是文件）时递归删会失败 → 退化为删文件
			err2 := d.conn.Delete(sp)
			if err2 != nil {
				d.mu.Unlock()
				return MapError(err)
			}
			err = nil
		}
	} else {
		err = d.conn.Delete(sp)
		if err != nil {
			err2 := d.conn.RemoveDir(sp)
			if err2 != nil {
				d.mu.Unlock()
				return MapError(err)
			}
			err = nil
		}
	}
	d.mu.Unlock()
	return nil
}

// Open 流式读。
func (d *ftpDriver) Open(ctx context.Context, path string) (io.ReadCloser, error) {
	sp, _, err := d.prep(path)
	if err != nil {
		return nil, err
	}
	d.mu.Lock()
	r, err := d.conn.Retr(sp)
	d.mu.Unlock()
	if err != nil {
		return nil, MapError(err)
	}
	return &ftpReader{d: d, r: r}, nil
}

// OpenRange 分段读（靠 REST + RETR，即 RetrFrom）。
func (d *ftpDriver) OpenRange(ctx context.Context, path string, offset, size int64) (io.ReadCloser, int64, error) {
	sp, _, err := d.prep(path)
	if err != nil {
		return nil, 0, err
	}
	d.mu.Lock()
	total, serr := d.conn.FileSize(sp)
	d.mu.Unlock()
	if serr != nil {
		// 拿不到总长（部分服务端不支持 SIZE）→ 交给上层按不支持 Range 处理
		return nil, 0, ErrRangeUnsupported
	}
	d.mu.Lock()
	r, err := d.conn.RetrFrom(sp, uint64(offset))
	d.mu.Unlock()
	if err != nil {
		return nil, 0, MapError(err)
	}
	var body io.Reader = r
	if size > 0 {
		body = io.LimitReader(r, size)
	}
	return &ftpReader{d: d, r: r, body: body}, total, nil
}

// Write 写入文件。
func (d *ftpDriver) Write(ctx context.Context, path string, r io.Reader, size int64) error {
	sp, _, err := d.prep(path)
	if err != nil {
		return err
	}
	d.mu.Lock()
	err = d.conn.Stor(sp, r)
	d.mu.Unlock()
	if err != nil {
		return MapError(err)
	}
	return nil
}

// Close 关闭控制连接。
func (d *ftpDriver) Close() error {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.closed {
		return nil
	}
	d.closed = true
	if d.conn == nil {
		return nil
	}
	if err := d.conn.Quit(); err != nil {
		return ConnectFailed(err.Error())
	}
	return nil
}

// ftpReader 包装 FTP 数据连接：Close 会读回「数据传输结束」状态，必须串行。
type ftpReader struct {
	d    *ftpDriver
	r    *ftp.Response
	body io.Reader
}

func (r *ftpReader) Read(p []byte) (int, error) {
	r.d.mu.Lock()
	defer r.d.mu.Unlock()
	if r.body != nil {
		return r.body.Read(p)
	}
	return r.r.Read(p)
}

func (r *ftpReader) Close() error {
	r.d.mu.Lock()
	defer r.d.mu.Unlock()
	return r.r.Close()
}

// ftpBaseName 取 FTP LIST 回传名称的末段。
// 部分服务端在 LIST 里回传的是「完整路径」而不是单纯文件名，统一截取末段。
func ftpBaseName(name string) string {
	n := strings.TrimSpace(name)
	if n == "" {
		return ""
	}
	n = strings.ReplaceAll(n, `\`, "/")
	if i := strings.LastIndex(n, "/"); i >= 0 {
		n = n[i+1:]
	}
	return n
}

// 编译期断言：各协议驱动都实现 Driver（漏实现方法会在编译期就炸，而不是运行时）。
var (
	_ Driver = (*ftpDriver)(nil)
	_ Driver = (*smbDriver)(nil)
)
