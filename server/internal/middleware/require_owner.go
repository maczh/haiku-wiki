package middleware

import (
	"github.com/gin-gonic/gin"

	hkerr "haiku-wiki/server/internal/pkg"
	"haiku-wiki/server/internal/pkg"
)

// RequireOwner 知识库管理操作（改名/删除/改可见性）仅 owner 可执行。
// 依赖 BookAccess 已把 *model.Book 放入 context。
func RequireOwner() gin.HandlerFunc {
	return func(c *gin.Context) {
		b := BookFromCtx(c)
		if b == nil {
			resp.Error(c, hkerr.NotFound("知识库不存在"))
			c.Abort()
			return
		}
		if b.OwnerID != UID(c) {
			resp.Error(c, hkerr.Forbidden())
			c.Abort()
			return
		}
		c.Next()
	}
}
