package service

import (
	"fmt"
	"io"
	"mime/multipart"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"

	"haiku-wiki/server/internal/model"
	hkerr "haiku-wiki/server/internal/pkg"
	"haiku-wiki/server/internal/repository"
	"haiku-wiki/server/internal/storage"
)

// UploadService 文件上传业务（白名单 + 大小限制 + 按年月分目录存储）。
//
// 落盘动作全部委托 internal/storage：local 模式写到数据目录，S3 模式写对象存储，
// 本文件不感知差异。返回的 URL 由后端自己决定形态（相对路径 / 公开链接），
// 业务侧只管把它存进数据库。
type UploadService struct{}

// DataDir 上传根目录（main 启动时注入）。
//
// ⚠️ 仅作**兜底与兼容**保留：真正的读写已走 storage 抽象，新代码不要再用它拼路径，
// 否则 S3 模式下会静默写到本地盘。
var DataDir = "./data"

// maxUploadBytes 单文件上限（字节），来自 conf/application.yml 的 upload.max_size_mb。
// 定在默认 64MB 而非更小：AutoCAD .dwg 图纸与含大量图片的 .pptx 常见十几到几十 MB。
func maxUploadBytes() int64 {
	if c := storage.Cfg(); c != nil {
		return c.UploadMaxBytes()
	}
	return 64 << 20
}

// allowedExt 白名单扩展名（svg 前端展示时禁用脚本渲染，仅作文件下载/预览图）。
var allowedExt = map[string]bool{
	".jpg": true, ".jpeg": true, ".png": true, ".gif": true, ".webp": true,
	".svg": true, ".bmp": true,
	".pdf": true, ".doc": true, ".docx": true, ".xls": true, ".xlsx": true,
	".ppt": true, ".pptx": true, ".md": true, ".txt": true, ".zip": true,
	// CAD 图纸：导入后由后端转换为 svg/png 预览
	".dwg": true, ".dxf": true,
	// draw.io 绘图：.drawio 直接作正文；.vsd/.vsdx 由内嵌编辑器导入
	".drawio": true, ".vsd": true, ".vsdx": true,
}

// UploadOutput 上传成功响应。
type UploadOutput struct {
	URL      string `json:"url"` // 可访问链接（local=/uploads/...；S3 公开桶=完整 https 链接）
	Filename string `json:"filename"`
	Size     int64  `json:"size"`
}

// Save 校验并保存上传文件，返回可访问 URL。
func (s *UploadService) Save(uid uint64, fh *multipart.FileHeader) (*UploadOutput, error) {
	if fh.Size > maxUploadBytes() {
		return nil, hkerr.FileTooLarge()
	}
	ext := strings.ToLower(filepath.Ext(fh.Filename))
	if ext == "" || !allowedExt[ext] {
		return nil, hkerr.FileTypeNotAllowed()
	}

	src, err := fh.Open()
	if err != nil {
		return nil, hkerr.Internal("读取上传文件失败")
	}
	defer src.Close()
	// 上限已在入口校验，这里再 Limit 一层防止声明大小与实际不符
	data, err := io.ReadAll(io.LimitReader(src, maxUploadBytes()+1))
	if err != nil {
		return nil, hkerr.Internal("读取上传文件失败")
	}
	if int64(len(data)) > maxUploadBytes() {
		return nil, hkerr.FileTooLarge()
	}
	return saveBytes(uid, filepath.Base(fh.Filename), fh.Header.Get("Content-Type"), data)
}

// SaveBytes 把字节数据存为上传文件（复用与 Save 一致的存储方案与白名单），
// 用于 URL 抓取导入时把远程图片本地化。返回可访问 URL。
func (s *UploadService) SaveBytes(uid uint64, filename string, data []byte) (*UploadOutput, error) {
	if int64(len(data)) > maxUploadBytes() {
		return nil, hkerr.FileTooLarge()
	}
	ext := strings.ToLower(filepath.Ext(filename))
	if ext == "" || !allowedExt[ext] {
		return nil, hkerr.FileTypeNotAllowed()
	}
	return saveBytes(uid, filepath.Base(filename), "", data)
}

// uploadKey 把业务侧流传的 "/uploads/2026/09/x.png" 换算成存储键，
// 并强制校验它必须落在 uploads/ 下（防目录穿越：URL 来自用户输入，可伪造）。
//
// 全仓凡是要按附件 URL 去读写文件的，都必须先过这个函数。
func uploadKey(url string) (string, error) {
	clean := strings.TrimSpace(url)
	if !strings.HasPrefix(clean, "/uploads/") && !strings.HasPrefix(clean, "uploads/") {
		return "", hkerr.NotFound("附件路径无效")
	}
	key := storage.KeyFromURL(clean)
	if !strings.HasPrefix(key, "uploads/") {
		return "", hkerr.NotFound("附件路径无效")
	}
	return key, nil
}

// saveBytes 落盘 + 记库 + 组装输出，两条入口共用（保证口径完全一致）。
func saveBytes(uid uint64, filename, contentType string, data []byte) (*UploadOutput, error) {
	ext := strings.ToLower(filepath.Ext(filename))
	// 存储键：uploads/YYYY/MM/<uuid>.<ext>（local 与 S3 共用同一套键名规则，
	// 这样两种存储之间迁移时无需改写任何业务数据）
	now := time.Now().UTC()
	key := fmt.Sprintf("uploads/%04d/%02d/%s%s", now.Year(), int(now.Month()), uuid.NewString(), ext)

	if contentType == "" {
		contentType = storage.MimeByExt(filename)
	}
	st := storage.Default()
	if err := st.Put(key, data, contentType); err != nil {
		return nil, err
	}

	att := &model.Attachment{
		UploaderID:  uid,
		Filename:    filename,
		StoragePath: key,
		MimeType:    contentType,
		Size:        int64(len(data)),
	}
	if err := repository.CreateAttachment(att); err != nil {
		// 记录失败不阻断：文件已落盘，仍返回 URL
		_ = err
	}
	return &UploadOutput{
		URL:      st.URL(key),
		Filename: filename,
		Size:     int64(len(data)),
	}, nil
}
