package model

import "time"

// DocVersion 文档版本快照，每文档保留最近 20 版。
type DocVersion struct {
	ID        uint64    `gorm:"primaryKey" json:"id"`
	DocID     uint64    `gorm:"index" json:"doc_id"`
	Title     string    `gorm:"size:256" json:"title"`
	Content   string    `gorm:"type:longtext" json:"content"`
	Source    string    `gorm:"size:16" json:"source"` // auto | manual | rollback
	CreatedBy uint64    `json:"created_by"`
	CreatedAt time.Time `json:"created_at"`
}

func (DocVersion) TableName() string { return "doc_versions" }
