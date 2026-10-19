package service

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"strconv"
	"strings"
	"sync"
	"time"

	"haiku-wiki/server/internal/config"
	"haiku-wiki/server/internal/model"
	"haiku-wiki/server/internal/netdisk"
	"haiku-wiki/server/internal/repository"
)

// oauthStateTTL 授权 state 的有效期（超过即失效，防止陈旧回调重放）。
const oauthStateTTL = 10 * time.Minute

// oauthExchangeTimeout 换 token 的超时（外网调用，不能无限等）。
const oauthExchangeTimeout = 20 * time.Second

// oauthState 服务端暂存的授权意图（不落库：一次性、短寿命，落库反而要清理）。
type oauthState struct {
	UID       uint64
	Name      string
	Provider  string
	CreatedAt time.Time
}

// NetdiskOAuthService 百度 / 阿里云盘的 OAuth2 授权流程。
//
// 为什么 state 存内存而不是库：state 只在「发起 → 回调」这几十秒内有效，
// 落库要额外清理；代价是多实例部署时回调必须打到同一实例（本期单机部署，接受）。
type NetdiskOAuthService struct {
	mu     sync.Mutex
	states map[string]*oauthState
}

// NetdiskOAuthSvc 单例。
var NetdiskOAuthSvc = &NetdiskOAuthService{states: make(map[string]*oauthState, 8)}

// ---------- 发起授权 ----------

// Authorize 生成 state 并返回授权页 URL。返回 (authorize_url, state, error)。
func (s *NetdiskOAuthService) Authorize(uid uint64, provider, name string) (string, string, error) {
	kind := strings.ToLower(strings.TrimSpace(provider))
	if kind != netdisk.KindBaidu && kind != netdisk.KindAliyun {
		return "", "", netdisk.ConfigInvalid("不支持 OAuth 授权的网盘类型：" + provider)
	}
	if err := netdisk.EnsureAvailable(kind); err != nil {
		return "", "", err
	}
	state, err := randomState()
	if err != nil {
		return "", "", err
	}
	cfg := config.Current()
	switch kind {
	case netdisk.KindBaidu:
		s.put(state, &oauthState{UID: uid, Name: name, Provider: kind, CreatedAt: time.Now()})
		return netdisk.BaiduAuthorizeURL(cfg.BaiduAppKey, cfg.BaiduRedirectURI, state), state, nil
	case netdisk.KindAliyun:
		s.put(state, &oauthState{UID: uid, Name: name, Provider: kind, CreatedAt: time.Now()})
		return netdisk.AliyunAuthorizeURL(cfg.AliyunAppKey, cfg.AliyunRedirectURI, state), state, nil
	}
	return "", "", netdisk.ConfigInvalid("不支持 OAuth 授权的网盘类型：" + provider)
}

// put 暂存 state，顺带清掉已过期的（避免内存无上限增长）。
func (s *NetdiskOAuthService) put(state string, v *oauthState) {
	s.mu.Lock()
	defer s.mu.Unlock()
	cut := time.Now().Add(-oauthStateTTL)
	for k, old := range s.states {
		if old.CreatedAt.Before(cut) {
			delete(s.states, k)
		}
	}
	s.states[state] = v
}

// take 取出并**立即删除** state（一次性，防止回调重放）。
func (s *NetdiskOAuthService) take(state string) (*oauthState, bool) {
	if state == "" {
		return nil, false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	v, ok := s.states[state]
	if !ok {
		return nil, false
	}
	delete(s.states, state)
	if time.Since(v.CreatedAt) > oauthStateTTL {
		return nil, false
	}
	return v, true
}

// ---------- 回调 ----------

// Callback 用 code 换 token，并创建（或更新）对应的网盘连接。
func (s *NetdiskOAuthService) Callback(provider, code, state string) (*model.NetdiskConnection, error) {
	kind := strings.ToLower(strings.TrimSpace(provider))
	if kind != netdisk.KindBaidu && kind != netdisk.KindAliyun {
		return nil, netdisk.ConfigInvalid("不支持 OAuth 授权的网盘类型：" + provider)
	}
	if code == "" {
		return nil, netdisk.AuthFailed("授权未完成（缺少 code）")
	}
	st, ok := s.take(state)
	if !ok {
		return nil, netdisk.AuthFailed("授权状态已失效，请重新发起授权")
	}
	if st.Provider != kind {
		return nil, netdisk.AuthFailed("授权状态与网盘类型不匹配")
	}

	ctx, cancel := context.WithTimeout(context.Background(), oauthExchangeTimeout)
	defer cancel()
	cfg := config.Current()
	var creds *netdisk.Credentials
	var err error
	switch kind {
	case netdisk.KindBaidu:
		if !cfg.BaiduEnabled {
			return nil, netdisk.KindDisabled("百度网盘未配置，请联系管理员")
		}
		creds, err = netdisk.ExchangeBaiduToken(ctx, cfg.BaiduAppKey, cfg.BaiduAppSecret, cfg.BaiduRedirectURI, code)
	case netdisk.KindAliyun:
		if !cfg.AliyunEnabled {
			return nil, netdisk.KindDisabled("阿里云盘未配置，请联系管理员")
		}
		creds, err = netdisk.ExchangeAliyunToken(ctx, cfg.AliyunAppKey, cfg.AliyunAppSecret, code)
	}
	if err != nil {
		logNetdiskError("OAuth 换 token 失败", 0, err)
		return nil, err
	}
	if creds == nil || !creds.HasToken() {
		return nil, netdisk.AuthFailed("授权结果缺少访问令牌，请重试")
	}
	enc, err := netdisk.EncryptCredentials(creds)
	if err != nil {
		return nil, netdisk.ConfigInvalid("凭据加密失败，请重试")
	}

	name := strings.TrimSpace(st.Name)
	if name == "" {
		name = defaultOAuthName(kind)
	}
	root := netdisk.DefaultRootPath(kind, cfg.BaiduAppName)

	// 同一用户 + 同一类型的 OAuth 连接只保留一条：重复授权视为「更新令牌」，
	// 否则用户每次重新授权都会多出一条同名（或报错）的连接。
	existing := s.findByKind(st.UID, kind)
	if existing != nil {
		existing.CredEnc = enc
		existing.RootPath = root
		existing.Status = model.NetdiskStatusConnected
		existing.LastError = ""
		if name != "" {
			existing.Name = s.uniqueName(st.UID, name, existing.ID)
		}
		if err := repository.UpdateNetdiskConnection(existing); err != nil {
			return nil, err
		}
		netdisk.DefaultPool().Invalidate(existing.ID)
		return existing, nil
	}

	conn := &model.NetdiskConnection{
		UserID:   st.UID,
		Name:     s.uniqueName(st.UID, name, 0),
		Kind:     kind,
		RootPath: root,
		Status:   model.NetdiskStatusConnected,
		Enabled:  true,
		CredEnc:  enc,
	}
	if err := repository.CreateNetdiskConnection(conn); err != nil {
		return nil, err
	}
	return conn, nil
}

// findByKind 找该用户下某类型的第一条连接（用于重复授权时更新而非新建）。
func (s *NetdiskOAuthService) findByKind(uid uint64, kind string) *model.NetdiskConnection {
	list, err := repository.ListNetdiskConnections(uid)
	if err != nil {
		return nil
	}
	for i := range list {
		if list[i].Kind == kind {
			c := list[i]
			return &c
		}
	}
	return nil
}

// uniqueName 重名时追加序号（OAuth 场景不该直接报错：用户只是想重新授权）。
func (s *NetdiskOAuthService) uniqueName(uid uint64, name string, excludeID uint64) string {
	exists, err := repository.ExistsNetdiskName(uid, name, excludeID)
	if err != nil || !exists {
		return name
	}
	for i := 2; i < 100; i++ {
		candidate := name + " " + strconv.Itoa(i)
		exists, err := repository.ExistsNetdiskName(uid, candidate, excludeID)
		if err != nil || !exists {
			return candidate
		}
	}
	return name + " " + strconv.FormatInt(time.Now().Unix()%100000, 10)
}

// defaultOAuthName 用户没填名称时的兜底。
func defaultOAuthName(kind string) string {
	switch kind {
	case netdisk.KindBaidu:
		return "我的百度网盘"
	case netdisk.KindAliyun:
		return "我的阿里云盘"
	default:
		return "我的网盘"
	}
}

// randomState 32 字节随机 state（hex 编码）。
func randomState() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", netdisk.ConfigInvalid("生成授权状态失败，请重试")
	}
	return hex.EncodeToString(buf), nil
}
