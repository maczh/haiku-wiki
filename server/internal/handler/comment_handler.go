package handler

import (
	"strconv"

	"github.com/gin-gonic/gin"

	"haiku-wiki/server/internal/middleware"
	"haiku-wiki/server/internal/pkg"
	"haiku-wiki/server/internal/service"
)

var commentService = &service.CommentService{}

// ---- 登录用户（docs/:id 组内）----

// ListComments GET /api/docs/:id/comments
func ListComments(c *gin.Context) {
	docID, ok := docIDFromPath(c)
	if !ok {
		resp.Error(c, paramMsg("无效的文档 ID"))
		return
	}
	doc, book, err := (&service.DocService{}).LoadForRead(middleware.UID(c), docID)
	if err != nil {
		resp.Error(c, err)
		return
	}
	list, err := commentService.ListComments(middleware.UID(c), doc, book)
	if err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, list)
}

// CreateComment POST /api/docs/:id/comments（支持 parent_id 跟帖）
func CreateComment(c *gin.Context) {
	docID, ok := docIDFromPath(c)
	if !ok {
		resp.Error(c, paramMsg("无效的文档 ID"))
		return
	}
	var req struct {
		ParentID  uint64 `json:"parent_id"`
		Body      string `json:"body"`
		GuestName string `json:"guest_name"` // 登录用户忽略
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		resp.Error(c, paramErr(err))
		return
	}
	doc, book, err := (&service.DocService{}).LoadForRead(middleware.UID(c), docID)
	if err != nil {
		resp.Error(c, err)
		return
	}
	cm, err := commentService.AddComment(middleware.UID(c), doc, book, req.ParentID, req.Body, req.GuestName, c.ClientIP())
	if err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, cm)
}

// GetCommentSettings GET /api/docs/:id/comment-settings（管理者）
func GetCommentSettings(c *gin.Context) {
	docID, ok := docIDFromPath(c)
	if !ok {
		resp.Error(c, paramMsg("无效的文档 ID"))
		return
	}
	set, err := commentService.GetSettings(middleware.UID(c), docID)
	if err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, set)
}

// UpdateCommentSettings PUT /api/docs/:id/comment-settings（管理者）
func UpdateCommentSettings(c *gin.Context) {
	docID, ok := docIDFromPath(c)
	if !ok {
		resp.Error(c, paramMsg("无效的文档 ID"))
		return
	}
	var req service.CommentSettingInput
	if err := c.ShouldBindJSON(&req); err != nil {
		resp.Error(c, paramErr(err))
		return
	}
	set, err := commentService.UpdateSettings(middleware.UID(c), docID, req)
	if err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, set)
}

// DeleteComment DELETE /api/docs/:id/comments/:cid（管理者）
func DeleteComment(c *gin.Context) {
	docID, ok := docIDFromPath(c)
	if !ok {
		resp.Error(c, paramMsg("无效的文档 ID"))
		return
	}
	cid, err := strconv.ParseUint(c.Param("cid"), 10, 64)
	if err != nil || cid == 0 {
		resp.Error(c, paramMsg("无效的帖子 ID"))
		return
	}
	if err := commentService.DeleteComment(middleware.UID(c), docID, cid); err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, gin.H{"ok": true})
}

// ClearComments DELETE /api/docs/:id/comments/all（管理者，清空本文所有发贴）
func ClearComments(c *gin.Context) {
	docID, ok := docIDFromPath(c)
	if !ok {
		resp.Error(c, paramMsg("无效的文档 ID"))
		return
	}
	if err := commentService.ClearComments(middleware.UID(c), docID); err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, gin.H{"ok": true})
}

// BanAuthor POST /api/docs/:id/comments/:cid/ban（管理者，禁言该帖作者）
func BanAuthor(c *gin.Context) {
	docID, ok := docIDFromPath(c)
	if !ok {
		resp.Error(c, paramMsg("无效的文档 ID"))
		return
	}
	cid, err := strconv.ParseUint(c.Param("cid"), 10, 64)
	if err != nil || cid == 0 {
		resp.Error(c, paramMsg("无效的帖子 ID"))
		return
	}
	if err := commentService.BanAuthor(middleware.UID(c), docID, cid); err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, gin.H{"ok": true})
}

// ---- 匿名（分享访客，/public/doc-comments）----

// AnonListComments GET /public/doc-comments?slug=&doc_id=&password=
func AnonListComments(c *gin.Context) {
	slug := c.Query("slug")
	docID, _ := strconv.ParseUint(c.Query("doc_id"), 10, 64)
	doc, book, err := commentService.ResolveAnonDoc(slug, docID, c.Query("password"), c.ClientIP())
	if err != nil {
		resp.Error(c, err)
		return
	}
	list, err := commentService.ListComments(0, doc, book)
	if err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, list)
}

// AnonCreateComment POST /public/doc-comments
func AnonCreateComment(c *gin.Context) {
	var req struct {
		Slug      string `json:"slug"`
		DocID     uint64 `json:"doc_id"`
		ParentID  uint64 `json:"parent_id"`
		Body      string `json:"body"`
		GuestName string `json:"guest_name"`
		Password  string `json:"password"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		resp.Error(c, paramErr(err))
		return
	}
	doc, book, err := commentService.ResolveAnonDoc(req.Slug, req.DocID, req.Password, c.ClientIP())
	if err != nil {
		resp.Error(c, err)
		return
	}
	cm, err := commentService.AddComment(0, doc, book, req.ParentID, req.Body, req.GuestName, c.ClientIP())
	if err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, cm)
}

// AnonUpload POST /public/doc-comments/upload（匿名发图，受 allow_post=all 约束）
func AnonUpload(c *gin.Context) {
	slug := c.PostForm("slug")
	docID, _ := strconv.ParseUint(c.PostForm("doc_id"), 10, 64)
	password := c.PostForm("password")
	doc, book, err := commentService.ResolveAnonDoc(slug, docID, password, c.ClientIP())
	if err != nil {
		resp.Error(c, err)
		return
	}
	ok, err := commentService.AnonCanPost(doc, book)
	if err != nil {
		resp.Error(c, err)
		return
	}
	if !ok {
		resp.Error(c, resp.New(40301, 403, "该文档不允许匿名访客发帖"))
		return
	}
	fh, err := c.FormFile("file")
	if err != nil {
		resp.Error(c, paramErr(err))
		return
	}
	out, err := uploadService.Save(0, fh)
	if err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, out)
}
