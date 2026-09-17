package handler

import (
	"github.com/gin-gonic/gin"

	"haiku-wiki/server/internal/middleware"
	"haiku-wiki/server/internal/pkg"
)

// Upload POST /api/uploads —— multipart 文件上传。
func Upload(c *gin.Context) {
	fh, err := c.FormFile("file")
	if err != nil {
		resp.Error(c, paramMsg("请通过 multipart/form-data 的 file 字段上传"))
		return
	}
	out, err := uploadService.Save(middleware.UID(c), fh)
	if err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, out)
}
