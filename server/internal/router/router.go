// Package router 路由装配。
package router

import (
	"io/fs"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"haiku-wiki/server/internal/config"
	"haiku-wiki/server/internal/handler"
	"haiku-wiki/server/internal/middleware"
	"haiku-wiki/server/internal/pkg"
	"haiku-wiki/server/internal/static"
)

// Register 挂载全部路由：/api 业务 + /uploads 静态 + SPA 前端托管。
func Register(r *gin.Engine, cfg *config.Config) {
	api := r.Group("/api")

	// 公开分享（免 JWT）
	pub := api.Group("/public")
	{
		pub.GET("/share/:slug", handler.GetShare)
		pub.GET("/share/:slug/docs/:docId", handler.GetShareDoc)
		// 文档级分享（与书级并列，handler 分文件）
		pub.GET("/doc-share/:slug", handler.GetDocShareMeta)
		pub.POST("/doc-share/:slug/verify", handler.VerifyDocShare)
	}

	// 认证（注册/登录免 JWT）
	auth := api.Group("/auth")
	{
		auth.POST("/register", handler.Register)
		auth.POST("/login", handler.Login)
	}

	// 搜索：可选鉴权（public 库支持匿名搜索）
	api.GET("/search", middleware.OptionalAuth(), handler.Search)

	// 以下均需登录
	jwt := api.Group("", middleware.JWTAuth())
	{
		jwt.GET("/auth/me", handler.Me)
		jwt.PUT("/users/me", handler.UpdateMe)

		// 知识库
		jwt.GET("/books", handler.ListBooks)
		jwt.POST("/books", handler.CreateBook)
		books := jwt.Group("/books/:id", middleware.BookAccess(true))
		{
			books.GET("", handler.GetBook)
			books.PUT("", middleware.RequireOwner(), handler.UpdateBook)
			books.DELETE("", middleware.RequireOwner(), handler.DeleteBook)
			books.PUT("/visibility", middleware.RequireOwner(), handler.SetBookVisibility)
			books.GET("/docs", handler.TreeDocs)
			books.POST("/docs", middleware.BookAccess(false), handler.CreateDoc)
			books.GET("/export", handler.ExportBook)
		}

		// 文档
		docs := jwt.Group("/docs/:id")
		{
			docs.GET("", handler.GetDoc)
			docs.PATCH("", handler.PatchDoc)
			docs.PUT("/move", handler.MoveDoc)
			docs.DELETE("", handler.DeleteDoc)
			// 第四轮增量：复制 / 跨库移动 / 置顶（写权限在各 service 内校验）
			docs.POST("/duplicate", handler.DuplicateDoc)
			docs.POST("/move-to-book", handler.MoveDocToBook)
			docs.PATCH("/pin", handler.PinDoc)
			docs.GET("/versions", handler.ListVersions)
			docs.GET("/versions/:vid", handler.GetVersion)
			docs.POST("/versions/:vid/rollback", handler.RollbackVersion)
			docs.POST("/restore", handler.RestoreDoc)
			docs.DELETE("/purge", handler.PurgeDoc)
			// 文档级分享管理
			docs.GET("/share", handler.GetDocShare)
			docs.PUT("/share", handler.UpsertDocShare)
			docs.DELETE("/share", handler.RevokeDocShare)
		}

		// 上传 / 回收站 / 导出
		jwt.POST("/uploads", handler.Upload)
		// 附件预处理（CAD 图纸在后端完成 svg/png 转换）与转换器能力查询
		jwt.POST("/attachments/prepare", handler.PrepareAttachment)
		// PPTX 外链图片本地化（历史文件补做；幂等）
		jwt.POST("/attachments/pptx-localize", handler.LocalizePptx)
		jwt.GET("/cad/converter", handler.CadConverterStatus)
		// 思维导图导入：.smm/.km/.xmind/.mm → 内置 .smm 正文（.xmind 是 zip，放服务端解析）
		jwt.POST("/mindmap/parse", handler.ParseMindmap)
		jwt.GET("/trash", handler.ListTrash)
		jwt.GET("/export/docs/:id", handler.ExportDoc)
		jwt.GET("/export/docs/:id/formats", handler.ExportDocFormats)
		jwt.GET("/export/books/:id", handler.ExportBook)
		// 网页标题代理（粘贴 URL 转链接用）
		jwt.GET("/fetch-title", handler.FetchTitle)
	}

	// 上传文件静态托管
	r.Static("/uploads", cfg.DataDir+"/uploads")

	// 前端 SPA 托管（生产模式：嵌入的 dist；本地开发仅有占位文件时跳过）
	if static.HasIndex() {
		distFS, _ := static.Dist()
		fileServer := http.FileServer(http.FS(distFS))
		r.NoRoute(func(c *gin.Context) {
			if _, err := fs.Stat(distFS, staticProbePath(c.Request.URL.Path)); err != nil {
				// SPA fallback：非静态资源路径统一回退到 index.html
				c.Request.URL.Path = "/"
			}
			fileServer.ServeHTTP(c.Writer, c.Request)
		})
	} else {
		r.NoRoute(func(c *gin.Context) {
			if strings.HasPrefix(c.Request.URL.Path, "/api") {
				resp.Fail(c, 40401, http.StatusNotFound, "接口不存在")
				return
			}
			c.String(http.StatusOK, "haiku-wiki 前端未构建：请在 web/ 目录执行 npm run build，或使用 Vite dev server 开发。")
		})
	}
}

// staticProbePath 把请求路径转换成 embed 文件系统里用于「是否存在」判断的路径。
//
// 目录型请求（以 "/" 结尾）必须补上 index.html，原因是 io/fs 的合法性约束：
// fs.ValidPath 不接受尾随斜杠，fs.Stat(fsys, "drawio/") 会直接返回
// `invalid argument`（而不是「不存在」）。若不处理，这类目录路径会被误判为
// 「静态资源不存在」而落进 SPA 兜底，返回应用自身的 index.html ——
// 生产形态下内嵌的 draw.io 组件（请求 /drawio/ 目录）会因此整个失效，
// 而 Vite dev server 由自己的静态中间件服务，不会暴露这个问题。
func staticProbePath(urlPath string) string {
	p := strings.TrimPrefix(urlPath, "/")
	if p == "" || strings.HasSuffix(p, "/") {
		p += "index.html"
	}
	return p
}
