package handler

import (
	"strconv"

	"github.com/gin-gonic/gin"

	"haiku-wiki/server/internal/middleware"
	"haiku-wiki/server/internal/pkg"
)

// ListRecentDocs GET /api/recent-docs —— 首页 Dashboard「最近更新」。
// 查询参数 limit 可选（默认 12，上限 50）；结果按更新时间倒序，已按读权限过滤。
func ListRecentDocs(c *gin.Context) {
	limit := 0
	if raw := c.Query("limit"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil {
			resp.Error(c, paramMsg("limit 必须为整数"))
			return
		}
		limit = n
	}
	items, err := docService.RecentDocs(middleware.UID(c), limit)
	if err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, gin.H{"items": items})
}
