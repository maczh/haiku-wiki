package service

import (
	"os"
	"path/filepath"
	"strings"

	hkerr "haiku-wiki/server/internal/pkg"
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

// Prepare 生成文档正文所需的 FileRef；CAD 图纸会顺带产出 svg/png。
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
	if !exportx.IsCadExt(ext) {
		// 其余附件（docx/pdf/pptx…）无需服务端派生
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
//
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
