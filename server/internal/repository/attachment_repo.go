package repository

import (
	"haiku-wiki/server/internal/model"
)

// CreateAttachment 记录上传附件。
func CreateAttachment(a *model.Attachment) error { return db.Create(a).Error }

// FindAttachmentByID 按 ID 查附件记录。
func FindAttachmentByID(id uint64) (*model.Attachment, error) {
	var a model.Attachment
	if err := db.First(&a, id).Error; err != nil {
		return nil, err
	}
	return &a, nil
}
