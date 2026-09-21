package service

import (
	"haiku-wiki/server/internal/model"
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
	return list, nil
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
