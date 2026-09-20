package model

import "time"

// DocCollaborator 文档协作者（个人库文档邀请协作）。
// 受邀用户获得该文档的「等价 owner」编辑权限（可读可写），不受知识库可见性约束。
type DocCollaborator struct {
	ID          uint64    `gorm:"primaryKey" json:"id"`
	DocID     uint64    `gorm:"primaryKey" json:"doc_id"`
	UserID    uint64    `gorm:"primaryKey" json:"user_id"`
	CreatedAt time.Time `json:"created_at"`
}

func (DocCollaborator) TableName() string { return "doc_collaborators" }

// DocCollaboratorView 协作者列表项：协作关系 + 用户展示信息（供前端直接渲染列表）。
// 与 TeamMemberView 同构：列表接口不返回裸 user_id，避免前端只看到数字 ID。
type DocCollaboratorView struct {
	DocID     uint64    `json:"doc_id"`
	UserID    uint64    `json:"user_id"`
	CreatedAt time.Time `json:"created_at"`
	Username  string    `json:"username"`
	Name      string    `json:"name"`
	Email     string    `json:"email"`
	Phone     string    `json:"phone"`
}
