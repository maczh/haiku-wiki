package repository

import "haiku-wiki/server/internal/model"

// CreateComment 落库一条点评。
func CreateComment(c *model.Comment) error { return db.Create(c).Error }

// GetComment 按 ID 查（含被软删的，供管理操作）。
func GetComment(id uint64) (*model.Comment, error) {
	var c model.Comment
	if err := db.Unscoped().First(&c, id).Error; err != nil {
		return nil, err
	}
	return &c, nil
}

// ListCommentsByDoc 该文档全部未删除点评（读者视角）。
func ListCommentsByDoc(docID uint64) ([]model.Comment, error) {
	var list []model.Comment
	if err := db.Where("doc_id = ? AND status = ?", docID, "normal").
		Order("created_at ASC, id ASC").Find(&list).Error; err != nil {
		return nil, err
	}
	return list, nil
}

// ListCommentsByDocUnscoped 含软删（管理者清区计数 / 可见性用）。
func ListCommentsByDocUnscoped(docID uint64) ([]model.Comment, error) {
	var list []model.Comment
	if err := db.Unscoped().Where("doc_id = ?", docID).
		Order("created_at ASC, id ASC").Find(&list).Error; err != nil {
		return nil, err
	}
	return list, nil
}

// CountCommentsByDoc 未删除条数。
func CountCommentsByDoc(docID uint64) (int64, error) {
	var n int64
	if err := db.Model(&model.Comment{}).Where("doc_id = ? AND status = ?", docID, "normal").Count(&n).Error; err != nil {
		return 0, err
	}
	return n, nil
}

// SoftDeleteComment 标记删除（保留树结构，正文置占位）。
func SoftDeleteComment(id, editorUID uint64) error {
	return db.Model(&model.Comment{}).Where("id = ?", id).
		Updates(map[string]any{"status": "deleted", "body": "[已删除]", "editor_uid": editorUID}).Error
}

// HardDeleteCommentsByDoc 清空该文档全部点评（管理者「清空本文所有发贴」）。
func HardDeleteCommentsByDoc(docID uint64) error {
	return db.Unscoped().Where("doc_id = ?", docID).Delete(&model.Comment{}).Error
}

// --- CommentSetting ---

// GetCommentSetting 按文档 ID 取配置。
func GetCommentSetting(docID uint64) (*model.CommentSetting, error) {
	var s model.CommentSetting
	if err := db.First(&s, docID).Error; err != nil {
		return nil, err
	}
	return &s, nil
}

// UpsertCommentSetting 保存（存在即更新，含首次创建）。
func UpsertCommentSetting(s *model.CommentSetting) error { return db.Save(s).Error }
