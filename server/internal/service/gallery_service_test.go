package service

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"strings"
	"testing"

	"haiku-wiki/server/internal/model"
	"haiku-wiki/server/internal/repository"
	"haiku-wiki/server/internal/storage"
)

// ---------- 夹具 ----------

func pngBytes(t *testing.T, w, h int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.SetRGBA(x, y, color.RGBA{R: uint8(x % 255), G: uint8(y % 255), B: 90, A: 255})
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func mkGalleryDoc(t *testing.T, book *model.Book, uid uint64) *model.Doc {
	t.Helper()
	d, err := (&DocService{}).CreateDocWithContent(book, uid, 0, "产品图册", "gallery", "")
	if err != nil {
		t.Fatalf("创建图片库失败: %v", err)
	}
	return d
}

// ---------- 批量上传 ----------

func TestGalleryAddImages(t *testing.T) {
	newEnv(t)
	owner := mkUser(t, "g-owner@hk.io", "pwd", "member")
	book := mkBook(t, owner.ID, "图册库", "private")
	doc := mkGalleryDoc(t, book, owner.ID)

	added, rejected, err := (&DocService{}).AddGalleryImages(owner.ID, doc.ID, []GalleryUpload{
		{Name: "sunset.png", Data: pngBytes(t, 2400, 1600)},
	})
	if err != nil || len(added) != 1 || len(rejected) != 0 {
		t.Fatalf("上传应成功: added=%d rejected=%v err=%v", len(added), rejected, err)
	}
	img := added[0]
	if img.ID == "" || img.URL == "" || img.Preview == "" || img.Thumb == "" {
		t.Fatalf("条目字段不完整: %+v", img)
	}
	if img.Degraded {
		t.Fatalf("PNG 不应降级: %+v", img)
	}
	if img.Width != 2400 || img.Height != 1600 {
		t.Fatalf("应上报原图尺寸: %+v", img)
	}
	// 派生图确实落到了存储里（不是只改了内存清单）
	for _, u := range []string{img.URL, img.Preview, img.Thumb} {
		key, err := uploadKey(u)
		if err != nil {
			t.Fatalf("URL 非法 %q: %v", u, err)
		}
		ok, err := storage.Default().Exists(key)
		if err != nil || !ok {
			t.Fatalf("文件应已落盘: %s (exists=%v err=%v)", key, ok, err)
		}
	}

	// 正文落库且可再次解析
	fresh, err := repository.FindDocByID(doc.ID)
	if err != nil {
		t.Fatal(err)
	}
	c := parseGalleryContent(fresh.Content)
	if len(c.Images) != 1 || c.Images[0].ID != img.ID {
		t.Fatalf("正文未正确落库: %s", fresh.Content)
	}

	// 再传一张是追加，不是覆盖
	if _, _, err := (&DocService{}).AddGalleryImages(owner.ID, doc.ID, []GalleryUpload{
		{Name: "night.png", Data: pngBytes(t, 800, 600)},
	}); err != nil {
		t.Fatal(err)
	}
	fresh, _ = repository.FindDocByID(doc.ID)
	if got := len(parseGalleryContent(fresh.Content).Images); got != 2 {
		t.Fatalf("应为 2 张, got %d", got)
	}
}

// 批量上传的核心保障：一张坏掉不影响其余（否则几十张图白传一次）。
func TestGalleryBatchPartialFailure(t *testing.T) {
	newEnv(t)
	owner := mkUser(t, "g-owner2@hk.io", "pwd", "member")
	book := mkBook(t, owner.ID, "图册库2", "private")
	doc := mkGalleryDoc(t, book, owner.ID)

	added, rejected, err := (&DocService{}).AddGalleryImages(owner.ID, doc.ID, []GalleryUpload{
		{Name: "ok.png", Data: pngBytes(t, 600, 400)},
		{Name: "evil.exe", Data: []byte("MZ")},
		{Name: "empty.png", Data: []byte{}},
	})
	if err != nil {
		t.Fatalf("部分失败不应返回错误: %v", err)
	}
	if len(added) != 1 || added[0].Name != "ok.png" {
		t.Fatalf("应只有 1 张成功: %+v", added)
	}
	if len(rejected) != 2 {
		t.Fatalf("应有 2 条拒绝原因: %+v", rejected)
	}
}

// SVG 是矢量：不栅格化，预览/缩略图直接复用原文件（浏览器自己缩放，清晰度无损）。
func TestGallerySVGReusesOriginal(t *testing.T) {
	newEnv(t)
	owner := mkUser(t, "g-owner3@hk.io", "pwd", "member")
	book := mkBook(t, owner.ID, "图册库3", "private")
	doc := mkGalleryDoc(t, book, owner.ID)

	svg := []byte(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600"></svg>`)
	added, _, err := (&DocService{}).AddGalleryImages(owner.ID, doc.ID, []GalleryUpload{{Name: "logo.svg", Data: svg}})
	if err != nil || len(added) != 1 {
		t.Fatalf("SVG 上传应成功: %+v %v", added, err)
	}
	if added[0].Preview != added[0].URL || added[0].Thumb != added[0].URL {
		t.Fatalf("SVG 应直通原件: %+v", added[0])
	}
	if added[0].Degraded {
		t.Fatalf("SVG 不算降级: %+v", added[0])
	}
	if added[0].Width != 800 || added[0].Height != 600 {
		t.Fatalf("应解析出尺寸: %+v", added[0])
	}
}

// 降级路径：HEIC 需要外部转换器，没装时也必须入库（可下载），只是没有预览图。
func TestGalleryDegradedWithoutConverter(t *testing.T) {
	newEnv(t)
	owner := mkUser(t, "g-owner4@hk.io", "pwd", "member")
	book := mkBook(t, owner.ID, "图册库4", "private")
	doc := mkGalleryDoc(t, book, owner.ID)

	added, _, err := (&DocService{}).AddGalleryImages(owner.ID, doc.ID, []GalleryUpload{
		{Name: "photo.heic", Data: []byte("\x00\x00\x00\x18ftypheic")},
	})
	if err != nil || len(added) != 1 {
		t.Fatalf("降级也应入库: %+v %v", added, err)
	}
	img := added[0]
	if !img.Degraded {
		t.Fatalf("应标记为降级（本机无转换器时）: %+v", img)
	}
	if img.URL == "" {
		t.Fatal("降级时原件仍应可下载")
	}
	if img.Note == "" {
		t.Fatal("降级应给出原因，前端要展示给用户")
	}
}

// ---------- 删除与改名 ----------

func TestGalleryRemoveAndRename(t *testing.T) {
	newEnv(t)
	owner := mkUser(t, "g-owner5@hk.io", "pwd", "member")
	book := mkBook(t, owner.ID, "图册库5", "private")
	doc := mkGalleryDoc(t, book, owner.ID)

	added, _, err := (&DocService{}).AddGalleryImages(owner.ID, doc.ID, []GalleryUpload{
		{Name: "a.png", Data: pngBytes(t, 500, 500)},
		{Name: "b.png", Data: pngBytes(t, 500, 500)},
	})
	if err != nil || len(added) != 2 {
		t.Fatalf("上传失败: %+v %v", added, err)
	}
	if err := (&DocService{}).RenameGalleryImage(owner.ID, doc.ID, added[0].ID, "封面图"); err != nil {
		t.Fatalf("改名失败: %v", err)
	}
	fresh, _ := repository.FindDocByID(doc.ID)
	if parseGalleryContent(fresh.Content).Images[0].Name != "封面图" {
		t.Fatal("改名未生效")
	}
	if codeOf(t, (&DocService{}).RenameGalleryImage(owner.ID, doc.ID, added[0].ID, "  ")) != 40001 {
		t.Fatal("空名应被拒")
	}

	key, _ := uploadKey(added[1].URL)
	// a.png 与 b.png 是**同一份字节**（确定性 PNG 夹具）⇒ 内容寻址后共享同一物理对象
	if added[0].URL != added[1].URL {
		t.Fatalf("同内容图片应共享同一物理对象: %q vs %q", added[0].URL, added[1].URL)
	}
	if err := (&DocService{}).RemoveGalleryImage(owner.ID, doc.ID, added[1].ID); err != nil {
		t.Fatalf("删除失败: %v", err)
	}
	fresh, _ = repository.FindDocByID(doc.ID)
	if got := len(parseGalleryContent(fresh.Content).Images); got != 1 {
		t.Fatalf("删除后应剩 1 张, got %d", got)
	}
	// 删除语义（PRD D2 / C2 + 架构 §1.2）：**只删 meta，物理对象一律不删**。
	// 此处该对象仍被 a.png 引用（同一 md5 共用 storage_path），删掉会毁掉 a.png；
	// 且 uploads/cas/ 前缀对象永不删除（孤儿留给 P2-2 清理）。
	if ok, _ := storage.Default().Exists(key); !ok {
		t.Fatal("删除图库条目不得删除物理对象（内容仍被 a.png 引用，且 CAS 前缀对象永不删除）")
	}
	if codeOf(t, (&DocService{}).RemoveGalleryImage(owner.ID, doc.ID, "no-such-id")) != 40401 {
		t.Fatal("删不存在的图应 40401")
	}
}

// ---------- 权限与类型守卫 ----------

func TestGalleryPermissions(t *testing.T) {
	newEnv(t)
	owner := mkUser(t, "g-owner6@hk.io", "pwd", "member")
	other := mkUser(t, "g-other6@hk.io", "pwd", "member")
	book := mkBook(t, owner.ID, "图册库6", "private")
	doc := mkGalleryDoc(t, book, owner.ID)

	_, _, err := (&DocService{}).AddGalleryImages(other.ID, doc.ID, []GalleryUpload{{Name: "x.png", Data: pngBytes(t, 10, 10)}})
	if codeOf(t, err) != 40301 {
		t.Fatalf("无写权限应 40301, got %v", err)
	}
	if codeOf(t, (&DocService{}).RemoveGalleryImage(other.ID, doc.ID, "any")) != 40301 {
		t.Fatal("无写权限不应能删图")
	}
	// 非图片库文档不能当相册用
	md := mkDoc(t, book, owner.ID, 0, "普通文档")
	if codeOf(t, func() error {
		_, _, e := (&DocService{}).AddGalleryImages(owner.ID, md.ID, []GalleryUpload{{Name: "x.png", Data: pngBytes(t, 10, 10)}})
		return e
	}()) != 40001 {
		t.Fatal("非图片库文档应拒绝")
	}
	// 空批
	if codeOf(t, func() error {
		_, _, e := (&DocService{}).AddGalleryImages(owner.ID, doc.ID, nil)
		return e
	}()) != 40001 {
		t.Fatal("空批应拒绝")
	}
}

// 正文被外部写坏（手工改库、迁移残留）时不能让整个图片库打不开。
func TestGalleryToleratesBrokenContent(t *testing.T) {
	c := parseGalleryContent("{not json")
	if len(c.Images) != 0 || c.Version != galleryVersion {
		t.Fatalf("坏 JSON 应回退成空清单: %+v", c)
	}
	c = parseGalleryContent("")
	if c.Images == nil {
		t.Fatal("空正文也应返回非 nil 切片（避免前端 map 时炸掉）")
	}
}

func TestGalleryAllowedExtList(t *testing.T) {
	ext := GalleryAllowedExt()
	if len(ext) == 0 {
		t.Fatal("格式清单不应为空")
	}
	joined := strings.Join(ext, ",")
	for _, want := range []string{"jpg", "png", "gif", "tiff", "webp", "heic", "svg", "psd", "cdr", "ai"} {
		if !strings.Contains(joined, want) {
			t.Fatalf("清单应包含 %s: %v", want, ext)
		}
	}
}
