package service

import (
	"haiku-wiki/server/internal/model"
	hkerr "haiku-wiki/server/internal/pkg"
	"haiku-wiki/server/internal/repository"
)

// ShareService 公开分享业务（免 JWT 只读）。
type ShareService struct{}

// ShareBookInfo 分享页头部信息。
type ShareBookInfo struct {
	ID         uint64 `json:"id"`
	Name       string `json:"name"`
	CoverColor string `json:"cover_color"`
	OwnerName  string `json:"owner_name"`
}

// ShareInfo /api/public/share/:slug 响应。
type ShareInfo struct {
	Book ShareBookInfo `json:"book"`
	Docs []model.Doc   `json:"docs"` // 目录树平铺列表
}

// GetBySlug 校验 slug 并返回书信息 + 目录树。
func (s *ShareService) GetBySlug(slug string) (*ShareInfo, error) {
	book, err := repository.FindBookBySlug(slug)
	if err != nil {
		return nil, hkerr.NotFound("分享链接无效或已关闭")
	}
	owner, err := repository.FindUserByID(book.OwnerID)
	ownerName := ""
	if err == nil {
		ownerName = owner.Nickname
	}
	docs, err := repository.ListTreeByBook(book.ID)
	if err != nil {
		return nil, hkerr.Internal("查询失败")
	}
	return &ShareInfo{
		Book: ShareBookInfo{ID: book.ID, Name: book.Name, CoverColor: book.CoverColor, OwnerName: ownerName},
		Docs: docs,
	}, nil
}

// GetDoc 只读获取分享文档内容（校验 doc 属于该书）。
func (s *ShareService) GetDoc(slug string, docID uint64) (*model.Doc, error) {
	book, err := repository.FindBookBySlug(slug)
	if err != nil {
		return nil, hkerr.NotFound("分享链接无效或已关闭")
	}
	doc, err := repository.FindDocByID(docID)
	if err != nil || doc.BookID != book.ID {
		return nil, hkerr.NotFound("文档不存在")
	}
	return doc, nil
}
