package model

import "time"

// DocCollaborator 文档协作者（个人库文档邀请协作）。
// 受邀用户获得该文档的「等价 owner」编辑权限（可读可写），不受知识库可见性约束。
type DocCollaborator struct {
	DocID     uint64    `gorm:"primaryKey" json:"doc_id"`
	UserID    uint64    `gorm:"primaryKey" json:"user_id"`
	CreatedAt time.Time `json:"created_at"`
}

func (DocCollaborator) TableName() string { return "doc_collaborators" }
