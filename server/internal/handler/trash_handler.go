package handler

import (
	"github.com/gin-gonic/gin"

	"haiku-wiki/server/internal/middleware"
	"haiku-wiki/server/internal/pkg"
)

// ListTrash GET /api/trash —— 回收站列表（P1）。
func ListTrash(c *gin.Context) {
	list, err := trashService.List(middleware.UID(c))
	if err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, list)
}

// RestoreDoc POST /api/docs/:id/restore —— 恢复。
func RestoreDoc(c *gin.Context) {
	id, ok := docIDFromPath(c)
	if !ok {
		resp.Error(c, paramMsg("无效的文档 ID"))
		return
	}
	if err := trashService.Restore(middleware.UID(c), id); err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, gin.H{"restored": true})
}

// PurgeDoc DELETE /api/docs/:id/purge —— 彻底删除（含快照）。
func PurgeDoc(c *gin.Context) {
	id, ok := docIDFromPath(c)
	if !ok {
		resp.Error(c, paramMsg("无效的文档 ID"))
		return
	}
	if err := trashService.Purge(middleware.UID(c), id); err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, gin.H{"purged": true})
}
