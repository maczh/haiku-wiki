package model

import (
	"time"

	"gorm.io/gorm"
)

// Comment 文档点评 / 讨论帖。
// 根主题 = docs.ID（顶层文档、子文档、文件型文档皆为同一套，不区分类型）；
// ParentID = 0 为顶层帖，非 0 为某帖的跟帖（树形结构）。
type Comment struct {
	ID          uint64         `gorm:"primaryKey" json:"id"`
	DocID       uint64         `gorm:"index:idx_comment_doc;not null" json:"doc_id"`
	ParentID    uint64         `gorm:"index:idx_comment_parent;not null;default:0" json:"parent_id"`
	AuthorUID   uint64         `gorm:"not null;default:0" json:"author_uid"` // 0 = 匿名访客
	GuestName   string         `gorm:"size:64" json:"guest_name,omitempty"`  // 匿名访客昵称
	AuthorName  string         `gorm:"size:64" json:"author_name,omitempty"` // 登录用户展示名（冗余，删号后仍可读）
	Body        string         `gorm:"type:longtext" json:"body"`
	Status      string         `gorm:"size:16;default:normal" json:"status"` // normal | deleted
	EditorUID   uint64         `gorm:"not null;default:0" json:"-"`           // 删帖 / 禁言操作者（不暴露）
	IP          string         `gorm:"size:64" json:"-"`                      // 匿名滥用溯源（不暴露）
	CreatedAt   time.Time      `json:"created_at"`
	UpdatedAt   time.Time      `json:"updated_at"`
	DeletedAt   gorm.DeletedAt `gorm:"index" json:"deleted_at,omitempty"`
}

func (Comment) TableName() string { return "comments" }
