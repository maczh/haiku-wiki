package service

// T02 / T02b 的验收测试：
//   - casPut 命中 / 未命中（同文件上传两次 → 1 个物理对象、同 URL、2 行 meta 同 storage_path）
//   - saveDerivedFile 的 force 语义（命中即跳过 Put / 强制覆盖）
//   - referenceMeta 引用式入库的 L1 / L2 / L3 三级回退
//   - 删除守卫（共享不删、CAS 不删、extraPrefix 目录清理）
//   - UploadStat 统计口径（累加而非覆盖）

import (
	"archive/zip"
	"bytes"
	"path"
	"strings"
	"testing"

	"haiku-wiki/server/internal/model"
	"haiku-wiki/server/internal/repository"
	"haiku-wiki/server/internal/storage"
)

// ---------- 夹具 ----------

// countObjects 统计某前缀下的物理对象数（List 只返回文件，不含目录）。
func countObjects(t *testing.T, prefix string) int {
	t.Helper()
	items, err := storage.Default().List(prefix)
	if err != nil {
		t.Fatalf("列举 %s 失败: %v", prefix, err)
	}
	return len(items)
}

// casStems 返回 CAS 下每个**物理内容**拥有的对象数：键名去掉派生扩展名后即原件 stem。
// 派生件是「原件键换扩展名」，剥掉派生扩展名后与原件同 stem ⇒ 以此统计"物理对象数"。
func casStems(t *testing.T) map[string]int {
	t.Helper()
	items, err := storage.Default().List(CasPrefix)
	if err != nil {
		t.Fatalf("列举 %s 失败: %v", CasPrefix, err)
	}
	out := map[string]int{}
	for _, it := range items {
		base := path.Base(it.Key)
		for _, ext := range derivedExts {
			if strings.HasSuffix(base, "."+ext) {
				base = strings.TrimSuffix(base, "."+ext)
				break
			}
		}
		out[base]++
	}
	return out
}

// countCasContents 不同物理内容数（同内容的多份派生件只算一份）。
func countCasContents(t *testing.T) int {
	t.Helper()
	return len(casStems(t))
}

func mustExists(t *testing.T, u string, want bool) {
	t.Helper()
	key, err := uploadKey(u)
	if err != nil {
		t.Fatalf("URL 非法 %q: %v", u, err)
	}
	ok, err := storage.Default().Exists(key)
	if err != nil {
		t.Fatalf("Exists(%s) 失败: %v", key, err)
	}
	if ok != want {
		t.Fatalf("Exists(%s) = %v, 期望 %v", key, ok, want)
	}
}

func mkZip(t *testing.T, entries map[string]string) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for name, content := range entries {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatalf("zip create %s: %v", name, err)
		}
		if _, err := w.Write([]byte(content)); err != nil {
			t.Fatalf("zip write %s: %v", name, err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatalf("zip close: %v", err)
	}
	return buf.Bytes()
}

// ---------- casPut：命中 / 未命中 ----------

func TestCasPutSameFileTwiceOnePhysicalObject(t *testing.T) {
	newEnv(t)
	owner := mkUser(t, "cas@hk.io", "pwd", "member")
	data := pngBytes(t, 64, 48)
	us := &UploadService{}

	first, err := us.SaveBytes(owner.ID, "pic.png", data)
	if err != nil {
		t.Fatalf("首次上传失败: %v", err)
	}
	if first.Dedup {
		t.Fatal("首次上传不应标记 dedup")
	}
	if first.MD5 != md5Hex(data) || len(first.MD5) != 32 || strings.ToLower(first.MD5) != first.MD5 {
		t.Fatalf("MD5 应为内容摘要（32 位小写）: %q", first.MD5)
	}
	if !strings.Contains(first.URL, "/"+CasPrefix+"/") {
		t.Fatalf("新上传必须落在 CAS 前缀下: %q", first.URL)
	}

	second, err := us.SaveBytes(owner.ID, "pic-copy.png", data)
	if err != nil {
		t.Fatalf("第二次上传失败: %v", err)
	}
	if !second.Dedup {
		t.Fatal("第二次同内容上传必须是秒传（dedup=true）")
	}
	if second.URL != first.URL {
		t.Fatalf("秒传必须复用同一 URL: %q vs %q", first.URL, second.URL)
	}

	// attachments：2 行 meta，同 md5、同 storage_path
	key := storage.KeyFromURL(first.URL)
	var rows []model.Attachment
	if err := repository.DB().Where("md5 = ?", first.MD5).Find(&rows).Error; err != nil {
		t.Fatalf("查 attachments 失败: %v", err)
	}
	if len(rows) != 2 {
		t.Fatalf("同内容上传两次应留 2 行 meta，实际 %d", len(rows))
	}
	for _, r := range rows {
		if r.StoragePath != key {
			t.Fatalf("两行 meta 必须共享同一 storage_path: %q vs %q", r.StoragePath, key)
		}
	}

	// 物理对象数 = 1（P0-2①）
	if n := countCasContents(t); n != 1 {
		t.Fatalf("CAS 下应只有 1 个物理对象，实际 %d", n)
	}

	// 统计口径（§12.7 / B8：累加而非覆盖）
	st, err := repository.GetUploadStat()
	if err != nil {
		t.Fatalf("读统计失败: %v", err)
	}
	if st.TotalUploads != 2 {
		t.Fatalf("TotalUploads 应累加为 2，实际 %d（若为 1 说明用了 UpdateAll 覆盖）", st.TotalUploads)
	}
	if st.DedupHits != 1 {
		t.Fatalf("DedupHits 应为 1，实际 %d", st.DedupHits)
	}
	if st.SavedBytes != int64(len(data)) {
		t.Fatalf("SavedBytes 应为 %d，实际 %d", len(data), st.SavedBytes)
	}
}

// TestInstantMetaReusesAndValidates 秒传路径：未知 md5 → 40401；大小不符 → 40901。
func TestInstantMetaReusesAndValidates(t *testing.T) {
	newEnv(t)
	owner := mkUser(t, "inst@hk.io", "pwd", "member")
	data := pngBytes(t, 32, 32)
	us := &UploadService{}

	first, err := us.SaveBytes(owner.ID, "i.png", data)
	if err != nil {
		t.Fatal(err)
	}
	// 未知 md5
	if _, err := us.Instant(owner.ID, strings.Repeat("0", 32), "i.png", "image/png", int64(len(data))); codeOf(t, err) != 40401 {
		t.Fatalf("未知 md5 应 40401, got %v", err)
	}
	// 格式非法
	if _, err := us.Instant(owner.ID, "not-a-md5", "i.png", "image/png", 0); codeOf(t, err) != 40001 {
		t.Fatalf("非法 md5 应 40001, got %v", err)
	}
	// 大小不符
	if _, err := us.Instant(owner.ID, first.MD5, "i.png", "image/png", int64(len(data)+1)); codeOf(t, err) != 40901 {
		t.Fatalf("大小不符应 40901, got %v", err)
	}
	// 正常秒传
	out, err := us.Instant(owner.ID, first.MD5, "i2.png", "", int64(len(data)))
	if err != nil {
		t.Fatalf("秒传失败: %v", err)
	}
	if !out.Dedup || out.URL != first.URL || out.MD5 != first.MD5 {
		t.Fatalf("秒传结果错误: %+v (first=%+v)", out, first)
	}
	if n := countCasContents(t); n != 1 {
		t.Fatalf("秒传不得新增物理对象，实际 %d", n)
	}
	// 预检：命中 / 未命中
	if hit, err := us.Precheck(first.MD5, int64(len(data)), "i.png"); err != nil || !hit {
		t.Fatalf("预检应命中: hit=%v err=%v", hit, err)
	}
	if hit, _ := us.Precheck(strings.Repeat("a", 32), int64(len(data)), "i.png"); hit {
		t.Fatal("未知 md5 预检不应命中")
	}
}

// ---------- saveDerivedFile 的 force 语义 ----------

func TestSaveDerivedFileForceSemantics(t *testing.T) {
	newEnv(t)
	owner := mkUser(t, "der@hk.io", "pwd", "member")

	origin, err := (&UploadService{}).SaveBytes(owner.ID, "o.png", []byte("origin-bytes"))
	if err != nil {
		t.Fatal(err)
	}
	url1, err := saveDerivedFile(origin.URL, "preview.jpg", []byte("AAA"), false)
	if err != nil {
		t.Fatalf("首次派生失败: %v", err)
	}
	// force=false：命中即跳过 Put（内容仍是 AAA）
	url2, err := saveDerivedFile(origin.URL, "preview.jpg", []byte("BBB"), false)
	if err != nil {
		t.Fatal(err)
	}
	if url1 != url2 {
		t.Fatalf("派生件键名确定，URL 应不变: %q vs %q", url1, url2)
	}
	got, _ := readUploadedFile(url2)
	if string(got) != "AAA" {
		t.Fatalf("force=false 不得覆盖已有派生件，期望 AAA 实际 %q", got)
	}
	// force=true：强制覆盖，URL 不变
	url3, err := saveDerivedFile(origin.URL, "preview.jpg", []byte("BBB"), true)
	if err != nil {
		t.Fatal(err)
	}
	if url3 != url1 {
		t.Fatalf("force=true 也必须保持 URL 不变: %q vs %q", url3, url1)
	}
	got, _ = readUploadedFile(url3)
	if string(got) != "BBB" {
		t.Fatalf("force=true 应覆盖内容，期望 BBB 实际 %q", got)
	}
}

// ---------- referenceMeta：L1 / L2 / L3 ----------

func TestReferenceMetaL1UsesCacheWithoutRederive(t *testing.T) {
	newEnv(t)
	owner := mkUser(t, "r1@hk.io", "pwd", "member")
	book := mkBook(t, owner.ID, "图册", "private")
	doc := mkGalleryDoc(t, book, owner.ID)
	data := pngBytes(t, 120, 80)

	added, rejected, err := (&DocService{}).AddGalleryImages(owner.ID, doc.ID, []GalleryUpload{{Name: "sun.png", Data: data}})
	if err != nil || len(added) != 1 {
		t.Fatalf("上传失败: added=%d rejected=%v err=%v", len(added), rejected, err)
	}
	img := added[0]

	md5v := md5Hex(data)
	before, err := repository.LoadDerived(md5v)
	if err != nil {
		t.Fatalf("首次上传应写入派生缓存: %v", err)
	}
	if before.App != "gallery" || before.Width != 120 || before.Height != 80 {
		t.Fatalf("缓存字段错误: %+v", before)
	}

	res, err := referenceMeta(owner.ID, "gallery", ReferenceInput{MD5: md5v, Filename: "sun-copy.png", Size: int64(len(data))})
	if err != nil {
		t.Fatalf("引用式入库失败: %v", err)
	}
	if !res.Dedup {
		t.Fatal("引用式必须 dedup=true")
	}
	// 逐字段相同（criterion 6）
	if res.Derived.Preview != img.Preview || res.Derived.Thumb != img.Thumb ||
		res.Derived.Original != img.Original || res.Derived.Width != img.Width ||
		res.Derived.Height != img.Height || res.Derived.Degraded != img.Degraded {
		t.Fatalf("L1 派生元数据应与首次逐字段相同:\n ref=%+v\n img=%+v", res.Derived, img)
	}
	// 未重新派生：缓存行未被改写（criterion 7）
	after, err := repository.LoadDerived(md5v)
	if err != nil {
		t.Fatal(err)
	}
	if !after.UpdatedAt.Equal(before.UpdatedAt) {
		t.Fatalf("L1 命中不应改写缓存（不应重派生）: %v → %v", before.UpdatedAt, after.UpdatedAt)
	}
	// meta 行 +1 且共享 storage_path
	var n int64
	if err := repository.DB().Model(&model.Attachment{}).Where("storage_path = ?", storage.KeyFromURL(img.URL)).Count(&n).Error; err != nil {
		t.Fatal(err)
	}
	if n != 2 {
		t.Fatalf("引用式入库后同路径 meta 应 2 行，实际 %d", n)
	}
	// 物理对象数不变（参考式未写盘/未新增对象）
	if got := countCasContents(t); got != 1 {
		t.Fatalf("引用式入库不得新增物理对象，实际 %d", got)
	}
}

func TestReferenceMetaL2RederivesWhenDerivedFileMissing(t *testing.T) {
	newEnv(t)
	owner := mkUser(t, "r2@hk.io", "pwd", "member")
	book := mkBook(t, owner.ID, "图册2", "private")
	doc := mkGalleryDoc(t, book, owner.ID)
	data := pngBytes(t, 120, 80)

	added, _, err := (&DocService{}).AddGalleryImages(owner.ID, doc.ID, []GalleryUpload{{Name: "sun.png", Data: data}})
	if err != nil || len(added) != 1 {
		t.Fatalf("上传失败: err=%v", err)
	}
	img := added[0]
	md5v := md5Hex(data)

	// 制造 L2：缓存还在，但派生文件被外部清理掉
	if err := storage.Default().Delete(storage.KeyFromURL(img.Preview)); err != nil {
		t.Fatalf("删除派生件失败: %v", err)
	}
	mustExists(t, img.Preview, false)

	res, err := referenceMeta(owner.ID, "gallery", ReferenceInput{MD5: md5v, Filename: "sun2.png", Size: int64(len(data))})
	if err != nil {
		t.Fatalf("L2 兜底失败: %v", err)
	}
	if res.Derived.Preview == "" || res.Derived.Thumb == "" {
		t.Fatalf("L2 应重新派生出预览图: %+v", res.Derived)
	}
	// 派生件已重建，且 URL 与原先一致（键名确定性）
	mustExists(t, img.Preview, true)
	if res.Derived.Preview != img.Preview {
		t.Fatalf("重建后 preview URL 应不变: %q vs %q", res.Derived.Preview, img.Preview)
	}
	if res.Derived.Width != 120 || res.Derived.Height != 80 {
		t.Fatalf("L2 重建的尺寸应正确: %+v", res.Derived)
	}
}

func TestReferenceMetaL3BuildsCacheFromScratch(t *testing.T) {
	newEnv(t)
	owner := mkUser(t, "r3@hk.io", "pwd", "member")
	data := pngBytes(t, 90, 60)

	// 只上传，不进图片库 ⇒ 没有派生缓存行（历史存量语义）
	out, err := (&UploadService{}).SaveBytes(owner.ID, "raw.png", data)
	if err != nil {
		t.Fatal(err)
	}
	md5v := md5Hex(data)
	if _, err := repository.LoadDerived(md5v); err == nil {
		t.Fatal("此时不应有派生缓存行")
	}

	res, err := referenceMeta(owner.ID, "gallery", ReferenceInput{MD5: md5v, Filename: "raw.png", Size: int64(len(data))})
	if err != nil {
		t.Fatalf("L3 兜底失败: %v", err)
	}
	if res.URL != out.URL {
		t.Fatalf("引用式应复用原件 URL: %q vs %q", res.URL, out.URL)
	}
	if res.Derived.Preview == "" || res.Derived.Thumb == "" {
		t.Fatalf("L3 应派生并写入缓存: %+v", res.Derived)
	}
	mustExists(t, res.Derived.Preview, true)
	mustExists(t, res.Derived.Thumb, true)
	// 缓存行已落库
	after, err := repository.LoadDerived(md5v)
	if err != nil {
		t.Fatalf("L3 应写入缓存行: %v", err)
	}
	if after.App != "gallery" || after.Width != 90 || after.Height != 60 {
		t.Fatalf("L3 缓存字段错误: %+v", after)
	}
	// 未知 md5 → 40401
	if _, err := referenceMeta(owner.ID, "gallery", ReferenceInput{MD5: strings.Repeat("f", 32), Filename: "x.png", Size: 1}); codeOf(t, err) != 40401 {
		t.Fatalf("未知 md5 应 40401, got %v", err)
	}
}

// TestReferenceMetaPrototypeZipKeepsEntryAndExtraPrefix 原型 zip 网页包：
// 引用式入库必须复用**同一个**入口页与内页目录（不重解压）。
func TestReferenceMetaPrototypeZipKeepsEntryAndExtraPrefix(t *testing.T) {
	newEnv(t)
	owner := mkUser(t, "rp@hk.io", "pwd", "member")
	book := mkBook(t, owner.ID, "原型库", "private")
	doc := mkProtoDoc(t, book, owner.ID, 0, "需求原型")
	zipData := mkZip(t, map[string]string{
		"index.html":    "<html><body>proto</body></html>",
		"assets/app.js": "console.log('x')",
	})

	added, rejected, err := (&DocService{}).AddPrototypeItems(owner.ID, doc.ID, []PrototypeUpload{
		{Name: "proto.zip", Data: zipData, Title: "首屏需求", Desc: "点击按钮跳转"},
	})
	if err != nil || len(added) != 1 {
		t.Fatalf("上传失败: added=%d rejected=%v err=%v", len(added), rejected, err)
	}
	it := added[0]
	if it.Kind != "html" || it.Entry == "" {
		t.Fatalf("zip 网页包应产出 html 条目与入口页: %+v", it)
	}
	md5v := md5Hex(zipData)
	cache, err := repository.LoadDerived(md5v)
	if err != nil {
		t.Fatalf("应写入派生缓存: %v", err)
	}
	wantPrefix := path.Dir(storage.KeyFromURL(it.Entry)) + "/"
	if cache.ExtraPrefix != wantPrefix {
		t.Fatalf("ExtraPrefix 应由入口页推导: %q != %q", cache.ExtraPrefix, wantPrefix)
	}

	// 记录内页目录的对象数，引用式入库后不应变多（不重解压）
	before := countObjects(t, strings.TrimSuffix(wantPrefix, "/"))

	res, err := referenceMeta(owner.ID, "prototype", ReferenceInput{MD5: md5v, Filename: "proto-copy.zip", Size: int64(len(zipData))})
	if err != nil {
		t.Fatalf("引用式入库失败: %v", err)
	}
	if res.Derived.Entry != it.Entry {
		t.Fatalf("引用式必须复用同一入口页（不重解压）: %q vs %q", res.Derived.Entry, it.Entry)
	}
	if res.Derived.Kind != "html" || res.Derived.ExtraPrefix != cache.ExtraPrefix {
		t.Fatalf("引用式缓存字段错误: %+v", res.Derived)
	}
	if after := countObjects(t, strings.TrimSuffix(wantPrefix, "/")); after != before {
		t.Fatalf("引用式入库不得重新解压产生新内页目录: %d → %d", before, after)
	}

	// 引用条目按缓存填充（ApplyDerivedToPrototypeItem）
	item := ApplyDerivedToPrototypeItem("第二个标题", "描述二", "proto-copy.zip", int64(len(zipData)), res.Derived)
	if item.Entry != it.Entry || item.Kind != "html" || item.Title != "第二个标题" {
		t.Fatalf("引用条目填充错误: %+v", item)
	}
}

// ---------- 删除守卫 ----------

func TestSafeDeleteOwnedSetGuardsSharingAndCAS(t *testing.T) {
	newEnv(t)
	owner := mkUser(t, "gd@hk.io", "pwd", "member")
	st := storage.Default()

	// ① 历史形态路径（非 CAS）+ 两条 meta 引用 → 必须整批跳过
	histKey := "uploads/2026/09/legacy.png"
	if err := st.Put(histKey, []byte("legacy"), "image/png"); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		if err := repository.CreateAttachment(&model.Attachment{
			UploaderID: owner.ID, Filename: "legacy.png", StoragePath: histKey, MimeType: "image/png", Size: 6,
		}); err != nil {
			t.Fatal(err)
		}
	}
	if err := safeDeleteOwnedSet("/"+histKey, nil); err != nil {
		t.Fatalf("守卫执行失败: %v", err)
	}
	if ok, _ := st.Exists(histKey); !ok {
		t.Fatal("被多处引用的历史对象不得删除")
	}

	// 删掉一条 meta → 只剩一条引用 → 允许删除
	var one model.Attachment
	if err := repository.DB().Where("storage_path = ?", histKey).First(&one).Error; err != nil {
		t.Fatal(err)
	}
	if err := repository.DB().Delete(&one).Error; err != nil {
		t.Fatal(err)
	}
	if err := safeDeleteOwnedSet("/"+histKey, nil); err != nil {
		t.Fatalf("守卫执行失败: %v", err)
	}
	if ok, _ := st.Exists(histKey); ok {
		t.Fatal("仅剩一条引用时应删除该对象")
	}

	// ② CAS 前缀下的对象一律不删（D2），即便只有一条 meta
	casPath := CasPrefix + "/ab/abc123-a1b2c3.png"
	if err := st.Put(casPath, []byte("cas"), "image/png"); err != nil {
		t.Fatal(err)
	}
	if err := repository.CreateAttachment(&model.Attachment{
		UploaderID: owner.ID, Filename: "cas.png", StoragePath: casPath, MimeType: "image/png", Size: 3,
	}); err != nil {
		t.Fatal(err)
	}
	if err := safeDeleteOwnedSet("/"+casPath, nil); err != nil {
		t.Fatalf("守卫执行失败: %v", err)
	}
	if ok, _ := st.Exists(casPath); !ok {
		t.Fatal("CAS 物理对象一律不删（D2）")
	}

	// ③ extraPrefixes（zip 内页目录）在非共享时应整目录清理
	originKey := "uploads/prototype/owner-test/origin.zip"
	innerDir := "uploads/prototype/inner-uuid/"
	if err := st.Put(originKey, []byte("zip"), "application/zip"); err != nil {
		t.Fatal(err)
	}
	for _, k := range []string{innerDir + "index.html", innerDir + "assets/app.js"} {
		if err := st.Put(k, []byte("x"), storage.MimeByExt(k)); err != nil {
			t.Fatal(err)
		}
	}
	if err := repository.CreateAttachment(&model.Attachment{
		UploaderID: owner.ID, Filename: "origin.zip", StoragePath: originKey, MimeType: "application/zip", Size: 3,
	}); err != nil {
		t.Fatal(err)
	}
	if err := safeDeleteOwnedSet("/"+originKey, []string{innerDir}); err != nil {
		t.Fatalf("守卫执行失败: %v", err)
	}
	if ok, _ := st.Exists(originKey); ok {
		t.Fatal("非共享原件应被删除")
	}
	if n := countObjects(t, strings.TrimSuffix(innerDir, "/")); n != 0 {
		t.Fatalf("extraPrefix 目录应被清空，残留 %d 个对象", n)
	}

	// ④ safeDeletePrefix 对 CAS 前缀是 no-op
	casDir := CasPrefix + "/cd/"
	if err := st.Put(casDir+"x.png", []byte("y"), "image/png"); err != nil {
		t.Fatal(err)
	}
	if err := safeDeletePrefix(casDir); err != nil {
		t.Fatalf("safeDeletePrefix 失败: %v", err)
	}
	if ok, _ := st.Exists(casDir + "x.png"); !ok {
		t.Fatal("safeDeletePrefix 不得删除 CAS 前缀下的对象")
	}
}

// TestGalleryDeleteIsolatedBetweenDocs 同一内容被两个文档引用时，
// 删除 A 的引用不得影响 B（criterion 10/11）。
func TestGalleryDeleteIsolatedBetweenDocs(t *testing.T) {
	newEnv(t)
	owner := mkUser(t, "iso@hk.io", "pwd", "member")
	book := mkBook(t, owner.ID, "共享库", "private")
	docA := mkGalleryDoc(t, book, owner.ID)
	docB := mkGalleryDoc(t, book, owner.ID)
	data := pngBytes(t, 100, 70)

	addedA, _, err := (&DocService{}).AddGalleryImages(owner.ID, docA.ID, []GalleryUpload{{Name: "same.png", Data: data}})
	if err != nil || len(addedA) != 1 {
		t.Fatalf("A 上传失败: %v", err)
	}
	addedB, _, err := (&DocService{}).AddGalleryImages(owner.ID, docB.ID, []GalleryUpload{{Name: "same.png", Data: data}})
	if err != nil || len(addedB) != 1 {
		t.Fatalf("B 上传失败: %v", err)
	}
	// 同内容 ⇒ 同一物理对象
	if addedA[0].URL != addedB[0].URL {
		t.Fatalf("同内容应共享同一原件 URL: %q vs %q", addedA[0].URL, addedB[0].URL)
	}
	objects := countCasContents(t)
	if objects != 1 {
		t.Fatalf("同内容两次入库应只有 1 个物理对象，实际 %d", objects)
	}

	if err := (&DocService{}).RemoveGalleryImage(owner.ID, docA.ID, addedA[0].ID); err != nil {
		t.Fatalf("删除 A 的图片失败: %v", err)
	}

	// B 的三档 URL 仍可访问
	for _, u := range []string{addedB[0].URL, addedB[0].Preview, addedB[0].Thumb, addedB[0].Original} {
		if u == "" {
			continue
		}
		mustExists(t, u, true)
	}
	if after := countCasContents(t); after != objects {
		t.Fatalf("删除一条引用不得改变物理对象数: %d → %d", objects, after)
	}
	// B 的正文仍包含该条目
	fresh, err := repository.FindDocByID(docB.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(fresh.Content, addedB[0].ID) {
		t.Fatal("B 文档正文应仍保留该条目")
	}
}
