package handler

import (
	"strconv"

	"github.com/gin-gonic/gin"

	"haiku-wiki/server/internal/middleware"
	"haiku-wiki/server/internal/pkg"
	"haiku-wiki/server/internal/service"
	"haiku-wiki/server/internal/service/imgconv"
)

// GalleryAddImages POST /api/docs/:id/gallery/images —— 往图片库批量加图（multipart files[]）。
//
// 上传后立刻生成「标准尺寸预览图 + 缩略图」，相册网格用缩略图、灯箱用预览图、
// 下载按钮给原件。缺外部转换器时（HEIC/PSD/CDR/AI 且本机没装转换器）单张降级：
// 仍入库、仍可下载，只是没有预览图，前端显示占位卡并给出原因。
//
// 批量是逐张处理的：一张坏了不影响其余（rejected 里给出原因，前端逐条提示）。
func GalleryAddImages(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		resp.Error(c, paramMsg("文档 ID 无效"))
		return
	}
	form, err := c.MultipartForm()
	if err != nil {
		resp.Error(c, paramMsg("请上传图片文件"))
		return
	}
	fhs := form.File["files"]
	if len(fhs) == 0 {
		resp.Error(c, paramMsg("请上传图片文件"))
		return
	}
	lim := service.GalleryMaxBytes()
	files := make([]service.GalleryUpload, 0, len(fhs))
	rejected := make([]service.GalleryReject, 0)
	for _, fh := range fhs {
		if fh.Size > lim {
			rejected = append(rejected, service.GalleryReject{Name: fh.Filename, Reason: "文件超过 " + strconv.FormatInt(lim>>20, 10) + "MB"})
			continue
		}
		f, err := fh.Open()
		if err != nil {
			rejected = append(rejected, service.GalleryReject{Name: fh.Filename, Reason: "文件无法读取"})
			continue
		}
		buf := make([]byte, fh.Size)
		n := 0
		for n < len(buf) {
			k, err := f.Read(buf[n:])
			n += k
			if err != nil {
				break
			}
		}
		_ = f.Close()
		if n == 0 {
			rejected = append(rejected, service.GalleryReject{Name: fh.Filename, Reason: "文件为空"})
			continue
		}
		files = append(files, service.GalleryUpload{Name: fh.Filename, Data: buf[:n]})
	}

	added, rej, err := docService.AddGalleryImages(middleware.UID(c), id, files)
	if err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, gin.H{"images": added, "rejected": append(rejected, rej...)})
}

// GalleryRemoveImage DELETE /api/docs/:id/gallery/images/:imageId —— 从图片库删一张图。
func GalleryRemoveImage(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		resp.Error(c, paramMsg("文档 ID 无效"))
		return
	}
	imageID := c.Param("imageId")
	if imageID == "" {
		resp.Error(c, paramMsg("图片 ID 无效"))
		return
	}
	if err := docService.RemoveGalleryImage(middleware.UID(c), id, imageID); err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, gin.H{"image_id": imageID})
}

// GalleryRegenerateImage POST /api/docs/:id/gallery/images/:imageId/regenerate
// 重新生成某张图片的预览图（三档），用于首次转换降级/缺转换器后的补救。
func GalleryRegenerateImage(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		resp.Error(c, paramMsg("文档 ID 无效"))
		return
	}
	imageID := c.Param("imageId")
	if imageID == "" {
		resp.Error(c, paramMsg("图片 ID 无效"))
		return
	}
	img, err := docService.RegenerateGalleryImage(middleware.UID(c), id, imageID)
	if err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, gin.H{"image": img})
}

// GalleryRenameImage PATCH /api/docs/:id/gallery/images/:imageId —— 改图片显示名。
func GalleryRenameImage(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		resp.Error(c, paramMsg("文档 ID 无效"))
		return
	}
	var in struct {
		Name string `json:"name" binding:"required"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		resp.Error(c, paramErr(err))
		return
	}
	if err := docService.RenameGalleryImage(middleware.UID(c), id, c.Param("imageId"), in.Name); err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, gin.H{"name": in.Name})
}

// ImageConverterStatus GET /api/images/converter —— 图片处理能力（与 /api/cad/converter 同构）。
//
// 前端在上传前用它提示用户：本机没装转换器时 HEIC/PSD/CDR/AI 只能保存原件、没有预览图。
func ImageConverterStatus(c *gin.Context) {
	cap := imgconv.Capabilities()
	resp.OK(c, gin.H{
		"converter":       cap.Converter,
		"heif_converter":  cap.HeifConverter,
		"native_formats":  cap.Native,
		"external_format": cap.External,
		"vector_formats":  cap.Vector,
		"allowed_ext":     service.GalleryAllowedExt(),
		"preview_max":     imgconv.PreviewMax,
		"thumb_max":       imgconv.ThumbMax,
	})
}
