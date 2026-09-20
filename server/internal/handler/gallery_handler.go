package handler

import (
	"mime/multipart"
	"strconv"

	"github.com/gin-gonic/gin"

	"haiku-wiki/server/internal/middleware"
	"haiku-wiki/server/internal/pkg"
	"haiku-wiki/server/internal/service"
	"haiku-wiki/server/internal/service/imgconv"
)

// GalleryAddImages POST /api/docs/:id/gallery/images —— 往图片库批量加图（multipart）。
//
// 上传后立刻生成「标准尺寸预览图 + 缩略图」，相册网格用缩略图、灯箱用预览图、
// 下载按钮给原件。缺外部转换器时（HEIC/PSD/CDR/AI 且本机没装转换器）单张降级：
// 仍入库、仍可下载，只是没有预览图，前端显示占位卡并给出原因。
//
// 批量是逐张处理的：一张坏了不影响其余（rejected 里给出原因，前端逐条提示）。
//
// 两阶段协议（T03b，§12.2.2）：可选表单字段 `manifest`（JSON 数组，**唯一真源**）声明
// 与用户所选条目等长同序的条目列表；`files[]` 只承载其中 `kind=file` 的字节。
// 无 `manifest` 时退化为改造前的纯字节契约。响应附 `mode` / `summary` 供前端一次性提示。
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
	manifest, err := parseManifest(firstFormValue(form.Value["manifest"]), len(fhs))
	if err != nil {
		resp.Error(c, err)
		return
	}
	if manifest == nil && len(fhs) == 0 {
		resp.Error(c, paramMsg("请上传图片文件"))
		return
	}
	lim := service.GalleryMaxBytes()
	files := make([]service.GalleryUpload, 0, len(fhs))
	rejected := make([]service.GalleryReject, 0)
	if manifest == nil {
		for _, fh := range fhs {
			data, rej := readBytesUpload(fh, lim)
			if rej != "" {
				rejected = append(rejected, service.GalleryReject{Name: fh.Filename, Reason: rej})
				continue
			}
			files = append(files, service.GalleryUpload{Name: fh.Filename, Data: data})
		}
	} else {
		files = append(files, galleryEntries(fhs, manifest, lim, &rejected)...)
	}

	added, rej, err := docService.AddGalleryImages(middleware.UID(c), id, files)
	if err != nil {
		resp.Error(c, err)
		return
	}
	rejected = append(rejected, rej...)
	resp.OK(c, gin.H{
		"images":   added,
		"rejected": rejected,
		"mode":     batchMode(manifest),
		"summary":  summarize(manifest, len(fhs), countGalleryDedup(added), len(rejected)),
	})
}

// countGalleryDedup 统计本次**未写盘**的入库条目数（引用式入库或 CAS 复用）。
func countGalleryDedup(imgs []service.GalleryImage) int {
	n := 0
	for _, img := range imgs {
		if img.Dedup {
			n++
		}
	}
	return n
}

// galleryEntries 按 manifest（唯一真源）组装有序条目：
// `kind=ref` 不取字节，`kind=file` 依 manifest 中的出现顺序消费 `fhs`（字节游标）。
//
// 图片库没有标题/描述，但**字节游标必须**按 manifest 顺序推进 —— 这是 §R13 强校验
// （file 条数 == len(fhs)）之外的第二道一致性保证。
func galleryEntries(fhs []*multipart.FileHeader, manifest []BatchManifestEntry, lim int64, rejected *[]service.GalleryReject) []service.GalleryUpload {
	out := make([]service.GalleryUpload, 0, len(manifest))
	fi := 0
	for _, m := range manifest {
		if m.Kind == "ref" {
			out = append(out, service.GalleryUpload{
				Name: m.Name,
				Kind: service.BatchKindRef,
				MD5:  m.MD5,
				Size: m.Size,
			})
			continue
		}
		// kind=file：manifest 顺序 == files[] 顺序，逐个消费
		if fi >= len(fhs) {
			break // 已被 parseManifest 的计数校验挡下；此处仅为防越界兜底
		}
		fh := fhs[fi]
		fi++
		data, reason := readBytesUpload(fh, lim)
		if reason != "" {
			*rejected = append(*rejected, service.GalleryReject{Name: m.Name, Reason: reason})
			continue
		}
		logManifestMismatch("gallery", m, fh)
		out = append(out, service.GalleryUpload{Name: m.Name, Data: data, Kind: service.BatchKindFile})
	}
	return out
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
