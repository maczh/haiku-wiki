package service

import (
	"strings"

	"gorm.io/gorm"

	"haiku-wiki/server/internal/model"
	hkerr "haiku-wiki/server/internal/pkg"
	"haiku-wiki/server/internal/repository"
)

// TemplateService 文档模板（仿语雀/WPS）查询：按业务分类 + 文档类型筛选，
// 以及分类聚合（每类含类型集合与模板数），供前端模板画廊筛选与展示。
type TemplateService struct{}

// TemplateCategory 分类聚合：分类名 + 该分类下的文档类型集合 + 模板总数。
type TemplateCategory struct {
	Category string   `json:"category"`
	DocTypes []string `json:"doc_types"`
	Count    int64    `json:"count"`
}

// ListTemplates 列出模板；category / doc_type 为空表示不过滤，builtin 为 nil 表示不过滤来源。
func (s *TemplateService) ListTemplates(category, docType string, builtin *bool) ([]model.DocTemplate, error) {
	db := repository.DB()
	q := db.Model(&model.DocTemplate{})
	if category != "" {
		q = q.Where("category = ?", category)
	}
	if docType != "" {
		q = q.Where("doc_type = ?", docType)
	}
	if builtin != nil {
		q = q.Where("builtin = ?", *builtin)
	}
	var list []model.DocTemplate
	if err := q.Order("category, sort, id").Find(&list).Error; err != nil {
		return nil, err
	}
	if list == nil {
		list = []model.DocTemplate{}
	}
	return list, nil
}

// ─────────────────────────────────────────────────────────────────────────────
// 模板写操作
//
// 「另存为模板」允许全部可新建类型（比内置种子数据的 4 类更宽）：用户把自己写的
// 流程图 / 待办清单 / 接口文档等存成模板是合理诉求，正文契约与对应 doc_type 一致即可。
// 目录（folder）与附件（file）、网页（web）没有可复用的正文，不接受另存。
// ─────────────────────────────────────────────────────────────────────────────

// savableTemplateDocTypes 「另存为模板」允许的文档类型。
var savableTemplateDocTypes = map[string]bool{
	"markdown": true, "sheet": true, "mindmap": true, "flowchart": true,
	"drawing": true, "todo": true, "calendar": true, "gantt": true,
	"api": true, "gallery": true, "prototype": true,
}

// TemplateInput 模板写入字段（另存为 / 管理员编辑共用）。
type TemplateInput struct {
	Category string `json:"category"`
	DocType  string `json:"doc_type"`
	Name     string `json:"name"`
	Title    string `json:"title"`
	Content  string `json:"content"`
	Sort     *int   `json:"sort"`
}

// normalizeTemplateInput 校验并补全写入字段：分类/模板名必填，标题缺省取模板名，
// 正文必须非空（空模板没有意义，且会让预览变成空白页）。
func normalizeTemplateInput(in *TemplateInput) error {
	in.Category = strings.TrimSpace(in.Category)
	in.Name = strings.TrimSpace(in.Name)
	in.DocType = strings.TrimSpace(in.DocType)
	in.Title = strings.TrimSpace(in.Title)
	switch {
	case in.Category == "":
		return hkerr.New(400, 400, "模板分类不能为空")
	case in.Name == "":
		return hkerr.New(400, 400, "模板名称不能为空")
	case !savableTemplateDocTypes[in.DocType]:
		return hkerr.New(400, 400, "该文档类型不支持存为模板")
	case strings.TrimSpace(in.Content) == "":
		return hkerr.New(400, 400, "文档正文为空，不能存为模板")
	}
	if in.Title == "" {
		in.Title = in.Name
	}
	if len(in.Category) > 64 {
		return hkerr.New(400, 400, "模板分类不能超过 64 个字符")
	}
	if len(in.Name) > 128 {
		return hkerr.New(400, 400, "模板名称不能超过 128 个字符")
	}
	if len(in.Title) > 256 {
		return hkerr.New(400, 400, "默认标题不能超过 256 个字符")
	}
	return nil
}

// CreateTemplate 用户把自建文档另存为模板（builtin=false，归属当前用户）。
// 同名同分类同类型已存在时返回明确错误，避免静默覆盖别人的模板。
func (s *TemplateService) CreateTemplate(uid uint64, in TemplateInput) (*model.DocTemplate, error) {
	if err := normalizeTemplateInput(&in); err != nil {
		return nil, err
	}
	db := repository.DB()
	var exist model.DocTemplate
	err := db.Where("category = ? AND doc_type = ? AND name = ?", in.Category, in.DocType, in.Name).
		First(&exist).Error
	if err == nil {
		return nil, hkerr.New(400, 400, "同名同类型的模板已存在，请换一个模板名")
	}
	if err != gorm.ErrRecordNotFound {
		return nil, err
	}
	sortNo := 0
	if in.Sort != nil {
		sortNo = *in.Sort
	}
	t := model.DocTemplate{
		Category:  in.Category,
		DocType:   in.DocType,
		Name:      in.Name,
		Title:     in.Title,
		Content:   in.Content,
		Builtin:   false,
		CreatedBy: uid,
		Sort:      sortNo,
	}
	if err := db.Create(&t).Error; err != nil {
		return nil, err
	}
	return &t, nil
}

// UpdateTemplate 管理员修改模板。内置模板不允许改 —— 启动时内置集会把正文同步回来，
// 改了也会丢，不如直接拒绝并引导「另存为自定义模板」。
func (s *TemplateService) UpdateTemplate(id uint64, in TemplateInput) (*model.DocTemplate, error) {
	if err := normalizeTemplateInput(&in); err != nil {
		return nil, err
	}
	db := repository.DB()
	var t model.DocTemplate
	if err := db.Where("id = ?", id).First(&t).Error; err != nil {
		return nil, err
	}
	if t.Builtin {
		return nil, hkerr.New(400, 400, "系统内置模板不可修改，可先另存为自定义模板")
	}
	// 改名后不能与同分类同类型的其它模板撞名
	if in.Name != t.Name || in.Category != t.Category || in.DocType != t.DocType {
		var dup model.DocTemplate
		err := db.Where("category = ? AND doc_type = ? AND name = ? AND id <> ?",
			in.Category, in.DocType, in.Name, id).First(&dup).Error
		if err == nil {
			return nil, hkerr.New(400, 400, "同名同类型的模板已存在，请换一个模板名")
		}
		if err != gorm.ErrRecordNotFound {
			return nil, err
		}
	}
	t.Category = in.Category
	t.DocType = in.DocType
	t.Name = in.Name
	t.Title = in.Title
	t.Content = in.Content
	if in.Sort != nil {
		t.Sort = *in.Sort
	}
	if err := db.Save(&t).Error; err != nil {
		return nil, err
	}
	return &t, nil
}

// DeleteOwnTemplate 用户删除自己另存的模板（内置模板与他人的模板不可删）。
func (s *TemplateService) DeleteOwnTemplate(id, uid uint64) error {
	db := repository.DB()
	var t model.DocTemplate
	if err := db.Where("id = ?", id).First(&t).Error; err != nil {
		return err
	}
	if t.Builtin {
		return hkerr.New(400, 400, "系统内置模板不可删除")
	}
	if t.CreatedBy == 0 || t.CreatedBy != uid {
		return hkerr.New(403, 403, "只能删除自己另存的模板")
	}
	return db.Delete(&model.DocTemplate{}, id).Error
}

// ImportResult 管理员导入结果统计。
type ImportResult struct {
	Created int `json:"created"`
	Updated int `json:"updated"`
	Skipped int `json:"skipped"`
}

// ImportTemplates 管理员批量导入模板数据（builtin=false，不与内置模板冲突）。
// overwrite=true 覆盖同名同分类同类型的既有模板；false 只补新模板。
func (s *TemplateService) ImportTemplates(items []model.DocTemplate, overwrite bool) (created, updated, skipped int, err error) {
	return repository.ImportTemplates(repository.DB(), items, overwrite)
}

// DeleteTemplate 删除管理员导入的模板；内置模板（builtin=true）不允许删除。
func (s *TemplateService) DeleteTemplate(id uint64) error {
	db := repository.DB()
	var t model.DocTemplate
	if err := db.Where("id = ?", id).First(&t).Error; err != nil {
		return err
	}
	if t.Builtin {
		return hkerr.New(400, 400, "系统内置模板不可删除")
	}
	return db.Delete(&model.DocTemplate{}, id).Error
}

// ListCategories 聚合出所有分类及其包含的类型与模板数。
func (s *TemplateService) ListCategories() ([]TemplateCategory, error) {
	db := repository.DB()
	type row struct {
		Category string
		DocType  string
		Cnt      int64
	}
	var rows []row
	if err := db.Model(&model.DocTemplate{}).
		Select("category, doc_type, COUNT(*) as cnt").
		Group("category, doc_type").
		Scan(&rows).Error; err != nil {
		return nil, err
	}
	m := map[string]*TemplateCategory{}
	for _, r := range rows {
		c, ok := m[r.Category]
		if !ok {
			c = &TemplateCategory{Category: r.Category}
			m[r.Category] = c
		}
		c.DocTypes = append(c.DocTypes, r.DocType)
		c.Count += r.Cnt
	}
	out := make([]TemplateCategory, 0, len(m))
	for _, c := range m {
		out = append(out, *c)
	}
	return out, nil
}
