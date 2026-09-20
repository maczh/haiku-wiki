package handler

import (
	"github.com/gin-gonic/gin"

	"haiku-wiki/server/internal/config"
	"haiku-wiki/server/internal/pkg"
	"haiku-wiki/server/internal/service"
)

// 系统配置（服务 / JWT / 数据库 / 存储 / 上传）的读取与保存。
// 路由挂在 /api/admin 组下，管理员鉴权由 middleware.RequireAdmin() 统一负责。

var systemConfigService service.SystemConfigService

// GetSystemConfig GET /api/admin/system-config —— 读取当前可编辑的系统配置。
func GetSystemConfig(c *gin.Context) {
	if !requireAdmin(c) {
		return
	}
	resp.OK(c, systemConfigService.Get())
}

// SaveSystemConfig PUT /api/admin/system-config —— 保存系统配置并触发后端重启。
func SaveSystemConfig(c *gin.Context) {
	if !requireAdmin(c) {
		return
	}
	var e config.EditableConfig
	if err := c.ShouldBindJSON(&e); err != nil {
		resp.Error(c, paramMsg("请求体解析失败"))
		return
	}
	if err := systemConfigService.Save(e); err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, gin.H{"message": "配置已保存，服务重启中…"})
}
