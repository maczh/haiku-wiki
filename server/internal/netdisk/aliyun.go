package netdisk

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

// 阿里云盘开放平台端点。
const (
	aliyunAuthURL  = "https://openapi.alipan.com/oauth/authorize"
	aliyunTokenURL = "https://openapi.alipan.com/oauth/token"
	aliyunAPIBase  = "https://openapi.alipan.com"
	// aliyunRootFileID 阿里云盘的根目录固定为 "root"
	aliyunRootFileID = "root"
)

// aliyunBase 所有阿里云盘响应的公共部分（code/message 判错统一走它）。
type aliyunBase struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// errorCode 返回业务码与文案。
func (a *aliyunBase) errorCode() (string, string) { return a.Code, a.Message }

// aliyunResp 响应体必须实现的接口（供 apiPost 统一判错）。
type aliyunResp interface{ errorCode() (string, string) }

// aliyunFile 文件条目。
type aliyunFile struct {
	FileID   string `json:"file_id"`
	Name     string `json:"name"`
	Type     string `json:"type"` // file | folder
	Size     int64  `json:"size"`
	Updated  string `json:"updated_at"`
	ParentID string `json:"parent_file_id"`
}

// aliyunPart 上传分片信息。
type aliyunPart struct {
	PartNumber int    `json:"part_number"`
	UploadURL  string `json:"upload_url"`
}

// aliyunListResp 列目录响应。
type aliyunListResp struct {
	aliyunBase
	Items []aliyunFile `json:"items"`
}

// aliyunUserResp 用户信息（取默认 drive_id）。
type aliyunUserResp struct {
	aliyunBase
	DriveID string `json:"default_drive_id"`
}

// aliyunCreateResp 创建文件 / 目录的响应（含上传地址）。
type aliyunCreateResp struct {
	aliyunBase
	FileID       string       `json:"file_id"`
	UploadID     string       `json:"upload_id"`
	PartInfoList []aliyunPart `json:"part_info_list"`
}

// aliyunDownloadResp 下载直链响应。
type aliyunDownloadResp struct {
	aliyunBase
	URL string `json:"url"`
}

// aliyunFileResp 单文件查询响应。
type aliyunFileResp struct {
	aliyunBase
	aliyunFile
}

// aliyunSimpleResp 只需判错的响应。
type aliyunSimpleResp struct {
	aliyunBase
}

// aliyunDriver 阿里云盘 OAuth2 + OpenAPI 驱动。
//
// 与百度不同：阿里云盘以 file_id 寻址而非路径，因此这里维护一份
// 「路径 → file_id」的解析缓存（会话级），逐级 List 匹配出目标 id。
//
// 商业门槛提示（PRD §1.2 / 设计文档 A1）：未购「三方应用权益包」时下载为标准通道、
// 视频为标清；若实测无法创建三方应用，配置留空即自动置灰（见 providers.go）。
type aliyunDriver struct {
	cfg  Config
	caps Caps
	http *http.Client

	mu        sync.Mutex
	creds     *Credentials
	driveID   string
	pathCache map[string]string // 规范路径 → file_id
	onRefresh func(*Credentials) error
}

// NewAliyun 构造阿里云盘驱动。
func NewAliyun(cfg Config, creds *Credentials) (Driver, error) {
	if creds == nil || creds.AccessToken == "" {
		return nil, ErrReauthRequired
	}
	root := cfg.RootPath
	if root == "" {
		root = "/"
	}
	return &aliyunDriver{
		cfg:       cfg,
		caps:      Caps{RangeRead: true, NativeMove: true, RecursiveRemove: false, NeedProxy: true, RootPath: root},
		http:      &http.Client{Timeout: dialTimeout},
		creds:     creds,
		driveID:   driveIDFromExtra(cfg.Extra),
		pathCache: map[string]string{"/": aliyunRootFileID},
	}, nil
}

// driveIDFromExtra 从 Extra（JSON）里取 drive_id。
func driveIDFromExtra(extra string) string {
	if strings.TrimSpace(extra) == "" {
		return ""
	}
	var o struct {
		DriveID string `json:"drive_id"`
	}
	if err := json.Unmarshal([]byte(extra), &o); err != nil {
		return ""
	}
	return o.DriveID
}

// SetTokenRefresher 注入 token 刷新后的回写钩子。
func (d *aliyunDriver) SetTokenRefresher(fn func(*Credentials) error) {
	d.mu.Lock()
	d.onRefresh = fn
	d.mu.Unlock()
}

// Kind 协议类型。
func (d *aliyunDriver) Kind() string { return KindAliyun }

// Caps 能力位。
func (d *aliyunDriver) Caps() Caps { return d.caps }

// AliyunAuthorizeURL 生成阿里云盘授权页 URL。
func AliyunAuthorizeURL(clientID, redirectURI, state string) string {
	q := url.Values{}
	q.Set("response_type", "code")
	q.Set("client_id", clientID)
	q.Set("redirect_uri", redirectURI)
	q.Set("state", state)
	q.Set("scope", "user:base,file:all:read,file:all:write")
	return aliyunAuthURL + "?" + q.Encode()
}

// ExchangeAliyunToken 用 code 换 token（OAuth 回调）。
func ExchangeAliyunToken(ctx context.Context, clientID, clientSecret, code string) (*Credentials, error) {
	raw, err := json.Marshal(map[string]string{
		"grant_type":    "authorization_code",
		"client_id":     clientID,
		"client_secret": clientSecret,
		"code":          code,
	})
	if err != nil {
		return nil, AuthFailed("构造阿里云盘授权请求失败")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, aliyunTokenURL, bytes.NewReader(raw))
	if err != nil {
		return nil, AuthFailed("构造阿里云盘授权请求失败")
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, ConnectFailed("阿里云盘授权请求失败：" + err.Error())
	}
	defer resp.Body.Close()
	var out struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		ExpiresIn    int    `json:"expires_in"`
		Code         string `json:"code"`
		Message      string `json:"message"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, AuthFailed("阿里云盘授权响应解析失败")
	}
	if out.AccessToken == "" {
		msg := out.Message
		if msg == "" {
			msg = out.Code
		}
		if msg == "" {
			msg = "阿里云盘授权未返回 access_token"
		}
		return nil, AuthFailed(msg)
	}
	return &Credentials{
		AccessToken:  out.AccessToken,
		RefreshToken: out.RefreshToken,
		TokenExpire:  time.Now().Add(time.Duration(out.ExpiresIn) * time.Second),
	}, nil
}

// token 取当前 access_token（临近过期先刷新）。
func (d *aliyunDriver) token(ctx context.Context) (string, error) {
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

// refresh 用 refresh_token 换新 token。
func (d *aliyunDriver) refresh(ctx context.Context) error {
	cfg := CurrentConfig()
	d.mu.Lock()
	rt := d.creds.RefreshToken
	d.mu.Unlock()
	if rt == "" || cfg.AliyunAppKey == "" || cfg.AliyunAppSecret == "" {
		return ErrReauthRequired
	}
	raw, err := json.Marshal(map[string]string{
		"grant_type":    "refresh_token",
		"refresh_token": rt,
		"client_id":     cfg.AliyunAppKey,
		"client_secret": cfg.AliyunAppSecret,
	})
	if err != nil {
		return ErrReauthRequired
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, aliyunTokenURL, bytes.NewReader(raw))
	if err != nil {
		return ErrReauthRequired
	}
	req.Header.Set("Content-Type", "application/json")
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
		_ = fn(next)
	}
	return nil
}

// drive 取 drive_id（没有时向 /adrive/v1/user/get 查询并缓存）。
func (d *aliyunDriver) drive(ctx context.Context) (string, error) {
	d.mu.Lock()
	id := d.driveID
	d.mu.Unlock()
	if id != "" {
		return id, nil
	}
	tk, err := d.token(ctx)
	if err != nil {
		return "", err
	}
	var out aliyunUserResp
	if err := d.apiPost(ctx, "/adrive/v1/user/get", tk, map[string]any{}, &out); err != nil {
		return "", err
	}
	if out.DriveID == "" {
		return "", AuthFailed("阿里云盘未返回 drive_id")
	}
	d.mu.Lock()
	d.driveID = out.DriveID
	d.mu.Unlock()
	return out.DriveID, nil
}

// resolve 规范路径 → file_id（逐级 List 匹配，结果进会话级缓存）。
func (d *aliyunDriver) resolve(ctx context.Context, path string) (string, error) {
	c, err := CleanPath(path)
	if err != nil {
		return "", err
	}
	d.mu.Lock()
	if id, ok := d.pathCache[c]; ok {
		d.mu.Unlock()
		return id, nil
	}
	d.mu.Unlock()
	if IsRoot(c) {
		return aliyunRootFileID, nil
	}
	parentID, err := d.resolve(ctx, Parent(c))
	if err != nil {
		return "", err
	}
	kids, err := d.listByID(ctx, parentID)
	if err != nil {
		return "", err
	}
	want := BaseName(c)
	for _, f := range kids {
		if f.Name == want {
			d.mu.Lock()
			d.pathCache[c] = f.FileID
			d.mu.Unlock()
			return f.FileID, nil
		}
	}
	return "", PathNotFound("阿里云盘路径不存在：" + c)
}

// listByID 按父 file_id 列子项。
func (d *aliyunDriver) listByID(ctx context.Context, parentID string) ([]aliyunFile, error) {
	tk, err := d.token(ctx)
	if err != nil {
		return nil, err
	}
	did, err := d.drive(ctx)
	if err != nil {
		return nil, err
	}
	var out aliyunListResp
	body := map[string]any{
		"drive_id":        did,
		"parent_file_id":  parentID,
		"limit":           500,
		"order_by":        "name",
		"order_direction": "ASC",
	}
	if err := d.apiPost(ctx, "/adrive/v1/file/list", tk, body, &out); err != nil {
		return nil, err
	}
	return out.Items, nil
}

// Test 列一次根目录。
func (d *aliyunDriver) Test(ctx context.Context) error {
	_, err := d.List(ctx, d.caps.RootPath)
	return err
}

// List 列目录。
func (d *aliyunDriver) List(ctx context.Context, path string) ([]Entry, error) {
	c, err := CleanPath(path)
	if err != nil {
		return nil, err
	}
	fileID, err := d.resolve(ctx, c)
	if err != nil {
		return nil, err
	}
	kids, err := d.listByID(ctx, fileID)
	if err != nil {
		return nil, err
	}
	out := make([]Entry, 0, len(kids))
	for _, f := range kids {
		p, jerr := Join(c, f.Name)
		if jerr != nil {
			continue
		}
		d.mu.Lock()
		d.pathCache[p] = f.FileID
		d.mu.Unlock()
		out = append(out, Entry{
			Name:    f.Name,
			Path:    p,
			IsDir:   f.Type == "folder",
			Size:    f.Size,
			ModTime: parseAliyunTime(f.Updated),
		})
	}
	sortEntries(out)
	return out, nil
}

// parseAliyunTime 解析阿里云盘的时间串（解析失败回落当前时间）。
func parseAliyunTime(s string) time.Time {
	if s == "" {
		return time.Now()
	}
	for _, layout := range []string{time.RFC3339, "2006-01-02T15:04:05.000Z0700", "2006-01-02 15:04:05"} {
		if t, err := time.Parse(layout, s); err == nil {
			return t
		}
	}
	return time.Now()
}

// Stat 单条目元信息。
func (d *aliyunDriver) Stat(ctx context.Context, path string) (*Entry, error) {
	c, err := CleanPath(path)
	if err != nil {
		return nil, err
	}
	if IsRoot(c) {
		return &Entry{Name: "/", Path: "/", IsDir: true}, nil
	}
	fileID, err := d.resolve(ctx, c)
	if err != nil {
		return nil, err
	}
	tk, err := d.token(ctx)
	if err != nil {
		return nil, err
	}
	did, err := d.drive(ctx)
	if err != nil {
		return nil, err
	}
	var f aliyunFileResp
	if err := d.apiPost(ctx, "/adrive/v1/file/get", tk,
		map[string]any{"drive_id": did, "file_id": fileID}, &f); err != nil {
		return nil, err
	}
	return &Entry{
		Name:    BaseName(c),
		Path:    c,
		IsDir:   f.Type == "folder",
		Size:    f.Size,
		ModTime: parseAliyunTime(f.Updated),
	}, nil
}

// Mkdir 新建目录。
func (d *aliyunDriver) Mkdir(ctx context.Context, path string) error {
	c, err := CleanPath(path)
	if err != nil {
		return err
	}
	parentID, err := d.resolve(ctx, Parent(c))
	if err != nil {
		return err
	}
	tk, err := d.token(ctx)
	if err != nil {
		return err
	}
	did, err := d.drive(ctx)
	if err != nil {
		return err
	}
	var out aliyunCreateResp
	body := map[string]any{
		"drive_id":        did,
		"parent_file_id":  parentID,
		"name":            BaseName(c),
		"type":            "folder",
		"check_name_mode": "refuse",
	}
	if err := d.apiPost(ctx, "/adrive/v1/file/create", tk, body, &out); err != nil {
		return err
	}
	if out.FileID != "" {
		d.mu.Lock()
		d.pathCache[c] = out.FileID
		d.mu.Unlock()
	}
	return nil
}

// Rename 改名。
func (d *aliyunDriver) Rename(ctx context.Context, path, newName string) error {
	c, err := CleanPath(path)
	if err != nil {
		return err
	}
	fileID, err := d.resolve(ctx, c)
	if err != nil {
		return err
	}
	tk, err := d.token(ctx)
	if err != nil {
		return err
	}
	did, err := d.drive(ctx)
	if err != nil {
		return err
	}
	var out aliyunSimpleResp
	body := map[string]any{
		"drive_id":        did,
		"file_id":         fileID,
		"name":            newName,
		"check_name_mode": "refuse",
	}
	if err := d.apiPost(ctx, "/adrive/v1/file/update", tk, body, &out); err != nil {
		return err
	}
	d.invalidateCache()
	return nil
}

// Move 移动到 targetDir 下。
func (d *aliyunDriver) Move(ctx context.Context, path, targetDir string) error {
	c, err := CleanPath(path)
	if err != nil {
		return err
	}
	tgt, err := CleanPath(targetDir)
	if err != nil {
		return err
	}
	fileID, err := d.resolve(ctx, c)
	if err != nil {
		return err
	}
	toParent, err := d.resolve(ctx, tgt)
	if err != nil {
		return err
	}
	tk, err := d.token(ctx)
	if err != nil {
		return err
	}
	did, err := d.drive(ctx)
	if err != nil {
		return err
	}
	var out aliyunSimpleResp
	body := map[string]any{
		"drive_id":        did,
		"file_id":         fileID,
		"to_parent_id":    toParent,
		"check_name_mode": "refuse",
	}
	if err := d.apiPost(ctx, "/adrive/v1/file/move", tk, body, &out); err != nil {
		return err
	}
	d.invalidateCache()
	return nil
}

// Remove 删除（阿里云盘的 delete 即整棵子树，但能力位仍标 false，UI 不开放递归删）。
func (d *aliyunDriver) Remove(ctx context.Context, path string, recursive bool) error {
	c, err := CleanPath(path)
	if err != nil {
		return err
	}
	fileID, err := d.resolve(ctx, c)
	if err != nil {
		return err
	}
	tk, err := d.token(ctx)
	if err != nil {
		return err
	}
	did, err := d.drive(ctx)
	if err != nil {
		return err
	}
	var out aliyunSimpleResp
	if err := d.apiPost(ctx, "/adrive/v1/file/delete", tk,
		map[string]any{"drive_id": did, "file_id": fileID}, &out); err != nil {
		return err
	}
	d.invalidateCache()
	return nil
}

// invalidateCache 写操作后清掉路径缓存（file_id 映射会变）。
func (d *aliyunDriver) invalidateCache() {
	d.mu.Lock()
	d.pathCache = map[string]string{"/": aliyunRootFileID}
	d.mu.Unlock()
}

// downloadURL 取下载直链。
func (d *aliyunDriver) downloadURL(ctx context.Context, path string) (string, error) {
	c, err := CleanPath(path)
	if err != nil {
		return "", err
	}
	fileID, err := d.resolve(ctx, c)
	if err != nil {
		return "", err
	}
	tk, err := d.token(ctx)
	if err != nil {
		return "", err
	}
	did, err := d.drive(ctx)
	if err != nil {
		return "", err
	}
	var out aliyunDownloadResp
	if err := d.apiPost(ctx, "/adrive/v1/file/get_download_url", tk,
		map[string]any{"drive_id": did, "file_id": fileID}, &out); err != nil {
		return "", err
	}
	if out.URL == "" {
		return "", PathNotFound("阿里云盘未返回下载链接：" + c)
	}
	return out.URL, nil
}

// Open 流式读。
func (d *aliyunDriver) Open(ctx context.Context, path string) (io.ReadCloser, error) {
	u, err := d.downloadURL(ctx, path)
	if err != nil {
		return nil, err
	}
	return d.openHTTP(ctx, u, 0, 0)
}

// OpenRange 分段读。
func (d *aliyunDriver) OpenRange(ctx context.Context, path string, offset, size int64) (io.ReadCloser, int64, error) {
	u, err := d.downloadURL(ctx, path)
	if err != nil {
		return nil, 0, err
	}
	total := int64(0)
	if e, serr := d.Stat(ctx, path); serr == nil && e != nil {
		total = e.Size
	}
	rc, err := d.openHTTP(ctx, u, offset, size)
	if err != nil {
		return nil, 0, err
	}
	return rc, total, nil
}

// openHTTP 带 Range 地取直链内容。
func (d *aliyunDriver) openHTTP(ctx context.Context, u string, offset, size int64) (io.ReadCloser, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, ConnectFailed("构造下载请求失败")
	}
	req.Header.Set("Referer", "https://www.alipan.com/")
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
		return nil, MapAliyunError(resp.StatusCode, "", "阿里云盘下载链接返回 HTTP "+strconv.Itoa(resp.StatusCode))
	}
	return resp.Body, nil
}

// Write 上传（create → PUT upload_url → complete）。
//
// 与百度同理：需要**先知道长度**，因此要求 io.ReadSeeker（service 层传的是临时文件）。
func (d *aliyunDriver) Write(ctx context.Context, path string, r io.Reader, size int64) error {
	c, err := CleanPath(path)
	if err != nil {
		return err
	}
	rs, ok := r.(io.ReadSeeker)
	if !ok {
		return Unsupported("阿里云盘上传需要可回溯的输入流")
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
	parentID, err := d.resolve(ctx, Parent(c))
	if err != nil {
		return err
	}
	tk, err := d.token(ctx)
	if err != nil {
		return err
	}
	did, err := d.drive(ctx)
	if err != nil {
		return err
	}
	var created aliyunCreateResp
	body := map[string]any{
		"drive_id":        did,
		"parent_file_id":  parentID,
		"name":            BaseName(c),
		"type":            "file",
		"size":            size,
		"check_name_mode": "auto_rename",
		"part_info_list":  []map[string]int{{"part_number": 1}},
	}
	if err := d.apiPost(ctx, "/adrive/v1/file/create", tk, body, &created); err != nil {
		return err
	}
	if len(created.PartInfoList) == 0 || created.PartInfoList[0].UploadURL == "" {
		return RateLimited("阿里云盘未返回上传地址")
	}
	put, err := http.NewRequestWithContext(ctx, http.MethodPut, created.PartInfoList[0].UploadURL, rs)
	if err != nil {
		return ConnectFailed("构造上传请求失败")
	}
	put.ContentLength = size
	resp, err := d.http.Do(put)
	if err != nil {
		return ConnectFailed("阿里云盘上传失败：" + err.Error())
	}
	_ = resp.Body.Close()
	if resp.StatusCode >= 400 {
		return RateLimited("阿里云盘上传失败（HTTP " + strconv.Itoa(resp.StatusCode) + "）")
	}
	var done aliyunSimpleResp
	if err := d.apiPost(ctx, "/adrive/v1/file/complete", tk, map[string]any{
		"drive_id":  did,
		"file_id":   created.FileID,
		"upload_id": created.UploadID,
	}, &done); err != nil {
		return err
	}
	d.invalidateCache()
	return nil
}

// Close 阿里云盘无连接可关。
func (d *aliyunDriver) Close() error { return nil }

// apiPost 统一 POST JSON：带 Bearer、解响应、按 code / HTTP 状态映射错误。
func (d *aliyunDriver) apiPost(ctx context.Context, path, token string, body any, out aliyunResp) error {
	raw, err := json.Marshal(body)
	if err != nil {
		return ConfigInvalid("构造请求失败")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, aliyunAPIBase+path, bytes.NewReader(raw))
	if err != nil {
		return ConnectFailed("构造请求失败")
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := d.http.Do(req)
	if err != nil {
		return ConnectFailed("阿里云盘请求失败：" + err.Error())
	}
	defer resp.Body.Close()
	if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
		// 4xx/5xx 时响应体可能不是 JSON（网关错误页），直接按状态码归类
		return MapAliyunError(resp.StatusCode, "", "阿里云盘接口返回 HTTP "+strconv.Itoa(resp.StatusCode))
	}
	code, msg := out.errorCode()
	if resp.StatusCode >= 400 {
		return MapAliyunError(resp.StatusCode, code, msg)
	}
	if code != "" && code != "OK" && code != "Success" && code != "200" {
		return MapAliyunError(0, code, msg)
	}
	return nil
}

// 编译期断言。
var _ Driver = (*aliyunDriver)(nil)
