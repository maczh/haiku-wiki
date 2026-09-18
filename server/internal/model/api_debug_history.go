package model

import "time"

// ApiDebugHistory 接口文档「在线调试」历史记录。
// 按文档 + 接口 + 用户隔离，每个用户每个接口最多保留最近 10 条记录。
type ApiDebugHistory struct {
	ID         uint64    `gorm:"primaryKey" json:"id"`
	DocID      uint64    `gorm:"index:idx_api_debug_doc_ep_user,priority:1" json:"doc_id"`
	EndpointID string    `gorm:"size:64;index:idx_api_debug_doc_ep_user,priority:2" json:"endpoint_id"`
	UserID     uint64    `gorm:"index:idx_api_debug_doc_ep_user,priority:3" json:"user_id"`
	Records    string    `gorm:"type:longtext" json:"records"` // JSON 数组：DebugHistoryRecord[]
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

func (ApiDebugHistory) TableName() string { return "api_debug_history" }
