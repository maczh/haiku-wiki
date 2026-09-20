package repository

import (
	"errors"
	"strings"

	"gorm.io/gorm"

	"haiku-wiki/server/internal/model"
)

// ErrNotFound 统一的"查无记录"错误。
var ErrNotFound = gorm.ErrRecordNotFound

// IsNotFound 判断是否为查无记录。
func IsNotFound(err error) bool { return errors.Is(err, gorm.ErrRecordNotFound) }

// CountUsers 用户总数（历史判定用，已不再用于"首用户即管理员"）。
func CountUsers() (int64, error) {
	var n int64
	err := db.Model(&model.User{}).Count(&n).Error
	return n, err
}

// CountUsersAll 用户总数（分页列表用）。
func CountUsersAll() (int64, error) {
	var n int64
	err := db.Model(&model.User{}).Count(&n).Error
	return n, err
}

// CreateUser 新建用户。
func CreateUser(u *model.User) error { return db.Create(u).Error }

// FindUserByEmail 按邮箱查用户。
func FindUserByEmail(email string) (*model.User, error) {
	var u model.User
	if err := db.Where("email = ?", email).First(&u).Error; err != nil {
		return nil, err
	}
	return &u, nil
}

// FindUserByUsername 按用户名查用户。
func FindUserByUsername(username string) (*model.User, error) {
	var u model.User
	if err := db.Where("username = ?", username).First(&u).Error; err != nil {
		return nil, err
	}
	return &u, nil
}

// FindUserByPhone 按手机号查用户。
func FindUserByPhone(phone string) (*model.User, error) {
	var u model.User
	if err := db.Where("phone = ?", phone).First(&u).Error; err != nil {
		return nil, err
	}
	return &u, nil
}

// FindUserByIdentifier 按 username/phone/name/email 精确匹配（添加成员 / 协作者用）。
func FindUserByIdentifier(identifier string) (*model.User, error) {
	q := strings.TrimSpace(identifier)
	var u model.User
	if err := db.Where("username = ? OR phone = ? OR name = ? OR email = ?", q, q, q, q).First(&u).Error; err != nil {
		return nil, err
	}
	return &u, nil
}

// FindUserByID 按 ID 查用户。
func FindUserByID(id uint64) (*model.User, error) {
	var u model.User
	if err := db.First(&u, id).Error; err != nil {
		return nil, err
	}
	return &u, nil
}

// UpdateUser 保存用户变更（昵称/密码哈希/状态等）。
func UpdateUser(u *model.User) error { return db.Save(u).Error }

// ListUsers 分页列出全部用户（管理员用）。
func ListUsers(offset, limit int) ([]model.User, error) {
	var us []model.User
	err := db.Order("id ASC").Offset(offset).Limit(limit).Find(&us).Error
	return us, err
}

// AdminListUsers 分页列出用户；includeDeleted=true 时含软删（Unscoped 绕过软删过滤）。
func AdminListUsers(offset, limit int, includeDeleted bool) ([]model.User, error) {
	var us []model.User
	q := db.Order("id ASC").Offset(offset).Limit(limit)
	if includeDeleted {
		q = q.Unscoped()
	}
	err := q.Find(&us).Error
	return us, err
}

// FindUserByIDUnscoped 按 ID 查用户（含软删，回收站 / 彻底删除用）。
func FindUserByIDUnscoped(id uint64) (*model.User, error) {
	var u model.User
	if err := db.Unscoped().First(&u, id).Error; err != nil {
		return nil, err
	}
	return &u, nil
}

// SoftDeleteUser 软删用户（GORM Delete 自动写 deleted_at）。
func SoftDeleteUser(id uint64) error { return db.Delete(&model.User{}, id).Error }

// RestoreUser 恢复软删用户（deleted_at 置 NULL）。
func RestoreUser(id uint64) error {
	return db.Unscoped().Model(&model.User{}).Where("id = ?", id).Update("deleted_at", nil).Error
}

// PurgeUser 彻底删除用户（物理删除，绕过软删）。
func PurgeUser(id uint64) error { return db.Unscoped().Delete(&model.User{}, id).Error }

// ListDeletedUsers 分页列出已软删用户（按删除时间倒序）。
func ListDeletedUsers(offset, limit int) ([]model.User, error) {
	var us []model.User
	err := db.Unscoped().Where("deleted_at IS NOT NULL").
		Order("deleted_at DESC").Offset(offset).Limit(limit).Find(&us).Error
	return us, err
}

// CountDeletedUsers 已软删用户总数（分页用）。
func CountDeletedUsers() (int64, error) {
	var n int64
	err := db.Unscoped().Model(&model.User{}).Where("deleted_at IS NOT NULL").Count(&n).Error
	return n, err
}

// CountAdmins 统计管理员数量（保留接口，便于未来扩展）。
func CountAdmins() (int64, error) {
	var n int64
	err := db.Model(&model.User{}).Where("role = 'admin'").Count(&n).Error
	return n, err
}

// IsAdmin 判断用户是否为管理员（供公司知识库写权限等场景复用）。
func IsAdmin(uid uint64) bool {
	if uid == 0 {
		return false
	}
	var n int64
	if err := db.Model(&model.User{}).Where("id = ? AND role = 'admin'", uid).Count(&n).Error; err != nil {
		return false
	}
	return n > 0
}
