package model

import "time"

// DocCollaborator 文档协作者（个人库文档邀请协作）。
// 受邀用户获得该文档的「等价 owner」编辑权限（可读可写），不受知识库可见性约束。
//
// 主键形态与 TeamMember 一致：自增 id 作唯一主键，(doc_id, user_id) 用组合唯一索引兜底
// 去重（而不是塞进主键）。原因：三列复合主键会让 GORM 在「旧库」上试图给已存在的复合
// 主键表就地补自增 id 列 —— SQLite 报 `Cannot add a PRIMARY KEY column`、MySQL 报
// `Error 1068 Multiple primary key defined`，AutoMigrate 直接失败、进程起不来（R20）。
type DocCollaborator struct {
	ID        uint64    `gorm:"primaryKey" json:"id"`
	DocID     uint64    `gorm:"uniqueIndex:idx_doc_user" json:"doc_id"`
	UserID    uint64    `gorm:"uniqueIndex:idx_doc_user" json:"user_id"`
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
