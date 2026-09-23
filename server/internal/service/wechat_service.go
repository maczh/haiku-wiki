// Package service 业务逻辑层：权限判定、fractional index 编排、版本快照、搜索过滤等。
package service

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/bcrypt"

	"haiku-wiki/server/internal/config"
	"haiku-wiki/server/internal/model"
	hkerr "haiku-wiki/server/internal/pkg"
	"haiku-wiki/server/internal/pkg/jwtutil"
	"haiku-wiki/server/internal/repository"
)

// ---------- 状态机 ----------

type WeChatTicketState string

const (
	WXStatePending      WeChatTicketState = "pending"      // 等待用户扫码授权
	WXStateAuthorized   WeChatTicketState = "authorized"   // 已绑定站内账号，可直接登录
	WXStateNeedsProfile WeChatTicketState = "needs_profile" // 微信身份无对应账号，待补全/注册
	WXStateExpired      WeChatTicketState = "expired"
)

// WeChatProfile 微信侧回传的用户画像（用于首次注册默认值 & 绑定展示）。
type WeChatProfile struct {
	UnionID  string `json:"union_id"`
	OpenID   string `json:"open_id"`
	Nickname string `json:"nickname"`
	Avatar   string `json:"avatar"`
}

type wechatTicket struct {
	Ticket    string
	State     WeChatTicketState
	AppID     string
	UnionID   string
	OpenID    string
	Nickname  string
	Avatar    string
	UserID    uint64
	Token     string
	LinkToken string // 一次性令牌：前端凭它在 /bind 完成「绑定/注册」后换取登录
	CreatedAt time.Time
}

// WeChatPollResult 轮询返回。
type WeChatPollResult struct {
	State     WeChatTicketState `json:"state"`
	Token     string            `json:"token,omitempty"`
	User      *model.User       `json:"user,omitempty"`
	LinkToken string            `json:"link_token,omitempty"`
	Nickname  string            `json:"nickname,omitempty"`
	Avatar    string            `json:"avatar,omitempty"`
}

// BindRequest /bind 请求体：mode=bind 走已有账号；mode=register 走新注册。
type BindRequest struct {
	LinkToken string `json:"link_token" binding:"required"`
	Mode      string `json:"mode" binding:"required"` // bind | register
	// bind 模式：账号 + 密码
	Account  string `json:"account"`
	Password string `json:"password"`
	// register 模式：新用户资料（微信昵称/头像自动带入）
	Username string `json:"username"`
	Email    string `json:"email"`
	Name     string `json:"name"`
	Phone    string `json:"phone"`
}

// WeChatService 扫码登录会话管理（内存态，单实例部署足够；多实例需换 Redis）。
type WeChatService struct {
	mu       sync.Mutex
	tickets  map[string]*wechatTicket
	linkKeys map[string]string // linkToken -> ticket
}

// NewWeChatService 构造。
func NewWeChatService() *WeChatService {
	return &WeChatService{
		tickets:  make(map[string]*wechatTicket),
		linkKeys: make(map[string]string),
	}
}

var WeChatSvc = NewWeChatService()

func (s *WeChatService) gcLocked() {
	cut := time.Now().Add(-10 * time.Minute)
	for k, t := range s.tickets {
		if t.CreatedAt.Before(cut) {
			delete(s.tickets, k)
			if t.LinkToken != "" {
				delete(s.linkKeys, t.LinkToken)
			}
		}
	}
}

func newTicketID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// CreateLogin 生成一个扫码会话，返回二维码内容（dev 模式下是模拟地址）与是否 dev 模式。
func (s *WeChatService) CreateLogin() (ticket, qrURL string, devMode bool) {
	cfg := config.Current()
	devMode = !cfg.WeChatEnabled
	ticket = newTicketID()
	if devMode {
		// dev 模式：二维码编码一个可被「模拟扫码」按钮消费的本地地址（真实环境不会用到）
		qrURL = "https://dev.local/wechat-simulate?ticket=" + ticket
	} else {
		redir := url.QueryEscape(cfg.WeChatRedirectURI)
		qrURL = fmt.Sprintf(
			"https://open.weixin.qq.com/connect/qrconnect?appid=%s&redirect_uri=%s&response_type=code&scope=snsapi_login&state=%s#wechat_redirect",
			cfg.WeChatAppID, redir, ticket,
		)
	}
	s.mu.Lock()
	s.gcLocked()
	s.tickets[ticket] = &wechatTicket{Ticket: ticket, State: WXStatePending, AppID: cfg.WeChatAppID, CreatedAt: time.Now()}
	s.mu.Unlock()
	return
}

// DevComplete dev 模式专用：不经过真实微信 OAuth，直接以给定 profile 完成扫码。
// 仅当微信未配置（dev 模式）时可用，便于无凭据环境下端到端验证整条链路。
func (s *WeChatService) DevComplete(ticket string, p WeChatProfile) error {
	s.mu.Lock()
	t, ok := s.tickets[ticket]
	if !ok || t.State != WXStatePending {
		s.mu.Unlock()
		return hkerr.Param("登录会话不存在或已失效，请刷新二维码")
	}
	if config.Current().WeChatEnabled {
		s.mu.Unlock()
		return hkerr.Param("已配置微信应用，请走真实扫码流程")
	}
	t.UnionID, t.OpenID, t.Nickname, t.Avatar = p.UnionID, p.OpenID, p.Nickname, p.Avatar
	s.mu.Unlock()
	return s.resolveOrProfile(t)
}

// ExchangeCode 处理微信重定向带回的 code（真实扫码流程）。
func (s *WeChatService) ExchangeCode(state, code string) error {
	s.mu.Lock()
	t, ok := s.tickets[state]
	if !ok || t.State != WXStatePending {
		s.mu.Unlock()
		return hkerr.Param("登录会话不存在或已失效，请刷新二维码")
	}
	appID, secret := t.AppID, config.Current().WeChatAppSecret
	s.mu.Unlock()

	tok, err := wechatToken(appID, secret, code)
	if err != nil {
		return err
	}
	info, err := wechatUserInfo(tok.AccessToken, tok.OpenID)
	if err != nil {
		return err
	}

	s.mu.Lock()
	t.AppID, t.OpenID, t.UnionID = appID, tok.OpenID, info.UnionID
	t.Nickname, t.Avatar = info.Nickname, info.HeadImgURL
	s.mu.Unlock()
	return s.resolveOrProfile(t)
}

// findByWeChat 按 unionid（优先）/ (app_id,open_id) 解析已绑定的站内用户。
func findByWeChat(appID, openID, unionID string) (*model.User, error) {
	if unionID != "" {
		if b, err := repository.FindWeChatBindingByUnionID(unionID); err == nil {
			return repository.FindUserByID(b.UserID)
		}
	}
	if b, err := repository.FindWeChatBindingByAppOpenID(appID, openID); err == nil {
		return repository.FindUserByID(b.UserID)
	}
	return nil, hkerr.New(40400, 404, "no binding")
}

// resolveOrProfile 命中绑定→authorized；否则→needs_profile 并签发 linkToken。
func (s *WeChatService) resolveOrProfile(t *wechatTicket) error {
	if u, _ := findByWeChat(t.AppID, t.OpenID, t.UnionID); u != nil {
		token, err := jwtutil.Create(u.ID, u.Role)
		if err != nil {
			return hkerr.Internal("签发凭证失败")
		}
		s.mu.Lock()
		t.UserID, t.Token, t.State = u.ID, token, WXStateAuthorized
		s.mu.Unlock()
		return nil
	}
	// 无对应账号：建立 needs_profile + 一次性 linkToken
	link := newTicketID()
	s.mu.Lock()
	t.State, t.LinkToken = WXStateNeedsProfile, link
	s.linkKeys[link] = t.Ticket
	s.mu.Unlock()
	return nil
}

// Poll 前端轮询：pending / authorized / needs_profile / expired。
func (s *WeChatService) Poll(ticket string) (*WeChatPollResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	t, ok := s.tickets[ticket]
	if !ok {
		return &WeChatPollResult{State: WXStateExpired}, nil
	}
	if t.State == WXStatePending && time.Since(t.CreatedAt) > 5*time.Minute {
		t.State = WXStateExpired
	}
	switch t.State {
	case WXStateAuthorized:
		return &WeChatPollResult{State: WXStateAuthorized, Token: t.Token, User: nil}, nil
	case WXStateNeedsProfile:
		return &WeChatPollResult{State: WXStateNeedsProfile, LinkToken: t.LinkToken, Nickname: t.Nickname, Avatar: t.Avatar}, nil
	default:
		return &WeChatPollResult{State: t.State}, nil
	}
}

// BindOrRegister 用 linkToken 完成「绑定已有账号」或「注册新用户」。
func (s *WeChatService) BindOrRegister(req BindRequest) (*RegisterOutput, error) {
	s.mu.Lock()
	ticket, ok := s.linkKeys[req.LinkToken]
	if !ok {
		s.mu.Unlock()
		return nil, hkerr.Param("绑定会话已失效，请重新扫码")
	}
	t := s.tickets[ticket]
	if t == nil || t.State != WXStateNeedsProfile {
		s.mu.Unlock()
		return nil, hkerr.Param("绑定会话状态异常，请重新扫码")
	}
	s.mu.Unlock()

	var user *model.User
	var err error
	switch req.Mode {
	case "bind":
		user, err = s.bindExisting(t, req.Account, req.Password)
	case "register":
		user, err = s.registerNew(t, req)
	default:
		return nil, hkerr.Param("未知的绑定方式")
	}
	if err != nil {
		return nil, err
	}
	// 写绑定关系
	if err := s.ensureBinding(t, user.ID); err != nil {
		return nil, err
	}
	token, err := jwtutil.Create(user.ID, user.Role)
	if err != nil {
		return nil, hkerr.Internal("签发凭证失败")
	}
	s.mu.Lock()
	t.UserID, t.Token, t.State = user.ID, token, WXStateAuthorized
	s.mu.Unlock()
	return &RegisterOutput{Token: token, User: user}, nil
}

func (s *WeChatService) bindExisting(t *wechatTicket, account, password string) (*model.User, error) {
	account = strings.TrimSpace(account)
	var u *model.User
	var err error
	if u, err = repository.FindUserByUsername(account); err != nil {
		if u, err = repository.FindUserByPhone(account); err != nil {
			if u, err = repository.FindUserByEmail(strings.ToLower(account)); err != nil {
				return nil, hkerr.Param("账号或密码错误")
			}
		}
	}
	if u.Status != 1 {
		return nil, hkerr.Param("该账号已被禁用，请联系管理员")
	}
	if bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(password)) != nil {
		return nil, hkerr.Param("账号或密码错误")
	}
	return u, nil
}

func (s *WeChatService) registerNew(t *wechatTicket, req BindRequest) (*model.User, error) {
	username := strings.TrimSpace(req.Username)
	email := strings.ToLower(strings.TrimSpace(req.Email))
	phone := strings.TrimSpace(req.Phone)
	name := strings.TrimSpace(req.Name)
	if username == "" || email == "" || req.Password == "" {
		return nil, hkerr.Param("用户名、邮箱、密码均为必填")
	}
	if len(req.Password) < 6 {
		return nil, hkerr.Param("密码至少 6 位")
	}
	if !strings.Contains(email, "@") {
		return nil, hkerr.Param("请输入有效邮箱")
	}
	if _, err := repository.FindUserByUsername(username); err == nil {
		return nil, hkerr.Conflict("该用户名已注册")
	}
	if _, err := repository.FindUserByEmail(email); err == nil {
		return nil, hkerr.Conflict("该邮箱已注册")
	}
	if phone != "" {
		if !isValidPhone(phone) {
			return nil, hkerr.Param("手机号格式不正确")
		}
		if _, err := repository.FindUserByPhone(phone); err == nil {
			return nil, hkerr.Conflict("该手机号已注册")
		}
	}
	if name == "" {
		name = username
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return nil, hkerr.Internal("密码加密失败")
	}
	u := &model.User{
		Username:     username,
		Name:         name,
		Email:        email,
		Phone:        toPhonePtr(phone),
		PasswordHash: string(hash),
		Nickname:     orDefault(name, t.Nickname),
		Avatar:       t.Avatar,
		Role:         "member",
		Status:       1,
	}
	if err := repository.CreateUser(u); err != nil {
		return nil, hkerr.Internal("注册失败")
	}
	return u, nil
}

func (s *WeChatService) ensureBinding(t *wechatTicket, userID uint64) error {
	// 先按 unionid / app_openid 查，已存在则更新昵称头像，否则新建
	if t.UnionID != "" {
		if b, err := repository.FindWeChatBindingByUnionID(t.UnionID); err == nil {
			b.Nickname, b.Avatar, b.UserID = t.Nickname, t.Avatar, userID
			return repository.UpdateWeChatBinding(b)
		}
	}
	if b, err := repository.FindWeChatBindingByAppOpenID(t.AppID, t.OpenID); err == nil {
		b.Nickname, b.Avatar, b.UserID = t.Nickname, t.Avatar, userID
		return repository.UpdateWeChatBinding(b)
	}
	b := &model.WeChatBinding{
		UserID:   userID,
		AppID:    t.AppID,
		OpenID:   t.OpenID,
		UnionID:  t.UnionID,
		Nickname: t.Nickname,
		Avatar:   t.Avatar,
	}
	return repository.CreateWeChatBinding(b)
}

// ---------- 微信 HTTP 调用（仅真实扫码流程用到） ----------

type wechatTokenResp struct {
	AccessToken string `json:"access_token"`
	OpenID      string `json:"openid"`
	UnionID     string `json:"unionid"`
	ErrCode     int    `json:"errcode"`
	ErrMsg      string `json:"errmsg"`
}

type wechatUserInfoResp struct {
	Nickname    string `json:"nickname"`
	HeadImgURL  string `json:"headimgurl"`
	UnionID     string `json:"unionid"`
	ErrCode     int    `json:"errcode"`
	ErrMsg      string `json:"errmsg"`
}

func wechatToken(appID, secret, code string) (*wechatTokenResp, error) {
	u := fmt.Sprintf(
		"https://api.weixin.qq.com/sns/oauth2/access_token?appid=%s&secret=%s&code=%s&grant_type=authorization_code",
		url.QueryEscape(appID), url.QueryEscape(secret), url.QueryEscape(code),
	)
	body, err := httpGetJSON(u, 8*time.Second)
	if err != nil {
		return nil, hkerr.Internal("微信授权接口调用失败")
	}
	var r wechatTokenResp
	if err := json.Unmarshal(body, &r); err != nil {
		return nil, hkerr.Internal("微信授权返回解析失败")
	}
	if r.ErrCode != 0 {
		return nil, hkerr.New(40000+r.ErrCode, 400, "微信授权失败："+r.ErrMsg)
	}
	return &r, nil
}

func wechatUserInfo(accessToken, openID string) (*wechatUserInfoResp, error) {
	u := fmt.Sprintf(
		"https://api.weixin.qq.com/sns/userinfo?access_token=%s&openid=%s",
		url.QueryEscape(accessToken), url.QueryEscape(openID),
	)
	body, err := httpGetJSON(u, 8*time.Second)
	if err != nil {
		return nil, hkerr.Internal("微信用户信息接口调用失败")
	}
	var r wechatUserInfoResp
	if err := json.Unmarshal(body, &r); err != nil {
		return nil, hkerr.Internal("微信用户信息解析失败")
	}
	if r.ErrCode != 0 {
		return nil, hkerr.New(40000+r.ErrCode, 400, "微信用户信息获取失败："+r.ErrMsg)
	}
	return &r, nil
}

func httpGetJSON(u string, timeout time.Duration) ([]byte, error) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	return io.ReadAll(resp.Body)
}

func orDefault(a, b string) string {
	if a != "" {
		return a
	}
	return b
}
