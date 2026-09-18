// Package handler HTTP 处理层：参数解析 + 响应封装。
package handler

import (
	"github.com/gin-gonic/gin"

	"haiku-wiki/server/internal/middleware"
	"haiku-wiki/server/internal/pkg"
	"haiku-wiki/server/internal/repository"
	"haiku-wiki/server/internal/service"
)

var (
	authService   = &service.AuthService{}
	userService   = &service.UserService{}
	bookService   = &service.BookService{}
	docService    = &service.DocService{}
	versionSvc    = &service.VersionService{}
	searchService = &service.SearchService{}
	uploadService = &service.UploadService{}
	shareService  = &service.ShareService{}
	trashService  = &service.TrashService{}
	exportService = &service.ExportService{}
)

type registerReq struct {
	Username   string `json:"username" binding:"required"`
	Name       string `json:"name"`
	Email      string `json:"email" binding:"required"`
	Phone      string `json:"phone"`
	Department string `json:"department"`
	Password   string `json:"password" binding:"required"`
}

// Register POST /api/auth/register
func Register(c *gin.Context) {
	var req registerReq
	if err := c.ShouldBindJSON(&req); err != nil {
		resp.Error(c, paramErr(err))
		return
	}
	out, err := authService.Register(req.Username, req.Name, req.Email, req.Phone, req.Department, req.Password, c.ClientIP())
	if err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, out)
}

type loginReq struct {
	Account  string `json:"account" binding:"required"` // 用户名 / 手机号 / 邮箱
	Password string `json:"password" binding:"required"`
}

// Login POST /api/auth/login（支持用户名 / 手机号 / 邮箱）
func Login(c *gin.Context) {
	var req loginReq
	if err := c.ShouldBindJSON(&req); err != nil {
		resp.Error(c, paramErr(err))
		return
	}
	out, err := authService.Login(req.Account, req.Password)
	if err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, out)
}

// Me GET /api/auth/me
func Me(c *gin.Context) {
	uid := middleware.UID(c)
	u, err := repository.FindUserByID(uid)
	if err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, u)
}

type updateMeReq struct {
	Nickname    string `json:"nickname"`
	OldPassword string `json:"old_password"`
	NewPassword string `json:"new_password"`
}

// UpdateMe PUT /api/users/me —— 修改昵称 / 密码。
func UpdateMe(c *gin.Context) {
	uid := middleware.UID(c)
	var req updateMeReq
	if err := c.ShouldBindJSON(&req); err != nil {
		resp.Error(c, paramErr(err))
		return
	}
	if req.Nickname != "" {
		u, err := userService.UpdateNickname(uid, req.Nickname)
		if err != nil {
			resp.Error(c, err)
			return
		}
		resp.OK(c, u)
		return
	}
	if req.NewPassword != "" {
		if err := userService.UpdatePassword(uid, req.OldPassword, req.NewPassword); err != nil {
			resp.Error(c, err)
			return
		}
		resp.OK(c, gin.H{"updated": true})
		return
	}
	resp.Error(c, paramMsg("无可更新字段"))
}
