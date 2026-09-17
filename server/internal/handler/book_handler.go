package handler

import (
	"github.com/gin-gonic/gin"

	"haiku-wiki/server/internal/middleware"
	"haiku-wiki/server/internal/pkg"
)

type bookReq struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	CoverColor  string `json:"cover_color"`
	CoverImage  string `json:"cover_image"`
	Visibility  string `json:"visibility"`
}

// ListBooks GET /api/books —— 书架页（mine + visible）。
func ListBooks(c *gin.Context) {
	out, err := bookService.List(middleware.UID(c))
	if err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, out)
}

// CreateBook POST /api/books
func CreateBook(c *gin.Context) {
	var req bookReq
	if err := c.ShouldBindJSON(&req); err != nil {
		resp.Error(c, paramErr(err))
		return
	}
	b, err := bookService.Create(middleware.UID(c), req.Name, req.Description, req.CoverColor, req.Visibility)
	if err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, b)
}

// GetBook GET /api/books/:id（BookAccess 中间件已完成读取鉴权）。
func GetBook(c *gin.Context) {
	resp.OK(c, middleware.BookFromCtx(c))
}

// UpdateBook PUT /api/books/:id（仅 owner：BookAccess write 已拦截）。
func UpdateBook(c *gin.Context) {
	var req bookReq
	if err := c.ShouldBindJSON(&req); err != nil {
		resp.Error(c, paramErr(err))
		return
	}
	b, err := bookService.Update(middleware.BookFromCtx(c), req.Name, req.Description, req.CoverColor, req.CoverImage)
	if err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, b)
}

// DeleteBook DELETE /api/books/:id（仅 owner，级联软删文档）。
func DeleteBook(c *gin.Context) {
	if err := bookService.Delete(middleware.BookFromCtx(c)); err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, gin.H{"deleted": true})
}

// SetBookVisibility PUT /api/books/:id/visibility（仅 owner）。
func SetBookVisibility(c *gin.Context) {
	var req bookReq
	if err := c.ShouldBindJSON(&req); err != nil {
		resp.Error(c, paramErr(err))
		return
	}
	b, err := bookService.SetVisibility(middleware.BookFromCtx(c), req.Visibility)
	if err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, b)
}
