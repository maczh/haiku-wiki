package handler

import (
	"github.com/gin-gonic/gin"

	"haiku-wiki/server/internal/pkg"
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
