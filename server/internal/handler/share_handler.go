package handler

import (
	"strconv"

	"github.com/gin-gonic/gin"

	"haiku-wiki/server/internal/pkg"
)

// GetShare GET /api/public/share/:slug —— 分享信息（免 JWT，只读）。
func GetShare(c *gin.Context) {
	slug := c.Param("slug")
	info, err := shareService.GetBySlug(slug)
	if err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, info)
}

// GetShareDoc GET /api/public/share/:slug/docs/:docId —— 只读文档内容。
func GetShareDoc(c *gin.Context) {
	slug := c.Param("slug")
	docID, err := strconv.ParseUint(c.Param("docId"), 10, 64)
	if err != nil || docID == 0 {
		resp.Error(c, paramMsg("无效的文档 ID"))
		return
	}
	doc, err := shareService.GetDoc(slug, docID)
	if err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, doc)
}
