package service

import (
	"golang.org/x/crypto/bcrypt"

	hkerr "haiku-wiki/server/internal/pkg"
	"haiku-wiki/server/internal/repository"
)

// UserService 当前用户资料管理。
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
