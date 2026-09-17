package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"haiku-wiki/server/internal/middleware"
	"haiku-wiki/server/internal/pkg"
	"haiku-wiki/server/internal/service"
)

// ExportDoc GET /api/export/docs/:id —— 单篇导出 .md。
func ExportDoc(c *gin.Context) {
	id, ok := docIDFromPath(c)
	if !ok {
		resp.Error(c, paramMsg("无效的文档 ID"))
		return
	}
	name, data, err := exportService.DocMarkdown(middleware.UID(c), id)
	if err != nil {
		resp.Error(c, err)
		return
	}
	c.Header("Content-Disposition", service.ContentDisposition(name))
	c.Data(http.StatusOK, "text/markdown; charset=utf-8", data)
}

// ExportBook GET /api/export/books/:id —— 知识库导出 .md.zip。
func ExportBook(c *gin.Context) {
	id, ok := bookIDFromPath(c)
	if !ok {
		resp.Error(c, paramMsg("无效的知识库 ID"))
		return
	}
	name, data, err := exportService.BookZip(middleware.UID(c), id)
	if err != nil {
		resp.Error(c, err)
		return
	}
	c.Header("Content-Disposition", service.ContentDisposition(name))
	c.Data(http.StatusOK, "application/zip", data)
}
