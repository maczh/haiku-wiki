package handler

import (
	"encoding/json"
	"io"
	"strconv"

	"github.com/gin-gonic/gin"

	"haiku-wiki/server/internal/middleware"
	// 包名为 resp（见 internal/pkg/respond.go），但导入路径仍是 .../internal/pkg
	"haiku-wiki/server/internal/pkg"
	"haiku-wiki/server/internal/service"
	"haiku-wiki/server/internal/storage"
)

// ImportURL POST /api/import/url —— 把外部网址**原样保存**为网页文档（JWT）。
//
// 变更说明（与旧行为的关键差异）：
//   - 旧实现是服务端抓取网页 → 转 Markdown → 图片本地化，等于把别人的内容抄一份进本站；
//   - 现在只保存网址本身，阅读页用 iframe 直接加载原站。
//
// 因此这里不再需要 SSRF 防护（服务端根本不发请求），只需保证协议是 http/https——
// iframe 的 src 若允许 javascript:/data:，等于把脚本执行权交给了输入者。
func ImportURL(c *gin.Context) {
	var in struct {
		URL      string `json:"url" binding:"required"`
		BookID   uint64 `json:"book_id" binding:"required"`
		ParentID uint64 `json:"parent_id"` // 可选：导入到指定目录下，0=根目录
		Title    string `json:"title"`     // 可选：未填时用域名兜底
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		resp.Error(c, paramErr(err))
		return
	}
	doc, err := docService.ImportWebURL(middleware.UID(c), in.BookID, in.ParentID, in.URL, in.Title)
	if err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, gin.H{"doc_id": doc.ID, "title": doc.Title, "doc_type": doc.DocType})
}

// ImportHTML POST /api/import/html —— 导入 HTML 页面 / zip 包 / 网页目录（JWT，multipart）。
//
// 原样保存、不做任何转换：网页包里的 css/js/图片都按原相对路径落盘，
// 阅读页用 iframe 加载入口文件，效果与本地打开一致。
//
// 表单字段：
//   - book_id / parent_id / title：导入目标
//   - files[]：文件（可多文件；目录导入时配合 paths 保留相对路径）
//   - paths：可选，JSON 字符串数组，与 files 顺序一一对应，指定每个文件的包内相对路径
func ImportHTML(c *gin.Context) {
	bookID, err := strconv.ParseUint(c.PostForm("book_id"), 10, 64)
	if err != nil || bookID == 0 {
		resp.Error(c, paramMsg("book_id 无效"))
		return
	}
	parentID, _ := strconv.ParseUint(c.PostForm("parent_id"), 10, 64)

	form, err := c.MultipartForm()
	if err != nil {
		resp.Error(c, paramMsg("表单解析失败"))
		return
	}
	fhs := form.File["files"]
	if len(fhs) == 0 {
		resp.Error(c, paramMsg("没有上传文件"))
		return
	}

	// 相对路径表（目录导入时前端给出 webkitRelativePath）
	var paths []string
	if raw := c.PostForm("paths"); raw != "" {
		_ = json.Unmarshal([]byte(raw), &paths)
	}

	maxBytes := int64(64 << 20)
	if cfg := storage.Cfg(); cfg != nil {
		maxBytes = cfg.UploadMaxBytes()
	}
	files := make([]service.HTMLFile, 0, len(fhs))
	for i, fh := range fhs {
		if fh.Size > maxBytes {
			resp.Error(c, resp.FileTooLarge())
			return
		}
		src, err := fh.Open()
		if err != nil {
			resp.Error(c, resp.Param("读取上传文件失败"))
			return
		}
		data, err := io.ReadAll(io.LimitReader(src, maxBytes+1))
		src.Close()
		if err != nil {
			resp.Error(c, resp.Param("读取上传文件失败"))
			return
		}
		if int64(len(data)) > maxBytes {
			resp.Error(c, resp.FileTooLarge())
			return
		}
		p := fh.Filename
		if i < len(paths) && paths[i] != "" {
			p = paths[i]
		}
		files = append(files, service.HTMLFile{Path: p, Data: data})
	}

	doc, err := docService.ImportHTML(middleware.UID(c), bookID, parentID, files, c.PostForm("title"))
	if err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, gin.H{"doc_id": doc.ID, "title": doc.Title, "doc_type": doc.DocType})
}
