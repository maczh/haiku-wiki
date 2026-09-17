package middleware

import (
	"strconv"

	"github.com/gin-gonic/gin"

	"haiku-wiki/server/internal/model"
	"haiku-wiki/server/internal/pkg"
	hkerr "haiku-wiki/server/internal/pkg"
	"haiku-wiki/server/internal/repository"
)

// BookAccess 知识库访问控制中间件（:id 路由参数）。
//
// read=true：private 仅 owner；members 所有登录用户；public 任何人（配合 OptionalAuth）。
// read=false（写操作）：owner 恒可写；members 库所有登录用户可写；public/private 仅 owner。
// 校验通过后把 *model.Book 放入 context（key="book"）。
func BookAccess(read bool) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, err := strconv.ParseUint(c.Param("id"), 10, 64)
		if err != nil || id == 0 {
			resp.Error(c, hkerr.Param("无效的知识库 ID"))
			c.Abort()
			return
		}
		book, err := repository.FindBookByID(id)
		if err != nil {
			resp.Error(c, hkerr.NotFound("知识库不存在"))
			c.Abort()
			return
		}
		uid := UID(c)
		switch {
		case read:
			// 读：private 仅 owner；members 登录用户；public 任何人
			switch book.Visibility {
			case "public":
			case "members":
				if uid == 0 {
					resp.Error(c, hkerr.Forbidden())
					c.Abort()
					return
				}
			default: // private
				if book.OwnerID != uid {
					resp.Error(c, hkerr.Forbidden())
					c.Abort()
					return
				}
			}
		case book.OwnerID != uid && (book.Visibility != "members" || uid == 0):
			// 写：owner 恒可写；members 库登录用户可写；public/private 仅 owner
			resp.Error(c, hkerr.Forbidden())
			c.Abort()
			return
		}
		c.Set("book", book)
		c.Next()
	}
}

// BookFromCtx 取 BookAccess 放入的知识库。
func BookFromCtx(c *gin.Context) *model.Book {
	if v, ok := c.Get("book"); ok {
		if b, ok := v.(*model.Book); ok {
			return b
		}
	}
	return nil
}
