package model

import "time"

// ApiRefreshRun 最近一次接口文档刷新任务的执行结果（P1-3；只留最近一次，不建全量任务表 —— Q8）。
//
// ⚠️ Trigger 列名在 MySQL 是**保留字**（§13.1-D3）：GORM 全程加反引号，DDL 与 CRUD 都安全；
// 但将来若手写该列的 SQL，必须写成 “ `trigger` “。
type ApiRefreshRun struct {
	ID         uint64     `gorm:"primaryKey" json:"id"`   // 恒为 1
	Trigger    string     `gorm:"size:16" json:"trigger"` // auto | manual | admin
	StartedAt  time.Time  `json:"started_at"`
	FinishedAt *time.Time `json:"finished_at,omitempty"`
	Scanned    int        `json:"scanned"`
	Succeeded  int        `json:"succeeded"`
	Failed     int        `json:"failed"`
	Added      int        `json:"added"`
	Updated    int        `json:"updated"`
	Removed    int        `json:"removed"`
	Failures   string     `gorm:"type:longtext" json:"failures"` // JSON: [{doc_id,title,error}]
}

func (ApiRefreshRun) TableName() string { return "api_refresh_runs" }
