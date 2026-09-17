package repository

import (
	"gorm.io/gorm"

	"haiku-wiki/server/internal/model"
)

// FindDocShareByDocID 按文档 ID 查有效分享记录（一文档一条）。
func FindDocShareByDocID(docID uint64) (*model.DocShare, error) {
	var s model.DocShare
	if err := db.Where("doc_id = ?", docID).First(&s).Error; err != nil {
		return nil, err
	}
	return &s, nil
}

// FindDocShareBySlug 按 slug 查分享记录（公开访问用）。
func FindDocShareBySlug(slug string) (*model.DocShare, error) {
	var s model.DocShare
	if err := db.Where("slug = ?", slug).First(&s).Error; err != nil {
		return nil, err
	}
	return &s, nil
}

// InsertDocShare 新建分享记录。
func InsertDocShare(s *model.DocShare) error { return db.Create(s).Error }

// SaveDocShare 保存分享记录变更（覆盖 slug/password/expires/enabled）。
func SaveDocShare(s *model.DocShare) error { return db.Save(s).Error }

// DeleteDocShare 撤销分享（物理删除，链接立即失效）。
func DeleteDocShare(docID uint64) error {
	return db.Where("doc_id = ?", docID).Delete(&model.DocShare{}).Error
}

// IncDocShareViews 分享访问次数自增（verify 成功时调用）。
func IncDocShareViews(id uint64) error {
	return db.Model(&model.DocShare{}).Where("id = ?", id).
		Update("views", gorm.Expr("views + 1")).Error
}

// DocShareExistsBySlug slug 是否已被占用。
func DocShareExistsBySlug(slug string) bool {
	var n int64
	db.Model(&model.DocShare{}).Where("slug = ?", slug).Count(&n)
	return n > 0
}
