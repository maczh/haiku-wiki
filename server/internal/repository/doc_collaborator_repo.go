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

// ListDocCollaboratorViews 列出文档协作者（联 users 补展示信息；phone 为可空列，用 COALESCE 兜空串）。
//
// 为什么单独一个函数而不是改 ListDocCollaborators：后者是纯关系查询，被写路径
// （查重）依赖；列表视图只服务 GET 接口，两者语义不同，分开可避免互相牵连。
func ListDocCollaboratorViews(docID uint64) ([]model.DocCollaboratorView, error) {
	var out []model.DocCollaboratorView
	err := db.Model(&model.DocCollaborator{}).
		Select(`doc_collaborators.doc_id, doc_collaborators.user_id, doc_collaborators.created_at,
			COALESCE(users.username, '') AS username, COALESCE(users.name, '') AS name,
			COALESCE(users.email, '') AS email, COALESCE(users.phone, '') AS phone`).
		Joins("LEFT JOIN users ON users.id = doc_collaborators.user_id").
		Where("doc_collaborators.doc_id = ?", docID).
		Order("doc_collaborators.created_at ASC").
		Scan(&out).Error
	return out, err
}

// DeleteDocCollaborator 移除文档协作者。
func DeleteDocCollaborator(docID, userID uint64) error {
	return db.Where("doc_id = ? AND user_id = ?", docID, userID).Delete(&model.DocCollaborator{}).Error
}
