package handler

import (
	"encoding/json"
	"io"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"haiku-wiki/server/internal/middleware"
	"haiku-wiki/server/internal/model"
	"haiku-wiki/server/internal/pkg"
	"haiku-wiki/server/internal/repository"
	"haiku-wiki/server/internal/service"
)

var templateService = &service.TemplateService{}

// officeTemplateExt 管理员可导入的 Word/Excel/PPT 模板文件扩展名 → 文档类型。
//
// 这些文件不是「模板数据 .json」，而是真实的办公文档/模板（.docx/.dotx/.xlsx/.xltx/.pptx/.potx 等）。
// 导入后文件经 CAS 落盘，模板正文存为办公文件引用 {url,filename,size,ext}，
// 用户在「新建文档」套用模板时即创建一篇对应类型的办公文档，正文指向该文件。
var officeTemplateExt = map[string]string{
	".doc":  "word",
	".docx": "word",
	".dotx": "word",
	".xls":  "sheet",
	".xlsx": "sheet",
	".xltx": "sheet",
	".ppt":  "ppt",
	".pptx": "ppt",
	".potx": "ppt",
}

// buildOfficeTemplate 把已落盘的办公文件（out）构造成一条模板记录。
//
// category 为空时按文档类型归入对应分组（Word 模板 / Excel 模板 / PPT 模板），便于画廊展示；
// 传入非空则使用调用方指定的分类。
// 模板正文复用办公文档的内容契约：{url, filename, size, ext} 引用（见 web/src/lib/officeDoc.ts），
// 套用模板创建文档时，正文即指向该文件，由 OnlyOffice 直接打开编辑。
func buildOfficeTemplate(filename string, out *service.UploadOutput, docType, category string, idx int) model.DocTemplate {
	name := strings.TrimSpace(strings.TrimSuffix(filename, filepath.Ext(filename)))
	if name == "" {
		name = filename
	}
	if category == "" {
		switch docType {
		case "word":
			category = "Word 模板"
		case "sheet":
			category = "Excel 模板"
		case "ppt":
			category = "PPT 模板"
		}
	}
	content, _ := json.Marshal(map[string]interface{}{
		"url":      out.URL,
		"filename": out.Filename,
		"size":     out.Size,
		"ext":      strings.TrimPrefix(strings.ToLower(filepath.Ext(filename)), "."),
	})
	return model.DocTemplate{
		Category: category,
		DocType:  docType,
		Name:     name,
		Title:    name,
		Content:  string(content),
		Sort:     (idx + 1) * 10,
	}
}

// ListTemplates GET /api/templates?category=&doc_type=&builtin=
// 列出文档模板，按业务分类 + 文档类型筛选；builtin 仅用于区分内置 / 用户自定义模板。
func ListTemplates(c *gin.Context) {
	category := c.Query("category")
	docType := c.Query("doc_type")
	var builtin *bool
	if v := c.Query("builtin"); v != "" {
		b := v == "1" || v == "true"
		builtin = &b
	}
	list, err := templateService.ListTemplates(category, docType, builtin)
	if err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, list)
}

// ImportTemplates POST /api/admin/templates/import —— 管理员导入模板（仅 admin，multipart）。
//
// 支持两类文件，自动按扩展名分流：
//  1. 模板数据文件（.json）：原有逻辑，解析后批量入库（可配合目录选择一次性导入整个模板目录）；
//  2. Word/Excel/PPT 模板文件（.doc/.docx/.dotx/.xls/.xlsx/.xltx/.ppt/.pptx/.potx）：
//     文件经 CAS 落盘，按扩展名映射文档类型（word/sheet/ppt），正文存为办公文件引用
//     {url,filename,size,ext}，套用模板即创建一篇对应类型的办公文档。
//
// 表单字段：
//   - files[]：上述两类文件，可多选；
//   - paths：可选，JSON 字符串数组，与 files 顺序对应，给出相对路径（仅用于报错提示）；
//   - overwrite：可选，"1"/"true" 覆盖同名同分类同类型的既有模板，缺省只补新模板；
//   - category：可选，办公模板文件归入的分类，缺省按类型归到「Word 模板 / Excel 模板 / PPT 模板」。
//
// 单个文件解析/落盘失败不影响其它文件，失败信息逐条返回在 errors 里。
func ImportTemplates(c *gin.Context) {
	form, err := c.MultipartForm()
	if err != nil {
		resp.Error(c, paramMsg("表单解析失败"))
		return
	}
	fhs := form.File["files"]
	if len(fhs) == 0 {
		resp.Error(c, paramMsg("没有选择模板数据文件"))
		return
	}
	overwrite := c.PostForm("overwrite") == "1" || c.PostForm("overwrite") == "true"
	defaultCategory := strings.TrimSpace(c.PostForm("category"))
	uid := middleware.UID(c)
	// 办公模板文件较大（含图片的 .pptx 常见十几到几十 MB），用上传上限而非 16MB 的 JSON 限制
	officeMax := service.UploadMaxBytes()

	var paths []string
	if raw := c.PostForm("paths"); raw != "" {
		_ = json.Unmarshal([]byte(raw), &paths)
	}

	type fileErr struct {
		File  string `json:"file"`
		Error string `json:"error"`
	}
	var (
		created, updated, skipped int
		// 必须初始化为空切片而非 nil：nil slice 会被序列化成 JSON null，
		// 前端 `result.errors.length` 会直接抛 TypeError 白屏（批量导入全部成功时必现）。
		failed = []fileErr{}
		// JSON 解析出的 + 办公文件转换出的，统一在末尾一次性入库
		items = []model.DocTemplate{}
	)

	for i, fh := range fhs {
		label := fh.Filename
		if i < len(paths) && strings.TrimSpace(paths[i]) != "" {
			label = paths[i]
		}
		ext := strings.ToLower(filepath.Ext(fh.Filename))

		// ── 1) 模板数据文件（.json） ──
		if ext == ".json" {
			if fh.Size > int64(16<<20) { // 16MB：模板包再大就是误传
				failed = append(failed, fileErr{File: label, Error: "文件超过 16MB"})
				continue
			}
			f, e := fh.Open()
			if e != nil {
				failed = append(failed, fileErr{File: label, Error: "无法读取文件"})
				continue
			}
			parsed, perr := repository.ParseTemplateFile(f)
			f.Close()
			if perr != nil {
				failed = append(failed, fileErr{File: label, Error: perr.Error()})
				continue
			}
			items = append(items, parsed...)
			continue
		}

		// ── 2) Word/Excel/PPT 模板文件 ──
		docType, ok := officeTemplateExt[ext]
		if !ok {
			failed = append(failed, fileErr{
				File:  label,
				Error: "不支持的文件类型，仅支持 .json 与 Word/Excel/PPT 模板（.doc/.docx/.dotx/.xls/.xlsx/.xltx/.ppt/.pptx/.potx）",
			})
			continue
		}
		if fh.Size > officeMax {
			failed = append(failed, fileErr{File: label, Error: "文件超过 " + strconv.FormatInt(officeMax>>20, 10) + "MB"})
			continue
		}
		f, e := fh.Open()
		if e != nil {
			failed = append(failed, fileErr{File: label, Error: "无法读取文件"})
			continue
		}
		data, rerr := io.ReadAll(io.LimitReader(f, officeMax+1))
		f.Close()
		if rerr != nil {
			failed = append(failed, fileErr{File: label, Error: "读取文件失败"})
			continue
		}
		if int64(len(data)) > officeMax {
			failed = append(failed, fileErr{File: label, Error: "文件超过 " + strconv.FormatInt(officeMax>>20, 10) + "MB"})
			continue
		}
		// 落 CAS（命中即秒传复用），拿到可访问 URL
		out, uerr := uploadService.SaveBytes(uid, fh.Filename, data)
		if uerr != nil {
			failed = append(failed, fileErr{File: label, Error: "保存文件失败：" + uerr.Error()})
			continue
		}
		items = append(items, buildOfficeTemplate(fh.Filename, out, docType, defaultCategory, i))
	}

	// 统一入库（overwrite 语义覆盖全部），单个文件失败已在上面记入 failed
	if len(items) > 0 {
		a, b, c2, ierr := templateService.ImportTemplates(items, overwrite)
		if ierr != nil {
			failed = append(failed, fileErr{File: "（批量入库）", Error: ierr.Error()})
		} else {
			created += a
			updated += b
			skipped += c2
		}
	}

	resp.OK(c, gin.H{
		"files":    len(fhs),
		"created":  created,
		"updated":  updated,
		"skipped":  skipped,
		"failed":    len(failed),
		"errors":    failed,
		"overwrite": overwrite,
	})
}

// CreateTemplate POST /api/templates —— 把自建文档另存为模板（任意登录用户）。
//
// 与「管理员批量导入」的区别：这里一次只存一条，builtin=false 且记录 created_by，
// 创建者本人可删，管理员可改可删。内置模板不受影响。
func CreateTemplate(c *gin.Context) {
	var req service.TemplateInput
	if err := c.ShouldBindJSON(&req); err != nil {
		resp.Error(c, paramErr(err))
		return
	}
	t, err := templateService.CreateTemplate(middleware.UID(c), req)
	if err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, t)
}

// DeleteOwnTemplate DELETE /api/templates/:id —— 删除自己另存的模板。
func DeleteOwnTemplate(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		resp.Error(c, paramMsg("模板 ID 无效"))
		return
	}
	if err := templateService.DeleteOwnTemplate(id, middleware.UID(c)); err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, gin.H{"id": id})
}

// UpdateTemplate PUT /api/admin/templates/:id —— 管理员修改模板（内置模板拒绝）。
func UpdateTemplate(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		resp.Error(c, paramMsg("模板 ID 无效"))
		return
	}
	var req service.TemplateInput
	if err := c.ShouldBindJSON(&req); err != nil {
		resp.Error(c, paramErr(err))
		return
	}
	t, err := templateService.UpdateTemplate(id, req)
	if err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, t)
}

// DeleteTemplate DELETE /api/admin/templates/:id —— 删除管理员导入的模板（内置模板不可删）。
func DeleteTemplate(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		resp.Error(c, paramMsg("模板 ID 无效"))
		return
	}
	if err := templateService.DeleteTemplate(id); err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, gin.H{"id": id})
}

// ListTemplateCategories GET /api/templates/categories
// 聚合所有分类及其包含的类型与模板数，供前端画廊做左侧分类导航。
func ListTemplateCategories(c *gin.Context) {
	cats, err := templateService.ListCategories()
	if err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, cats)
}
