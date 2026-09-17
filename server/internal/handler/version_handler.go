package handler

import (
	"strconv"

	"github.com/gin-gonic/gin"

	"haiku-wiki/server/internal/middleware"
	"haiku-wiki/server/internal/pkg"
)

// ListVersions GET /api/docs/:id/versions
func ListVersions(c *gin.Context) {
	docID, ok := docIDFromPath(c)
	if !ok {
		resp.Error(c, paramMsg("无效的文档 ID"))
		return
	}
	if _, _, err := docService.LoadForRead(middleware.UID(c), docID); err != nil {
		resp.Error(c, err)
		return
	}
	list, err := versionSvc.List(docID)
	if err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, list)
}

// GetVersion GET /api/docs/:id/versions/:vid
func GetVersion(c *gin.Context) {
	docID, ok := docIDFromPath(c)
	if !ok {
		resp.Error(c, paramMsg("无效的文档 ID"))
		return
	}
	vid, err := strconv.ParseUint(c.Param("vid"), 10, 64)
	if err != nil {
		resp.Error(c, paramMsg("无效的版本 ID"))
		return
	}
	if _, _, err := docService.LoadForRead(middleware.UID(c), docID); err != nil {
		resp.Error(c, err)
		return
	}
	v, err := versionSvc.Get(docID, vid)
	if err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, v)
}

// RollbackVersion POST /api/docs/:id/versions/:vid/rollback
func RollbackVersion(c *gin.Context) {
	docID, ok := docIDFromPath(c)
	if !ok {
		resp.Error(c, paramMsg("无效的文档 ID"))
		return
	}
	vid, err := strconv.ParseUint(c.Param("vid"), 10, 64)
	if err != nil {
		resp.Error(c, paramMsg("无效的版本 ID"))
		return
	}
	doc, err := versionSvc.Rollback(middleware.UID(c), docID, vid)
	if err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, doc)
}
