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

// CountAdmins 统计管理员数量（保留接口，便于未来扩展）。
func CountAdmins() (int64, error) {
	var n int64
	err := db.Model(&model.User{}).Where("role = 'admin'").Count(&n).Error
	return n, err
}
