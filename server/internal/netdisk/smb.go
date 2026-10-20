package netdisk

import (
	"context"
	"io"
	"net"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/hirochachacha/go-smb2"
)

// dialTimeout 建连 / 认证的超时（设计文档：单个操作 15s）。
const dialTimeout = 15 * time.Second

// smbDriver SMB2/3 驱动（hirochachacha/go-smb2）。
//
// 能力：只支持 NTLMv2（不支持 Kerberos）；匿名连接会退化成 Guest 账号
// （go-smb2 明确不支持空用户的 NTLM，见其 Dialer.DialContext 的校验）。
//
// 非并发安全：SMB 会话同一时刻只能跑一个请求，由 SessionPool 的 entry.mu 串行化。
type smbDriver struct {
	cfg  Config
	caps Caps

	mu      sync.Mutex
	conn    net.Conn
	session *smb2.Session
	share   *smb2.Share
	closed  bool
}

// SMBShareInfo 列举出的共享及其权限探测结果（用于「新增 SMB 网盘」两步流程）。
type SMBShareInfo struct {
	// Name 共享名（如 homes / public）
	Name string `json:"name"`
	// Readable 能否挂载并读取（能挂载即视为可读）
	Readable bool `json:"readable"`
	// Writable 是否可写（通过「建临时目录 + 删除」探针判定）
	Writable bool `json:"writable"`
	// Error 探测失败时的可读原因（如认证失败 / 无权限）
	Error string `json:"error,omitempty"`
}

// dialSMB 仅建连 + 认证（**不挂载业务共享**），用于列举共享等「连接级」操作。
//
// 抽出这一步，是因为「列举共享」需要先拿到 *smb2.Session（ListSharenames 内部会自行
// 挂 IPC$ 做 MS-RPC），而 NewSMB 走的是「认证 + 挂业务共享」两条路。
func dialSMB(cfg Config, creds *Credentials) (*smb2.Session, net.Conn, error) {
	if strings.TrimSpace(cfg.Host) == "" {
		return nil, nil, ConfigInvalid("SMB 主机地址不能为空")
	}
	if creds == nil {
		creds = &Credentials{}
	}
	port := cfg.Port
	if port <= 0 {
		port = 445
	}
	addr := net.JoinHostPort(strings.TrimSpace(cfg.Host), strconv.Itoa(port))

	ctx, cancel := context.WithTimeout(context.Background(), dialTimeout)
	defer cancel()

	var d net.Dialer
	conn, err := d.DialContext(ctx, "tcp", addr)
	if err != nil {
		return nil, nil, ConnectFailed("无法连接到 SMB 主机 " + addr + "：" + err.Error())
	}

	user := creds.Username
	if user == "" {
		// 匿名：go-smb2 不支持空用户，退化成 Guest（空口令）
		user = "Guest"
	}
	dialer := &smb2.Dialer{
		Initiator: &smb2.NTLMInitiator{
			User:     user,
			Password: creds.Password,
			Domain:   creds.Domain,
		},
	}
	session, err := dialer.DialContext(ctx, conn)
	if err != nil {
		_ = conn.Close()
		return nil, nil, mapSMBError(err)
	}
	return session, conn, nil
}

// NewSMB 建立 SMB 会话并挂载共享目录。
func NewSMB(cfg Config, creds *Credentials) (Driver, error) {
	if strings.TrimSpace(cfg.Share) == "" {
		return nil, ConfigInvalid("SMB 共享名（share）不能为空")
	}
	session, conn, err := dialSMB(cfg, creds)
	if err != nil {
		return nil, err
	}
	share, err := session.Mount(strings.TrimSpace(cfg.Share))
	if err != nil {
		_ = session.Logoff()
		_ = conn.Close()
		return nil, mapSMBError(err)
	}
	root := cfg.RootPath
	if root == "" {
		root = "/"
	}
	return &smbDriver{
		cfg:     cfg,
		caps:    Caps{RangeRead: true, NativeMove: true, RecursiveRemove: true, NeedProxy: true, RootPath: root},
		conn:    conn,
		session: session,
		share:   share,
	}, nil
}

// ListSMBShares 建立会话后枚举服务器上的全部共享，并逐个探测可读 / 可写权限。
//
// 不挂载业务共享、不落库，仅用于「新增 SMB 网盘」两步流程里把「服务器」与「共享」拆开：
// 第 1 步填 IP / 账号；第 2 步在这里拿到共享清单供用户勾选。
// 探测写权限的方式是在共享根建一个隐藏临时目录再删除（自清理，副作用极小）；
// IPC$ 与 print$ 是非文件系统共享，直接跳过。
func ListSMBShares(cfg Config, creds *Credentials) ([]SMBShareInfo, error) {
	session, conn, err := dialSMB(cfg, creds)
	if err != nil {
		return nil, err
	}
	defer func() {
		_ = session.Logoff()
		_ = conn.Close()
	}()

	names, err := session.ListSharenames()
	if err != nil {
		return nil, mapSMBError(err)
	}
	sort.Strings(names)

	infos := make([]SMBShareInfo, 0, len(names))
	for _, name := range names {
		if strings.EqualFold(name, "IPC$") || strings.EqualFold(name, "print$") {
			continue
		}
		info := SMBShareInfo{Name: name}
		share, merr := session.Mount(name)
		if merr != nil {
			info.Error = mapSMBError(merr).Error()
			infos = append(infos, info)
			continue
		}
		// 能挂载即视为可读；再探测可写。
		info.Readable = true
		probe := ".hk_probe_" + strconv.FormatInt(time.Now().UnixNano(), 36)
		if cerr := share.Mkdir(probe, 0o755); cerr == nil {
			info.Writable = true
			_ = share.Remove(probe)
		}
		_ = share.Umount()
		infos = append(infos, info)
	}
	return infos, nil
}

// mapSMBError SMB 原始错误 → 统一业务错误（挂载失败绝大多数是共享名不存在 / 无权限）。
func mapSMBError(err error) error {
	if err == nil {
		return nil
	}
	if IsAppError(err) {
		return err
	}
	msg := err.Error()
	low := strings.ToLower(msg)
	switch {
	case strings.Contains(low, "status_logon_failure"),
		strings.Contains(low, "status_access_denied"),
		strings.Contains(low, "status_account"),
		strings.Contains(low, "authentication"):
		return AuthFailed("SMB 认证失败，请检查用户名 / 密码 / 域")
	case strings.Contains(low, "status_bad_network_name"),
		strings.Contains(low, "status_object_name_not_found"),
		strings.Contains(low, "status_not_found"):
		return ConnectFailed("SMB 共享名不存在或路径不可达：" + msg)
	default:
		return MapError(err)
	}
}

// smbPath 把统一口径的 '/a/b' 转成 go-smb2 需要的 'a\b'（根为 ""）。
func smbPath(p string) string {
	c, err := CleanPath(p)
	if err != nil {
		return ""
	}
	if c == "/" {
		return ""
	}
	return strings.ReplaceAll(strings.TrimPrefix(c, "/"), "/", `\`)
}

// Kind 协议类型。
func (d *smbDriver) Kind() string { return KindSMB }

// Caps 能力位。
func (d *smbDriver) Caps() Caps { return d.caps }

// Test 列一次根目录即可证明可用。
func (d *smbDriver) Test(ctx context.Context) error {
	_, err := d.List(ctx, d.caps.RootPath)
	return err
}

// List 列目录（目录优先，同类型按名称排序）。
func (d *smbDriver) List(ctx context.Context, path string) ([]Entry, error) {
	c, err := CleanPath(path)
	if err != nil {
		return nil, err
	}
	d.mu.Lock()
	fs := d.share.WithContext(ctx)
	d.mu.Unlock()
	infos, err := fs.ReadDir(smbPath(c))
	if err != nil {
		return nil, mapSMBError(err)
	}
	return fileInfosToEntries(infos, c), nil
}

// Stat 单条目元信息。
func (d *smbDriver) Stat(ctx context.Context, path string) (*Entry, error) {
	c, err := CleanPath(path)
	if err != nil {
		return nil, err
	}
	d.mu.Lock()
	fs := d.share.WithContext(ctx)
	d.mu.Unlock()
	fi, err := fs.Stat(smbPath(c))
	if err != nil {
		return nil, mapSMBError(err)
	}
	return &Entry{
		Name:    BaseName(c),
		Path:    c,
		IsDir:   fi.IsDir(),
		Size:    fi.Size(),
		ModTime: fi.ModTime(),
	}, nil
}

// Mkdir 新建目录（父目录必须已存在）。
func (d *smbDriver) Mkdir(ctx context.Context, path string) error {
	c, err := CleanPath(path)
	if err != nil {
		return err
	}
	d.mu.Lock()
	fs := d.share.WithContext(ctx)
	d.mu.Unlock()
	if err := fs.Mkdir(smbPath(c), 0o755); err != nil {
		return mapSMBError(err)
	}
	return nil
}

// Rename 改名（newName 不含路径）。
func (d *smbDriver) Rename(ctx context.Context, path, newName string) error {
	target, err := Join(Parent(path), newName)
	if err != nil {
		return err
	}
	return d.moveTo(ctx, path, target)
}

// Move 移动到 targetDir 下。
func (d *smbDriver) Move(ctx context.Context, path, targetDir string) error {
	target, err := Join(targetDir, BaseName(path))
	if err != nil {
		return err
	}
	return d.moveTo(ctx, path, target)
}

// moveTo SMB 的 Rename 同时承担改名与移动（同一 share 内）。
func (d *smbDriver) moveTo(ctx context.Context, from, to string) error {
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
	d.mu.Lock()
	fs := d.share.WithContext(ctx)
	d.mu.Unlock()
	if err := fs.Rename(smbPath(oldP), smbPath(newP)); err != nil {
		return mapSMBError(err)
	}
	return nil
}

// Remove 删除；recursive=true 时递归删非空目录（go-smb2 无 RemoveAll，自行实现）。
func (d *smbDriver) Remove(ctx context.Context, path string, recursive bool) error {
	c, err := CleanPath(path)
	if err != nil {
		return err
	}
	d.mu.Lock()
	fs := d.share.WithContext(ctx)
	d.mu.Unlock()
	if recursive {
		return d.removeAll(fs, c)
	}
	if err := fs.Remove(smbPath(c)); err != nil {
		return mapSMBError(err)
	}
	return nil
}

// removeAll 先删子节点再删自身（深度优先）。
func (d *smbDriver) removeAll(fs *smb2.Share, dir string) error {
	kids, err := fs.ReadDir(smbPath(dir))
	if err != nil {
		// 读不出来就当作普通条目直接删（可能是文件）
		if err := fs.Remove(smbPath(dir)); err != nil {
			return mapSMBError(err)
		}
		return nil
	}
	for _, fi := range kids {
		child, err := Join(dir, fi.Name())
		if err != nil {
			return err
		}
		if fi.IsDir() {
			if err := d.removeAll(fs, child); err != nil {
				return err
			}
			continue
		}
		if err := fs.Remove(smbPath(child)); err != nil {
			return mapSMBError(err)
		}
	}
	if err := fs.Remove(smbPath(dir)); err != nil {
		return mapSMBError(err)
	}
	return nil
}

// Open 流式读。
func (d *smbDriver) Open(ctx context.Context, path string) (io.ReadCloser, error) {
	c, err := CleanPath(path)
	if err != nil {
		return nil, err
	}
	d.mu.Lock()
	fs := d.share.WithContext(ctx)
	d.mu.Unlock()
	f, err := fs.Open(smbPath(c))
	if err != nil {
		return nil, mapSMBError(err)
	}
	return &smbFile{f: f, fs: fs}, nil
}

// OpenRange 分段读（SMB 支持随机读，用 Seek + LimitReader 实现）。
func (d *smbDriver) OpenRange(ctx context.Context, path string, offset, size int64) (io.ReadCloser, int64, error) {
	c, err := CleanPath(path)
	if err != nil {
		return nil, 0, err
	}
	d.mu.Lock()
	fs := d.share.WithContext(ctx)
	d.mu.Unlock()
	fi, err := fs.Stat(smbPath(c))
	if err != nil {
		return nil, 0, mapSMBError(err)
	}
	total := fi.Size()
	f, err := fs.Open(smbPath(c))
	if err != nil {
		return nil, 0, mapSMBError(err)
	}
	if offset > 0 {
		if _, err := f.Seek(offset, io.SeekStart); err != nil {
			_ = f.Close()
			return nil, 0, mapSMBError(err)
		}
	}
	var body io.Reader = f
	if size > 0 {
		body = io.LimitReader(f, size)
	}
	return &smbFile{f: f, fs: fs, r: body}, total, nil
}

// Write 写入文件（覆盖式）。size<0 表示长度未知。
func (d *smbDriver) Write(ctx context.Context, path string, r io.Reader, size int64) error {
	c, err := CleanPath(path)
	if err != nil {
		return err
	}
	d.mu.Lock()
	fs := d.share.WithContext(ctx)
	d.mu.Unlock()
	f, err := fs.Create(smbPath(c))
	if err != nil {
		return mapSMBError(err)
	}
	if _, err := io.Copy(f, r); err != nil {
		_ = f.Close()
		return mapSMBError(err)
	}
	if err := f.Close(); err != nil {
		return mapSMBError(err)
	}
	return nil
}

// Close 释放会话（Umount + Logoff + 关 TCP）。
func (d *smbDriver) Close() error {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.closed {
		return nil
	}
	d.closed = true
	var errs []string
	if d.share != nil {
		if err := d.share.Umount(); err != nil {
			errs = append(errs, err.Error())
		}
	}
	if d.session != nil {
		_ = d.session.Logoff()
	}
	if d.conn != nil {
		if err := d.conn.Close(); err != nil {
			errs = append(errs, err.Error())
		}
	}
	if len(errs) > 0 {
		return ConnectFailed(strings.Join(errs, "; "))
	}
	return nil
}

// smbFile 包装 go-smb2 的 *File：Close 必须走同一个 Share 上下文，
// 且 SMB 会话非并发安全，读也要串行。
type smbFile struct {
	fs *smb2.Share
	f  *smb2.File
	r  io.Reader
	mu sync.Mutex
}

func (f *smbFile) Read(p []byte) (int, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.r != nil {
		return f.r.Read(p)
	}
	return f.f.Read(p)
}

func (f *smbFile) Close() error {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.f.Close()
}

// ---------- 公共：os.FileInfo → Entry ----------

// fileInfosToEntries 目录项转换 + 排序（目录优先，其次按名称）。
// 各协议共用，保证「目录优先」的表现完全一致。
func fileInfosToEntries(infos []os.FileInfo, dir string) []Entry {
	out := make([]Entry, 0, len(infos))
	for _, fi := range infos {
		name := fi.Name()
		if name == "." || name == ".." {
			continue
		}
		p, err := Join(dir, name)
		if err != nil {
			continue
		}
		out = append(out, Entry{
			Name:    name,
			Path:    p,
			IsDir:   fi.IsDir(),
			Size:    fi.Size(),
			ModTime: fi.ModTime(),
		})
	}
	sortEntries(out)
	return out
}

// sortEntries 目录优先 + 名称升序（大小写不敏感）。
func sortEntries(list []Entry) {
	sort.Slice(list, func(i, j int) bool {
		if list[i].IsDir != list[j].IsDir {
			return list[i].IsDir
		}
		return strings.ToLower(list[i].Name) < strings.ToLower(list[j].Name)
	})
}
