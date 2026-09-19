package handler

import (
	"strconv"

	"github.com/gin-gonic/gin"

	"haiku-wiki/server/internal/middleware"
	"haiku-wiki/server/internal/pkg"
)

// Search GET /api/search?q= —— 标题+正文搜索（OptionalAuth：公开库支持匿名搜索）。
// 可选 book_id：限定在单个知识库内搜索（文库工作台用）。
func Search(c *gin.Context) {
	q := c.Query("q")
	var bookID uint64
	if raw := c.Query("book_id"); raw != "" {
		n, err := strconv.ParseUint(raw, 10, 64)
		if err != nil {
			resp.Error(c, paramMsg("book_id 必须为非负整数"))
			return
		}
		bookID = n
	}
	hits, err := searchService.Search(middleware.UID(c), q, bookID)
	if err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, hits)
}
