package service

import (
	"archive/zip"
	"bytes"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// 一张最小 PNG（1×1），冒充"从网上下回来的图片"。
var qaPNG = []byte{
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
	0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
	0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
	0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
	0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
	0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
	0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
	0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
	0x42, 0x60, 0x82,
}

// qaBuildPptx 造一份含外链图片关系的最小 pptx。
func qaBuildPptx(t *testing.T, imgURL string) []byte {
	t.Helper()
	const slide = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
       xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
       xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:cSld><p:spTree><p:pic><p:blipFill><a:blip r:link="rId2"/></p:blipFill></p:pic></p:spTree></p:cSld>
</p:sld>`
	rels := `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="` + imgURL + `" TargetMode="External"/>
</Relationships>`
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for _, e := range []struct{ name, body string }{
		{"[Content_Types].xml", `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`},
		{"_rels/.rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`},
		{"ppt/presentation.xml", `<?xml version="1.0"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>`},
		{"ppt/slides/slide1.xml", slide},
		{"ppt/slides/_rels/slide1.xml.rels", rels},
	} {
		w, err := zw.Create(e.name)
		if err != nil {
			t.Fatalf("创建条目 %s: %v", e.name, err)
		}
		if _, err := w.Write([]byte(e.body)); err != nil {
			t.Fatalf("写入条目 %s: %v", e.name, err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatalf("关闭 zip: %v", err)
	}
	return buf.Bytes()
}

// qaPutUpload 把字节落到 DataDir/uploads/2026/09/<name>，返回可用的 url。
func qaPutUpload(t *testing.T, name string, data []byte) (string, string) {
	t.Helper()
	dir := filepath.Join(DataDir, "uploads", "2026", "09")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatalf("建上传目录失败: %v", err)
	}
	abs := filepath.Join(dir, name)
	if err := os.WriteFile(abs, data, 0o644); err != nil {
		t.Fatalf("写入上传文件失败: %v", err)
	}
	return "/uploads/2026/09/" + name, abs
}

// qaZipEntry 读出 zip 内某条目内容。
func qaZipEntry(t *testing.T, data []byte, name string) string {
	t.Helper()
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatalf("打开 zip 失败: %v", err)
	}
	for _, f := range zr.File {
		if f.Name != name {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			t.Fatalf("打开 %s 失败: %v", name, err)
		}
		defer rc.Close()
		b, _ := io.ReadAll(rc)
		return string(b)
	}
	t.Fatalf("zip 内找不到条目 %s", name)
	return ""
}

// TestPreparePptxLocalizesNetworkImages 覆盖导入链路：
// 前端上传 → Prepare → 下载外链图片 → 写回原文件 → 图片入库。
func TestPreparePptxLocalizesNetworkImages(t *testing.T) {
	newEnv(t)
	owner := mkUser(t, "pptx@x.com", "pass123", "member")

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/png")
		_, _ = w.Write(qaPNG)
	}))
	defer srv.Close()

	src := qaBuildPptx(t, srv.URL+"/logo.png")
	url, abs := qaPutUpload(t, "deck.pptx", src)

	// 测试服务器是 127.0.0.1，默认会被 SSRF 防护拦下 —— 这里显式放开内网，
	// 真正的公网拦截逻辑由 exportx 的单测覆盖。
	t.Setenv("EXPORT_PPTX_IMG_ALLOW_PRIVATE", "1")

	svc := &AttachmentService{}
	out, err := svc.Prepare(owner.ID, PrepareInput{URL: url, Filename: "deck.pptx", Size: int64(len(src))})
	if err != nil {
		t.Fatalf("Prepare 失败: %v", err)
	}
	if !out.Ref.PptxScanned {
		t.Fatal("pptx 应被标记为已完成外链图片扫描")
	}
	if !strings.Contains(out.Ref.Note, "1/1") {
		t.Fatalf("结果说明不符：%q（warning=%q）", out.Ref.Note, out.Warning)
	}

	// 原文件必须已被就地改写
	onDisk, err := os.ReadFile(abs)
	if err != nil {
		t.Fatalf("读取改写后的文件失败: %v", err)
	}
	if !bytes.Contains(onDisk, []byte("haiku-net-1.png")) {
		t.Fatal("改写后的 pptx 内没有嵌入的本地图片")
	}
	if got := qaZipEntry(t, onDisk, "ppt/slides/_rels/slide1.xml.rels"); strings.Contains(got, "TargetMode") {
		t.Fatalf("关系项仍是外部链接：%s", got)
	}
	if got := qaZipEntry(t, onDisk, "ppt/media/haiku-net-1.png"); got != string(qaPNG) {
		t.Fatal("压缩包内的图片内容不正确")
	}
	if got := qaZipEntry(t, onDisk, "ppt/slides/slide1.xml"); !strings.Contains(got, `r:embed="rId2"`) {
		t.Fatalf("r:link 未改为 r:embed：%s", got)
	}
	// 原文件字节数会变（zip 重新打包），但绝不能变成空文件
	if len(onDisk) < 200 {
		t.Fatalf("改写后的文件过小（%d 字节），疑似写坏", len(onDisk))
	}

	// 下载到的图片应已入库到 pptx-assets 子目录
	assetsDir := filepath.Join(DataDir, "uploads", "2026", "09", "pptx-assets")
	names, err := os.ReadDir(assetsDir)
	if err != nil {
		t.Fatalf("图片未入库到 %s: %v", assetsDir, err)
	}
	if len(names) != 1 {
		t.Fatalf("入库图片数 = %d，期望 1", len(names))
	}
	if !strings.HasSuffix(names[0].Name(), ".png") {
		t.Fatalf("入库图片扩展名不符：%s", names[0].Name())
	}

	// 幂等：再跑一次不应改动文件，且识别为"没有外链图片"
	sizeBefore := len(onDisk)
	out2, err := svc.Prepare(owner.ID, PrepareInput{URL: url, Filename: "deck.pptx", Size: int64(len(src))})
	if err != nil {
		t.Fatalf("第二次 Prepare 失败: %v", err)
	}
	if out2.Ref.Note != "演示文稿内没有外链图片" {
		t.Fatalf("第二次结果说明不符：%q", out2.Ref.Note)
	}
	again, _ := os.ReadFile(abs)
	if len(again) != sizeBefore {
		t.Fatalf("重复处理不应改动文件：%d → %d", sizeBefore, len(again))
	}
}

// TestPreparePptxDownloadFailureIsNonFatal 图片下不来时导入仍须成功。
func TestPreparePptxDownloadFailureIsNonFatal(t *testing.T) {
	newEnv(t)
	owner := mkUser(t, "pptx2@x.com", "pass123", "member")

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "nope", http.StatusForbidden)
	}))
	defer srv.Close()

	src := qaBuildPptx(t, srv.URL+"/blocked.png")
	url, abs := qaPutUpload(t, "deck2.pptx", src)
	t.Setenv("EXPORT_PPTX_IMG_ALLOW_PRIVATE", "1")

	svc := &AttachmentService{}
	out, err := svc.Prepare(owner.ID, PrepareInput{URL: url, Filename: "deck2.pptx", Size: int64(len(src))})
	if err != nil {
		t.Fatalf("下载失败不应让导入失败: %v", err)
	}
	if out.Warning == "" || !strings.Contains(out.Warning, "403") {
		t.Fatalf("应给出可读的告警，实际：%q", out.Warning)
	}
	// 文件必须原样保留
	onDisk, _ := os.ReadFile(abs)
	if !bytes.Equal(onDisk, src) {
		t.Fatal("下载失败时不应改动原文件")
	}
}

// TestPrepareRejectsNonPptxWithoutScanning 非 pptx 附件不应被打上扫描标记。
func TestPrepareRejectsNonPptxWithoutScanning(t *testing.T) {
	newEnv(t)
	owner := mkUser(t, "pdf@x.com", "pass123", "member")
	url, _ := qaPutUpload(t, "doc.pdf", []byte("%PDF-1.4\n"))
	svc := &AttachmentService{}
	out, err := svc.Prepare(owner.ID, PrepareInput{URL: url, Filename: "doc.pdf", Size: 9})
	if err != nil {
		t.Fatalf("Prepare 失败: %v", err)
	}
	if out.Ref.PptxScanned {
		t.Fatal("pdf 不应带 pptx 扫描标记")
	}
	if out.Ref.Note != "" {
		t.Fatalf("pdf 不应产生说明：%q", out.Ref.Note)
	}
}

// TestLocalizePptxMissingFile 文件不存在时给出明确的业务错误（供补做接口复用）。
func TestLocalizePptxMissingFile(t *testing.T) {
	newEnv(t)
	svc := &AttachmentService{}
	if _, err := svc.LocalizePptx(1, "/uploads/2026/09/nope.pptx"); codeOf(t, err) != 40401 {
		t.Fatalf("文件不存在应为 40401，实际 %v", err)
	}
	// 越界路径必须被拒
	if _, err := svc.LocalizePptx(1, "/uploads/../../etc/passwd"); codeOf(t, err) != 40401 {
		t.Fatalf("目录穿越应被拒，实际 %v", err)
	}
}
