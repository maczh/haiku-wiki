package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"haiku-wiki/server/internal/middleware"
	"haiku-wiki/server/internal/pkg"
	"haiku-wiki/server/internal/service"
)

// ExportDoc GET /api/export/docs/:id?format=<md|docx|pdf|xlsx|csv|json|km|smm|xmind|mm|png|svg>
// 单篇导出：服务端完成全部格式转换；附件型文档直接回传原文件。
func ExportDoc(c *gin.Context) {
	id, ok := docIDFromPath(c)
	if !ok {
		resp.Error(c, paramMsg("无效的文档 ID"))
		return
	}
	out, err := exportService.DocExport(middleware.UID(c), id, c.Query("format"))
	if err != nil {
		resp.Error(c, err)
		return
	}
	c.Header("Content-Disposition", service.ContentDisposition(out.Filename))
	c.Data(http.StatusOK, out.MIME, out.Data)
}

// ExportDocFormats GET /api/export/docs/:id/formats —— 该文档可选的导出格式。
func ExportDocFormats(c *gin.Context) {
	id, ok := docIDFromPath(c)
	if !ok {
		resp.Error(c, paramMsg("无效的文档 ID"))
		return
	}
	opt, err := exportService.DocExportFormats(middleware.UID(c), id)
	if err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, opt)
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
