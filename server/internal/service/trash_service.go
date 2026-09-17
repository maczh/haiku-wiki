package service

import (
	"haiku-wiki/server/internal/repository"
	hkerr "haiku-wiki/server/internal/pkg"
)

// TrashService 回收站业务（P1）。
type TrashService struct{}

// List 回收站列表（按库分组的数据由前端聚合，这里返回平铺列表）。
func (s *TrashService) List(uid uint64) ([]repository.TrashItem, error) {
	return repository.ListTrash(uid)
}

// Restore 恢复文档（连同已删除的祖先链一起恢复，保证树完整）。
func (s *TrashService) Restore(uid, docID uint64) error {
	doc, err := repository.FindDocUnscopedByID(docID)
	if err != nil || !doc.DeletedAt.Valid {
		return hkerr.NotFound("文档不在回收站中")
	}
	// 仅书主可恢复
	book, err := repository.FindBookByID(doc.BookID)
	if err != nil || book.OwnerID != uid {
		return hkerr.Forbidden()
	}
	return repository.RestoreDocWithAncestors(doc)
}

// Purge 彻底删除（文档 + 子孙 + 全部版本快照，不可恢复）。
func (s *TrashService) Purge(uid, docID uint64) error {
	doc, err := repository.FindDocUnscopedByID(docID)
	if err != nil {
		return hkerr.NotFound("文档不存在")
	}
	book, err := repository.FindBookByID(doc.BookID)
	if err != nil || book.OwnerID != uid {
		return hkerr.Forbidden()
	}
	ids, err := repository.ListDescendantIDs(doc.BookID, doc.ID)
	if err != nil {
		return hkerr.Internal("查询失败")
	}
	if err := repository.DeleteVersionsByDocs(ids); err != nil {
		return hkerr.Internal("删除版本失败")
	}
	return repository.PurgeDocs(ids)
}
