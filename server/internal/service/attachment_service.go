package service

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"

	"haiku-wiki/server/internal/model"
	hkerr "haiku-wiki/server/internal/pkg"
	"haiku-wiki/server/internal/repository"
	"haiku-wiki/server/internal/service/exportx"
)

// AttachmentService 附件型文档（doc_type=file）的服务端预处理。
//
// 导入 .dwg/.dxf 时：前端先把原文件传到 /api/uploads，再调用本服务，
// 由**后端**完成 → svg/png 的转换（转换结果与原件同目录存放），
// 前端只负责把返回的 FileRef JSON 当成文档正文写库。
// .pptx / .docx / .pdf 不需要派生资源，本服务直接回传原样引用。
type AttachmentService struct{}

// PrepareInput 前端上传完成后提交的原始信息。
type PrepareInput struct {
	URL      string `json:"url"`
	Filename string `json:"filename"`
	Size     int64  `json:"size"`
}

// PrepareOutput 预处理结果。
type PrepareOutput struct {
	Ref *exportx.FileRef `json:"ref"`
	// Warning 派生失败时的可读原因（不影响导入：原件已保存且可下载）。
	Warning string `json:"warning,omitempty"`
}

// Prepare 生成文档正文所需的 FileRef；CAD 图纸会顺带产出 svg/png，
// PPTX 会把外链（网络）图片下载下来嵌入原文件。
func (s *AttachmentService) Prepare(uid uint64, in PrepareInput) (*PrepareOutput, error) {
	url := strings.TrimSpace(in.URL)
	if url == "" {
		return nil, hkerr.Param("缺少附件地址")
	}
	name := strings.TrimSpace(in.Filename)
	ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(name), "."))
	if ext == "" {
		ext = strings.ToLower(strings.TrimPrefix(filepath.Ext(url), "."))
	}
	ref := &exportx.FileRef{
		URL:      url,
		Filename: name,
		Size:     in.Size,
		Ext:      ext,
	}
	if ext == "pptx" {
		// 幻灯片里的"链接图片"在本机/内网环境下会整片空白，导入时一并下载嵌入。
		res, err := s.localizePptx(uid, url)
		ref.PptxScanned = true
		if err != nil {
			// 本地化失败不影响导入：原件已落盘，仍可预览（只是外链图片可能显示不出来）
			ref.Note = "外链图片本地化未完成：" + err.Error()
			return &PrepareOutput{Ref: ref, Warning: ref.Note}, nil
		}
		ref.Note = res.Note()
		if len(res.Failures) > 0 {
			return &PrepareOutput{Ref: ref, Warning: ref.Note + "；" + strings.Join(truncateNotes(res.Failures), "；")}, nil
		}
		return &PrepareOutput{Ref: ref}, nil
	}
	if !exportx.IsCadExt(ext) {
		// 其余附件（docx/pdf…）无需服务端派生
		return &PrepareOutput{Ref: ref}, nil
	}

	raw, err := readUploadedFile(url)
	if err != nil {
		return nil, err
	}
	svg, pngData, degraded, note, cerr := exportx.ConvertCad(raw, ext)
	if cerr != nil {
		// 转换失败不算导入失败：原件已落盘，用户仍可下载原始图纸。
		ref.Note = cerr.Error()
		return &PrepareOutput{
			Ref:     ref,
			Warning: "图纸已保存，但预览生成失败：" + cerr.Error(),
		}, nil
	}
	ref.Derived = map[string]string{}
	ref.Degraded = degraded
	ref.Note = note
	if len(svg) > 0 {
		u, werr := saveDerivedFile(url, "svg", svg)
		if werr != nil {
			return nil, werr
		}
		ref.Derived["svg"] = u
	}
	if len(pngData) > 0 {
		u, werr := saveDerivedFile(url, "png", pngData)
		if werr != nil {
			return nil, werr
		}
		ref.Derived["png"] = u
	}
	return &PrepareOutput{Ref: ref}, nil
}

// saveDerivedFile 把派生文件写在原文件旁边（同目录、同基名、换扩展名）。
// 为什么不另建目录：派生资源与原件的生命周期完全绑定（删文档时一起清理），
// 放同目录让"按 url 前缀做权限与穿越校验"的既有逻辑直接复用。
func saveDerivedFile(origURL, ext string, data []byte) (string, error) {
	rel := filepath.Clean(filepath.FromSlash(strings.TrimPrefix(strings.TrimSpace(origURL), "/")))
	if rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) || filepath.IsAbs(rel) {
		return "", hkerr.NotFound("附件路径无效")
	}
	// 与 readUploadedFile 一致：必须落在 DataDir/uploads 内，防目录穿越
	if !strings.HasPrefix(rel, "uploads"+string(os.PathSeparator)) {
		return "", hkerr.NotFound("附件路径无效")
	}
	out := strings.TrimSuffix(filepath.Join(DataDir, rel), filepath.Ext(rel)) + "." + ext
	if err := os.MkdirAll(filepath.Dir(out), 0o755); err != nil {
		return "", hkerr.Internal("创建派生文件目录失败")
	}
	if err := os.WriteFile(out, data, 0o644); err != nil {
		return "", hkerr.Internal("写入派生文件失败")
	}
	relOut, err := filepath.Rel(DataDir, out)
	if err != nil {
		return "", hkerr.Internal("派生文件路径计算失败")
	}
	return "/" + filepath.ToSlash(relOut), nil
}

// ---------- PPTX 外链图片本地化 ----------

// LocalizePptx 对已入库的 .pptx 执行一次外链图片本地化。
//
// 供两条路径复用：
//   - 导入时的 Prepare（新文件）；
//   - POST /api/attachments/pptx-localize（历史文件在首次打开时补做）。
//
// 该操作是幂等的：已经没有外链图片时直接返回，不会重写文件。
func (s *AttachmentService) LocalizePptx(uid uint64, url string) (*exportx.PptxLocalizeResult, error) {
	return s.localizePptx(uid, strings.TrimSpace(url))
}

func (s *AttachmentService) localizePptx(uid uint64, url string) (*exportx.PptxLocalizeResult, error) {
	raw, err := readUploadedFile(url)
	if err != nil {
		return nil, err
	}
	res, out, err := exportx.LocalizePptxImages(raw, exportx.PptxLocalizeOptions{
		// 下载到的图片同时落一份到文件库，便于追溯与复用
		Save: func(name string, data []byte) (string, error) {
			return savePptxAsset(uid, url, name, data)
		},
	})
	if err != nil {
		return res, err
	}
	if !res.Changed || out == nil {
		return res, nil
	}
	if err := replaceUploadedFile(url, out); err != nil {
		return res, err
	}
	return res, nil
}

// savePptxAsset 把从网络下载来的图片作为独立附件入库。
//
// 目录用 pptx-assets 而不是直接堆在同级：一份演示文稿可能带十几张图，
// 独立子目录既避免与原文件同名冲突，也让清理时能整目录删除。
func savePptxAsset(uid uint64, origURL, filename string, data []byte) (string, error) {
	rel := filepath.Clean(filepath.FromSlash(strings.TrimPrefix(strings.TrimSpace(origURL), "/")))
	if rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) || filepath.IsAbs(rel) {
		return "", hkerr.NotFound("附件路径无效")
	}
	if !strings.HasPrefix(rel, "uploads"+string(os.PathSeparator)) {
		return "", hkerr.NotFound("附件路径无效")
	}
	ext := strings.ToLower(filepath.Ext(filename))
	if ext == "" {
		ext = ".png"
	}
	name := uuid.NewString() + ext
	relDir := filepath.Join(filepath.Dir(rel), "pptx-assets")
	absDir := filepath.Join(DataDir, relDir)
	if err := os.MkdirAll(absDir, 0o755); err != nil {
		return "", hkerr.Internal("创建图片目录失败")
	}
	if err := os.WriteFile(filepath.Join(absDir, name), data, 0o644); err != nil {
		return "", hkerr.Internal("写入图片失败")
	}
	storagePath := filepath.ToSlash(filepath.Join(relDir, name))
	if err := repository.CreateAttachment(&model.Attachment{
		UploaderID:  uid,
		Filename:    filename,
		StoragePath: storagePath,
		MimeType:    mimeByExt(ext),
		Size:        int64(len(data)),
		CreatedAt:   time.Now().UTC(),
	}); err != nil {
		// 记录失败不阻断：图已落盘且已嵌入 pptx
		_ = err
	}
	return "/" + storagePath, nil
}

// replaceUploadedFile 原子替换文件库中的文件（同目录临时文件 + rename）。
//
// 直接就地覆盖有风险：写一半失败会毁掉用户刚导入的原件。同目录 rename 在同一文件系统
// 上是原子的，最坏情况也只是保留旧文件。
func replaceUploadedFile(url string, data []byte) error {
	rel := filepath.Clean(filepath.FromSlash(strings.TrimPrefix(strings.TrimSpace(url), "/")))
	if rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) || filepath.IsAbs(rel) {
		return hkerr.NotFound("附件路径无效")
	}
	if !strings.HasPrefix(rel, "uploads"+string(os.PathSeparator)) {
		return hkerr.NotFound("附件路径无效")
	}
	abs := filepath.Join(DataDir, rel)
	tmp, err := os.CreateTemp(filepath.Dir(abs), ".pptx-*.tmp")
	if err != nil {
		return hkerr.Internal("创建临时文件失败")
	}
	tmpName := tmp.Name()
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		_ = os.Remove(tmpName)
		return hkerr.Internal("写入临时文件失败")
	}
	if err := tmp.Close(); err != nil {
		_ = os.Remove(tmpName)
		return hkerr.Internal("写入临时文件失败")
	}
	if err := os.Chmod(tmpName, 0o644); err != nil {
		_ = err
	}
	if err := os.Rename(tmpName, abs); err != nil {
		_ = os.Remove(tmpName)
		return hkerr.Internal("替换原文件失败")
	}
	return nil
}

// truncateNotes 限制提示条数，避免一次导入塞几十行警告把界面顶满。
func truncateNotes(lines []string) []string {
	const max = 3
	if len(lines) <= max {
		return lines
	}
	out := append([]string{}, lines[:max]...)
	return append(out, fmt.Sprintf("另有 %d 项未显示", len(lines)-max))
}
