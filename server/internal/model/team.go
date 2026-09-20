package model

import "time"

// Team 团队。
type Team struct {
	ID          uint64    `gorm:"primaryKey" json:"id"`
	Name        string    `gorm:"size:128" json:"name"`
	Description string    `gorm:"size:512" json:"description"`
	OwnerID     uint64    `gorm:"index" json:"owner_id"` // 创建者（视为团队 admin，不可被移除/降权）
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

func (Team) TableName() string { return "teams" }

// TeamMember 团队成员。role：admin | read_write | read_only。
// 旧数据中的 member 等价于 read_write，读取时由服务层兼容。
type TeamMember struct {
	ID        uint64    `gorm:"primaryKey" json:"id"`
	TeamID    uint64    `gorm:"primaryKey" json:"team_id"`
	UserID    uint64    `gorm:"primaryKey" json:"user_id"`
	Role      string    `gorm:"size:16;default:read_write" json:"role"`
	CreatedAt time.Time `json:"created_at"`
}

func (TeamMember) TableName() string { return "team_members" }

// TeamWithCount 团队列表项：Team + 文库数。
type TeamWithCount struct {
	Team
	BookCount int64 `gorm:"column:book_count" json:"book_count"`
}
