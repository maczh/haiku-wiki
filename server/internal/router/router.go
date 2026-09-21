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
	"haiku-wiki/server/internal/storage"
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
		// 文档点评（分享访客，免 JWT）：文档级 / 书级分享 slug 均可
		pub.GET("/doc-comments", handler.AnonListComments)
		pub.POST("/doc-comments", handler.AnonCreateComment)
		pub.POST("/doc-comments/upload", handler.AnonUpload)
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
		// 首页 Dashboard「最近更新」：跨库聚合当前用户可读的最近更新文档（含协作文档）
		jwt.GET("/recent-docs", handler.ListRecentDocs)
		// 首页「工作台」：一次请求拿到待办 / 甘特图 / 工作日历三类文档（含正文，供前端算进度）
		jwt.GET("/workbench", handler.Workbench)

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
			// 目录树拖拽/右键菜单：移动（可指定目标父节点）与递归复制（可跨库、可指定目标父节点）
			docs.POST("/copy", handler.CopyDoc)
			docs.PATCH("/pin", handler.PinDoc)
			// 公司文库：管理员把个别文档设为「所有人可编辑」，用于收集建议 / bug 反馈
			docs.PATCH("/public-edit", handler.SetDocPublicEdit)
			// 图片库：批量加图 / 删图 / 改显示名
			docs.POST("/gallery/images", handler.GalleryAddImages)
			docs.DELETE("/gallery/images/:imageId", handler.GalleryRemoveImage)
			docs.PATCH("/gallery/images/:imageId", handler.GalleryRenameImage)
			docs.POST("/gallery/images/:imageId/regenerate", handler.GalleryRegenerateImage)
			// 需求原型：批量加原型（每文件带标题+需求描述）/ 改说明 / 删原型
			docs.POST("/prototype/items", handler.PrototypeAddItems)
			docs.PATCH("/prototype/items/:itemId", handler.PrototypeUpdateItem)
			docs.DELETE("/prototype/items/:itemId", handler.PrototypeRemoveItem)
			docs.POST("/prototype/items/:itemId/regenerate", handler.PrototypeRegenerateItem)
			docs.GET("/versions", handler.ListVersions)
			docs.GET("/versions/:vid", handler.GetVersion)
			docs.POST("/versions/:vid/rollback", handler.RollbackVersion)
			docs.POST("/restore", handler.RestoreDoc)
			docs.DELETE("/purge", handler.PurgeDoc)
			// 文档级分享管理
			docs.GET("/share", handler.GetDocShare)
			docs.PUT("/share", handler.UpsertDocShare)
			docs.DELETE("/share", handler.RevokeDocShare)
			// 接口文档调试历史（按文档 + endpoint + 用户隔离，最近 10 条）
			docs.GET("/api-debug-history", handler.ListApiDebugHistory)
			docs.POST("/api-debug-history", handler.SaveApiDebugHistory)
			docs.DELETE("/api-debug-history", handler.DeleteApiDebugHistory)
			// 文档点评 / 讨论区
			docs.GET("/comments", handler.ListComments)
			docs.POST("/comments", handler.CreateComment)
			docs.GET("/comment-settings", handler.GetCommentSettings)
			docs.PUT("/comment-settings", handler.UpdateCommentSettings)
			docs.DELETE("/comments/all", handler.ClearComments)
			docs.DELETE("/comments/:cid", handler.DeleteComment)
			docs.POST("/comments/:cid/ban", handler.BanAuthor)
			// 接口文档 URL 导入来源的定时/手动刷新（P0-7 / P0-8 / P1-2）
			docs.GET("/api-refresh-status", handler.GetApiRefreshStatus)
			docs.POST("/refresh", handler.RefreshDocApi)
		}

		// 上传 / 回收站 / 导出
		jwt.POST("/uploads", handler.Upload)
		// 秒传两阶段（§3.3 R1/R2 + §12.2.1）：预检（只回命中与否、无副作用）→ 秒传落 meta。
		// 鉴权走 JWT 即可，**不放 admin 组**：任何登录用户都能上传，预检不写任何数据。
		jwt.POST("/uploads/precheck", handler.PrecheckUpload)
		jwt.POST("/uploads/instant", handler.InstantUpload)
		// 附件预处理（CAD 图纸在后端完成 svg/png 转换）与转换器能力查询
		jwt.POST("/attachments/prepare", handler.PrepareAttachment)
		// PPTX 外链图片本地化（历史文件补做；幂等）
		jwt.POST("/attachments/pptx-localize", handler.LocalizePptx)
		jwt.GET("/cad/converter", handler.CadConverterStatus)
		// 图片库：本机图片转换能力（缺转换器时提示前端哪些格式会降级）
		jwt.GET("/images/converter", handler.ImageConverterStatus)
		// 思维导图导入：.smm/.km/.xmind/.mm → 内置 .smm 正文（.xmind 是 zip，放服务端解析）
		jwt.POST("/mindmap/parse", handler.ParseMindmap)
		jwt.GET("/trash", handler.ListTrash)
		jwt.GET("/export/docs/:id", handler.ExportDoc)
		jwt.GET("/export/docs/:id/formats", handler.ExportDocFormats)
		jwt.GET("/export/books/:id", handler.ExportBook)
		// 网页标题代理（粘贴 URL 转链接用）
		jwt.GET("/fetch-title", handler.FetchTitle)
		// URL 抓取导入（SSRF 防护，转为 Markdown 文档）
		jwt.POST("/import/url", handler.ImportURL)
		// 网页包导入：单 html / zip 包 / 网页目录，原样保存后 iframe 嵌入展示
		jwt.POST("/import/html", handler.ImportHTML)
		// 接口文档「在线调试」服务端代理转发（SSRF 防护，CORS 绕行）
		jwt.POST("/proxy", handler.ProxyRequest)

		// 文档模板（仿语雀/WPS）：按业务分类 + 文档类型筛选，供「新建文档」套用
		tpl := jwt.Group("/templates")
		{
			tpl.GET("", handler.ListTemplates)
			tpl.GET("/categories", handler.ListTemplateCategories)
			// 「另存为模板」：任意登录用户可把自己写的文档存成自定义模板（可删自己存的）
			tpl.POST("", handler.CreateTemplate)
			tpl.DELETE("/:id", handler.DeleteOwnTemplate)
		}

		// 管理员用户管理（仅 admin）
		admin := jwt.Group("/admin", middleware.RequireAdmin())
		{
			admin.GET("/users", handler.ListUsers)
			// 内容去重统计（P1-4）：总上传次数 / 秒传命中次数 / 省下的字节
			admin.GET("/upload-stats", handler.UploadStats)
			admin.PATCH("/users/:id/status", handler.SetUserStatus)
			admin.PATCH("/users/:id/reset-password", handler.ResetUserPassword)
			// 用户删除 / 恢复 / 彻底删除（静态路由 /users/deleted 优先于 /users/:id）
			admin.GET("/users/deleted", handler.ListDeletedUsers)
			admin.DELETE("/users/:id", handler.DeleteUser)
			admin.POST("/users/:id/restore", handler.RestoreUser)
			admin.DELETE("/users/:id/purge", handler.PurgeUser)
			// 用户文库管理：查看 / 备份 / 删除某用户的私有文库与团队文库
			admin.GET("/users/:id/libraries", handler.ListUserLibraries)
			admin.GET("/books/:id/docs", handler.ListLibraryDocs)
			admin.DELETE("/books/:id", handler.DeleteLibrary)
			admin.POST("/books/:id/backup", handler.BackupLibrary)
			// 公司知识库写权限授权（仅管理员）：列出 / 授予 / 撤销
			admin.GET("/books/:id/writers", handler.ListBookWriters)
			admin.POST("/books/:id/writers", handler.AddBookWriter)
			admin.DELETE("/books/:id/writers/:uid", handler.RemoveBookWriter)

			// 系统配置（服务 / JWT / 数据库 / 存储 / 上传）
			admin.GET("/system-config", handler.GetSystemConfig)
			admin.PUT("/system-config", handler.SaveSystemConfig)

			// 系统迁移（数据库 SQLite↔MySQL、存储 local↔S3）：仅管理员
			admin.GET("/migrate/config", handler.MigrateConfig)
			admin.GET("/migrate/status", handler.MigrateStatus)
			admin.POST("/migrate/database", handler.MigrateDatabase)
			admin.POST("/migrate/storage", handler.MigrateStorage)
			admin.POST("/migrate/database/test", handler.TestDatabaseConnection)
			admin.POST("/migrate/storage/test", handler.TestStorageConnection)
			// 接口文档刷新：最近一次任务汇总（仅管理员；P1-3）
			admin.GET("/api-refresh/last", handler.GetApiRefreshLastRun)
			// 文档模板管理（仅管理员）：导入模板数据文件 / 模板目录，修改 / 删除模板
			admin.POST("/templates/import", handler.ImportTemplates)
			admin.PUT("/templates/:id", handler.UpdateTemplate)
			admin.DELETE("/templates/:id", handler.DeleteTemplate)
		}

		// 团队管理
		jwt.POST("/teams", handler.CreateTeam)
		jwt.GET("/teams", handler.ListTeams)
		teams := jwt.Group("/teams/:id")
		{
			teams.GET("", handler.GetTeam)
			teams.PUT("", handler.UpdateTeam)
			teams.DELETE("", handler.DeleteTeam)
			// 团队文库（团队 admin 可新建；成员任意角色可见）
			teams.GET("/books", handler.ListTeamLibraries)
			teams.POST("/books", handler.CreateTeamLibrary)
			teams.GET("/members", handler.ListTeamMembers)
			teams.POST("/members", handler.AddTeamMember)
			teams.DELETE("/members/:uid", handler.RemoveTeamMember)
			teams.PATCH("/members/:uid", handler.SetTeamMemberRole)
		}

		// 文档协作邀请（个人库文档）
		jwt.POST("/docs/:id/collaborators", handler.AddCollaborator)
		jwt.GET("/docs/:id/collaborators", handler.ListCollaborators)
		jwt.DELETE("/docs/:id/collaborators/:uid", handler.RemoveCollaborator)
	}

	// 上传文件访问入口：
	//   - local 存储：直接静态托管（零拷贝、支持 Range）
	//   - S3 存储：走代理转发，让库里存的历史相对路径 /uploads/... 继续可用
	if storage.Default().Kind() == config.StorageLocal {
		r.Static("/uploads", cfg.DataDir+"/uploads")
	} else {
		r.GET("/uploads/*path", handler.StorageProxy)
	}

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
