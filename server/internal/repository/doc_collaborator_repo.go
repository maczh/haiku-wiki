package repository

import (
	"haiku-wiki/server/internal/model"
)

// CreateDocCollaborator 添加文档协作者。
func CreateDocCollaborator(dc *model.DocCollaborator) error { return db.Create(dc).Error }

// FindDocCollaborator 查某用户是否为文档协作者。
func FindDocCollaborator(docID, userID uint64) (*model.DocCollaborator, error) {
	var dc model.DocCollaborator
	if err := db.Where("doc_id = ? AND user_id = ?", docID, userID).First(&dc).Error; err != nil {
		return nil, err
	}
	return &dc, nil
}

// ListDocCollaborators 列出文档全部协作者。
func ListDocCollaborators(docID uint64) ([]model.DocCollaborator, error) {
	var xs []model.DocCollaborator
	err := db.Where("doc_id = ?", docID).Order("created_at ASC").Find(&xs).Error
	return xs, err
}

// DeleteDocCollaborator 移除文档协作者。
func DeleteDocCollaborator(docID, userID uint64) error {
	return db.Where("doc_id = ? AND user_id = ?", docID, userID).Delete(&model.DocCollaborator{}).Error
}
