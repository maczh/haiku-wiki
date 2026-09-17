package handler

import (
	"github.com/gin-gonic/gin"

	"haiku-wiki/server/internal/middleware"
	"haiku-wiki/server/internal/pkg"
	"haiku-wiki/server/internal/service"
)

// docShareService 文档级分享服务实例。
var docShareService = &service.DocShareService{}

// UpsertDocShare PUT /api/docs/:id/share —— 创建/更新二合一（upsert，更新即刷新 slug）。
func UpsertDocShare(c *gin.Context) {
	id, ok := docIDFromPath(c)
	if !ok {
		resp.Error(c, paramMsg("无效的文档 ID"))
		return
	}
	var req service.UpsertInput
	if err := c.ShouldBindJSON(&req); err != nil {
		resp.Error(c, paramErr(err))
		return
	}
	view, err := docShareService.Upsert(middleware.UID(c), id, req)
	if err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, view)
}

// GetDocShare GET /api/docs/:id/share —— 分享抽屉回显（未创建过返回 null）。
func GetDocShare(c *gin.Context) {
	id, ok := docIDFromPath(c)
	if !ok {
		resp.Error(c, paramMsg("无效的文档 ID"))
		return
	}
	view, err := docShareService.GetByDocID(middleware.UID(c), id)
	if err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, view)
}

// RevokeDocShare DELETE /api/docs/:id/share —— 撤销分享（物理删除，链接立即失效）。
func RevokeDocShare(c *gin.Context) {
	id, ok := docIDFromPath(c)
	if !ok {
		resp.Error(c, paramMsg("无效的文档 ID"))
		return
	}
	if err := docShareService.Revoke(middleware.UID(c), id); err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, gin.H{"revoked": true})
}

// GetDocShareMeta GET /api/public/doc-share/:slug —— 公开元信息（免 JWT）。
func GetDocShareMeta(c *gin.Context) {
	meta, err := docShareService.GetPublicMeta(c.Param("slug"))
	if err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, meta)
}

// VerifyDocShare POST /api/public/doc-share/:slug/verify —— 密码校验，成功直接返回内容（免 JWT）。
func VerifyDocShare(c *gin.Context) {
	var req struct {
		Password string `json:"password"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		// 空请求体（无密码分享）也允许通过
		req.Password = ""
	}
	out, err := docShareService.Verify(c.Param("slug"), req.Password, c.ClientIP())
	if err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, out)
}
