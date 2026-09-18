package handler

import (
	"github.com/gin-gonic/gin"

	"haiku-wiki/server/internal/middleware"
	"haiku-wiki/server/internal/pkg"
	"haiku-wiki/server/internal/service"
)

var collaboratorService = &service.CollaboratorService{}

type addCollaboratorReq struct {
	Identifier string `json:"identifier" binding:"required"`
}

// AddCollaborator POST /api/docs/:id/collaborators —— 邀请协作者（需文档编辑权限）。
func AddCollaborator(c *gin.Context) {
	docID, ok := docIDFromPath(c)
	if !ok {
		resp.Error(c, paramMsg("无效的文档 ID"))
		return
	}
	var req addCollaboratorReq
	if err := c.ShouldBindJSON(&req); err != nil {
		resp.Error(c, paramErr(err))
		return
	}
	dc, err := collaboratorService.Add(middleware.UID(c), docID, req.Identifier)
	if err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, dc)
}

// ListCollaborators GET /api/docs/:id/collaborators —— 协作者列表（需文档编辑权限）。
func ListCollaborators(c *gin.Context) {
	docID, ok := docIDFromPath(c)
	if !ok {
		resp.Error(c, paramMsg("无效的文档 ID"))
		return
	}
	list, err := collaboratorService.List(middleware.UID(c), docID)
	if err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, list)
}

// RemoveCollaborator DELETE /api/docs/:id/collaborators/:uid —— 移除协作者（需文档编辑权限）。
func RemoveCollaborator(c *gin.Context) {
	docID, ok := docIDFromPath(c)
	if !ok {
		resp.Error(c, paramMsg("无效的文档 ID"))
		return
	}
	uid, ok := parseUintParam(c, "uid")
	if !ok {
		resp.Error(c, paramMsg("无效的用户 ID"))
		return
	}
	if err := collaboratorService.Remove(middleware.UID(c), docID, uid); err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, gin.H{"removed": true})
}
