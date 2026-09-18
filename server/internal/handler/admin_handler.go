package handler

import (
	"strconv"

	"github.com/gin-gonic/gin"

	"haiku-wiki/server/internal/middleware"
	"haiku-wiki/server/internal/pkg"
)

// requireAdmin 仅管理员可继续执行；否则写 40301 并中断。
func requireAdmin(c *gin.Context) bool {
	if middleware.Role(c) != "admin" {
		resp.Error(c, resp.Forbidden())
		c.Abort()
		return false
	}
	return true
}

// userIDFromPath 解析 :id 路由参数（用户 ID）。
func userIDFromPath(c *gin.Context) (uint64, bool) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	return id, err == nil && id > 0
}

// ListUsers GET /api/admin/users —— 管理员分页列出用户。
func ListUsers(c *gin.Context) {
	if !requireAdmin(c) {
		return
	}
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	size, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	users, total, err := userService.AdminListUsers(page, size)
	if err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, gin.H{"users": users, "total": total, "page": page, "page_size": size})
}

// SetUserStatus PATCH /api/admin/users/:id/status —— 启用/禁用用户。
func SetUserStatus(c *gin.Context) {
	if !requireAdmin(c) {
		return
	}
	id, ok := userIDFromPath(c)
	if !ok {
		resp.Error(c, paramMsg("无效的用户 ID"))
		return
	}
	var in struct {
		Status int `json:"status"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		resp.Error(c, paramErr(err))
		return
	}
	v, err := userService.AdminSetStatus(middleware.UID(c), id, in.Status)
	if err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, v)
}

// ResetUserPassword PATCH /api/admin/users/:id/reset-password —— 重置密码，返回明文（未指定则系统生成）。
func ResetUserPassword(c *gin.Context) {
	if !requireAdmin(c) {
		return
	}
	id, ok := userIDFromPath(c)
	if !ok {
		resp.Error(c, paramMsg("无效的用户 ID"))
		return
	}
	var in struct {
		Password string `json:"password"`
	}
	_ = c.ShouldBindJSON(&in)
	pwd, err := userService.AdminResetPassword(middleware.UID(c), id, in.Password)
	if err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, gin.H{"password": pwd})
}
