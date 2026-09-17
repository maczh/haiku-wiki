package service

import (
	"time"

	"haiku-wiki/server/internal/model"
	hkerr "haiku-wiki/server/internal/pkg"
	"haiku-wiki/server/internal/repository"
)

// VersionService 版本快照业务：内容变化即快照 + 手动快照，每文档保留最近 20 版。
type VersionService struct{}

// defaultVersionService 供 DocService 复用（同包内单例）。
var defaultVersionService = &VersionService{}

// Snapshot 写入快照并裁剪旧版本。
func (s *VersionService) Snapshot(doc *model.Doc, source string, uid uint64) error {
	v := &model.DocVersion{
		DocID:     doc.ID,
		Title:     doc.Title,
		Content:   doc.Content,
		Source:    source,
		CreatedBy: uid,
	}
	if err := repository.CreateVersion(v); err != nil {
		return hkerr.Internal("版本快照失败")
	}
	if err := repository.TrimVersions(doc.ID); err != nil {
		return hkerr.Internal("版本裁剪失败")
	}
	return nil
}

// List 版本列表（倒序，最多 20，含字数）。
func (s *VersionService) List(docID uint64) ([]repository.VersionMeta, error) {
	return repository.ListVersionsByDoc(docID)
}

// Get 快照内容（预览对比用）。
func (s *VersionService) Get(docID, versionID uint64) (*model.DocVersion, error) {
	v, err := repository.FindVersionByID(versionID)
	if err != nil || v.DocID != docID {
		return nil, hkerr.NotFound("版本不存在")
	}
	return v, nil
}

// RollbackInput 回滚请求。
type RollbackInput struct{}

// Rollback 回滚到指定版本：当前内容先存为 rollback 快照，再写入目标版本内容。
func (s *VersionService) Rollback(uid uint64, docID, versionID uint64) (*model.Doc, error) {
	doc, err := repository.FindDocByID(docID)
	if err != nil {
		return nil, hkerr.NotFound("文档不存在")
	}
	v, err := s.Get(docID, versionID)
	if err != nil {
		return nil, err
	}
	// 当前内容先存为 rollback 快照
	if err := s.Snapshot(doc, "rollback", uid); err != nil {
		return nil, err
	}
	doc.Content = v.Content
	doc.UpdatedAt = time.Now()
	if err := repository.UpdateDoc(doc); err != nil {
		return nil, hkerr.Internal("回滚失败")
	}
	return doc, nil
}
