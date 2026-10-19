package netdisk

import (
	"bytes"
	"context"
	"crypto/md5"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

// 百度网盘开放平台端点（只用标准库 net/http，避免引入 SDK）。
const (
	baiduAuthURL  = "https://openapi.baidu.com/oauth/2.0/authorize"
	baiduTokenURL = "https://openapi.baidu.com/oauth/2.0/token"
	baiduAPIBase  = "https://pan.baidu.com/rest/2.0/xpan"
	baiduScope    = "basic,netdisk"
	// baiduSliceSize 默认分片大小；文件更大时按「≤1024 片」自动上调。
	baiduSliceSize = 4 << 20
	baiduMaxSlice  = 1024
)

// baiduDriver 百度网盘 OAuth2 + REST 驱动。
//
// 硬约束（PRD §1.1）：百度强制**应用目录隔离** —— 三方应用只能访问
// `/apps/<appname>` 下的数据，RootPath 恒为 /apps/<baidu_app_name>，UI 必须明示。
// 因此 RecursiveRemove=false（批量删除走 filemanager，风险高，UI 不开放递归删）。
type baiduDriver struct {
	cfg  Config
	caps Caps
	http *http.Client

	mu        sync.Mutex
	creds     *Credentials
	appName   string
	onRefresh func(*Credentials) error // token 刷新后回写数据库（由 service 注入）
}

// baiduResp 所有百度响应的公共部分（errno 判错统一走它）。
type baiduResp interface{ ErrnoCode() int }

// baiduBase 嵌入到各响应体里以获得 ErrnoCode()。
type baiduBase struct {
	Errno int `json:"errno"`
}

// ErrnoCode 实现 baiduResp。
func (b *baiduBase) ErrnoCode() int { return b.Errno }

// baiduListResp 列目录响应。
type baiduListResp struct {
	baiduBase
	List []struct {
		FsID       uint64 `json:"fs_id"`
		Path       string `json:"path"`
		ServerName string `json:"server_filename"`
		Size       int64  `json:"size"`
		IsDir      int    `json:"isdir"`
		Mtime      int64  `json:"server_mtime"`
	} `json:"list"`
}

// baiduSimpleResp 只有 errno 的响应（create / mkdir / filemanager）。
type baiduSimpleResp struct {
	baiduBase
}

// baiduPrecreateResp precreate 响应（返回 uploadid）。
type baiduPrecreateResp struct {
	baiduBase
	UploadID string `json:"uploadid"`
}

// baiduMetaResp 取下载直链响应。
type baiduMetaResp struct {
	baiduBase
	List []struct {
		DLink string `json:"dlink"`
	} `json:"list"`
}

// NewBaidu 构造百度网盘驱动（不发请求，token 有效性在首次操作时校验）。
func NewBaidu(cfg Config, creds *Credentials) (Driver, error) {
	if creds == nil || creds.AccessToken == "" {
		return nil, ErrReauthRequired
	}
	appName := strings.TrimSpace(CurrentConfig().BaiduAppName)
	if appName == "" {
		appName = "haiku-wiki"
	}
	root := cfg.RootPath
	if root == "" {
		root = "/apps/" + appName
	}
	return &baiduDriver{
		cfg:     cfg,
		caps:    Caps{RangeRead: true, NativeMove: true, RecursiveRemove: false, NeedProxy: true, RootPath: root},
		http:    &http.Client{Timeout: dialTimeout},
		creds:   creds,
		appName: appName,
	}, nil
}

// SetTokenRefresher 注入 token 刷新后的回写钩子（service 层用它把新 token 落库）。
func (d *baiduDriver) SetTokenRefresher(fn func(*Credentials) error) {
	d.mu.Lock()
	d.onRefresh = fn
	d.mu.Unlock()
}

// Kind 协议类型。
func (d *baiduDriver) Kind() string { return KindBaidu }

// Caps 能力位。
func (d *baiduDriver) Caps() Caps { return d.caps }

// AuthorizeURL 生成百度授权页 URL（display=tv&qrcode=1 出二维码，适合 PC 端扫码）。
func BaiduAuthorizeURL(clientID, redirectURI, state string) string {
	q := url.Values{}
	q.Set("response_type", "code")
	q.Set("client_id", clientID)
	q.Set("redirect_uri", redirectURI)
	q.Set("scope", baiduScope)
	q.Set("state", state)
	q.Set("display", "tv")
	q.Set("qrcode", "1")
	q.Set("force_login", "1")
	return baiduAuthURL + "?" + q.Encode()
}

// ExchangeBaiduToken 用 code 换 token（OAuth 回调）。
func ExchangeBaiduToken(ctx context.Context, clientID, clientSecret, redirectURI, code string) (*Credentials, error) {
	form := url.Values{}
	form.Set("grant_type", "authorization_code")
	form.Set("code", code)
	form.Set("client_id", clientID)
	form.Set("client_secret", clientSecret)
	form.Set("redirect_uri", redirectURI)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, baiduTokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, AuthFailed("构造百度授权请求失败")
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, ConnectFailed("百度授权请求失败：" + err.Error())
	}
	defer resp.Body.Close()
	var out struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		ExpiresIn    int    `json:"expires_in"`
		Error        string `json:"error"`
		ErrorDesc    string `json:"error_description"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, AuthFailed("百度授权响应解析失败")
	}
	if out.AccessToken == "" {
		msg := out.ErrorDesc
		if msg == "" {
			msg = out.Error
		}
		if msg == "" {
			msg = "百度授权未返回 access_token"
		}
		return nil, AuthFailed(msg)
	}
	return &Credentials{
		AccessToken:  out.AccessToken,
		RefreshToken: out.RefreshToken,
		TokenExpire:  time.Now().Add(time.Duration(out.ExpiresIn) * time.Second),
	}, nil
}

// token 取当前 access_token（临近过期时先刷新）。
func (d *baiduDriver) token(ctx context.Context) (string, error) {
	d.mu.Lock()
	c := d.creds
	d.mu.Unlock()
	if c == nil || c.AccessToken == "" {
		return "", ErrReauthRequired
	}
	if !c.TokenExpire.IsZero() && time.Until(c.TokenExpire) < 5*time.Minute {
		if err := d.refresh(ctx); err != nil {
			return "", err
		}
		d.mu.Lock()
		c = d.creds
		d.mu.Unlock()
	}
	return c.AccessToken, nil
}

// refresh 用 refresh_token 换新 token；失败 → 42009 需要重新授权。
func (d *baiduDriver) refresh(ctx context.Context) error {
	cfg := CurrentConfig()
	d.mu.Lock()
	rt := d.creds.RefreshToken
	d.mu.Unlock()
	if rt == "" || cfg.BaiduAppKey == "" || cfg.BaiduAppSecret == "" {
		return ErrReauthRequired
	}
	form := url.Values{}
	form.Set("grant_type", "refresh_token")
	form.Set("refresh_token", rt)
	form.Set("client_id", cfg.BaiduAppKey)
	form.Set("client_secret", cfg.BaiduAppSecret)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, baiduTokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return ErrReauthRequired
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := d.http.Do(req)
	if err != nil {
		return ErrReauthRequired
	}
	defer resp.Body.Close()
	var out struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		ExpiresIn    int    `json:"expires_in"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil || out.AccessToken == "" {
		return ErrReauthRequired
	}
	d.mu.Lock()
	d.creds.AccessToken = out.AccessToken
	if out.RefreshToken != "" {
		d.creds.RefreshToken = out.RefreshToken
	}
	if out.ExpiresIn > 0 {
		d.creds.TokenExpire = time.Now().Add(time.Duration(out.ExpiresIn) * time.Second)
	}
	fn := d.onRefresh
	next := d.creds
	d.mu.Unlock()
	if fn != nil {
		// 回写失败不影响本次使用（token 已在内存里，下次操作还会再刷）
		_ = fn(next)
	}
	return nil
}

// Test 列一次根目录。
func (d *baiduDriver) Test(ctx context.Context) error {
	_, err := d.List(ctx, d.caps.RootPath)
	return err
}

// List 列目录。
func (d *baiduDriver) List(ctx context.Context, path string) ([]Entry, error) {
	c, err := CleanPath(path)
	if err != nil {
		return nil, err
	}
	tk, err := d.token(ctx)
	if err != nil {
		return nil, err
	}
	q := url.Values{}
	q.Set("method", "list")
	q.Set("access_token", tk)
	q.Set("dir", c)
	q.Set("order", "name")
	q.Set("limit", "1000")
	var out baiduListResp
	if err := d.apiGet(ctx, baiduAPIBase+"/file?"+q.Encode(), &out); err != nil {
		return nil, err
	}
	list := make([]Entry, 0, len(out.List))
	for _, it := range out.List {
		p, jerr := Join(c, it.ServerName)
		if jerr != nil {
			continue
		}
		t := time.Now()
		if it.Mtime > 0 {
			t = time.Unix(it.Mtime, 0)
		}
		list = append(list, Entry{
			Name:    it.ServerName,
			Path:    p,
			IsDir:   it.IsDir == 1,
			Size:    it.Size,
			ModTime: t,
		})
	}
	sortEntries(list)
	return list, nil
}

// Stat 单条目元信息（百度没有单文件 stat，退化为在父目录里找）。
func (d *baiduDriver) Stat(ctx context.Context, path string) (*Entry, error) {
	c, err := CleanPath(path)
	if err != nil {
		return nil, err
	}
	if IsRoot(c) {
		return &Entry{Name: "/", Path: "/", IsDir: true}, nil
	}
	list, err := d.List(ctx, Parent(c))
	if err != nil {
		return nil, err
	}
	for _, it := range list {
		if it.Path == c {
			cp := it
			return &cp, nil
		}
	}
	return nil, PathNotFound("百度网盘路径不存在：" + c)
}

// Mkdir 新建目录。
func (d *baiduDriver) Mkdir(ctx context.Context, path string) error {
	c, err := CleanPath(path)
	if err != nil {
		return err
	}
	tk, err := d.token(ctx)
	if err != nil {
		return err
	}
	form := url.Values{}
	form.Set("method", "create")
	form.Set("access_token", tk)
	form.Set("path", c)
	form.Set("size", "0")
	form.Set("isdir", "1")
	var out baiduSimpleResp
	return d.apiPost(ctx, baiduAPIBase+"/file?", form, &out)
}

// Rename 改名（走 filemanager 的 rename）。
func (d *baiduDriver) Rename(ctx context.Context, path, newName string) error {
	target, err := Join(Parent(path), newName)
	if err != nil {
		return err
	}
	return d.manage(ctx, "rename", path, target)
}

// Move 移动到 targetDir 下。
func (d *baiduDriver) Move(ctx context.Context, path, targetDir string) error {
	target, err := Join(targetDir, BaseName(path))
	if err != nil {
		return err
	}
	return d.manage(ctx, "move", path, target)
}

// Remove 删除。recursive 对百度无意义（delete 本身就是整棵子树），故 RecursiveRemove=false。
func (d *baiduDriver) Remove(ctx context.Context, path string, recursive bool) error {
	return d.manage(ctx, "delete", path, "")
}

// manage 走 /filemanager 的批量接口（rename / move / delete）。
func (d *baiduDriver) manage(ctx context.Context, opera, from, to string) error {
	src, err := CleanPath(from)
	if err != nil {
		return err
	}
	tk, err := d.token(ctx)
	if err != nil {
		return err
	}
	item := map[string]string{"path": src}
	if to != "" {
		dst, cerr := CleanPath(to)
		if cerr != nil {
			return cerr
		}
		item["dest"] = dst
		item["newname"] = BaseName(dst)
	}
	body, err := json.Marshal([]map[string]string{item})
	if err != nil {
		return ConfigInvalid("构造请求失败")
	}
	form := url.Values{}
	form.Set("method", "filemanager")
	form.Set("access_token", tk)
	form.Set("opera", opera)
	form.Set("async", "0")
	form.Set("filelist", string(body))
	var out baiduSimpleResp
	return d.apiPost(ctx, baiduAPIBase+"/file?", form, &out)
}

// Open 流式读：先换下载直链，再 http.Get（对上层与其他协议完全一致）。
func (d *baiduDriver) Open(ctx context.Context, path string) (io.ReadCloser, error) {
	link, err := d.downloadLink(ctx, path)
	if err != nil {
		return nil, err
	}
	return d.openHTTP(ctx, link, 0, 0)
}

// OpenRange 分段读（下载直链支持 Range）。
func (d *baiduDriver) OpenRange(ctx context.Context, path string, offset, size int64) (io.ReadCloser, int64, error) {
	link, err := d.downloadLink(ctx, path)
	if err != nil {
		return nil, 0, err
	}
	total := int64(0)
	if e, serr := d.Stat(ctx, path); serr == nil && e != nil {
		total = e.Size
	}
	rc, err := d.openHTTP(ctx, link, offset, size)
	if err != nil {
		return nil, 0, err
	}
	return rc, total, nil
}

// downloadLink 换取下载直链（dlink + access_token）。
func (d *baiduDriver) downloadLink(ctx context.Context, path string) (string, error) {
	c, err := CleanPath(path)
	if err != nil {
		return "", err
	}
	tk, err := d.token(ctx)
	if err != nil {
		return "", err
	}
	q := url.Values{}
	q.Set("method", "filemetadata")
	q.Set("access_token", tk)
	q.Set("dlink", "1")
	q.Set("path", c)
	var out baiduMetaResp
	if err := d.apiGet(ctx, baiduAPIBase+"/multimedia?"+q.Encode(), &out); err != nil {
		return "", err
	}
	if len(out.List) == 0 || out.List[0].DLink == "" {
		return "", PathNotFound("百度网盘未返回下载链接：" + c)
	}
	return out.List[0].DLink + "&access_token=" + tk, nil
}

// openHTTP 带 Range 地取直链内容（百度直链要求 User-Agent: pan.baidu.com）。
func (d *baiduDriver) openHTTP(ctx context.Context, link string, offset, size int64) (io.ReadCloser, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, link, nil)
	if err != nil {
		return nil, ConnectFailed("构造下载请求失败")
	}
	req.Header.Set("User-Agent", "pan.baidu.com")
	if size > 0 {
		req.Header.Set("Range", "bytes="+strconv.FormatInt(offset, 10)+"-"+strconv.FormatInt(offset+size-1, 10))
	} else if offset > 0 {
		req.Header.Set("Range", "bytes="+strconv.FormatInt(offset, 10)+"-")
	}
	resp, err := d.http.Do(req)
	if err != nil {
		return nil, ConnectFailed("下载失败：" + err.Error())
	}
	if resp.StatusCode >= 400 {
		_ = resp.Body.Close()
		return nil, RateLimited("百度网盘下载链接返回 HTTP " + strconv.Itoa(resp.StatusCode))
	}
	return resp.Body, nil
}

// Write 上传（三段式：precreate → 分片 superfile2 → create）。
//
// 输入必须是 io.ReadSeeker：百度的 precreate 需要**先给出全部分片 md5**，
// 因此必须先扫一遍算 md5 再回退上传。service 层上传时传的是临时文件（天然可回溯），
// 不满足时直接给出明确错误，而不是先缓冲 2GB 到内存。
func (d *baiduDriver) Write(ctx context.Context, path string, r io.Reader, size int64) error {
	c, err := CleanPath(path)
	if err != nil {
		return err
	}
	tk, err := d.token(ctx)
	if err != nil {
		return err
	}
	rs, ok := r.(io.ReadSeeker)
	if !ok {
		return Unsupported("百度网盘上传需要可回溯的输入流")
	}
	if size < 0 {
		end, serr := rs.Seek(0, io.SeekEnd)
		if serr != nil {
			return ConnectFailed("无法确定上传长度")
		}
		size = end
		if _, serr := rs.Seek(0, io.SeekStart); serr != nil {
			return ConnectFailed("无法回退输入流")
		}
	}
	slice := int64(baiduSliceSize)
	if size > slice*baiduMaxSlice {
		slice = (size + baiduMaxSlice - 1) / baiduMaxSlice
	}
	// ① 先扫一遍算全部分片 md5
	md5s := make([]string, 0, 8)
	buf := make([]byte, slice)
	for {
		n, rerr := io.ReadFull(rs, buf)
		if n > 0 {
			md5s = append(md5s, md5Hex(buf[:n]))
		}
		if rerr == io.EOF || rerr == io.ErrUnexpectedEOF {
			break
		}
		if rerr != nil {
			return ConnectFailed("读取上传内容失败：" + rerr.Error())
		}
	}
	if len(md5s) == 0 {
		md5s = append(md5s, md5Hex(nil))
	}
	blockList, _ := json.Marshal(md5s)
	if _, serr := rs.Seek(0, io.SeekStart); serr != nil {
		return ConnectFailed("无法回退输入流")
	}

	// ② precreate
	form := url.Values{}
	form.Set("method", "precreate")
	form.Set("access_token", tk)
	form.Set("path", c)
	form.Set("size", strconv.FormatInt(size, 10))
	form.Set("isdir", "0")
	form.Set("autoinit", "1")
	form.Set("block_list", string(blockList))
	var pre baiduPrecreateResp
	if err := d.apiPost(ctx, baiduAPIBase+"/file?", form, &pre); err != nil {
		return err
	}

	// ③ 逐片 superfile2
	for seq := 0; seq < len(md5s); seq++ {
		n, rerr := io.ReadFull(rs, buf)
		if n <= 0 {
			break
		}
		q := url.Values{}
		q.Set("method", "upload")
		q.Set("access_token", tk)
		q.Set("type", "tmpfile")
		q.Set("path", c)
		q.Set("uploadid", pre.UploadID)
		q.Set("partseq", strconv.Itoa(seq))
		if err := d.putBytes(ctx, "https://d.pcs.baidu.com/rest/2.0/pcs/superfile2?"+q.Encode(), buf[:n]); err != nil {
			return err
		}
		if rerr == io.EOF || rerr == io.ErrUnexpectedEOF {
			break
		}
		if rerr != nil {
			return ConnectFailed("读取上传内容失败：" + rerr.Error())
		}
	}

	// ④ create
	create := url.Values{}
	create.Set("method", "create")
	create.Set("access_token", tk)
	create.Set("path", c)
	create.Set("size", strconv.FormatInt(size, 10))
	create.Set("isdir", "0")
	create.Set("uploadid", pre.UploadID)
	create.Set("block_list", string(blockList))
	var out baiduSimpleResp
	return d.apiPost(ctx, baiduAPIBase+"/file?", create, &out)
}

// Close 百度无连接可关。
func (d *baiduDriver) Close() error { return nil }

// ---------- HTTP 辅助 ----------

// apiGet 发起 GET 并把响应解析进 out（统一做 errno 映射）。
func (d *baiduDriver) apiGet(ctx context.Context, full string, out baiduResp) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, full, nil)
	if err != nil {
		return ConnectFailed("构造请求失败")
	}
	req.Header.Set("User-Agent", "pan.baidu.com")
	resp, err := d.http.Do(req)
	if err != nil {
		return ConnectFailed("百度网盘请求失败：" + err.Error())
	}
	defer resp.Body.Close()
	if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
		return ConnectFailed("百度网盘响应解析失败")
	}
	return MapBaiduError(out.ErrnoCode(), "")
}

// apiPost 发起 POST（application/x-www-form-urlencoded）并做 errno 映射。
func (d *baiduDriver) apiPost(ctx context.Context, base string, form url.Values, out baiduResp) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, base+form.Encode(),
		strings.NewReader(form.Encode()))
	if err != nil {
		return ConnectFailed("构造请求失败")
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("User-Agent", "pan.baidu.com")
	resp, err := d.http.Do(req)
	if err != nil {
		return ConnectFailed("百度网盘请求失败：" + err.Error())
	}
	defer resp.Body.Close()
	if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
		return ConnectFailed("百度网盘响应解析失败")
	}
	return MapBaiduError(out.ErrnoCode(), "")
}

// putBytes 上传单个分片。
func (d *baiduDriver) putBytes(ctx context.Context, u string, body []byte) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u, bytes.NewReader(body))
	if err != nil {
		return ConnectFailed("构造上传请求失败")
	}
	req.Header.Set("User-Agent", "pan.baidu.com")
	resp, err := d.http.Do(req)
	if err != nil {
		return ConnectFailed("百度网盘分片上传失败：" + err.Error())
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return RateLimited("百度网盘分片上传失败（HTTP " + strconv.Itoa(resp.StatusCode) + "）")
	}
	return nil
}

// md5Hex 分片的 md5（小写 hex），百度 block_list 要求这个格式。
func md5Hex(b []byte) string {
	sum := md5.Sum(b)
	return hex.EncodeToString(sum[:])
}

// 编译期断言。
var _ Driver = (*baiduDriver)(nil)
