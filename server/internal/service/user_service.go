package service

import (
	"crypto/rand"
	"math/big"
	"time"

	"golang.org/x/crypto/bcrypt"

	"haiku-wiki/server/internal/model"
	hkerr "haiku-wiki/server/internal/pkg"
	"haiku-wiki/server/internal/repository"
)

// UserService 当前用户资料管理 + 管理员用户管理。
type UserService struct{}

// UpdateNickname 修改昵称。
func (s *UserService) UpdateNickname(uid uint64, nickname string) (*interface{}, error) {
	if len(nickname) == 0 || len(nickname) > 64 {
		return nil, hkerr.Param("昵称需为 1~64 个字符")
	}
	u, err := repository.FindUserByID(uid)
	if err != nil {
		return nil, hkerr.NotFound("用户不存在")
	}
	u.Nickname = nickname
	if err := repository.UpdateUser(u); err != nil {
		return nil, hkerr.Internal("保存失败")
	}
	var out interface{} = u
	return &out, nil
}

// UpdatePassword 修改密码（需校验旧密码）。
func (s *UserService) UpdatePassword(uid uint64, oldPwd, newPwd string) error {
	if len(newPwd) < 6 {
		return hkerr.Param("新密码至少 6 位")
	}
	u, err := repository.FindUserByID(uid)
	if err != nil {
		return hkerr.NotFound("用户不存在")
	}
	if bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(oldPwd)) != nil {
		return hkerr.Param("旧密码错误")
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(newPwd), bcrypt.DefaultCost)
	if err != nil {
		return hkerr.Internal("密码加密失败")
	}
	u.PasswordHash = string(hash)
	return repository.UpdateUser(u)
}

// ---------- 管理员用户管理 ----------

// AdminUserView 管理员视角的用户列表项。
type AdminUserView struct {
	ID         uint64    `json:"id"`
	Username   string    `json:"username"`
	Name       string    `json:"name"`
	Email      string    `json:"email"`
	Phone      string    `json:"phone"`
	Department string    `json:"department"`
	Role       string    `json:"role"`
	Status     int       `json:"status"`
	CreatedAt  time.Time `json:"created_at"`
}

func toAdminView(u model.User) AdminUserView {
	return AdminUserView{
		ID:         u.ID,
		Username:   u.Username,
		Name:       u.Name,
		Email:      u.Email,
		Phone:      derefStr(u.Phone),
		Department: u.Department,
		Role:       u.Role,
		Status:     u.Status,
		CreatedAt:  u.CreatedAt,
	}
}

// derefStr 解引用可空字符串，nil 返回空串。
func derefStr(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// AdminListUsers 分页列出全部用户。
func (s *UserService) AdminListUsers(page, pageSize int) ([]AdminUserView, int64, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}
	users, err := repository.ListUsers((page-1)*pageSize, pageSize)
	if err != nil {
		return nil, 0, hkerr.Internal("查询失败")
	}
	total, err := repository.CountUsersAll()
	if err != nil {
		return nil, 0, hkerr.Internal("查询失败")
	}
	views := make([]AdminUserView, 0, len(users))
	for _, u := range users {
		views = append(views, toAdminUserView(u))
	}
	return views, total, nil
}

func toAdminUserView(u model.User) AdminUserView { return toAdminView(u) }

// AdminSetStatus 管理员启用/禁用用户（不能禁用自己，不能禁用管理员账号）。
func (s *UserService) AdminSetStatus(adminID, targetID uint64, status int) (*AdminUserView, error) {
	if adminID == targetID {
		return nil, hkerr.Param("不能禁用或启用自己")
	}
	target, err := repository.FindUserByID(targetID)
	if err != nil {
		return nil, hkerr.NotFound("用户不存在")
	}
	if target.Role == "admin" {
		return nil, hkerr.Param("不能禁用管理员账号")
	}
	if status != 0 && status != 1 {
		return nil, hkerr.Param("状态值非法（仅 0/1）")
	}
	target.Status = status
	if err := repository.UpdateUser(target); err != nil {
		return nil, hkerr.Internal("保存失败")
	}
	v := toAdminView(*target)
	return &v, nil
}

// AdminResetPassword 管理员重置用户密码：未指定新密码则系统生成；
// 返回最终生效的明文密码（前端展示一次）。不能重置自己。
func (s *UserService) AdminResetPassword(adminID, targetID uint64, newPassword string) (string, error) {
	if adminID == targetID {
		return "", hkerr.Param("不能重置自己的密码")
	}
	target, err := repository.FindUserByID(targetID)
	if err != nil {
		return "", hkerr.NotFound("用户不存在")
	}
	if newPassword == "" {
		newPassword = genRandomPassword(12)
	}
	if len(newPassword) < 6 {
		return "", hkerr.Param("密码至少 6 位")
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcrypt.DefaultCost)
	if err != nil {
		return "", hkerr.Internal("密码加密失败")
	}
	target.PasswordHash = string(hash)
	if err := repository.UpdateUser(target); err != nil {
		return "", hkerr.Internal("保存失败")
	}
	return newPassword, nil
}

const pwdCharset = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789"

// genRandomPassword 生成指定长度随机密码（不含易混字符）。
func genRandomPassword(n int) string {
	b := make([]byte, n)
	for i := range b {
		idx, err := rand.Int(rand.Reader, big.NewInt(int64(len(pwdCharset))))
		if err != nil {
			b[i] = pwdCharset[0]
			continue
		}
		b[i] = pwdCharset[idx.Int64()]
	}
	return string(b)
}
