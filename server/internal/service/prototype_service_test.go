package service

import (
	"archive/zip"
	"bytes"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"os"
	"strings"
	"testing"

	"haiku-wiki/server/internal/model"
	"haiku-wiki/server/internal/repository"
)

// mkProtoDoc 造一个需求原型文档（doc_type=prototype）。
func mkProtoDoc(t *testing.T, book *model.Book, uid, parentID uint64, title string) *model.Doc {
	t.Helper()
	d, err := (&DocService{}).CreateDocWithContent(book, uid, parentID, title, "prototype", "")
	if err != nil {
		t.Fatalf("创建原型文档失败: %v", err)
	}
	return d
}

// ---------- 夹具 ----------

func pngFixture(w, h int, c color.RGBA) []byte {
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.SetRGBA(x, y, c)
		}
	}
	var buf bytes.Buffer
	_ = png.Encode(&buf, img)
	return buf.Bytes()
}

// jpegFixture 造一张指定尺寸、指定底色的合法 JPEG（用于内嵌图抽取测试）。
func jpegFixture(t *testing.T, w, h int, c color.RGBA) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.SetRGBA(x, y, c)
		}
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 90}); err != nil {
		t.Fatalf("编码 jpeg 夹具失败: %v", err)
	}
	return buf.Bytes()
}

func htmlZipBytes(t *testing.T) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	_ = zw.Close()
	zw2 := zip.NewWriter(&buf)
	w, _ := zw2.Create("index.html")
	_, _ = w.Write([]byte("<html><body>proto</body></html>"))
	_ = zw2.Close()
	return buf.Bytes()
}

// ---------- 用例 ----------

func TestPrototypeAddImage(t *testing.T) {
	newEnv(t)
	owner := mkUser(t, "po@hk.io", "pwd", "admin")
	book := mkBook(t, owner.ID, "产品库", "private")
	doc := mkProtoDoc(t, book, owner.ID, 0, "需求原型")

	added, rej, err := (&DocService{}).AddPrototypeItems(owner.ID, doc.ID, []PrototypeUpload{
		{Name: "screen.png", Data: pngFixture(800, 600, color.RGBA{R: 10, G: 20, B: 30, A: 255}), Title: "登录页", Desc: "新版登录交互"},
	})
	if err != nil {
		t.Fatalf("加图片原型失败: %v", err)
	}
	if len(added) != 1 || len(rej) != 0 {
		t.Fatalf("应成功 1 条，rejected=%+v", rej)
	}
	it := added[0]
	if it.Kind != "image" {
		t.Fatalf("png 应识别为 image, got %q", it.Kind)
	}
	if it.Title != "登录页" || it.Desc != "新版登录交互" {
		t.Fatalf("标题/描述未保留: %+v", it)
	}
	if it.URL == "" {
		t.Fatal("原件 URL 不应为空")
	}
	if it.Preview == "" || it.Thumb == "" {
		t.Fatal("原生 png 应生成预览图与缩略图")
	}
	if it.ID == "" {
		t.Fatal("item ID 不应为空")
	}
}

func TestPrototypeAddHTMLAndZip(t *testing.T) {
	newEnv(t)
	owner := mkUser(t, "ph@hk.io", "pwd", "admin")
	book := mkBook(t, owner.ID, "产品库", "private")
	doc := mkProtoDoc(t, book, owner.ID, 0, "需求原型")

	// 单页 HTML → 直接嵌入
	added, _, err := (&DocService{}).AddPrototypeItems(owner.ID, doc.ID, []PrototypeUpload{
		{Name: "page.html", Data: []byte("<html><body>x</body></html>"), Title: "落地页"},
	})
	if err != nil {
		t.Fatalf("加 html 原型失败: %v", err)
	}
	if added[0].Kind != "html" || added[0].Entry == "" {
		t.Fatalf("单页 html 应 kind=html 且带 entry: %+v", added[0])
	}

	// Axure 导出的 zip 包 → 解压后嵌入入口页
	added, _, err = (&DocService{}).AddPrototypeItems(owner.ID, doc.ID, []PrototypeUpload{
		{Name: "axure.zip", Data: htmlZipBytes(t), Title: "会员中心原型"},
	})
	if err != nil {
		t.Fatalf("加 zip 原型失败: %v", err)
	}
	if added[0].Kind != "html" || !strings.Contains(added[0].Entry, "index.html") {
		t.Fatalf("zip 应解压并嵌入入口页: %+v", added[0])
	}
}

func TestPrototypeAddProjectFileDegrades(t *testing.T) {
	newEnv(t)
	owner := mkUser(t, "pp@hk.io", "pwd", "admin")
	book := mkBook(t, owner.ID, "产品库", "private")
	doc := mkProtoDoc(t, book, owner.ID, 0, "需求原型")

	// .rp 工程文件：服务端无法渲染 → 降级（保原件、可下载）
	added, _, err := (&DocService{}).AddPrototypeItems(owner.ID, doc.ID, []PrototypeUpload{
		{Name: "flow.rp", Data: []byte("not a real rp, just bytes"), Title: "流程图工程"},
	})
	if err != nil {
		t.Fatalf("加 .rp 失败: %v", err)
	}
	it := added[0]
	if it.Kind != "other" || !it.Degraded {
		t.Fatalf(".rp 应降级为 other+Degraded: %+v", it)
	}
	if it.URL == "" {
		t.Fatal("降级也应保留原件 URL")
	}
}

func TestPrototypeRejectsMissingTitle(t *testing.T) {
	newEnv(t)
	owner := mkUser(t, "pt@hk.io", "pwd", "admin")
	book := mkBook(t, owner.ID, "产品库", "private")
	doc := mkProtoDoc(t, book, owner.ID, 0, "需求原型")

	_, rej, err := (&DocService{}).AddPrototypeItems(owner.ID, doc.ID, []PrototypeUpload{
		{Name: "a.png", Data: pngFixture(10, 10, color.RGBA{R: 0, G: 0, B: 0, A: 255}), Title: ""},
	})
	if err != nil {
		t.Fatalf("不应返回错误: %v", err)
	}
	if len(rej) != 1 || !strings.Contains(rej[0].Reason, "标题") {
		t.Fatalf("缺标题应被拒绝: %+v", rej)
	}
}

func TestPrototypeUpdateAndRemove(t *testing.T) {
	newEnv(t)
	owner := mkUser(t, "pu@hk.io", "pwd", "admin")
	book := mkBook(t, owner.ID, "产品库", "private")
	doc := mkProtoDoc(t, book, owner.ID, 0, "需求原型")
	added, _, err := (&DocService{}).AddPrototypeItems(owner.ID, doc.ID, []PrototypeUpload{
		{Name: "a.png", Data: pngFixture(10, 10, color.RGBA{R: 0, G: 0, B: 0, A: 255}), Title: "初稿", Desc: "old"},
	})
	if err != nil {
		t.Fatalf("加原型失败: %v", err)
	}
	id := added[0].ID

	if err := (&DocService{}).UpdatePrototypeItem(owner.ID, doc.ID, id, "终稿", "new desc"); err != nil {
		t.Fatalf("更新说明失败: %v", err)
	}
	got := parsePrototypeContent(docAfter(t, owner.ID, doc.ID).Content)
	if got.Items[0].Title != "终稿" || got.Items[0].Desc != "new desc" {
		t.Fatalf("更新未生效: %+v", got.Items[0])
	}

	if err := (&DocService{}).RemovePrototypeItem(owner.ID, doc.ID, id); err != nil {
		t.Fatalf("删除原型失败: %v", err)
	}
	got = parsePrototypeContent(docAfter(t, owner.ID, doc.ID).Content)
	if len(got.Items) != 0 {
		t.Fatalf("删除后应无原型, got %+v", got.Items)
	}
}

// docAfter 重新从库里读出文档（Add/Update/Remove 改的是传入指针，这里拿最新持久化状态）。
func docAfter(t *testing.T, uid, docID uint64) *model.Doc {
	t.Helper()
	d, err := repository.FindDocByID(docID)
	if err != nil {
		t.Fatalf("读文档失败: %v", err)
	}
	return d
}

// ---------- 内嵌图抽取（Bug 修复）----------

// fakeRP 把一段合法 JPEG 塞进任意二进制里，伪装成 Axure .rp 专有容器。
func fakeRP(t *testing.T, jpeg []byte) []byte {
	t.Helper()
	var b bytes.Buffer
	b.WriteString("AC EF 09 00 Axure proprietary binary header \x00\x01\x02\x03")
	b.Write(jpeg)
	b.WriteString("trailing garbage \xFF\x00\xFF\xD9 padding")
	return b.Bytes()
}

// TestBuildProjectArchiveExtractsEmbeddedJPEG 非 ZIP 但内含 JPEG 字节的 .rp，应抽出预览图。
func TestBuildProjectArchiveExtractsEmbeddedJPEG(t *testing.T) {
	newEnv(t)
	jpeg := jpegFixture(t, 256, 251, color.RGBA{R: 200, G: 100, B: 50, A: 255})
	fake := fakeRP(t, jpeg)

	it, err := buildProjectArchive(1, fake, &PrototypeItem{Filename: "demo.rp"})
	if err != nil {
		t.Fatalf("buildProjectArchive 失败: %v", err)
	}
	if it.Degraded {
		t.Fatalf("含内嵌 JPEG 的 .rp 不应降级: %+v", it)
	}
	if it.Kind != "other" {
		t.Fatalf("kind 应为 other（工程文件）, got %q", it.Kind)
	}
	if it.Preview == "" {
		t.Fatalf("应抽到预览图: %+v", it)
	}
	if it.Thumb == "" {
		t.Fatalf("应派生缩略图: %+v", it)
	}
	if it.URL == "" {
		t.Fatal("应保留原件 URL 供下载")
	}
	if it.Original == "" {
		t.Fatalf("应产出 original 全分辨率图: %+v", it)
	}
	// 回归：native() 曾漏掉 Original，导致 original.jpg 是 0 字节空文件
	if data, e := readUploadedFile(it.Original); e != nil || len(data) == 0 {
		t.Fatalf("original 应落盘且非空: err=%v len=%d", e, len(data))
	}
	if it.Note != "已抽取 Axure 内置预览图" {
		t.Fatalf("Note 不符: %q", it.Note)
	}
}

// TestBuildProjectArchiveIgnoresTinyIcons 内嵌图太小（<120px）应视为图标跳过，最终降级。
func TestBuildProjectArchiveIgnoresTinyIcons(t *testing.T) {
	newEnv(t)
	// 16×16 小图标，远小于 minEmbeddedLong，不应被当成可用预览
	tiny := jpegFixture(t, 16, 16, color.RGBA{R: 0, G: 0, B: 0, A: 255})
	fake := fakeRP(t, tiny)

	it, err := buildProjectArchive(1, fake, &PrototypeItem{Filename: "icons.rp"})
	if err != nil {
		t.Fatalf("buildProjectArchive 失败: %v", err)
	}
	if !it.Degraded {
		t.Fatalf("只有小图标时应降级: %+v", it)
	}
	if it.Preview != "" {
		t.Fatalf("不应抽到预览图: %+v", it)
	}
}

// TestBuildProjectArchiveNoEmbeddedImageDegrades 完全没有内嵌图的非 ZIP，应保留原降级行为。
func TestBuildProjectArchiveNoEmbeddedImageDegrades(t *testing.T) {
	newEnv(t)
	raw := []byte("not a real rp, just some binary without any embedded image \x00\xFF\xD8garbage")
	it, err := buildProjectArchive(1, raw, &PrototypeItem{Filename: "flow.rp"})
	if err != nil {
		t.Fatalf("buildProjectArchive 失败: %v", err)
	}
	if !it.Degraded {
		t.Fatalf("无内嵌图应降级: %+v", it)
	}
	if it.Kind != "other" {
		t.Fatalf("kind 应为 other, got %q", it.Kind)
	}
	if it.Preview != "" {
		t.Fatalf("降级不应有预览图: %+v", it)
	}
	if it.URL == "" {
		t.Fatal("降级也应保留原件 URL")
	}
}

// TestBuildProjectArchiveRealRP 集成样例：用真实 .rp 验证能抽到预览图（文件缺失则跳过）。
func TestBuildProjectArchiveRealRP(t *testing.T) {
	newEnv(t)
	const path = "/Users/macro/Documents/打印小票功能(1).rp"
	data, err := os.ReadFile(path)
	if err != nil {
		t.Skipf("真实 .rp 样例缺失，跳过集成验证: %v", err)
	}
	it, err := buildProjectArchive(1, data, &PrototypeItem{Filename: "打印小票功能.rp"})
	if err != nil {
		t.Fatalf("buildProjectArchive 失败: %v", err)
	}
	if it.Degraded {
		t.Fatalf("真实 .rp 应抽到预览图而不降级: %+v", it)
	}
	if it.Preview == "" {
		t.Fatalf("真实 .rp 应抽到预览图: %+v", it)
	}
}
