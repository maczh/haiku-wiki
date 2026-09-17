package handler

import (
	"github.com/gin-gonic/gin"

	"haiku-wiki/server/internal/middleware"
	"haiku-wiki/server/internal/pkg"
	"haiku-wiki/server/internal/service"
	"haiku-wiki/server/internal/service/exportx"
)

var attachmentService = &service.AttachmentService{}

// PrepareAttachment POST /api/attachments/prepare
//
// 附件型文档导入的服务端预处理环节：前端把原文件上传到 /api/uploads 之后调用本接口，
// 由后端决定是否需要派生资源（目前为 CAD 图纸的 svg/png），
// 返回可直接作为文档正文写入的 FileRef。
//
// 之所以单独一步而不是塞进 /api/uploads：上传接口是通用的（图片、头像等也用），
// 把"按业务类型做重转换"耦合进去会让上传变慢且难以复用。
func PrepareAttachment(c *gin.Context) {
	var in service.PrepareInput
	if err := c.ShouldBindJSON(&in); err != nil {
		resp.Error(c, paramMsg("请求体格式错误"))
		return
	}
	out, err := attachmentService.Prepare(middleware.UID(c), in)
	if err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, out)
}

// CadConverterStatus GET /api/cad/converter
//
// 返回 DWG 转换器的可用状态，供界面提示与运维排障。
// 未安装转换器时导入 DWG 仍可工作（使用文件内嵌预览图降级），
// 因此这里只作为"能力说明"而不是错误。
func CadConverterStatus(c *gin.Context) {
	resp.OK(c, gin.H{
		"available": exportx.DWGConverterAvailable(),
		"detail":    exportx.DWGConverterStatus(),
	})
}
