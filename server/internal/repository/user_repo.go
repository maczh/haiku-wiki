package repository

import (
	"errors"

	"gorm.io/gorm"

	"haiku-wiki/server/internal/model"
)

// ErrNotFound 统一的"查无记录"错误。
var ErrNotFound = gorm.ErrRecordNotFound

// IsNotFound 判断是否为查无记录。
func IsNotFound(err error) bool { return errors.Is(err, gorm.ErrRecordNotFound) }

// CountUsers 用户总数（首个注册用户判定）。
func CountUsers() (int64, error) {
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

// FindUserByID 按 ID 查用户。
func FindUserByID(id uint64) (*model.User, error) {
	var u model.User
	if err := db.First(&u, id).Error; err != nil {
		return nil, err
	}
	return &u, nil
}

// UpdateUser 保存用户变更（昵称/密码哈希）。
func UpdateUser(u *model.User) error { return db.Save(u).Error }
