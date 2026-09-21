package handler

import (
	"encoding/json"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"haiku-wiki/server/internal/middleware"
	"haiku-wiki/server/internal/pkg"
	"haiku-wiki/server/internal/repository"
	"haiku-wiki/server/internal/service"
)

var templateService = &service.TemplateService{}

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
// 表单字段：
//   - files[]：模板数据文件（.json），可多选；也可配合目录选择（webkitdirectory）一次性导入整个模板目录
//   - paths：可选，JSON 字符串数组，与 files 顺序对应，给出每个文件的相对路径（仅用于报错提示）
//   - overwrite：可选，"1"/"true" 表示覆盖同名同分类同类型的既有模板，缺省只补新模板
//
// 单个文件解析失败不影响其它文件，失败信息逐条返回在 errors 里。
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
	)
	for i, fh := range fhs {
		label := fh.Filename
		if i < len(paths) && strings.TrimSpace(paths[i]) != "" {
			label = paths[i]
		}
		if fh.Size > int64(16<<20) { // 16MB：模板包再大就是误传
			failed = append(failed, fileErr{File: label, Error: "文件超过 16MB"})
			continue
		}
		f, err := fh.Open()
		if err != nil {
			failed = append(failed, fileErr{File: label, Error: "无法读取文件"})
			continue
		}
		items, perr := repository.ParseTemplateFile(f)
		f.Close()
		if perr != nil {
			failed = append(failed, fileErr{File: label, Error: perr.Error()})
			continue
		}
		a, b, c2, ierr := templateService.ImportTemplates(items, overwrite)
		if ierr != nil {
			failed = append(failed, fileErr{File: label, Error: ierr.Error()})
			continue
		}
		created += a
		updated += b
		skipped += c2
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
