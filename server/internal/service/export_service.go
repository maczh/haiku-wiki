package service

import (
	"archive/zip"
	"bytes"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf8"

	"haiku-wiki/server/internal/model"
	hkerr "haiku-wiki/server/internal/pkg"
	"haiku-wiki/server/internal/repository"
	"haiku-wiki/server/internal/service/exportx"
)

// ExportService Markdown 导出业务（P1）：单篇 .md / 知识库 .md.zip。
type ExportService struct{}

// sanitizeFilename 清理文件名中的路径分隔符等非法字符。
func sanitizeFilename(name string) string {
	name = strings.NewReplacer("/", "＿", "\\", "＿", ":", "：", "*", "＊",
		"?", "？", "\"", "＂", "<", "《", ">", "》", "|", "｜", "\n", " ").Replace(name)
	name = strings.TrimSpace(name)
	if name == "" {
		name = "untitled"
	}
	if utf8.RuneCountInString(name) > 80 {
		name = string([]rune(name)[:80])
	}
	return name
}

// ContentDisposition 构造 RFC 5987 编码的下载头（支持中文文件名）。
func ContentDisposition(filename string) string {
	return fmt.Sprintf("attachment; filename*=UTF-8''%s", url.PathEscape(filename))
}

// canReadBook 读权限：public 任何人；members 登录用户；private 仅 owner；
// 团队文库（team_id 非空）团队任意成员可读（与写一致，团队内完全协作）。
func canReadBook(book *model.Book, uid uint64) bool {
	switch book.Visibility {
	case "public":
		return true
	case "members":
		return uid > 0
	default: // private
		return book.OwnerID == uid || isTeamReader(book, uid)
	}
}

// ExportOutput 导出结果：文件名 + MIME + 内容字节。
type ExportOutput struct {
	Filename string
	MIME     string
	Data     []byte
}

// loadReadableDoc 取文档及其所属知识库并做读权限校验。
func loadReadableDoc(uid, docID uint64) (*model.Doc, error) {
	doc, err := repository.FindDocByID(docID)
	if err != nil {
		return nil, hkerr.NotFound("文档不存在")
	}
	book, err := repository.FindBookByID(doc.BookID)
	if err != nil {
		return nil, hkerr.NotFound("知识库不存在")
	}
	if !canReadBook(book, uid) {
		return nil, hkerr.Forbidden()
	}
	return doc, nil
}

// DocMarkdown 导出单篇文档：返回 (文件名, markdown 字节)。
func (s *ExportService) DocMarkdown(uid, docID uint64) (string, []byte, error) {
	doc, err := loadReadableDoc(uid, docID)
	if err != nil {
		return "", nil, err
	}
	name := sanitizeFilename(doc.Title) + ".md"
	return name, []byte(doc.Content), nil
}

// DocExport 导出单篇文档为指定格式（format 为空时取该类型默认格式）。
// 所有格式转换在服务端完成；附件型（doc_type=file）直接回传原始文件。
func (s *ExportService) DocExport(uid, docID uint64, format string) (*ExportOutput, error) {
	doc, err := loadReadableDoc(uid, docID)
	if err != nil {
		return nil, err
	}
	// 附件型：默认原样回传上传的原文件；若该类型有派生格式（CAD 图纸），
	// 且请求的是派生格式，则回传后端在导入时生成好的 SVG/PNG。
	if exportx.NormalizeDocType(doc.DocType) == "file" {
		return attachmentExport(doc, strings.TrimSpace(format))
	}
	spec := exportx.DefaultFormat(doc.DocType)
	if want := strings.TrimSpace(format); want != "" {
		got, ok := exportx.LookupFormat(doc.DocType, want)
		if !ok {
			return nil, hkerr.Param(fmt.Sprintf("不支持的导出格式：%s", want))
		}
		spec = got
	}
	data, spec, err := exportx.Convert(doc.DocType, spec.Value, doc.Content, doc.Title)
	if err != nil {
		return nil, hkerr.Internal(fmt.Sprintf("导出失败：%v", err))
	}
	return &ExportOutput{
		Filename: sanitizeFilename(doc.Title) + "." + spec.Ext,
		MIME:     spec.MIME,
		Data:     data,
	}, nil
}

// ExportFormatOption 导出对话框所需的格式选项（附件型返回 IsFile）。
type ExportFormatOption struct {
	DocType  string               `json:"doc_type"`
	IsFile   bool                 `json:"is_file"`
	Formats  []exportx.FormatSpec `json:"formats"`
	Default  string               `json:"default"`
	Filename string               `json:"filename"` // 附件型：原文件名（含扩展名）
	// 以下三项仅附件型（file）有值：后端在导入时生成的派生资源
	Derived  map[string]string `json:"derived,omitempty"`
	Note     string            `json:"note,omitempty"`
	Degraded bool              `json:"degraded,omitempty"`
}

// DocExportFormats 返回文档可选的导出格式，供前端导出对话框渲染。
func (s *ExportService) DocExportFormats(uid, docID uint64) (*ExportFormatOption, error) {
	doc, err := loadReadableDoc(uid, docID)
	if err != nil {
		return nil, err
	}
	docType := exportx.NormalizeDocType(doc.DocType)
	if docType == "file" {
		name := doc.Title
		ref := exportx.ParseFileRef(doc.Content)
		if ref != nil && ref.Filename != "" {
			name = ref.Filename
		}
		opt := &ExportFormatOption{DocType: "file", IsFile: true, Filename: name}
		if ref != nil {
			// CAD 图纸额外提供后端生成的 svg/png；其余附件仅原文件
			opt.Formats = exportx.AttachmentFormats(ref.Ext)
			if len(opt.Formats) > 0 {
				opt.Default = opt.Formats[0].Value
			}
			opt.Derived = ref.Derived
			opt.Note = ref.Note
			opt.Degraded = ref.Degraded
		}
		return opt, nil
	}
	return &ExportFormatOption{
		DocType: docType,
		Formats: exportx.FormatsForDocType(docType),
		Default: exportx.DefaultFormat(docType).Value,
	}, nil
}

// attachmentExport 附件型文档导出：format 为空或等于原扩展名 → 原文件；
// 否则在派生资源里找（目前仅 CAD 图纸的 svg/png）。
func attachmentExport(doc *model.Doc, format string) (*ExportOutput, error) {
	ref := exportx.ParseFileRef(doc.Content)
	if ref == nil {
		return nil, hkerr.NotFound("附件不存在或已被移除")
	}
	want := strings.ToLower(strings.TrimPrefix(format, "."))
	if want == "" || want == ref.Ext {
		return attachmentOutput(doc)
	}
	spec, ok := lookupAttachmentFormat(ref.Ext, want)
	if !ok {
		return nil, hkerr.Param(fmt.Sprintf("附件不支持导出为 %s", format))
	}
	url := ""
	if ref.Derived != nil {
		url = ref.Derived[want]
	}
	if url == "" {
		msg := "该附件没有可用的派生文件"
		if ref.Note != "" {
			msg += "（" + ref.Note + "）"
		}
		return nil, hkerr.NotFound(msg)
	}
	data, err := readUploadedFile(url)
	if err != nil {
		return nil, err
	}
	return &ExportOutput{
		Filename: sanitizeFilename(doc.Title) + "." + spec.Ext,
		MIME:     spec.MIME,
		Data:     data,
	}, nil
}

// lookupAttachmentFormat 在附件派生格式表里查指定格式。
func lookupAttachmentFormat(ext, format string) (exportx.FormatSpec, bool) {
	for _, f := range exportx.AttachmentFormats(ext) {
		if f.Value == format {
			return f, true
		}
	}
	return exportx.FormatSpec{}, false
}

// attachmentOutput 读取附件型文档关联的上传文件，原样返回。
func attachmentOutput(doc *model.Doc) (*ExportOutput, error) {
	ref := exportx.ParseFileRef(doc.Content)
	if ref == nil {
		return nil, hkerr.NotFound("附件不存在或已被移除")
	}
	data, err := readUploadedFile(ref.URL)
	if err != nil {
		return nil, err
	}
	name := ref.Filename
	if name == "" {
		name = doc.Title
	}
	if !strings.Contains(name, ".") && ref.Ext != "" {
		name += "." + ref.Ext
	}
	return &ExportOutput{
		Filename: sanitizeFilename(name),
		MIME:     mimeByExt(ref.Ext),
		Data:     data,
	}, nil
}

// attachmentExt 返回附件扩展名（含点），缺省 .bin。
func attachmentExt(ref *exportx.FileRef) string {
	if ref.Ext != "" {
		return "." + ref.Ext
	}
	if i := strings.LastIndex(ref.Filename, "."); i >= 0 {
		return ref.Filename[i:]
	}
	return ".bin"
}

// exportMIMEByExt 附件下载用的扩展名 → MIME 映射。
var exportMIMEByExt = map[string]string{
	".pdf":  "application/pdf",
	".doc":  "application/msword",
	".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	".xls":  "application/vnd.ms-excel",
	".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	".ppt":  "application/vnd.ms-powerpoint",
	".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
	".md":   "text/markdown; charset=utf-8",
	".txt":  "text/plain; charset=utf-8",
	".png":  "image/png",
	".jpg":  "image/jpeg",
	".jpeg": "image/jpeg",
	".gif":  "image/gif",
	".bmp":  "image/bmp",
	".webp": "image/webp",
	".svg":  "image/svg+xml",
	".ico":  "image/x-icon",
	".zip":  "application/zip",
}

// mimeByExt 按扩展名推断 MIME。
func mimeByExt(ext string) string {
	if m, ok := exportMIMEByExt["."+strings.ToLower(strings.TrimPrefix(strings.TrimSpace(ext), "."))]; ok {
		return m
	}
	return "application/octet-stream"
}

// readUploadedFile 读取上传目录内的文件。
// url 形如 /uploads/2026/09/xxx.pdf，仅允许落在 DataDir/uploads 内（防目录穿越）。
func readUploadedFile(urlPath string) ([]byte, error) {
	clean := strings.TrimSpace(urlPath)
	if !strings.HasPrefix(clean, "/uploads/") {
		return nil, hkerr.NotFound("附件路径无效")
	}
	rel := filepath.Clean(filepath.FromSlash(strings.TrimPrefix(clean, "/")))
	if rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) || filepath.IsAbs(rel) {
		return nil, hkerr.NotFound("附件路径无效")
	}
	base := filepath.Join(DataDir, "uploads")
	abs := filepath.Join(DataDir, rel)
	if !strings.HasPrefix(abs, base+string(os.PathSeparator)) {
		return nil, hkerr.NotFound("附件路径无效")
	}
	data, err := os.ReadFile(abs)
	if err != nil {
		return nil, hkerr.NotFound("附件文件不存在")
	}
	return data, nil
}

// BookZip 导出知识库为 .md.zip：目录节点 → 文件夹，文档 → .md 文件。
func (s *ExportService) BookZip(uid, bookID uint64) (string, []byte, error) {
	book, err := repository.FindBookByID(bookID)
	if err != nil {
		return "", nil, hkerr.NotFound("知识库不存在")
	}
	if !canReadBook(book, uid) {
		return "", nil, hkerr.Forbidden()
	}
	docs, err := repository.ListTreeByBook(book.ID)
	if err != nil {
		return "", nil, hkerr.Internal("查询失败")
	}

	// id → doc 索引，用于拼目录路径
	byID := make(map[uint64]*model.Doc, len(docs))
	for i := range docs {
		byID[docs[i].ID] = &docs[i]
	}
	pathOf := func(d *model.Doc) string {
		parts := []string{sanitizeFilename(d.Title)}
		cur := d.ParentID
		for cur != 0 {
			p, ok := byID[cur]
			if !ok {
				break
			}
			parts = append([]string{sanitizeFilename(p.Title)}, parts...)
			cur = p.ParentID
		}
		return strings.Join(parts, "/")
	}

	buf := &bytes.Buffer{}
	zw := zip.NewWriter(buf)
	used := map[string]int{} // 同名文件去重
	for i := range docs {
		d := &docs[i]
		full, err := repository.FindDocByID(d.ID)
		if err != nil {
			continue
		}
		// 附件型文档：原样打包上传的原文件，保留原扩展名
		// 绘图文档：正文即 mxGraph XML，落成 .drawio 文件
		ext := ".md"
		data := []byte(full.Content)
		switch exportx.NormalizeDocType(d.DocType) {
		case "drawing":
			ext = ".drawio"
		case "file":
			ref := exportx.ParseFileRef(full.Content)
			if ref == nil {
				continue
			}
			b, err := readUploadedFile(ref.URL)
			if err != nil {
				continue
			}
			data = b
			ext = attachmentExt(ref)
		}
		base := pathOf(d) + ext
		path := base
		if n, dup := used[path]; dup {
			path = fmt.Sprintf("%s(%d)%s", strings.TrimSuffix(base, ext), n, ext)
		}
		used[path]++
		w, err := zw.Create(path)
		if err != nil {
			continue
		}
		_, _ = w.Write(data)
	}
	if err := zw.Close(); err != nil {
		return "", nil, hkerr.Internal("打包失败")
	}
	return sanitizeFilename(book.Name) + ".md.zip", buf.Bytes(), nil
}
