package model

import "time"

// BookWriter 公司知识库写权限授权表（多对多）。
// 公司知识库对所有登录用户只读；管理员在此表授予特定用户写权限，
// 与管理员自身一起构成写权限持有者（见 service.canWriteDoc）。
type BookWriter struct {
	BookID    uint64    `gorm:"primaryKey" json:"book_id"`
	UserID    uint64    `gorm:"primaryKey" json:"user_id"`
	CreatedAt time.Time `json:"created_at"`
}

func (BookWriter) TableName() string { return "book_writers" }

// BookWriterView 授权列表项：授权关系 + 用户展示信息（供前端直接渲染）。
type BookWriterView struct {
	BookID    uint64    `json:"book_id"`
	UserID    uint64    `json:"user_id"`
	CreatedAt time.Time `json:"created_at"`
	Username  string    `json:"username"`
	Name      string    `json:"name"`
	Email     string    `json:"email"`
	Nickname  string    `json:"nickname"`
}
