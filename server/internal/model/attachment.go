package model

import "time"

// Attachment 上传的图片/附件记录。
//
// 注意 storage_path 的两种历史形态（迁移期共存，不迁移历史数据）：
//   - uploads/YYYY/MM/<uuid>.<ext>   —— 本特性之前的存量（MD5 为空，不参与秒传）
//   - uploads/cas/<md5 前2位>/<md5>-<随机6位hex>.<ext> —— 内容寻址（新上传）
//
// 多行 meta 共享同一 md5 与同一 storage_path 是**设计预期**（P0-2③ / P0-4）：
// 同一份内容被不同用户/不同文库引用时会各记一行，物理对象只有一份。
type Attachment struct {
	ID          uint64 `gorm:"primaryKey" json:"id"`
	UploaderID  uint64 `json:"uploader_id"`
	Filename    string `gorm:"size:255" json:"filename"`
	StoragePath string `gorm:"size:255" json:"storage_path"`
	MimeType    string `gorm:"size:255" json:"mime_type"`
	Size        int64  `json:"size"`
	// MD5 原件内容摘要（32 位小写 hex）。空串 = 历史存量（未回填，P2-1 不做）。
	// 索引用于秒传预检（按 md5 反查物理对象）。
	MD5       string    `gorm:"size:32;index:idx_attachments_md5" json:"md5,omitempty"`
	CreatedAt time.Time `json:"created_at"`
}

func (Attachment) TableName() string { return "attachments" }
