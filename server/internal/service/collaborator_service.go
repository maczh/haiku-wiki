package service

import (
	"haiku-wiki/server/internal/model"
	hkerr "haiku-wiki/server/internal/pkg"
	"haiku-wiki/server/internal/repository"
)

// CollaboratorService 文档协作邀请业务（个人库文档）。
type CollaboratorService struct{}

// Add 邀请协作者：需文档编辑权限（owner 或知识库可写），被邀请者获得等价 owner 编辑权限。
func (s *CollaboratorService) Add(uid, docID uint64, identifier string) (*model.DocCollaborator, error) {
	doc, _, err := (&DocService{}).loadDocForAccess(docID, uid, true)
	if err != nil {
		return nil, err
	}
	u, err := repository.FindUserByIdentifier(identifier)
	if err != nil {
		return nil, hkerr.NotFound("未找到该用户（按用户名/手机号/姓名/邮箱）")
	}
	// 文档创建者无需重复添加
	if u.ID == doc.CreatedBy {
		return nil, hkerr.Param("该用户已是文档所有者")
	}
	if _, err := repository.FindDocCollaborator(docID, u.ID); err == nil {
		return nil, hkerr.Conflict("该用户已是协作者")
	}
	dc := &model.DocCollaborator{DocID: docID, UserID: u.ID}
	if err := repository.CreateDocCollaborator(dc); err != nil {
		return nil, hkerr.Internal("添加失败")
	}
	return dc, nil
}

// List 列出文档协作者（需文档编辑权限）。
func (s *CollaboratorService) List(uid, docID uint64) ([]model.DocCollaborator, error) {
	if _, _, err := (&DocService{}).loadDocForAccess(docID, uid, true); err != nil {
		return nil, err
	}
	return repository.ListDocCollaborators(docID)
}

// Remove 移除协作者（需文档编辑权限）。
func (s *CollaboratorService) Remove(uid, docID, userID uint64) error {
	if _, _, err := (&DocService{}).loadDocForAccess(docID, uid, true); err != nil {
		return err
	}
	return repository.DeleteDocCollaborator(docID, userID)
}
