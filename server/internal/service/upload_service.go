package service

import (
	"fmt"
	"io"
	"mime/multipart"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"

	"haiku-wiki/server/internal/model"
	hkerr "haiku-wiki/server/internal/pkg"
	"haiku-wiki/server/internal/repository"
)

// UploadService 文件上传业务（白名单 + 20MB 限制 + 本地磁盘按年月存储）。
type UploadService struct{}

// DataDir 上传根目录（main 启动时注入）。
var DataDir = "./data"

const maxUploadSize = 20 << 20 // 20MB

// allowedExt 白名单扩展名（svg 前端展示时禁用脚本渲染，仅作文件下载/预览图）。
var allowedExt = map[string]bool{
	".jpg": true, ".jpeg": true, ".png": true, ".gif": true, ".webp": true,
	".svg": true, ".bmp": true,
	".pdf": true, ".doc": true, ".docx": true, ".xls": true, ".xlsx": true,
	".ppt": true, ".pptx": true, ".md": true, ".txt": true, ".zip": true,
}

// UploadOutput 上传成功响应。
type UploadOutput struct {
	URL      string `json:"url"` // 相对 URL：/uploads/YYYY/MM/xxx.ext
	Filename string `json:"filename"`
	Size     int64  `json:"size"`
}

// Save 校验并保存上传文件，返回可访问 URL。
func (s *UploadService) Save(uid uint64, fh *multipart.FileHeader) (*UploadOutput, error) {
	if fh.Size > maxUploadSize {
		return nil, hkerr.FileTooLarge()
	}
	ext := strings.ToLower(filepath.Ext(fh.Filename))
	if ext == "" || !allowedExt[ext] {
		return nil, hkerr.FileTypeNotAllowed()
	}
	// 存储路径：DATA_DIR/uploads/YYYY/MM/<uuid>.<ext>
	now := time.Now().UTC()
	relDir := fmt.Sprintf("uploads/%04d/%02d", now.Year(), int(now.Month()))
	absDir := filepath.Join(DataDir, relDir)
	if err := os.MkdirAll(absDir, 0o755); err != nil {
		return nil, hkerr.Internal("创建上传目录失败")
	}
	name := uuid.NewString() + ext
	absPath := filepath.Join(absDir, name)

	src, err := fh.Open()
	if err != nil {
		return nil, hkerr.Internal("读取上传文件失败")
	}
	defer src.Close()
	dst, err := os.Create(absPath)
	if err != nil {
		return nil, hkerr.Internal("写入文件失败")
	}
	defer dst.Close()
	if _, err := io.Copy(dst, src); err != nil {
		return nil, hkerr.Internal("写入文件失败")
	}

	att := &model.Attachment{
		UploaderID:  uid,
		Filename:    filepath.Base(fh.Filename),
		StoragePath: relDir + "/" + name,
		MimeType:    fh.Header.Get("Content-Type"),
		Size:        fh.Size,
	}
	if err := repository.CreateAttachment(att); err != nil {
		// 记录失败不阻断：文件已落盘，仍返回 URL
		_ = err
	}
	return &UploadOutput{
		URL:      "/" + relDir + "/" + name,
		Filename: att.Filename,
		Size:     fh.Size,
	}, nil
}
