package service

import (
	"archive/zip"
	"bytes"
	"context"
	"fmt"
	"net/url"
	"strings"
	"unicode/utf8"

	"haiku-wiki/server/internal/model"
	hkerr "haiku-wiki/server/internal/pkg"
	"haiku-wiki/server/internal/repository"
	"haiku-wiki/server/internal/service/exportx"
	"haiku-wiki/server/internal/service/office"
	"haiku-wiki/server/internal/storage"
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
// 公司知识库（is_company_kb）对所有登录用户只读。
func canReadBook(book *model.Book, uid uint64) bool {
	if book.IsCompanyKB {
		return uid > 0
	}
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
	if ref := exportx.ParseFileRef(doc.Content); doc.DocType == "powerpoint" && ref != nil && ref.Ext == "pptx" {
		if format != "" && format != "pptx" {
			return nil, hkerr.Param("请在演示文稿编辑器内导出其他格式")
		}
		return attachmentOutput(doc)
	}
	if ref := exportx.ParseFileRef(doc.Content); ref != nil && ref.Ext == "xlsx" && ref.EditedURL != "" {
		if format != "" && format != "xlsx" {
			return nil, hkerr.Param("请在工作簿编辑器内导出 XLSX")
		}
		return attachmentOutput(doc)
	}
	if doc.DocType == "excel" {
		if ref := exportx.ParseFileRef(doc.Content); ref != nil && ref.Ext == "xlsx" {
			return attachmentExport(doc, strings.TrimSpace(format))
		}
	}
	if snapshot, ok := office.Parse(doc.Content); ok {
		spec := officeFormat(snapshot.Kind)
		if format != "" && format != spec.Value {
			return nil, hkerr.Param("不支持的 Office 导出格式")
		}
		data, err := office.Default.Export(context.Background(), office.Format(spec.Value), snapshot.Snapshot)
		if err != nil {
			return nil, hkerr.Param(err.Error())
		}
		return &ExportOutput{Filename: sanitizeFilename(doc.Title) + "." + spec.Ext, MIME: spec.MIME, Data: data}, nil
	}
	// 附件型：默认原样回传上传的原文件；若该类型有派生格式（CAD 图纸），
	// 且请求的是派生格式，则回传后端在导入时生成好的 DXF/SVG。
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
	Note     string               `json:"note,omitempty"`
}

// DocExportFormats 返回文档可选的导出格式，供前端导出对话框渲染。
func (s *ExportService) DocExportFormats(uid, docID uint64) (*ExportFormatOption, error) {
	doc, err := loadReadableDoc(uid, docID)
	if err != nil {
		return nil, err
	}
	if ref := exportx.ParseFileRef(doc.Content); doc.DocType == "powerpoint" && ref != nil && ref.Ext == "pptx" {
		return &ExportFormatOption{DocType: "powerpoint", Formats: []exportx.FormatSpec{{Value: "pptx", Label: "PowerPoint（.pptx）", Ext: "pptx", MIME: "application/vnd.openxmlformats-officedocument.presentationml.presentation"}}, Default: "pptx", Filename: ref.Filename}, nil
	}
	if ref := exportx.ParseFileRef(doc.Content); ref != nil && ref.Ext == "xlsx" {
		return &ExportFormatOption{
			DocType: "excel", Default: "xlsx", Filename: ref.Filename,
			Formats: []exportx.FormatSpec{{
				Value: "xlsx", Label: "Excel 工作簿（.xlsx）", Ext: "xlsx",
				MIME: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
			}},
		}, nil
	}
	if snapshot, ok := office.Parse(doc.Content); ok {
		spec := officeFormat(snapshot.Kind)
		return &ExportFormatOption{DocType: doc.DocType, Formats: []exportx.FormatSpec{spec}, Default: spec.Value,
			Note: "导出当前编辑快照；原始附件可在阅读页面单独下载。基础转换可能丢失复杂排版。"}, nil
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
			// 附件型没有服务端可转换的目标格式（CAD 派生格式已随该功能一并移除），
			// 因此 Formats 留空、Default 不设 —— 前端据此走「原文件 / 浏览器端格式」。
			opt.Note = ref.Note
		}
		return opt, nil
	}
	return &ExportFormatOption{
		DocType: docType,
		Formats: exportx.FormatsForDocType(docType),
		Default: exportx.DefaultFormat(docType).Value,
	}, nil
}

func officeFormat(kind string) exportx.FormatSpec {
	if kind == "sheet" {
		return exportx.FormatSpec{Value: "xlsx", Label: "Excel 工作簿（当前快照）", Ext: "xlsx",
			MIME: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}
	}
	return exportx.FormatSpec{Value: "docx", Label: "Word 文档（当前快照）", Ext: "docx",
		MIME: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"}
}

// attachmentExport 附件型文档导出：format 为空或等于原扩展名 → 原文件；
// 否则在派生资源里找（目前仅 CAD 图纸的 dxf/svg）。
//
// 关键性质：**不执行任何转换**。派生件（dxf / svg）都是导入时已经存好的文件，
// 这里只做"按 URL 取出来吐回去"，绝不再跑一次 DWG→DXF 或栅格化。
// 因此 .dxf 导出与 .dwg 原文件导出走的是同一条直达路径。
// attachmentExport 附件型文档导出：只能原样返回上传的原文件。
//
// 曾经这里还有一段「查附件派生格式表」的逻辑，服务端可把 .dwg 转成 .dxf/.svg 下发。
// CAD 功能整体移除后，附件不再有任何服务端可转换的目标格式，那段查表恒不命中、
// 其后的分支永远走不到，因此一并删掉，只保留「原文件 or 不支持」两种结局。
func attachmentExport(doc *model.Doc, format string) (*ExportOutput, error) {
	ref := exportx.ParseFileRef(doc.Content)
	if ref == nil {
		return nil, hkerr.NotFound("附件不存在或已被移除")
	}
	want := strings.ToLower(strings.TrimPrefix(format, "."))
	if want == "" || want == ref.Ext {
		return attachmentOutput(doc)
	}
	return nil, hkerr.Param(fmt.Sprintf("附件不支持导出为 %s", format))
}

// attachmentOutput 读取附件型文档关联的上传文件，原样返回。
func attachmentOutput(doc *model.Doc) (*ExportOutput, error) {
	ref := exportx.ParseFileRef(doc.Content)
	if ref == nil {
		return nil, hkerr.NotFound("附件不存在或已被移除")
	}
	fileURL := ref.URL
	if ref.EditedURL != "" {
		fileURL = ref.EditedURL
	}
	data, err := readUploadedFile(fileURL)
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

// readUploadedFile 读取上传目录内的文件（local 或 S3 由 storage 决定）。
// url 形如 /uploads/2026/09/xxx.pdf，仅允许落在 uploads/ 内（防目录穿越）。
func readUploadedFile(urlPath string) ([]byte, error) {
	key, err := uploadKey(urlPath)
	if err != nil {
		return nil, err
	}
	data, err := storage.Default().Read(key)
	if err != nil {
		// 统一口径：调用方（导出/预览）靠 NotFound 区分「参数错」与「文件没了」
		return nil, err
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
		// 白板文档：正文场景三件套装回官方壳，落成 .excalidraw 文件
		ext := ".md"
		data := []byte(full.Content)
		if snapshot, ok := office.Parse(full.Content); ok {
			spec := officeFormat(snapshot.Kind)
			converted, err := office.Default.Export(context.Background(), office.Format(spec.Value), snapshot.Snapshot)
			if err != nil {
				return "", nil, hkerr.Internal("Office 快照打包失败")
			}
			data, ext = converted, "."+spec.Ext
		} else {
			docType := exportx.NormalizeDocType(d.DocType)
			if d.DocType == "excel" || d.DocType == "powerpoint" {
				docType = d.DocType
			}
			switch docType {
			case "excel", "sheet":
				if ref := exportx.ParseFileRef(full.Content); ref != nil && ref.Ext == "xlsx" {
					output, err := attachmentOutput(full)
					if err != nil {
						return "", nil, hkerr.Internal("工作簿打包失败")
					}
					data, ext = output.Data, ".xlsx"
				}
			case "powerpoint":
				if ref := exportx.ParseFileRef(full.Content); ref != nil && ref.Ext == "pptx" {
					output, err := attachmentOutput(full)
					if err != nil {
						return "", nil, hkerr.Internal("演示文稿打包失败")
					}
					data, ext = output.Data, ".pptx"
				}
			case "drawing":
				ext = ".drawio"
			case "whiteboard":
				ext = ".excalidraw"
				// 转换失败（空场景/脏数据）时退回原正文，至少不丢内容
				if b, err := exportx.BuildExcalidrawFile(full.Content); err == nil {
					data = b
				}
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
