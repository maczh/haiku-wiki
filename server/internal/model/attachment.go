package model

import "time"

// Attachment 上传的图片/附件记录。
type Attachment struct {
	ID          uint64    `gorm:"primaryKey" json:"id"`
	UploaderID  uint64    `json:"uploader_id"`
	Filename    string    `gorm:"size:255" json:"filename"`
	StoragePath string    `gorm:"size:255" json:"storage_path"` // uploads/2026/09/<uuid>.<ext>
	MimeType    string    `gorm:"size:64" json:"mime_type"`
	Size        int64     `json:"size"`
	CreatedAt   time.Time `json:"created_at"`
}

func (Attachment) TableName() string { return "attachments" }
