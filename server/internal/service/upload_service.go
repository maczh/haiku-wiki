package service

import (
	"io"
	"mime/multipart"
	"path/filepath"
	"strings"

	hkerr "haiku-wiki/server/internal/pkg"
	"haiku-wiki/server/internal/repository"
	"haiku-wiki/server/internal/storage"
)

// UploadService 文件上传业务（白名单 + 大小限制 + 内容寻址存储 + 秒传）。
//
// 落盘动作全部委托 internal/storage：local 模式写到数据目录，S3 模式写对象存储，
// 本文件不感知差异。返回的 URL 由后端自己决定形态（相对路径 / 公开链接），
// 业务侧只管把它存进数据库。
//
// 去重（P0-2）：物理对象一律按内容寻址（uploads/cas/<前2位>/<md5>-<rand6>.<ext>），
// 同一 md5 的全部 meta 行共享同一 storage_path；本文件只做校验与转发，写盘/记账在 casPut。
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

// UploadMaxBytes 当前配置下的单文件上限（字节）。
//
// 导出给 handler 层做「预检提前拦截」：预检与真实上传必须**同口径**，否则会出现
// 「预检通过但上传必失败」的体验裂缝（§3.3 R1 的 41301 要求）。
// 与既有 GalleryMaxBytes / PrototypeMaxBytes 同一约定。
func UploadMaxBytes() int64 { return maxUploadBytes() }

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
//
// MD5 / Dedup 是新增的**可选**字段（老前端忽略它们，契约不破，§9 响应契约）。
type UploadOutput struct {
	URL      string `json:"url"` // 可访问链接（local=/uploads/...；S3 公开桶=完整 https 链接）
	Filename string `json:"filename"`
	Size     int64  `json:"size"`
	// MD5 内容摘要（32 位小写 hex）。
	MD5 string `json:"md5,omitempty"`
	// Dedup 本次是否命中已有内容（true = 未写盘，仅新增引用）。
	Dedup bool `json:"dedup,omitempty"`
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

// Precheck 秒传预检：只按 md5 判断是否已有物理对象。
//
// ⚠️ 刻意**不返回**任何他人信息（filename / storage_path / 知识库），只回命中与否
// （P0-5④ / R9：/uploads/* 免鉴权，跨库共享 URL 存在合规风险，响应必须最小化）。
// 未命中或大小不符都返回 (false, nil)，让前端降级为普通上传。
func (s *UploadService) Precheck(md5v string, size int64, filename string) (bool, error) {
	m := normalizeMD5(md5v)
	if !isHexMD5(m) {
		return false, hkerr.Param("md5 必须是 32 位小写十六进制")
	}
	ext := strings.ToLower(filepath.Ext(filename))
	if ext == "" || !allowedExt[ext] {
		return false, hkerr.FileTypeNotAllowed()
	}
	att, err := repository.FindAttachmentByMD5(m)
	if err != nil || att == nil || att.StoragePath == "" {
		return false, nil
	}
	if size > 0 && att.Size > 0 && att.Size != size {
		return false, nil
	}
	return true, nil
}

// Instant 秒传：按 md5 复用已存在的物理对象，仅新增一条 meta（**不接收字节**）。
//
// 未知 md5 → 40401（前端据此降级为普通上传）；大小不符 → 40901。
func (s *UploadService) Instant(uid uint64, md5v, filename, mime string, size int64) (*UploadOutput, error) {
	name := filepath.Base(strings.TrimSpace(filename))
	ext := strings.ToLower(filepath.Ext(name))
	if ext == "" || !allowedExt[ext] {
		return nil, hkerr.FileTypeNotAllowed()
	}
	return instantMeta(uid, md5v, size, name, mime)
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
//
// 实现已收敛到 casPut：内容寻址 + 命中复用 + 统计累加，全部在 cas_service.go。
func saveBytes(uid uint64, filename, contentType string, data []byte) (*UploadOutput, error) {
	return casPut(uid, filename, contentType, data)
}
