package handler

import (
	"io"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"haiku-wiki/server/internal/storage"
)

// StorageProxy GET /uploads/*path —— 对象存储模式下的文件读取代理。
//
// 为什么需要它：业务数据里存的始终是相对路径 /uploads/2026/09/x.png，
// 私有桶下前端拿这个路径直接访问不到对象。两种解法：
//  1. 把预签名 URL 写进数据库 —— 链接会过期，而这是数据的长期字段，不可用；
//  2. 在这里代理转发 —— 每次请求现取现返回，链接永不过期（推荐）。
//
// 公开读桶时 storage.URL() 会直接返回完整 https 链接，压根不会走到这里。
//
// 与 local 模式的静态路由保持同一口径：不鉴权（历史行为，附件链接可被拿到的人访问）。
func StorageProxy(c *gin.Context) {
	p := c.Param("path")
	key := "uploads" + strings.TrimPrefix(p, "/")

	st := storage.Default()
	rc, err := st.Open(key)
	if err != nil {
		c.Status(http.StatusNotFound)
		return
	}
	defer rc.Close()

	c.Header("Content-Type", storage.MimeByExt(key))
	// 附件内容不可变（key 含 uuid），可放心长缓存
	c.Header("Cache-Control", "public, max-age=31536000, immutable")
	c.Status(http.StatusOK)
	_, _ = io.Copy(c.Writer, rc)
}
