package model

import (
	"time"

	"gorm.io/gorm"
)

// Doc 文档树节点，同时是回收站数据源（GORM 软删 deleted_at）。
// pos 为 fractional index 排序键，兄弟间字典序即显示序。
type Doc struct {
	ID        uint64         `gorm:"primaryKey" json:"id"`
	BookID    uint64         `gorm:"index:idx_book_parent_pos,priority:1" json:"book_id"`
	ParentID  uint64         `gorm:"index:idx_book_parent_pos,priority:2" json:"parent_id"`
	Pos       string         `gorm:"index:idx_book_parent_pos,priority:3;size:64" json:"pos"`
	Title     string         `gorm:"size:256" json:"title"`
	DocType   string         `gorm:"size:16;default:markdown" json:"doc_type"` // markdown|sheet|mindmap|flowchart（datatable 已下线，存量迁移为 sheet）
	Content   string         `gorm:"type:longtext" json:"content"`
	// PinnedAt 置顶时间（NULL=未置顶）；同级排序：置顶在前，其余按 pos。
	PinnedAt  *time.Time     `json:"pinned_at,omitempty"`
	CreatedBy uint64         `json:"created_by"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"deleted_at,omitempty"`
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
}

func (Doc) TableName() string { return "docs" }
