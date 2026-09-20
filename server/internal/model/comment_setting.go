package model

import "time"

// CommentSetting 文档点评区权限配置（一文档一行，懒创建）。
//
// AllowView / AllowPost 取值（范围从窄到宽）：
//
//	owner  仅文档所有者（含管理员 / 团队管理员）
//	team   团队文库成员
//	login  任意登录用户
//	all    所有人（含匿名分享访客）
type CommentSetting struct {
	DocID      uint64    `gorm:"primaryKey" json:"doc_id"`
	AllowView  string    `gorm:"size:16;default:all" json:"allow_view"`
	AllowPost  string    `gorm:"size:16;default:all" json:"allow_post"`
	Locked     bool      `gorm:"default:false" json:"locked"` // 全局禁言（禁止发新帖）
	BannedUIDs string    `gorm:"type:text" json:"-"`          // JSON 数组 [uid,...] 被禁言的登录用户
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

func (CommentSetting) TableName() string { return "comment_settings" }
