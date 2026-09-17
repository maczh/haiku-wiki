// Package service 业务逻辑层：权限判定、fractional index 编排、版本快照、搜索过滤等。
package service

import (
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/bcrypt"

	"haiku-wiki/server/internal/model"
	hkerr "haiku-wiki/server/internal/pkg"
	"haiku-wiki/server/internal/pkg/jwtutil"
	"haiku-wiki/server/internal/repository"
)

// AuthService 认证相关业务。
type AuthService struct{}

var authRateMu sync.Mutex
var authRateMap = map[string]time.Time{} // IP → 上次注册时间（60s 限频）

// allowRegister 同 IP 60 秒内仅允许一次注册（防滥用）。
func allowRegister(ip string) bool {
	authRateMu.Lock()
	defer authRateMu.Unlock()
	if len(authRateMap) > 10000 { // 简单防膨胀
		authRateMap = map[string]time.Time{}
	}
	if t, ok := authRateMap[ip]; ok && time.Since(t) < 60*time.Second {
		return false
	}
	authRateMap[ip] = time.Now()
	return true
}

// RegisterOutput 注册/登录成功返回。
type RegisterOutput struct {
	Token string      `json:"token"`
	User  *model.User `json:"user"`
}

// Register 注册新用户；首个用户自动 admin；同 IP 60s 限频。
func (s *AuthService) Register(email, password, nickname, ip string) (*RegisterOutput, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	if email == "" || !strings.Contains(email, "@") {
		return nil, hkerr.Param("请输入有效邮箱")
	}
	if len(password) < 6 {
		return nil, hkerr.Param("密码至少 6 位")
	}
	if !allowRegister(ip) {
		return nil, hkerr.New(42901, 429, "注册过于频繁，请 60 秒后再试")
	}
	if _, err := repository.FindUserByEmail(email); err == nil {
		return nil, hkerr.Conflict("该邮箱已注册")
	}
	if nickname == "" {
		nickname = email[:strings.Index(email, "@")]
	}
	if len(nickname) > 64 {
		nickname = nickname[:64]
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return nil, hkerr.Internal("密码加密失败")
	}
	role := "member"
	if n, err := repository.CountUsers(); err == nil && n == 0 {
		role = "admin" // 首个注册用户自动成为管理员
	}
	u := &model.User{Email: email, PasswordHash: string(hash), Nickname: nickname, Role: role}
	if err := repository.CreateUser(u); err != nil {
		return nil, hkerr.Internal("注册失败")
	}
	token, err := jwtutil.Create(u.ID, u.Role)
	if err != nil {
		return nil, hkerr.Internal("签发凭证失败")
	}
	return &RegisterOutput{Token: token, User: u}, nil
}

// Login 邮箱 + 密码登录。
func (s *AuthService) Login(email, password string) (*RegisterOutput, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	u, err := repository.FindUserByEmail(email)
	if err != nil {
		return nil, hkerr.Param("邮箱或密码错误")
	}
	if bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(password)) != nil {
		return nil, hkerr.Param("邮箱或密码错误")
	}
	token, err := jwtutil.Create(u.ID, u.Role)
	if err != nil {
		return nil, hkerr.Internal("签发凭证失败")
	}
	return &RegisterOutput{Token: token, User: u}, nil
}
