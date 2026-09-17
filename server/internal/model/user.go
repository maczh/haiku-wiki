// Package model 定义全部 GORM 数据模型。
// 约定：主键 id uint64 自增；时间戳 created_at/updated_at；JSON 输出 snake_case。
package model

import "time"

// User 用户表。首个注册用户自动 role=admin。
type User struct {
	ID           uint64    `gorm:"primaryKey" json:"id"`
	Email        string    `gorm:"size:128;uniqueIndex" json:"email"`
	PasswordHash string    `gorm:"size:80" json:"-"` // 绝不外泄
	Nickname     string    `gorm:"size:64" json:"nickname"`
	Role         string    `gorm:"size:16;default:member" json:"role"` // admin | member
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

func (User) TableName() string { return "users" }
