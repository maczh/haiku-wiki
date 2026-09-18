// Package model 定义全部 GORM 数据模型。
// 约定：主键 id uint64 自增；时间戳 created_at/updated_at；JSON 输出 snake_case。
package model

import "time"

// User 用户表。
//   - 首个注册用户自动 admin 的 old 规则已退役（新注册用户固定 member），仅保留存量 admin 账号；
//   - username / phone 唯一索引（phone 可空）；status：1=启用 0=禁用（默认 1）。
type User struct {
	ID           uint64    `gorm:"primaryKey" json:"id"`
	Username     string    `gorm:"size:64;uniqueIndex" json:"username"` // 登录用户名（唯一）
	Email        string    `gorm:"size:128;uniqueIndex" json:"email"`
	PasswordHash string    `gorm:"size:80" json:"-"` // 绝不外泄
	Nickname     string    `gorm:"size:64" json:"nickname"`
	Name         string    `gorm:"size:64" json:"name"`       // 姓名
	Department   string    `gorm:"size:128" json:"department"` // 部门
	Phone        *string   `gorm:"size:32;uniqueIndex" json:"phone"` // 手机号（可空，唯一；空值存 NULL，不触发唯一冲突）
	Role         string    `gorm:"size:16;default:member" json:"role"` // admin | member
	Status       int       `gorm:"default:1" json:"status"`            // 1=启用 0=禁用
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

func (User) TableName() string { return "users" }
