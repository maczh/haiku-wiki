package handler

import (
	"strconv"

	"github.com/gin-gonic/gin"

	"haiku-wiki/server/internal/middleware"
	"haiku-wiki/server/internal/pkg"
	"haiku-wiki/server/internal/service"
)

// docIDFromPath 解析 :id 路由参数为文档 ID。
func docIDFromPath(c *gin.Context) (uint64, bool) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	return id, err == nil && id > 0
}

type createDocReq struct {
	ParentID uint64 `json:"parent_id"`
	Title    string `json:"title"`
	DocType  string `json:"doc_type"`
	// Content 可选：导入附件型文档（doc_type=file）时一次性写入 FileRef
	Content string `json:"content"`
}

// validDocTypes 新建文档允许的类型枚举（datatable 已下线，存量由 MigrateData 迁移为 sheet）。
// file：导入的 .docx/.pdf/.pptx/.dwg 原样保存的附件型文档，正文不可编辑，仅阅读与下载。
// drawing：内嵌 draw.io 的绘图文档，正文为 mxGraph XML，可编辑。
// todo：待办清单，正文 {version,items:[…]}，可导出 xlsx/md。
// calendar：工作日历，正文 {version,tasks:[…]}，可导出 xlsx/ics。
var validDocTypes = map[string]bool{
	"markdown": true, "sheet": true, "mindmap": true, "flowchart": true,
	"file": true, "drawing": true, "todo": true, "calendar": true, "api": true,
}

// TreeDocs GET /api/books/:id/docs —— 目录树平铺列表。
func TreeDocs(c *gin.Context) {
	docs, err := docService.Tree(middleware.BookFromCtx(c))
	if err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, docs)
}

// CreateDoc POST /api/books/:id/docs
func CreateDoc(c *gin.Context) {
	var req createDocReq
	if err := c.ShouldBindJSON(&req); err != nil {
		resp.Error(c, paramErr(err))
		return
	}
	// 枚举归一化：缺省/非法均回退 markdown 落库（PRD P0-5 / 架构 §3.3，
	// 后端 create 不感知类型内容，内容默认值由前端首次保存写入）
	if !validDocTypes[req.DocType] {
		req.DocType = "markdown"
	}
	doc, err := docService.CreateDocWithContent(middleware.BookFromCtx(c), middleware.UID(c), req.ParentID, req.Title, req.DocType, req.Content)
	if err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, doc)
}

// GetDoc GET /api/docs/:id —— 文档详情（含正文）。
func GetDoc(c *gin.Context) {
	id, ok := docIDFromPath(c)
	if !ok {
		resp.Error(c, paramMsg("无效的文档 ID"))
		return
	}
	doc, book, err := docService.LoadForRead(middleware.UID(c), id)
	if err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, gin.H{"doc": doc, "book": gin.H{"id": book.ID, "name": book.Name, "visibility": book.Visibility, "owner_id": book.OwnerID}})
}

type patchDocReq struct {
	Title   *string `json:"title"`
	Content *string `json:"content"`
	Source  string  `json:"source"` // auto | manual
}

// PatchDoc PATCH /api/docs/:id —— 更新标题/正文；内容变化时自动快照。
func PatchDoc(c *gin.Context) {
	id, ok := docIDFromPath(c)
	if !ok {
		resp.Error(c, paramMsg("无效的文档 ID"))
		return
	}
	var req patchDocReq
	if err := c.ShouldBindJSON(&req); err != nil {
		resp.Error(c, paramErr(err))
		return
	}
	if req.Title == nil && req.Content == nil {
		resp.Error(c, paramMsg("无可更新字段"))
		return
	}
	doc, changed, err := docService.UpdateDoc(middleware.UID(c), id, req.Title, req.Content, req.Source)
	if err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, gin.H{"doc": doc, "changed": changed})
}

// MoveDoc PUT /api/docs/:id/move —— 移动/排序（fractional index）。
func MoveDoc(c *gin.Context) {
	id, ok := docIDFromPath(c)
	if !ok {
		resp.Error(c, paramMsg("无效的文档 ID"))
		return
	}
	var req service.MoveInput
	if err := c.ShouldBindJSON(&req); err != nil {
		resp.Error(c, paramErr(err))
		return
	}
	doc, err := docService.Move(middleware.UID(c), id, req)
	if err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, doc)
}

// DeleteDoc DELETE /api/docs/:id —— 软删（进回收站，级联子孙）。
func DeleteDoc(c *gin.Context) {
	id, ok := docIDFromPath(c)
	if !ok {
		resp.Error(c, paramMsg("无效的文档 ID"))
		return
	}
	if err := docService.SoftDelete(middleware.UID(c), id); err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, gin.H{"deleted": true})
}

// DuplicateDoc POST /api/docs/:id/duplicate —— 复制文档（同父级末尾，内容原样）。
func DuplicateDoc(c *gin.Context) {
	id, ok := docIDFromPath(c)
	if !ok {
		resp.Error(c, paramMsg("无效的文档 ID"))
		return
	}
	doc, err := docService.Duplicate(middleware.UID(c), id)
	if err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, doc)
}

type moveToBookReq struct {
	BookID uint64 `json:"book_id"`
}

// MoveDocToBook POST /api/docs/:id/move-to-book —— 跨知识库移动到目标书根目录末尾。
func MoveDocToBook(c *gin.Context) {
	id, ok := docIDFromPath(c)
	if !ok {
		resp.Error(c, paramMsg("无效的文档 ID"))
		return
	}
	var req moveToBookReq
	if err := c.ShouldBindJSON(&req); err != nil {
		resp.Error(c, paramErr(err))
		return
	}
	if req.BookID == 0 {
		resp.Error(c, paramMsg("book_id 不能为空"))
		return
	}
	doc, err := docService.MoveToBook(middleware.UID(c), id, req.BookID)
	if err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, doc)
}

type pinDocReq struct {
	Pinned *bool `json:"pinned"`
}

// PinDoc PATCH /api/docs/:id/pin —— 置顶/取消置顶（body {pinned: bool}）。
func PinDoc(c *gin.Context) {
	id, ok := docIDFromPath(c)
	if !ok {
		resp.Error(c, paramMsg("无效的文档 ID"))
		return
	}
	var req pinDocReq
	if err := c.ShouldBindJSON(&req); err != nil {
		resp.Error(c, paramErr(err))
		return
	}
	if req.Pinned == nil {
		resp.Error(c, paramMsg("pinned 不能为空"))
		return
	}
	doc, err := docService.SetPinned(middleware.UID(c), id, *req.Pinned)
	if err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, doc)
}
