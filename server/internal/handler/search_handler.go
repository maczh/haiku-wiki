package handler

import (
	"github.com/gin-gonic/gin"

	"haiku-wiki/server/internal/middleware"
	"haiku-wiki/server/internal/pkg"
)

// Search GET /api/search?q= —— 标题+正文搜索（OptionalAuth：公开库支持匿名搜索）。
func Search(c *gin.Context) {
	q := c.Query("q")
	hits, err := searchService.Search(middleware.UID(c), q)
	if err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, hits)
}
