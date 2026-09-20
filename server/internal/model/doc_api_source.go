package model

import "time"

// DocApiSource 接口文档的「URL 导入来源」元数据（D3：只对本次改动之后新导入的文档生效）。
//
// 一篇文档至多一条（doc_id 即主键，无来源 URL 的文档不建行）。
//
// ⚠️ SourceURL **不建索引**（§13.3-①，方言安全硬约束）：
// MySQL 下 varchar(1024)×4B = 4096B > InnoDB 3072B 索引上限 → AutoMigrate 直接
// ERROR 1071，而 Connect() 之后紧接着 AutoMigrate() ⇒ 切到 MySQL 时进程启动即失败。
// 本设计也不存在「按 source_url 查询」的路径（刷新是遍历本表逐行取自身 URL，见 §5.2）。
type DocApiSource struct {
	DocID           uint64     `gorm:"primaryKey" json:"doc_id"`
	SourceURL       string     `gorm:"size:1024" json:"source_url"`
	ImportedAt      time.Time  `json:"imported_at"` // 首次导入时间，刷新时**不改写**
	LastRefreshedAt *time.Time `json:"last_refreshed_at,omitempty"`
	RefreshStatus   string     `gorm:"size:16" json:"refresh_status"` // "" | success | failed
	RefreshError    string     `gorm:"size:512" json:"refresh_error,omitempty"`
	LastAdded       int        `json:"last_added"`
	LastUpdated     int        `json:"last_updated"`
	LastRemoved     int        `json:"last_removed"`
	CreatedAt       time.Time  `json:"created_at"`
	UpdatedAt       time.Time  `json:"updated_at"`
}

func (DocApiSource) TableName() string { return "doc_api_sources" }
