package model

// TodoOption 保存当前用户可复用的待办负责人和项目名称。
type TodoOption struct {
	ID     uint64 `gorm:"primaryKey" json:"-"`
	UserID uint64 `gorm:"uniqueIndex:idx_todo_option,priority:1" json:"-"`
	Kind   string `gorm:"size:16;uniqueIndex:idx_todo_option,priority:2" json:"kind"`
	Name   string `gorm:"size:191;uniqueIndex:idx_todo_option,priority:3" json:"name"`
}
