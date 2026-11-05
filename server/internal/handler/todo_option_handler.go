package handler

import (
	"strings"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm/clause"

	"haiku-wiki/server/internal/middleware"
	"haiku-wiki/server/internal/model"
	resp "haiku-wiki/server/internal/pkg"
	"haiku-wiki/server/internal/repository"
)

// ListTodoOptions 只返回当前用户维护的名称，避免跨用户泄露项目和人名。
func ListTodoOptions(c *gin.Context) {
	options := []model.TodoOption{}
	err := repository.DB().Where("user_id = ?", middleware.UID(c)).Order("name ASC").Find(&options).Error
	if err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, options)
}

// SaveTodoOptions 批量幂等添加新名称，唯一索引处理并发去重。
func SaveTodoOptions(c *gin.Context) {
	var req struct {
		Options []model.TodoOption `json:"options"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		resp.Error(c, paramErr(err))
		return
	}
	if len(req.Options) > 500 {
		resp.Error(c, paramMsg("每次最多添加 500 个名称"))
		return
	}
	options := []model.TodoOption{}
	seen := map[string]bool{}
	for _, option := range req.Options {
		option.Name = strings.TrimSpace(option.Name)
		if option.Kind != "assignee" && option.Kind != "project" {
			resp.Error(c, paramMsg("名称类型无效"))
			return
		}
		if option.Name == "" || utf8.RuneCountInString(option.Name) > 191 {
			resp.Error(c, paramMsg("名称须为 1–191 个字符"))
			return
		}
		key := option.Kind + ":" + option.Name
		if seen[key] {
			continue
		}
		seen[key] = true
		options = append(options, model.TodoOption{UserID: middleware.UID(c), Kind: option.Kind, Name: option.Name})
	}
	if len(options) > 0 {
		if err := repository.DB().Clauses(clause.OnConflict{DoNothing: true}).Create(&options).Error; err != nil {
			resp.Error(c, err)
			return
		}
	}
	resp.OK(c, gin.H{"saved": true})
}
