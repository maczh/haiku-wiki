package handler

import (
	"log"
	"strings"

	"github.com/gin-gonic/gin"

	"haiku-wiki/server/internal/middleware"
	"haiku-wiki/server/internal/pkg"
)

// Upload POST /api/uploads —— multipart 文件上传。
//
// 请求新增可选 form 字段 `md5`（前端算出的值，§3.3 R3）：
// **仅用于日志比对**，服务端一律自己重算，不一致以服务端为准 —— 客户端可伪造，
// 信任它会让「同内容共享同一 storage_path」这条内容寻址不变量失效。
// 响应的 `md5` / `dedup` 由 `UploadOutput` 自带（老前端忽略新字段，契约不破）。
func Upload(c *gin.Context) {
	fh, err := c.FormFile("file")
	if err != nil {
		resp.Error(c, paramMsg("请通过 multipart/form-data 的 file 字段上传"))
		return
	}
	// FormFile 已触发 multipart 解析，此处读得到同请求的普通字段。
	claimed := strings.TrimSpace(c.PostForm("md5"))

	out, err := uploadService.Save(middleware.UID(c), fh)
	if err != nil {
		resp.Error(c, err)
		return
	}
	if claimed != "" && !strings.EqualFold(claimed, out.MD5) {
		// 不改写落库值，只留痕：这种不一致通常意味着前端在传输前改过字节（或算错了分片）。
		log.Printf("[upload] 前端声明的 md5 与服务端重算不一致 claimed=%s actual=%s file=%s",
			claimed, out.MD5, fh.Filename)
	}
	resp.OK(c, out)
}
