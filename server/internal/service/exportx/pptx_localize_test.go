package exportx

import (
	"archive/zip"
	"bytes"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// 一张最小可用的 PNG（1×1 透明像素），用来冒充"从网上下回来的图片"。
var testPNG = []byte{
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

const testContentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
</Types>`

const testPresentation = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:sldIdLst><p:sldId id="256" r:id="rId1" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/></p:sldIdLst>
</p:presentation>`

const testPackageRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`

// slide1.xml：图片用 r:link 指向关系项（PowerPoint "链接图片" 的写法）
const testSlide = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
       xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
       xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:cSld><p:spTree>
    <p:pic>
      <p:blipFill><a:blip r:link="rId2"/></p:blipFill>
    </p:pic>
  </p:spTree></p:cSld>
</p:sld>`

func testSlideRels(imgURL string) string {
	return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="` + imgURL + `" TargetMode="External"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="http://example.com/page" TargetMode="External"/>
</Relationships>`
}

// buildTestPptx 造一份结构完整的最小 pptx（含一条外链图片关系与一条外链超链接关系）。
func buildTestPptx(t *testing.T, imgURL string) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	add := func(name, body string) {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatalf("创建条目 %s: %v", name, err)
		}
		if _, err := w.Write([]byte(body)); err != nil {
			t.Fatalf("写入条目 %s: %v", name, err)
		}
	}
	add("[Content_Types].xml", testContentTypes)
	add("_rels/.rels", testPackageRels)
	add("ppt/presentation.xml", testPresentation)
	add("ppt/slides/slide1.xml", testSlide)
	add("ppt/slides/_rels/slide1.xml.rels", testSlideRels(imgURL))
	if err := zw.Close(); err != nil {
		t.Fatalf("关闭 zip: %v", err)
	}
	return buf.Bytes()
}

// readZipEntries 把 zip 字节读成 路径→内容。
func readZipEntries(t *testing.T, data []byte) map[string]string {
	t.Helper()
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatalf("打开结果 zip: %v", err)
	}
	out := map[string]string{}
	for _, f := range zr.File {
		rc, err := f.Open()
		if err != nil {
			t.Fatalf("打开 %s: %v", f.Name, err)
		}
		var b bytes.Buffer
		if _, err := b.ReadFrom(rc); err != nil {
			t.Fatalf("读取 %s: %v", f.Name, err)
		}
		rc.Close()
		out[f.Name] = b.String()
	}
	return out
}

func TestLocalizePptxImagesEmbedsNetworkImage(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/png")
		_, _ = w.Write(testPNG)
	}))
	defer srv.Close()

	src := buildTestPptx(t, srv.URL+"/logo.png")
	var savedName string
	var savedData []byte
	res, out, err := LocalizePptxImages(src, PptxLocalizeOptions{
		Client: srv.Client(),
		Save: func(name string, data []byte) (string, error) {
			savedName, savedData = name, data
			return "/uploads/2026/09/" + name, nil
		},
	})
	if err != nil {
		t.Fatalf("本地化失败: %v", err)
	}
	// 只算图片关系：外链超链接不能被当成图片下载
	if res.External != 1 {
		t.Fatalf("识别到的外链图片数 = %d，期望 1（超链接不应计入）", res.External)
	}
	if res.Embedded != 1 || !res.Changed {
		t.Fatalf("Embedded=%d Changed=%v，期望 1/true（失败项：%v）", res.Embedded, res.Changed, res.Failures)
	}
	if len(res.Assets) != 1 || res.Assets[0] != "/uploads/2026/09/"+savedName {
		t.Fatalf("入库 URL 不符：%v（savedName=%s）", res.Assets, savedName)
	}
	if !bytes.Equal(savedData, testPNG) {
		t.Fatalf("入库内容与下载内容不一致")
	}

	got := readZipEntries(t, out)
	if !strings.Contains(got["ppt/slides/_rels/slide1.xml.rels"], `Target="../media/haiku-net-1.png"`) {
		t.Fatalf("关系项 Target 未改成本地路径：%s", got["ppt/slides/_rels/slide1.xml.rels"])
	}
	// 只看被改写的那一条关系项：超链接那条本来就应该保留 TargetMode
	if el := relElement(t, got["ppt/slides/_rels/slide1.xml.rels"], "rId2"); strings.Contains(el, "TargetMode") {
		t.Fatalf("图片关系项的 TargetMode 应已被移除：%s", el)
	}
	// 必须把 link 改成 embed，否则渲染器不会画出来
	if !strings.Contains(got["ppt/slides/slide1.xml"], `r:embed="rId2"`) ||
		strings.Contains(got["ppt/slides/slide1.xml"], "r:link") {
		t.Fatalf("slide1.xml 的 r:link 未改为 r:embed：%s", got["ppt/slides/slide1.xml"])
	}
	if !bytes.Equal([]byte(got["ppt/media/haiku-net-1.png"]), testPNG) {
		t.Fatalf("压缩包内的图片内容不正确")
	}
	// 原有条目必须原样保留
	for _, keep := range []string{"[Content_Types].xml", "_rels/.rels", "ppt/presentation.xml"} {
		if _, ok := got[keep]; !ok {
			t.Fatalf("条目 %s 在重新打包后丢失", keep)
		}
	}
	// 外链超链接关系必须原样保留（仍然指向 example.com）
	if !strings.Contains(got["ppt/slides/_rels/slide1.xml.rels"], `Target="http://example.com/page"`) {
		t.Fatalf("超链接关系被误改：%s", got["ppt/slides/_rels/slide1.xml.rels"])
	}
	// 结果必须仍是可解析的 zip，且能再次打开
	if _, err := zip.NewReader(bytes.NewReader(out), int64(len(out))); err != nil {
		t.Fatalf("重新打包的结果不是合法 zip: %v", err)
	}
}

func TestLocalizePptxImagesNoExternal(t *testing.T) {
	// 同一份文件里不带外链（把 URL 换成包内相对路径）
	src := buildTestPptx(t, "../media/image1.png")
	res, out, err := LocalizePptxImages(src, PptxLocalizeOptions{})
	if err != nil {
		t.Fatalf("不应报错: %v", err)
	}
	if res.External != 0 || res.Changed || out != nil {
		t.Fatalf("无外链图片时不应改动文件：%+v", res)
	}
	if res.Note() != "演示文稿内没有外链图片" {
		t.Fatalf("说明文案不符：%s", res.Note())
	}
}

func TestLocalizePptxImagesDownloadFailureKeepsOriginal(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "gone", http.StatusNotFound)
	}))
	defer srv.Close()

	src := buildTestPptx(t, srv.URL+"/missing.png")
	res, out, err := LocalizePptxImages(src, PptxLocalizeOptions{Client: srv.Client()})
	if err != nil {
		t.Fatalf("单张下载失败不应导致整体报错: %v", err)
	}
	if res.Embedded != 0 || res.Changed || out != nil {
		t.Fatalf("下载失败时不应改动文件：%+v", res)
	}
	if len(res.Failures) != 1 || !strings.Contains(res.Failures[0], "404") {
		t.Fatalf("失败原因未记录：%v", res.Failures)
	}
	if !strings.Contains(res.Note(), "0/1") {
		t.Fatalf("结果描述不符：%s", res.Note())
	}
}

func TestLocalizePptxImagesRejectsNonImageBody(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		_, _ = w.Write([]byte("<html><body>not an image</body></html>"))
	}))
	defer srv.Close()

	src := buildTestPptx(t, srv.URL+"/page")
	res, out, err := LocalizePptxImages(src, PptxLocalizeOptions{Client: srv.Client()})
	if err != nil {
		t.Fatalf("不应报错: %v", err)
	}
	if res.Embedded != 0 || res.Changed || out != nil {
		t.Fatalf("非图片响应不应被嵌入：%+v", res)
	}
	if len(res.Failures) != 1 || !strings.Contains(res.Failures[0], "不是可识别的图片") {
		t.Fatalf("失败原因不符：%v", res.Failures)
	}
}

func TestLocalizePptxImagesRejectsNonPptx(t *testing.T) {
	if _, _, err := LocalizePptxImages([]byte("this is not a zip"), PptxLocalizeOptions{}); err == nil {
		t.Fatal("非 zip 输入应报错")
	}
	// 是 zip 但缺 ppt/presentation.xml
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	w, _ := zw.Create("word/document.xml")
	_, _ = w.Write([]byte("<w:document/>"))
	_ = zw.Close()
	if _, _, err := LocalizePptxImages(buf.Bytes(), PptxLocalizeOptions{}); err == nil ||
		!strings.Contains(err.Error(), "presentation.xml") {
		t.Fatalf("缺 presentation.xml 时应给出明确错误，实际：%v", err)
	}
}

func TestLocalizePptxImagesDedupesSameURL(t *testing.T) {
	hits := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		_, _ = w.Write(testPNG)
	}))
	defer srv.Close()

	// 两份 slide 引用同一个 URL
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for _, e := range []struct{ name, body string }{
		{"[Content_Types].xml", testContentTypes},
		{"_rels/.rels", testPackageRels},
		{"ppt/presentation.xml", testPresentation},
		{"ppt/slides/slide1.xml", testSlide},
		{"ppt/slides/slide2.xml", testSlide},
		{"ppt/slides/_rels/slide1.xml.rels", testSlideRels(srv.URL + "/same.png")},
		{"ppt/slides/_rels/slide2.xml.rels", testSlideRels(srv.URL + "/same.png")},
	} {
		w, _ := zw.Create(e.name)
		_, _ = w.Write([]byte(e.body))
	}
	_ = zw.Close()

	res, out, err := LocalizePptxImages(buf.Bytes(), PptxLocalizeOptions{Client: srv.Client()})
	if err != nil {
		t.Fatalf("本地化失败: %v", err)
	}
	if res.External != 1 || res.Embedded != 1 {
		t.Fatalf("同一 URL 应只下载一次：%+v", res)
	}
	if hits != 1 {
		t.Fatalf("实际请求了 %d 次，期望 1 次", hits)
	}
	got := readZipEntries(t, out)
	for _, rels := range []string{"ppt/slides/_rels/slide1.xml.rels", "ppt/slides/_rels/slide2.xml.rels"} {
		if !strings.Contains(got[rels], `Target="../media/haiku-net-1.png"`) {
			t.Fatalf("%s 未指向同一份本地图片：%s", rels, got[rels])
		}
	}
}

func TestDetectImageExt(t *testing.T) {
	cases := []struct {
		name string
		data []byte
		want string
	}{
		{"png", testPNG, "png"},
		{"jpg", []byte{0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10}, "jpg"},
		{"gif87", []byte("GIF87a\x01\x00\x01\x00"), "gif"},
		{"gif89", []byte("GIF89a\x01\x00\x01\x00"), "gif"},
		{"bmp", []byte("BM\x36\x00\x00\x00"), "bmp"},
		{"webp", []byte("RIFF\x24\x00\x00\x00WEBPVP8 "), "webp"},
		{"svg", []byte(`<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>`), "svg"},
		{"svg-bom", append([]byte{0xef, 0xbb, 0xbf}, []byte(`<svg xmlns="http://www.w3.org/2000/svg"/>`)...), "svg"},
		{"html 不是图片", []byte("<html>hi</html>"), ""},
		{"空内容", nil, ""},
	}
	for _, c := range cases {
		if got := detectImageExt(c.data); got != c.want {
			t.Errorf("%s: detectImageExt = %q，期望 %q", c.name, got, c.want)
		}
	}
}

func TestCheckPublicIPRejectsNonPublic(t *testing.T) {
	blocked := []string{
		"127.0.0.1", "0.0.0.0", "10.1.2.3", "172.16.5.5", "192.168.1.1",
		"169.254.1.1", "100.64.0.1", "198.18.0.1", "240.0.0.1", "255.255.255.255",
		"::1", "fe80::1", "fc00::1", "ff02::1",
	}
	for _, s := range blocked {
		if err := checkPublicIP(parseTestIP(t, s)); err == nil {
			t.Errorf("%s 应被拒绝，实际放行", s)
		}
	}
	allowed := []string{"8.8.8.8", "1.1.1.1", "93.184.216.34", "2606:4700:4700::1111"}
	for _, s := range allowed {
		if err := checkPublicIP(parseTestIP(t, s)); err != nil {
			t.Errorf("%s 应被放行，实际拒绝：%v", s, err)
		}
	}
}

func TestRelativeRelTarget(t *testing.T) {
	cases := []struct{ dir, abs, want string }{
		{"ppt/slides", "ppt/media/x.png", "../media/x.png"},
		{"ppt/slides", "ppt/slides/x.png", "x.png"},
		{"ppt", "ppt/media/x.png", "media/x.png"},
		{"ppt/slideLayouts", "ppt/media/deep/x.png", "../media/deep/x.png"},
		{"", "ppt/media/x.png", "ppt/media/x.png"},
		{".", "ppt/media/x.png", "ppt/media/x.png"},
	}
	for _, c := range cases {
		if got := relativeRelTarget(c.dir, c.abs); got != c.want {
			t.Errorf("relativeRelTarget(%q, %q) = %q，期望 %q", c.dir, c.abs, got, c.want)
		}
	}
}

func TestRelPartForRels(t *testing.T) {
	cases := []struct{ in, want string }{
		{"ppt/slides/_rels/slide1.xml.rels", "ppt/slides/slide1.xml"},
		{"ppt/_rels/presentation.xml.rels", "ppt/presentation.xml"},
		{"_rels/.rels", ""},
		{"ppt/media/image1.png", ""},
	}
	for _, c := range cases {
		if got := relPartForRels(c.in); got != c.want {
			t.Errorf("relPartForRels(%q) = %q，期望 %q", c.in, got, c.want)
		}
	}
}

func TestRewriteRelTargetOnlyTouchesTargetedRelationship(t *testing.T) {
	body := []byte(`<Relationships xmlns="x">
  <Relationship Id="rId1" Type="t" Target="keep.png"/>
  <Relationship Id="rId2" Type="t" Target="http://a/b.png" TargetMode="External"/>
</Relationships>`)
	out := string(rewriteRelTarget(body, "rId2", "../media/new.png"))
	if !strings.Contains(out, `Target="../media/new.png"`) {
		t.Fatalf("目标关系项未改写：%s", out)
	}
	if strings.Contains(out, "TargetMode") {
		t.Fatalf("TargetMode 未移除：%s", out)
	}
	if !strings.Contains(out, `Id="rId1" Type="t" Target="keep.png"`) {
		t.Fatalf("无关关系项被改动：%s", out)
	}
}

func TestRepackZipRoundTrip(t *testing.T) {
	entries := map[string][]byte{
		"ppt/presentation.xml": []byte("<p:presentation/>"),
		"[Content_Types].xml":  []byte("<Types/>"),
		"_rels/.rels":          []byte("<Relationships/>"),
	}
	out, err := repackZip(entries)
	if err != nil {
		t.Fatalf("重新打包失败: %v", err)
	}
	got := readZipEntries(t, out)
	if len(got) != len(entries) {
		t.Fatalf("条目数不一致：%d != %d", len(got), len(entries))
	}
	for k, v := range entries {
		if got[k] != string(v) {
			t.Fatalf("条目 %s 内容不一致", k)
		}
	}
	// 同一份输入重复打包必须产出完全相同的字节（固定时间戳）
	out2, _ := repackZip(entries)
	if !bytes.Equal(out, out2) {
		t.Fatal("相同输入应产出相同字节流")
	}
}

// relElement 取出某一份 .rels 里指定 Id 的那条 <Relationship .../> 原文。
func relElement(t *testing.T, rels, id string) string {
	t.Helper()
	marker := `Id="` + id + `"`
	i := strings.Index(rels, marker)
	if i < 0 {
		t.Fatalf(".rels 中找不到 %s：%s", marker, rels)
	}
	// 回退到标签起始，前进到标签结束
	start := strings.LastIndex(rels[:i], "<Relationship")
	if start < 0 {
		start = i
	}
	end := strings.Index(rels[i:], "/>")
	if end < 0 {
		t.Fatalf("关系项 %s 不是自闭合标签", id)
	}
	return rels[start : i+end+2]
}

func parseTestIP(t *testing.T, s string) net.IP {
	t.Helper()
	ip := net.ParseIP(s)
	if ip == nil {
		t.Fatalf("无法解析测试地址 %s", s)
	}
	return ip
}
