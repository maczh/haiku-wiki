package model

import "time"

// DocShare 文档级分享（一文档一条有效分享：doc_id 唯一索引）。
// 与书级公开（books.share_slug）完全独立，撤销 = 物理删除本行。
type DocShare struct {
	ID           uint64     `gorm:"primaryKey" json:"id"`
	DocID        uint64     `gorm:"uniqueIndex" json:"doc_id"` // 一文档一有效分享
	Slug         string     `gorm:"size:32;uniqueIndex" json:"slug"`
	PasswordHash string     `json:"-"`                      // bcrypt；空串 = 无密码
	ExpiresAt    *time.Time `json:"expires_at"`             // nil = 永久
	Enabled      bool       `json:"enabled"`                // 停用开关
	Views        uint64     `gorm:"default:0" json:"views"` // 分享访问次数（verify 成功自增）
	CreatedAt    time.Time  `json:"created_at"`
	UpdatedAt    time.Time  `json:"updated_at"`
}

func (DocShare) TableName() string { return "doc_shares" }
