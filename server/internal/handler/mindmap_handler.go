package handler

import (
	"io"
	"strings"

	"github.com/gin-gonic/gin"

	resp "haiku-wiki/server/internal/pkg"
	"haiku-wiki/server/internal/service/exportx"
)

// maxMindmapImportBytes 导入思维导图源文件的大小上限。
// 思维导图本身是纯文本/小压缩包，超过这个量级基本是传错了文件。
const maxMindmapImportBytes = 32 << 20

// mindmapImportResp 导入解析结果：直接落成内置思维导图文档所需的三要素。
type mindmapImportResp struct {
	Title   string `json:"title"`
	Content string `json:"content"`
	DocType string `json:"doc_type"`
}

// ParseMindmap POST /api/mindmap/parse —— 把 .smm/.km/.xmind/.mm 解析为内置思维导图正文。
//
// 为什么放在服务端：.xmind 是 zip 包（需解压 + 兼容新旧两种内部结构），
// 浏览器侧要额外引入解压库；放服务端后四种格式共用一套解析与错误提示，
// 且能被单测直接覆盖（见 exportx/mindmap_import_test.go）。
func ParseMindmap(c *gin.Context) {
	fh, err := c.FormFile("file")
	if err != nil {
		resp.Error(c, paramMsg("请通过 multipart/form-data 的 file 字段上传思维导图文件"))
		return
	}
	if fh.Size > maxMindmapImportBytes {
		resp.Error(c, paramMsg("思维导图文件过大（上限 32MB）"))
		return
	}
	f, err := fh.Open()
	if err != nil {
		resp.Error(c, paramMsg("无法读取上传的思维导图文件"))
		return
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, maxMindmapImportBytes))
	if err != nil {
		resp.Error(c, paramMsg("读取思维导图文件失败"))
		return
	}
	content, title, err := exportx.ImportMindmapFile(fh.Filename, data)
	if err != nil {
		// 解析失败直接回原话，前端会把它展示给用户（例如「未找到 content.json」）
		resp.Error(c, paramMsg(err.Error()))
		return
	}
	title = strings.TrimSpace(title)
	if r := []rune(title); len(r) > 200 {
		title = string(r[:200])
	}
	if title == "" {
		title = "导入的思维导图"
	}
	resp.OK(c, mindmapImportResp{Title: title, Content: content, DocType: "mindmap"})
}
