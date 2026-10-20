package handler

import (
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"

	"github.com/gin-gonic/gin"

	"haiku-wiki/server/internal/middleware"
	resp "haiku-wiki/server/internal/pkg"
	"haiku-wiki/server/internal/service"
	"haiku-wiki/server/internal/storage"
)

// 本文件：网盘文件操作（新建 / 改名 / 移动 / 删除 / 上传）、下载、预览、导入。
//
// 下载与预览是**同步流式**（不落任务）：浏览器本身就是下载端，代理流天然带进度条，
// 落任务反而更慢（设计文档 §1.7）。两者都支持 Range —— 视频 seek 与 pdf.js 分片都靠它。

// CreateNetdiskDir POST /api/netdisks/:id/dirs —— 新建目录。
func CreateNetdiskDir(c *gin.Context) {
	id, ok := netdiskIDFromPath(c)
	if !ok {
		resp.Error(c, paramMsg("网盘连接 ID 无效"))
		return
	}
	var req netdiskMkdirReq
	if err := c.ShouldBindJSON(&req); err != nil {
		resp.Error(c, paramErr(err))
		return
	}
	if err := service.NetdiskFileSvc.Mkdir(id, middleware.UID(c), req.Path, req.Name); err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, gin.H{"created": true})
}

// RenameNetdiskItem POST /api/netdisks/:id/rename —— 改名。
func RenameNetdiskItem(c *gin.Context) {
	id, ok := netdiskIDFromPath(c)
	if !ok {
		resp.Error(c, paramMsg("网盘连接 ID 无效"))
		return
	}
	var req netdiskRenameReq
	if err := c.ShouldBindJSON(&req); err != nil {
		resp.Error(c, paramErr(err))
		return
	}
	if err := service.NetdiskFileSvc.Rename(id, middleware.UID(c), req.Path, req.Name); err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, gin.H{"renamed": true})
}

// MoveNetdiskItem POST /api/netdisks/:id/move —— 移动。
func MoveNetdiskItem(c *gin.Context) {
	id, ok := netdiskIDFromPath(c)
	if !ok {
		resp.Error(c, paramMsg("网盘连接 ID 无效"))
		return
	}
	var req netdiskMoveReq
	if err := c.ShouldBindJSON(&req); err != nil {
		resp.Error(c, paramErr(err))
		return
	}
	if err := service.NetdiskFileSvc.Move(id, middleware.UID(c), req.Path, req.TargetDir); err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, gin.H{"moved": true})
}

// DeleteNetdiskItem DELETE /api/netdisks/:id/items?path=&recursive= —— 删除。
func DeleteNetdiskItem(c *gin.Context) {
	id, ok := netdiskIDFromPath(c)
	if !ok {
		resp.Error(c, paramMsg("网盘连接 ID 无效"))
		return
	}
	path := netdiskQueryPath(c)
	if path == "" {
		resp.Error(c, paramMsg("缺少 path 参数"))
		return
	}
	recursive := c.Query("recursive") == "1" || c.Query("recursive") == "true"
	if err := service.NetdiskFileSvc.Remove(id, middleware.UID(c), path, recursive); err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, gin.H{"deleted": true})
}

// UploadNetdiskFile POST /api/netdisks/:id/upload?path= —— 上传（任务化，立即返回 task）。
func UploadNetdiskFile(c *gin.Context) {
	id, ok := netdiskIDFromPath(c)
	if !ok {
		resp.Error(c, paramMsg("网盘连接 ID 无效"))
		return
	}
	fh, err := c.FormFile("file")
	if err != nil {
		resp.Error(c, paramMsg("缺少上传文件"))
		return
	}
	task, err := service.NetdiskFileSvc.SubmitUpload(id, middleware.UID(c), netdiskQueryPath(c), fh)
	if err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, task)
}

// ImportNetdiskFile POST /api/netdisks/:id/import —— 导入到知识库（任务化）。
//
// 只建任务；worker 把网盘文件取回服务端临时目录，前端随后用
// GET /api/netdisk-tasks/:id/blob 取字节，交给既有导入对话框解析。
func ImportNetdiskFile(c *gin.Context) {
	id, ok := netdiskIDFromPath(c)
	if !ok {
		resp.Error(c, paramMsg("网盘连接 ID 无效"))
		return
	}
	var req netdiskImportReq
	if err := c.ShouldBindJSON(&req); err != nil {
		resp.Error(c, paramErr(err))
		return
	}
	task, err := service.NetdiskFileSvc.SubmitImport(id, middleware.UID(c), req.Path, req.BookID, req.ParentID)
	if err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, task)
}

// DownloadNetdiskFile GET /api/netdisks/:id/download?path=&token= —— 下载（代理流，支持 Range）。
func DownloadNetdiskFile(c *gin.Context) {
	writeNetdiskStream(c, "attachment")
}

// PreviewNetdiskFile GET /api/netdisks/:id/preview?path=&token= —— 预览（代理流，支持 Range）。
//
// 为什么 URL 里能带 token：`<video>` / `<img>` 的 src 发不出 Authorization 头，
// 只能把身份签进 query（2 小时有效，且签名绑定 uid + connID + path，换一个就是无效签名）。
func PreviewNetdiskFile(c *gin.Context) {
	writeNetdiskStream(c, "inline")
}

// writeNetdiskStream 下载 / 预览的公共实现。disposition 决定 Content-Disposition 前缀。
func writeNetdiskStream(c *gin.Context, disposition string) {
	id, ok := netdiskIDFromPath(c)
	if !ok {
		resp.Error(c, paramMsg("网盘连接 ID 无效"))
		return
	}
	path := netdiskQueryPath(c)
	if path == "" {
		resp.Error(c, paramMsg("缺少 path 参数"))
		return
	}
	uid, ok := netdiskStreamUID(c, id, path)
	if !ok {
		return // 错误已在 netdiskStreamUID 里写出
	}
	rng := service.ParseRangeHeader(c.GetHeader("Range"))
	st, err := service.NetdiskFileSvc.OpenStream(id, uid, path, rng)
	if err != nil {
		resp.Error(c, err)
		return
	}
	defer st.Body.Close()

	c.Header("Content-Type", storage.MimeByExt(st.Name))
	c.Header("Content-Disposition", disposition+"; filename*=UTF-8''"+url.QueryEscape(st.Name))
	c.Header("X-Content-Type-Options", "nosniff")
	// 不让反向代理把视频代理请求攒成完整响应；浏览器据此可以立刻消费
	// Range 响应并继续请求后续片段，避免等整个远端文件下载完成。
	c.Header("Cache-Control", "no-store")
	c.Header("X-Accel-Buffering", "no")
	if st.AcceptRange {
		c.Header("Accept-Ranges", "bytes")
	} else {
		c.Header("Accept-Ranges", "none")
	}

	if st.Partial && st.Total > 0 {
		end := st.Total - 1
		if st.Length > 0 && st.Offset+st.Length-1 < end {
			end = st.Offset + st.Length - 1
		}
		if end < st.Offset {
			end = st.Offset
		}
		c.Header("Content-Range", fmt.Sprintf("bytes %d-%d/%d", st.Offset, end, st.Total))
		c.Header("Content-Length", strconv.FormatInt(end-st.Offset+1, 10))
		c.Status(http.StatusPartialContent)
	} else if st.Total > 0 {
		c.Header("Content-Length", strconv.FormatInt(st.Total, 10))
		c.Status(http.StatusOK)
	} else {
		c.Status(http.StatusOK)
	}
	_, _ = io.Copy(c.Writer, st.Body)
}

// netdiskStreamUID 解析流式请求的归属用户。
//
// 两条路：① 带 Bearer 头（fetch / XHR）→ 直接用登录态 uid；
// ② 不带头（`<video src>` / `<img src>`）→ 用短期 token 里签的 uid。
// 两条都不成立就 401，绝不退化成「不鉴权」。
func netdiskStreamUID(c *gin.Context, connID uint64, path string) (uint64, bool) {
	if uid := middleware.UID(c); uid > 0 {
		return uid, true
	}
	token := c.Query("token")
	if token == "" {
		resp.Error(c, resp.Unauthorized())
		return 0, false
	}
	uid, err := service.NetdiskFileSvc.ParsePreviewToken(connID, path, token)
	if err != nil {
		resp.Error(c, err)
		return 0, false
	}
	return uid, true
}

// MakeNetdiskPreviewToken 给前端签发预览 / 下载短期 token（2 小时）。
//
// 单独开一个接口而不是让前端自己拼：<video> 的 src 需要在打开预览时就拿到。
func MakeNetdiskPreviewToken(c *gin.Context) {
	id, ok := netdiskIDFromPath(c)
	if !ok {
		resp.Error(c, paramMsg("网盘连接 ID 无效"))
		return
	}
	path := netdiskQueryPath(c)
	if path == "" {
		resp.Error(c, paramMsg("缺少 path 参数"))
		return
	}
	uid := middleware.UID(c)
	resp.OK(c, gin.H{
		"token": service.NetdiskFileSvc.MakePreviewToken(uid, id, path),
		"exp":   service.PreviewTokenTTLSeconds(),
	})
}
