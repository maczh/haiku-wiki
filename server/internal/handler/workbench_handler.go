package handler

import (
	"strconv"

	"github.com/gin-gonic/gin"

	"haiku-wiki/server/internal/middleware"
	"haiku-wiki/server/internal/pkg"
)

// Workbench GET /api/workbench —— 工作台聚合（待办 / 甘特图 / 工作日历）。
//
// 查询参数：
//   - per_type 可选（单类型条数，默认 8，上限 20），0 或非法值回落默认。
//   - book_id 可选（>0 时限定单个知识库，供文库工作台/知识库页空态使用）。
//
// 返回每篇文档的**正文**，前端用 lib/todo.ts、lib/gantt.ts、lib/calendar.ts 里的
// 纯函数解析出进度、逾期、日程，无需再逐篇拉取（避免 N+1）。
func Workbench(c *gin.Context) {
	perType := 0
	if raw := c.Query("per_type"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil {
			resp.Error(c, paramMsg("per_type 必须为整数"))
			return
		}
		perType = n
	}
	var bookID uint64
	if raw := c.Query("book_id"); raw != "" {
		n, err := strconv.ParseUint(raw, 10, 64)
		if err != nil {
			resp.Error(c, paramMsg("book_id 必须为非负整数"))
			return
		}
		bookID = n
	}
	view, err := docService.Workbench(middleware.UID(c), perType, bookID)
	if err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, gin.H{"items": view.Items, "counts": view.Counts})
}
