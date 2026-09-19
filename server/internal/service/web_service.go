package service

// 网页型文档（doc_type=web）：把「外部网址」与「导入的 HTML 包」统一成一类文档。
//
// 与附件型文档（doc_type=file）的区别：file 是单个不可编辑的文件（pdf/docx…），
// web 是**可嵌入展示的网页**——没有编辑模式，阅读页直接 iframe 呈现原内容。
//
// 两种来源用 kind 区分：
//   - kind=url ：只保存原始网址，服务端**不抓取**网页（抓取既慢、又会把内容抄一份
//     到本站造成版权与一致性问题），展示时由浏览器直接加载原站。
//   - kind=html：导入的 HTML 页面 / zip 包 / 网页目录，原样保存在存储里，不做任何转换。

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"io"
	"net/url"
	"path"
	"strings"

	"github.com/google/uuid"

	"haiku-wiki/server/internal/model"
	hkerr "haiku-wiki/server/internal/pkg"
	"haiku-wiki/server/internal/repository"
	"haiku-wiki/server/internal/storage"
)

// WebRef 网页型文档的正文 JSON（与前端 types.ts 的 WebRef 对应）。
type WebRef struct {
	Kind string `json:"kind"` // url | html
	// URL kind=url 时的原始网址（原样保存，不抓取、不改写）
	URL string `json:"url,omitempty"`
	// Entry kind=html 时的入口文件访问路径（/uploads/web/<id>/index.html）
	Entry string `json:"entry,omitempty"`
	// Title 网页标题（URL 导入时用域名或用户填的标题兜底）
	Title string `json:"title,omitempty"`
	// Note 导入说明（如 zip 包名、入口文件推断方式）
	Note string `json:"note,omitempty"`
}

// ---------- URL 导入 ----------

// ImportWebURL 保存一个外部网址为网页文档（不抓取内容）。
func (s *DocService) ImportWebURL(uid, bookID, parentID uint64, rawURL, title string) (*model.Doc, error) {
	u, err := ValidateWebURL(rawURL)
	if err != nil {
		return nil, err
	}
	if title == "" {
		title = defaultWebTitle(u)
	}
	ref := WebRef{Kind: "url", URL: u.String(), Title: title}
	b, err := json.Marshal(ref)
	if err != nil {
		return nil, hkerr.Internal("序列化失败")
	}
	content := string(b)
	if err != nil {
		return nil, hkerr.Internal("序列化失败")
	}
	return s.createWebDoc(uid, bookID, parentID, title, content)
}

// ValidateWebURL 校验可嵌入的网页地址。
//
// 只放行 http/https：iframe 的 src 若允许 javascript: 或 data: 就等于把脚本执行权
// 交给了输入者（data: 在部分浏览器下可绕过 CSP）。
func ValidateWebURL(raw string) (*url.URL, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, hkerr.Param("请输入网页地址")
	}
	// 用户常常直接粘 "www.example.com"：补上协议，别让他先去猜为什么报错
	if !strings.Contains(raw, "://") {
		raw = "https://" + raw
	}
	u, err := url.Parse(raw)
	if err != nil {
		return nil, hkerr.Param("网页地址无效")
	}
	scheme := strings.ToLower(u.Scheme)
	if scheme != "http" && scheme != "https" {
		return nil, hkerr.Param("仅支持 http / https 地址")
	}
	if u.Host == "" {
		return nil, hkerr.Param("网页地址缺少主机名")
	}
	return u, nil
}

// defaultWebTitle URL 导入未填标题时的兜底：用主机名的主域，去掉 www. 前缀。
func defaultWebTitle(u *url.URL) string {
	h := u.Hostname()
	h = strings.TrimPrefix(h, "www.")
	if h == "" {
		return "网页"
	}
	return h
}

// ---------- HTML 导入 ----------

// HTMLFile 一次 HTML 导入里的一个文件（相对路径 + 内容）。
type HTMLFile struct {
	Path string // 包内相对路径（目录导入时是相对所选目录的路径）
	Data []byte
}

// ImportHTML 保存 HTML 页面 / zip 包 / 网页目录，返回新建文档。
//
// 处理策略：
//   - 单个 .zip：服务端解压（防 zip slip）后按目录处理；
//   - 其余：按相对路径原样落盘；
//   - 入口文件：优先根目录 index.html/index.htm，其次包内首个 .html/.htm。
func (s *DocService) ImportHTML(uid, bookID, parentID uint64, files []HTMLFile, title string) (*model.Doc, error) {
	if len(files) == 0 {
		return nil, hkerr.Param("没有可导入的文件")
	}
	// 单 zip 包 → 解压展开
	if len(files) == 1 && strings.EqualFold(path.Ext(files[0].Path), ".zip") {
		expanded, err := unzipHTML(files[0].Data)
		if err != nil {
			return nil, err
		}
		files = expanded
	}

	// 清理与校验相对路径
	cleaned := make([]HTMLFile, 0, len(files))
	for _, f := range files {
		p, err := safeHTMLPath(f.Path)
		if err != nil {
			return nil, err
		}
		if !allowedHTMLExt(path.Ext(p)) {
			continue // 静默跳过不支持的资源类型（网页目录里杂七杂八的文件很多）
		}
		cleaned = append(cleaned, HTMLFile{Path: p, Data: f.Data})
	}
	if len(cleaned) == 0 {
		return nil, hkerr.Param("没有可导入的网页文件（需包含 .html/.htm）")
	}

	// 统一放在 uploads/web/<uuid>/ 下：一个导入一个目录，删除文档时整目录清理
	base := "uploads/web/" + uuid.NewString()
	st := storage.Default()
	for _, f := range cleaned {
		if err := st.Put(base+"/"+f.Path, f.Data, storage.MimeByExt(f.Path)); err != nil {
			return nil, err
		}
	}

	entry := pickHTMLEntry(cleaned)
	if entry == "" {
		return nil, hkerr.Param("未找到入口页面（index.html 或任意 .html）")
	}
	if title == "" {
		title = "网页导入"
	}
	ref := WebRef{
		Kind:  "html",
		Entry: st.URL(base + "/" + entry),
		Title: title,
		Note:  "入口：" + entry,
	}
	b, err := json.Marshal(ref)
	if err != nil {
		return nil, hkerr.Internal("序列化失败")
	}
	content := string(b)
	if err != nil {
		return nil, hkerr.Internal("序列化失败")
	}
	return s.createWebDoc(uid, bookID, parentID, title, content)
}

// createWebDoc 建文档（权限与归属校验复用既有 createDoc 口径）。
func (s *DocService) createWebDoc(uid, bookID, parentID uint64, title, content string) (*model.Doc, error) {
	book, err := repository.FindBookByID(bookID)
	if err != nil {
		return nil, hkerr.NotFound("知识库不存在")
	}
	if !CanWriteBook(book, uid) {
		return nil, hkerr.Forbidden()
	}
	if parentID > 0 {
		parent, err := repository.FindDocByID(parentID)
		if err != nil || parent.BookID != bookID {
			return nil, hkerr.NotFound("目标目录不存在")
		}
	}
	doc, err := s.CreateDocWithContent(book, uid, parentID, title, "web", content)
	if err != nil {
		return nil, err
	}
	return doc, nil
}

// ---------- 内部工具 ----------

// safeHTMLPath 规范化包内相对路径，拒绝绝对路径与 ..（防 zip slip 与目录穿越）。
func safeHTMLPath(p string) (string, error) {
	p = strings.ReplaceAll(strings.TrimSpace(p), "\\", "/")
	p = strings.TrimPrefix(p, "/")
	clean := path.Clean(p)
	if clean == "." || clean == "" || clean == ".." ||
		strings.HasPrefix(clean, "../") || strings.Contains(clean, "/../") {
		return "", hkerr.Param("文件包含非法路径：" + p)
	}
	return clean, nil
}

// allowedHTMLExt 网页包内允许落盘的资源类型。
//
// 刻意不放行服务端脚本与可执行文件（.php/.jsp/.exe/.sh…）：导入的目录可能来自
// 不可信来源，落盘后即便不会被本站执行，留在存储里也是隐患。
func allowedHTMLExt(ext string) bool {
	switch strings.ToLower(ext) {
	case ".html", ".htm", ".css", ".js", ".mjs", ".json", ".xml", ".txt", ".md",
		".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".ico", ".bmp",
		".woff", ".woff2", ".ttf", ".eot", ".otf",
		".mp4", ".webm", ".mp3", ".pdf":
		return true
	}
	return false
}

// pickHTMLEntry 选入口文件：根目录 index → 任意 index → 首个 html（路径浅者优先）。
func pickHTMLEntry(files []HTMLFile) string {
	var firstHTML string
	for _, f := range files {
		ext := strings.ToLower(path.Ext(f.Path))
		if ext != ".html" && ext != ".htm" {
			continue
		}
		base := strings.ToLower(path.Base(f.Path))
		if base == "index.html" || base == "index.htm" {
			// 根目录的 index 最优
			if !strings.Contains(f.Path, "/") {
				return f.Path
			}
			if firstHTML == "" {
				firstHTML = f.Path
			}
			continue
		}
		if firstHTML == "" {
			firstHTML = f.Path
		}
	}
	return firstHTML
}

// unzipHTML 解压 zip 包为文件列表（防 zip slip、限制解压体积）。
func unzipHTML(data []byte) ([]HTMLFile, error) {
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, hkerr.Param("无法解析 zip 包")
	}
	const (
		maxFiles     = 2000
		maxTotalSize = 200 << 20 // 200MB
		maxFileSize  = 50 << 20  // 单文件 50MB
	)
	var out []HTMLFile
	var total int64
	for _, f := range zr.File {
		if len(out) >= maxFiles {
			return nil, hkerr.Param("zip 包内文件过多")
		}
		if f.FileInfo().IsDir() {
			continue
		}
		name, err := safeHTMLPath(f.Name)
		if err != nil {
			// 跳过非法路径条目而不是整体失败：一个坏文件名不该让整包导入失败
			continue
		}
		if !allowedHTMLExt(path.Ext(name)) {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			continue
		}
		buf, err := io.ReadAll(io.LimitReader(rc, maxFileSize+1))
		rc.Close()
		if err != nil {
			continue
		}
		if int64(len(buf)) > maxFileSize {
			return nil, hkerr.Param("zip 包内有超大文件")
		}
		total += int64(len(buf))
		if total > maxTotalSize {
			return nil, hkerr.Param("zip 包解压后体积过大")
		}
		out = append(out, HTMLFile{Path: name, Data: buf})
	}
	if len(out) == 0 {
		return nil, hkerr.Param("zip 包内没有可导入的网页文件")
	}
	return out, nil
}
