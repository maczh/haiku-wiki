package middleware

import (
	"github.com/gin-gonic/gin"

	"haiku-wiki/server/internal/pkg"
	hkerr "haiku-wiki/server/internal/pkg"
	"haiku-wiki/server/internal/pkg/jwtutil"
)

// context key 常量。
const (
	CtxUID  = "uid"
	CtxRole = "role"
)

// JWTAuth 强制鉴权：无有效 token 直接 40101。
func JWTAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		claims, err := jwtutil.Parse(BearerToken(c))
		if err != nil {
			resp.Error(c, hkerr.Unauthorized())
			c.Abort()
			return
		}
		c.Set(CtxUID, claims.UID)
		c.Set(CtxRole, claims.Role)
		c.Next()
	}
}

// OptionalAuth 可选鉴权：有 token 则解析，匿名也放行（搜索/分享场景）。
func OptionalAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		if claims, err := jwtutil.Parse(BearerToken(c)); err == nil {
			c.Set(CtxUID, claims.UID)
			c.Set(CtxRole, claims.Role)
		}
		c.Next()
	}
}

// UID 取当前登录用户 ID，未登录返回 0。
func UID(c *gin.Context) uint64 {
	if v, ok := c.Get(CtxUID); ok {
		if id, ok := v.(uint64); ok {
			return id
		}
	}
	return 0
}

// Role 取当前登录用户角色。
func Role(c *gin.Context) string {
	if v, ok := c.Get(CtxRole); ok {
		if r, ok := v.(string); ok {
			return r
		}
	}
	return ""
}
