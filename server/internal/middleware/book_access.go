package middleware

import (
	"strconv"

	"github.com/gin-gonic/gin"

	"haiku-wiki/server/internal/model"
	"haiku-wiki/server/internal/pkg"
	hkerr "haiku-wiki/server/internal/pkg"
	"haiku-wiki/server/internal/repository"
	"haiku-wiki/server/internal/service"
)

// BookAccess 知识库访问控制中间件（:id 路由参数）。
//
// read=true：public 任何人（配合 OptionalAuth）；members 所有登录用户；
//
//	private 仅 owner；团队文库（team_id 非空）团队任意成员。
//
// read=false（写操作）：owner 恒可写；members 库所有登录用户可写；
//
//	public/private 仅 owner；团队文库团队任意成员可写。
//
// 判定直接复用 service.CanReadBook / service.CanWriteBook —— 与 service 层
// （canReadBook / canWriteDoc）同源，避免「service 放行、中间件拦截」的语义漂移。
// 管理类操作（改名/删除/改可见性）继续由 RequireOwner() 限制为仅 owner。
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
		// 与 service 层同源判定（含团队文库成员可读/可写）
		ok := service.CanReadBook(book, uid)
		if !read {
			ok = service.CanWriteBook(book, uid)
		}
		if !ok {
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
