// Package service 业务逻辑层：权限判定、fractional index 编排、版本快照、搜索过滤等。
package service

import (
	"regexp"
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

// phoneRe 中国大陆手机号格式（宽松校验，避免误伤）。
var phoneRe = regexp.MustCompile(`^1[3-9]\d{9}$`)

func isValidPhone(phone string) bool {
	return phoneRe.MatchString(phone)
}

// toPhonePtr 将字符串手机号转为可空指针：空字符串 → nil（存 NULL，避免唯一索引冲突）。
func toPhonePtr(phone string) *string {
	if phone == "" {
		return nil
	}
	p := phone
	return &p
}

// Register 注册新用户：username/email 必填且唯一；phone 可空且唯一；新用户固定 member。
// 旧规则"首个注册用户自动 admin"已退役，仅保留存量 admin 账号（见 repository.SeedData）。
func (s *AuthService) Register(username, name, email, phone, department, password, ip string) (*RegisterOutput, error) {
	username = strings.TrimSpace(username)
	email = strings.ToLower(strings.TrimSpace(email))
	phone = strings.TrimSpace(phone)
	department = strings.TrimSpace(department)
	if username == "" {
		return nil, hkerr.Param("请输入用户名")
	}
	if !allowRegister(ip) {
		return nil, hkerr.New(42901, 429, "注册过于频繁，请 60 秒后再试")
	}
	if email == "" || !strings.Contains(email, "@") {
		return nil, hkerr.Param("请输入有效邮箱")
	}
	if len(password) < 6 {
		return nil, hkerr.Param("密码至少 6 位")
	}
	if phone != "" && !isValidPhone(phone) {
		return nil, hkerr.Param("手机号格式不正确")
	}

	// 唯一性校验（40901）
	if _, err := repository.FindUserByUsername(username); err == nil {
		return nil, hkerr.Conflict("该用户名已注册")
	}
	if _, err := repository.FindUserByEmail(email); err == nil {
		return nil, hkerr.Conflict("该邮箱已注册")
	}
	if phone != "" {
		if _, err := repository.FindUserByPhone(phone); err == nil {
			return nil, hkerr.Conflict("该手机号已注册")
		}
	}

	if name == "" {
		name = username
	}
	if len(name) > 64 {
		name = name[:64]
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return nil, hkerr.Internal("密码加密失败")
	}
	u := &model.User{
		Username:     username,
		Name:         name,
		Email:        email,
		Phone:        toPhonePtr(phone),
		Department:   department,
		PasswordHash: string(hash),
		Nickname:     name,
		Role:         "member",
		Status:       1,
	}
	if err := repository.CreateUser(u); err != nil {
		return nil, hkerr.Internal("注册失败")
	}
	token, err := jwtutil.Create(u.ID, u.Role)
	if err != nil {
		return nil, hkerr.Internal("签发凭证失败")
	}
	return &RegisterOutput{Token: token, User: u}, nil
}

// Login 登录：支持 用户名 / 手机号 / 邮箱 任一作为账号；禁用账号拒绝登录。
func (s *AuthService) Login(identifier, password string) (*RegisterOutput, error) {
	identifier = strings.TrimSpace(identifier)
	var u *model.User
	var err error
	// 优先级：username → phone → email
	if u, err = repository.FindUserByUsername(identifier); err != nil {
		if u, err = repository.FindUserByPhone(identifier); err != nil {
			if u, err = repository.FindUserByEmail(strings.ToLower(identifier)); err != nil {
				return nil, hkerr.Param("账号或密码错误")
			}
		}
	}
	if u.Status != 1 {
		return nil, hkerr.Param("账号已被禁用，请联系管理员")
	}
	if bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(password)) != nil {
		return nil, hkerr.Param("账号或密码错误")
	}
	token, err := jwtutil.Create(u.ID, u.Role)
	if err != nil {
		return nil, hkerr.Internal("签发凭证失败")
	}
	return &RegisterOutput{Token: token, User: u}, nil
}
