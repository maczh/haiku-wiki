package service

import (
	"strconv"
	"strings"
	"time"

	"haiku-wiki/server/internal/config"
	"haiku-wiki/server/internal/model"
	"haiku-wiki/server/internal/netdisk"
	hkerr "haiku-wiki/server/internal/pkg"
	"haiku-wiki/server/internal/repository"
)

// NetdiskService「我的网盘」连接管理：CRUD / 测试 / 状态刷新 / 列目录 / 能力清单。
//
// 设计要点：
//  1. **脱敏是硬要求**：所有出参必须经 ToConnectionDTO，任何路径都不得把
//     cred_enc / password / token 写进响应；
//  2. 凭据在 service 层解密后**只在进程内传递**，不落日志、不回前端；
//  3. 跨用户访问一律 404（而不是 403），避免探测资源存在性。
type NetdiskService struct{}

// NetdiskSvc 单例（handler 直接用，与 AuthSvc 等保持一致）。
var NetdiskSvc = &NetdiskService{}

// ---------- DTO ----------

// ProviderDTO 网盘类型能力清单（前端菜单由它渲染，不可用即置灰）。
type ProviderDTO struct {
	Kind           string `json:"kind"`
	Label          string `json:"label"`
	Available      bool   `json:"available"`
	DisabledReason string `json:"disabled_reason,omitempty"`
	OAuth          bool   `json:"oauth"`
	Native         bool   `json:"native"`
}

// ConnectionDTO 连接出参。**永不携带任何凭据字段**（只有 has_password / has_token 布尔位）。
type ConnectionDTO struct {
	ID           uint64     `json:"id"`
	Name         string     `json:"name"`
	Kind         string     `json:"kind"`
	Host         string     `json:"host"`
	Port         int        `json:"port"`
	Share        string     `json:"share,omitempty"`
	RootPath     string     `json:"root_path"`
	Mode         string     `json:"mode,omitempty"`
	Encoding     string     `json:"encoding,omitempty"`
	Status       string     `json:"status"`
	LastError    string     `json:"last_error,omitempty"`
	LastTestedAt *time.Time `json:"last_tested_at,omitempty"`
	Enabled      bool       `json:"enabled"`
	HasPassword  bool       `json:"has_password"`
	HasToken     bool       `json:"has_token"`
	Account      string     `json:"account,omitempty"`
	CreatedAt    time.Time  `json:"created_at"`
	UpdatedAt    time.Time  `json:"updated_at"`
}

// CreateReq 新建 / 编辑入参。password 为空表示「不修改」（编辑态）。
type CreateReq struct {
	Name     string `json:"name" binding:"required"`
	Kind     string `json:"kind" binding:"required"`
	Host     string `json:"host"`
	Port     int    `json:"port"`
	Share    string `json:"share"`
	Mode     string `json:"mode"`
	Encoding string `json:"encoding"`
	Username string `json:"username"`
	Password string `json:"password"`
	Domain   string `json:"domain"`
}

// TestResult 测试连接结果。
type TestResult struct {
	OK       bool   `json:"ok"`
	Message  string `json:"message"`
	RootPath string `json:"root_path,omitempty"`
	Count    int    `json:"count,omitempty"`
}

// SMBSharesReq 「列举 SMB 共享」入参（第 1 步填的 IP / 账号，不落库）。
//
// 与 CreateReq 分开：这一步只是为了拿到共享清单，还没有「共享名」，不能走完整校验 / 落库。
type SMBSharesReq struct {
	Host     string `json:"host" binding:"required"`
	Port     int    `json:"port"`
	Username string `json:"username"`
	Password string `json:"password"`
	Domain   string `json:"domain"`
}

// DirListResp 列目录结果。
type DirListResp struct {
	Path   string          `json:"path"`
	Items  []netdisk.Entry `json:"items"`
	Cached bool            `json:"cached"`
}

// ---------- 能力清单 ----------

// ListProviders 按当前服务端配置推导各网盘类型的可用状态。
func (s *NetdiskService) ListProviders() []ProviderDTO {
	src := netdisk.Providers()
	out := make([]ProviderDTO, 0, len(src))
	for _, p := range src {
		out = append(out, ProviderDTO{
			Kind:           p.Kind,
			Label:          p.Label,
			Available:      p.Available,
			DisabledReason: p.DisabledReason,
			OAuth:          p.OAuth,
			Native:         p.Native,
		})
	}
	return out
}

// ---------- 查询 ----------

// List 当前用户的全部连接。
func (s *NetdiskService) List(uid uint64) ([]ConnectionDTO, error) {
	list, err := repository.ListNetdiskConnections(uid)
	if err != nil {
		return nil, err
	}
	out := make([]ConnectionDTO, 0, len(list))
	for i := range list {
		out = append(out, ToConnectionDTO(&list[i]))
	}
	return out, nil
}

// Get 单条详情（跨用户 = 404）。
func (s *NetdiskService) Get(id, uid uint64) (*ConnectionDTO, error) {
	c, err := s.mustConn(id, uid)
	if err != nil {
		return nil, err
	}
	dto := ToConnectionDTO(c)
	return &dto, nil
}

// mustConn 取连接；不存在 / 跨用户一律 40401。
func (s *NetdiskService) mustConn(id, uid uint64) (*model.NetdiskConnection, error) {
	if id == 0 {
		return nil, hkerr.NotFound("网盘连接不存在")
	}
	c, err := repository.GetNetdiskConnection(id, uid)
	if err != nil {
		// 跨用户与不存在对外完全一致：不暴露资源是否存在
		return nil, hkerr.NotFound("网盘连接不存在")
	}
	return c, nil
}

// ---------- 新建 / 编辑 ----------

// Create 新建连接（SMB / FTP / WebDAV）。百度 / 阿里云盘走 OAuth，不接受直接创建。
func (s *NetdiskService) Create(uid uint64, req CreateReq) (*ConnectionDTO, error) {
	kind := strings.ToLower(strings.TrimSpace(req.Kind))
	if err := s.validateKind(kind); err != nil {
		return nil, err
	}
	if kind == netdisk.KindBaidu || kind == netdisk.KindAliyun {
		return nil, netdisk.KindDisabled("百度网盘 / 阿里云盘请通过授权流程添加")
	}
	name, err := s.validateName(req.Name)
	if err != nil {
		return nil, err
	}
	conn, err := s.buildConn(uid, 0, kind, req)
	if err != nil {
		return nil, err
	}
	conn.Name = name
	// 同一用户、协议、地址、共享和根路径视为同一个连接：新建时只更新凭据，
	// 避免重复生成连接配置。
	if old, findErr := repository.FindNetdiskByLocation(uid, kind, conn.Host, conn.Port, conn.Share, conn.RootPath); findErr == nil {
		creds := credentialsOf(req)
		enc, encErr := netdisk.EncryptCredentials(creds)
		if encErr != nil { return nil, hkerr.Internal("凭据加密失败") }
		old.CredEnc = enc
		old.Status = model.NetdiskStatusUnknown
		old.LastError = ""
		if err := repository.UpdateNetdiskConnection(old); err != nil { return nil, err }
		dto := ToConnectionDTO(old)
		return &dto, nil
	}

	cfg := config.Current()
	max := cfg.NetdiskMaxConnectionsOr()
	n, err := repository.CountNetdiskConnections(uid)
	if err != nil {
		return nil, err
	}
	if int(n) >= max {
		return nil, netdisk.LimitExceeded("网盘连接数已达上限（" + strconv.Itoa(max) + " 个）")
	}
	exists, err := repository.ExistsNetdiskName(uid, name, 0)
	if err != nil {
		return nil, err
	}
	if exists {
		return nil, netdisk.AlreadyExists("已存在同名网盘连接")
	}

	creds := credentialsOf(req)
	enc, err := netdisk.EncryptCredentials(creds)
	if err != nil {
		return nil, hkerr.Internal("凭据加密失败")
	}
	conn.CredEnc = enc
	conn.Status = model.NetdiskStatusUnknown
	conn.Enabled = true
	if err := repository.CreateNetdiskConnection(conn); err != nil {
		return nil, err
	}
	dto := ToConnectionDTO(conn)
	return &dto, nil
}

// Update 编辑连接。password 留空 = 保持原口令不变。
func (s *NetdiskService) Update(id, uid uint64, req CreateReq) (*ConnectionDTO, error) {
	old, err := s.mustConn(id, uid)
	if err != nil {
		return nil, err
	}
	kind := strings.ToLower(strings.TrimSpace(req.Kind))
	if kind == "" {
		kind = old.Kind
	}
	if kind != old.Kind {
		return nil, netdisk.ConfigInvalid("网盘类型不允许修改，请删除后重建")
	}
	name := old.Name
	if strings.TrimSpace(req.Name) != "" {
		name, err = s.validateName(req.Name)
		if err != nil {
			return nil, err
		}
	}
	conn, err := s.buildConn(uid, id, kind, req)
	if err != nil {
		return nil, err
	}
	conn.Name = name
	if name != old.Name {
		exists, err := repository.ExistsNetdiskName(uid, name, id)
		if err != nil {
			return nil, err
		}
		if exists {
			return nil, netdisk.AlreadyExists("已存在同名网盘连接")
		}
	}

	// 旧凭据解密 → 口令留空时沿用旧值
	oldCreds, err := netdisk.DecryptCredentials(old.CredEnc)
	if err != nil {
		return nil, netdisk.ConfigInvalid("已保存的凭据无法解密（可能服务端密钥已变更）")
	}
	newCreds := credentialsOf(req)
	if newCreds.Password == "" && newCreds.Username == "" && newCreds.Domain == "" {
		// 表单整体未给出口令类字段：沿用旧凭据
		newCreds = oldCreds
	} else if newCreds.Password == "" {
		newCreds.Password = oldCreds.Password
		newCreds.AccessToken = oldCreds.AccessToken
		newCreds.RefreshToken = oldCreds.RefreshToken
		newCreds.TokenExpire = oldCreds.TokenExpire
	}
	enc, err := netdisk.EncryptCredentials(newCreds)
	if err != nil {
		return nil, hkerr.Internal("凭据加密失败")
	}
	conn.ID = id
	conn.CredEnc = enc
	conn.Status = old.Status
	conn.LastError = old.LastError
	conn.LastTestedAt = old.LastTestedAt
	conn.Account = old.Account
	conn.CreatedAt = old.CreatedAt
	if err := repository.UpdateNetdiskConnection(conn); err != nil {
		return nil, err
	}
	// 凭据或地址变了 → 会话必须重建，否则还在用旧连接
	netdisk.DefaultPool().Invalidate(id)
	dto := ToConnectionDTO(conn)
	return &dto, nil
}

// Delete 删除（软删除）。
func (s *NetdiskService) Delete(id, uid uint64) error {
	if _, err := s.mustConn(id, uid); err != nil {
		return err
	}
	netdisk.DefaultPool().Invalidate(id)
	return repository.DeleteNetdiskConnection(id, uid)
}

// ---------- 测试连接 ----------

// TestUnsaved 测试**未保存**的配置（保存前先测，UI 强制先测后存）。
func (s *NetdiskService) TestUnsaved(uid uint64, req CreateReq) (*TestResult, error) {
	kind := strings.ToLower(strings.TrimSpace(req.Kind))
	if err := s.validateKind(kind); err != nil {
		return nil, err
	}
	conn, err := s.buildConn(uid, 0, kind, req)
	if err != nil {
		return nil, err
	}
	return s.testWith(conn, credentialsOf(req))
}

// TestSaved 测试**已保存**的连接，并回写状态。
func (s *NetdiskService) TestSaved(id, uid uint64) (*TestResult, error) {
	conn, err := s.mustConn(id, uid)
	if err != nil {
		return nil, err
	}
	creds, err := netdisk.DecryptCredentials(conn.CredEnc)
	if err != nil {
		return nil, netdisk.ConfigInvalid("已保存的凭据无法解密（可能服务端密钥已变更）")
	}
	res, err := s.testWith(conn, creds)
	// 无论成败都回写状态，前端徽标据此变色
	if res != nil {
		s.saveStatus(conn.ID, res.OK, res.Message)
	}
	return res, err
}

// testWith 用给定凭据建连并列一次根目录（ID=0 时会话不入池，测完即关）。
func (s *NetdiskService) testWith(conn *model.NetdiskConnection, creds *netdisk.Credentials) (*TestResult, error) {
	ctx, cancel := ctxWithTimeout()
	defer cancel()
	drv, release, err := netdisk.DefaultPool().Acquire(ctx, conn, creds)
	if err != nil {
		return &TestResult{OK: false, Message: humanMessage(err)}, err
	}
	defer release()
	root := drv.Caps().RootPath
	if conn.RootPath != "" {
		root = conn.RootPath
	}
	items, err := drv.List(ctx, root)
	if err != nil {
		return &TestResult{OK: false, Message: humanMessage(err), RootPath: root}, err
	}
	return &TestResult{
		OK:       true,
		Message:  "连接成功，可访问 " + strconv.Itoa(len(items)) + " 个根目录条目",
		RootPath: root,
		Count:    len(items),
	}, nil
}

// ListSMBShares 列举 SMB 服务器上的共享并探测权限（两步添加流程第 1→2 步）。
//
// 仅要求登录态（uid>0）：避免匿名用户拿本服务当内网探测跳板。
// 不落库、不建连接记录，只是临时拨一次号枚举共享。
func (s *NetdiskService) ListSMBShares(uid uint64, req SMBSharesReq) ([]netdisk.SMBShareInfo, error) {
	if uid == 0 {
		return nil, hkerr.Unauthorized()
	}
	cfg := netdisk.Config{
		Kind: netdisk.KindSMB,
		Host: strings.TrimSpace(req.Host),
		Port: req.Port,
	}
	creds := &netdisk.Credentials{
		Username: strings.TrimSpace(req.Username),
		Password: req.Password,
		Domain:   strings.TrimSpace(req.Domain),
	}
	return netdisk.ListSMBShares(cfg, creds)
}

// Refresh 重新探测已保存连接的状态（OAuth 重新授权后也用它刷新徽标）。
func (s *NetdiskService) Refresh(id, uid uint64) (*ConnectionDTO, error) {
	if _, err := s.TestSaved(id, uid); err != nil {
		// 状态已回写为 failed，这里仍返回 DTO 让前端能看到原因
		c, gerr := s.mustConn(id, uid)
		if gerr != nil {
			return nil, err
		}
		dto := ToConnectionDTO(c)
		return &dto, err
	}
	dto, err := s.Get(id, uid)
	return dto, err
}

// ---------- 列目录 ----------

// ListDir 列目录。force=true 时跳过服务端短缓存（前端写操作后重拉用）。
func (s *NetdiskService) ListDir(id, uid uint64, path string, force bool) (*DirListResp, error) {
	conn, err := s.mustConn(id, uid)
	if err != nil {
		return nil, err
	}
	clean, err := netdisk.CleanPath(path)
	if err != nil {
		return nil, err
	}
	creds, err := netdisk.DecryptCredentials(conn.CredEnc)
	if err != nil {
		return nil, netdisk.ConfigInvalid("已保存的凭据无法解密（可能服务端密钥已变更）")
	}
	ctx, cancel := ctxWithTimeout()
	defer cancel()
	drv, release, err := netdisk.DefaultPool().Acquire(ctx, conn, creds)
	if err != nil {
		s.saveStatus(conn.ID, false, humanMessage(err))
		return nil, err
	}
	defer release()
	items, err := drv.List(ctx, clean)
	if err != nil {
		s.saveStatus(conn.ID, false, humanMessage(err))
		return nil, err
	}
	if conn.Status != model.NetdiskStatusConnected {
		s.saveStatus(conn.ID, true, "")
	}
	return &DirListResp{Path: clean, Items: items, Cached: !force}, nil
}

// ---------- 内部工具 ----------

// saveStatus 回写连接状态（失败信息已脱敏，绝不含口令）。
func (s *NetdiskService) saveStatus(id uint64, ok bool, msg string) {
	now := time.Now()
	cols := map[string]any{"last_tested_at": now}
	if ok {
		cols["status"] = model.NetdiskStatusConnected
		cols["last_error"] = ""
	} else {
		cols["status"] = model.NetdiskStatusFailed
		if len(msg) > 500 {
			msg = msg[:500]
		}
		cols["last_error"] = msg
	}
	if err := repository.UpdateNetdiskColumns(id, cols); err != nil {
		logNetdiskError("回写连接状态失败", id, err)
	}
}

// validateKind 校验 kind 合法且当前配置下可用。
func (s *NetdiskService) validateKind(kind string) error {
	if !netdisk.IsKindCreatable(kind) {
		return netdisk.ConfigInvalid("不支持的网盘类型：" + kind)
	}
	return netdisk.EnsureAvailable(kind)
}

// validateName 名称长度 1–64。
func (s *NetdiskService) validateName(name string) (string, error) {
	n := strings.TrimSpace(name)
	if n == "" {
		return "", netdisk.ConfigInvalid("网盘名称不能为空")
	}
	if len([]rune(n)) > 64 {
		return "", netdisk.ConfigInvalid("网盘名称不能超过 64 个字符")
	}
	return n, nil
}

// buildConn 由入参拼出连接模型（不含凭据）。
func (s *NetdiskService) buildConn(uid, id uint64, kind string, req CreateReq) (*model.NetdiskConnection, error) {
	host := strings.TrimSpace(req.Host)
	if kind == netdisk.KindSMB || kind == netdisk.KindFTP || kind == netdisk.KindWebDAV {
		if host == "" {
			return nil, netdisk.ConfigInvalid("主机地址不能为空")
		}
	}
	port := req.Port
	if port <= 0 {
		switch kind {
		case netdisk.KindSMB:
			port = 445
		case netdisk.KindFTP:
			port = 21
		}
	}
	if port < 0 || port > 65535 {
		return nil, netdisk.ConfigInvalid("端口不合法")
	}
	mode := strings.ToLower(strings.TrimSpace(req.Mode))
	if kind == netdisk.KindFTP {
		if mode == "" {
			mode = "passive"
		}
		if mode != "passive" && mode != "active" {
			return nil, netdisk.ConfigInvalid("FTP 连接模式只能是 passive 或 active")
		}
		if mode == "active" {
			// 主动模式本期置灰；正常路径到不了这里（UI 已禁用），但后端必须挡住
			return nil, netdisk.ErrFTPActiveMode()
		}
	} else {
		mode = ""
	}
	enc := strings.ToLower(strings.TrimSpace(req.Encoding))
	if kind == netdisk.KindFTP {
		if enc == "" {
			enc = "utf-8"
		}
		if enc != "utf-8" && enc != "gbk" {
			return nil, netdisk.ConfigInvalid("FTP 编码只能是 utf-8 或 gbk")
		}
	} else {
		enc = ""
	}
	share := strings.TrimSpace(req.Share)
	if kind == netdisk.KindSMB && share == "" {
		return nil, netdisk.ConfigInvalid("SMB 共享名（share）不能为空")
	}
	// Current() 在单测里可能是 nil（未 Load 配置），这里必须判空再取字段
	appName := ""
	if cfg := config.Current(); cfg != nil {
		appName = cfg.BaiduAppName
	}
	root := netdisk.DefaultRootPath(kind, appName)
	return &model.NetdiskConnection{
		ID:       id,
		UserID:   uid,
		Kind:     kind,
		Host:     host,
		Port:     port,
		Share:    share,
		RootPath: root,
		Mode:     mode,
		Encoding: enc,
		Status:   model.NetdiskStatusUnknown,
		Enabled:  true,
	}, nil
}

// credentialsOf 入参 → 凭据。
func credentialsOf(req CreateReq) *netdisk.Credentials {
	return &netdisk.Credentials{
		Username: strings.TrimSpace(req.Username),
		Password: req.Password,
		Domain:   strings.TrimSpace(req.Domain),
	}
}

// ToConnectionDTO 模型 → 出参（**唯一的脱敏出口**，全仓只允许这一处读 CredEnc）。
//
// 解密只为了得到两个布尔位；任何情况下都不把明文放进 DTO。
func ToConnectionDTO(c *model.NetdiskConnection) ConnectionDTO {
	if c == nil {
		return ConnectionDTO{}
	}
	hasPassword := false
	hasToken := false
	if creds, err := netdisk.DecryptCredentials(c.CredEnc); err == nil && creds != nil {
		hasPassword = creds.Password != ""
		hasToken = creds.AccessToken != ""
	}
	return ConnectionDTO{
		ID:           c.ID,
		Name:         c.Name,
		Kind:         c.Kind,
		Host:         c.Host,
		Port:         c.Port,
		Share:        c.Share,
		RootPath:     c.RootPath,
		Mode:         c.Mode,
		Encoding:     c.Encoding,
		Status:       normalizeStatus(c.Status),
		LastError:    c.LastError,
		LastTestedAt: c.LastTestedAt,
		Enabled:      c.Enabled,
		HasPassword:  hasPassword,
		HasToken:     hasToken,
		Account:      c.Account,
		CreatedAt:    c.CreatedAt,
		UpdatedAt:    c.UpdatedAt,
	}
}

// normalizeStatus 脏数据兜底：未知值一律显示 unknown，避免前端拿到空串。
func normalizeStatus(s string) string {
	switch s {
	case model.NetdiskStatusConnected, model.NetdiskStatusFailed, model.NetdiskStatusReauthRequired:
		return s
	default:
		return model.NetdiskStatusUnknown
	}
}
