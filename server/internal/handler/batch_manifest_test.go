package handler

// T03b 验收测试：批量入口（图片库 / 原型）的 manifest 两阶段协议。
//
// 覆盖点（与派单一致）：
//   - `parseManifest` 六组边界：0 文件 / 全 ref / 全 file / 混合 / 少传（fileCount 不足）
//     / 多传（fileCount 超出）
//   - 非法 JSON、非法 kind、非法 ref md5、缺文件名、size 为负 → **40001 整批拒绝**
//   - manifest 缺省 → 退化为改造前的纯字节契约（`mode=bytes`）
//   - 端到端：混合提交下**条目顺序与标题严格按 manifest 对齐**（§12.5，本协议最大风险点）
//   - 端到端：`len(files) != kind=file 条数` → 40001，且**文档正文一字未改**（§R13）
//
// 交接点：`attachment_derived` 缓存 + CAS 是「引用式入库」的前提，因此端到端用例先走一次
// 真实上传把缓存种下，再以 `kind=ref` 引用它 —— 不打桩仓储/存储，契约测试才有意义。

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"haiku-wiki/server/internal/middleware"
	"haiku-wiki/server/internal/model"
	"haiku-wiki/server/internal/repository"
	"haiku-wiki/server/internal/service"

	hkerr "haiku-wiki/server/internal/pkg"
)

// ---------- 夹具 ----------

// mpFile 一个 multipart 文件分片。
type mpFile struct {
	field string
	name  string
	data  []byte
}

// batchRouter 只装配被测的两条批量路由；uid 直接塞进 gin context 模拟 JWT 中间件。
func batchRouter(uid uint64) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	g := r.Group("", func(c *gin.Context) {
		c.Set(middleware.CtxUID, uid)
		c.Next()
	})
	g.POST("/api/docs/:id/gallery/images", GalleryAddImages)
	g.POST("/api/docs/:id/prototype/items", PrototypeAddItems)
	return r
}

// postMultipart 发一个 multipart 请求（fields 为普通字段，files 为文件分片，**顺序即提交顺序**）。
func postMultipart(t *testing.T, r *gin.Engine, path string, fields map[string]string, files []mpFile) (int, apiResp, string) {
	t.Helper()
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	for k, v := range fields {
		if err := w.WriteField(k, v); err != nil {
			t.Fatalf("写字段失败: %v", err)
		}
	}
	for _, f := range files {
		fw, err := w.CreateFormFile(f.field, f.name)
		if err != nil {
			t.Fatalf("写文件分片失败: %v", err)
		}
		if _, err := fw.Write(f.data); err != nil {
			t.Fatalf("写文件内容失败: %v", err)
		}
	}
	if err := w.Close(); err != nil {
		t.Fatalf("关闭 multipart 失败: %v", err)
	}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, path, &buf)
	req.Header.Set("Content-Type", w.FormDataContentType())
	r.ServeHTTP(rec, req)
	raw := rec.Body.String()
	var out apiResp
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		t.Fatalf("响应不是合法 JSON: %v\n原文: %s", err, raw)
	}
	return rec.Code, out, raw
}

// testPNG 造一张确定性 PNG（内容不同 → md5 不同）。
func testPNG(t *testing.T, w, h, seed int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.SetRGBA(x, y, color.RGBA{R: uint8((x*7 + seed) % 255), G: uint8((y*11 + seed) % 255), B: uint8(seed % 255), A: 255})
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatalf("编码 PNG 失败: %v", err)
	}
	return buf.Bytes()
}

// mkBatchDoc 建一个指定类型（gallery / prototype）的文档。
func mkBatchDoc(t *testing.T, uid uint64, docType string) *model.Doc {
	t.Helper()
	b, err := (&service.BookService{}).Create(uid, "批量测试库", "", "", "private")
	if err != nil {
		t.Fatalf("创建知识库失败: %v", err)
	}
	d, err := (&service.DocService{}).CreateDocWithContent(b, uid, 0, "批量文档", docType, "")
	if err != nil {
		t.Fatalf("创建文档失败: %v", err)
	}
	return d
}

// docContent 读回文档正文原文（用于「一字未改」与「顺序对齐」断言）。
func docContent(t *testing.T, docID uint64) string {
	t.Helper()
	d, err := repository.FindDocByID(docID)
	if err != nil {
		t.Fatalf("读回文档失败: %v", err)
	}
	return d.Content
}

func manifestJSON(t *testing.T, entries ...map[string]any) string {
	t.Helper()
	b, err := json.Marshal(entries)
	if err != nil {
		t.Fatalf("序列化 manifest 失败: %v", err)
	}
	return string(b)
}

// assertCode 断言业务错误码（40001 等）。
func assertCode(t *testing.T, err error, want int) {
	t.Helper()
	if err == nil {
		t.Fatalf("期望业务错误 code=%d，实际为 nil", want)
	}
	var ae *hkerr.AppError
	if !errors.As(err, &ae) {
		t.Fatalf("期望 AppError，实际 %T: %v", err, err)
	}
	if ae.Code != want {
		t.Fatalf("期望 code=%d，实际 code=%d msg=%s", want, ae.Code, ae.Message)
	}
}

// sumResult 解析响应里的 summary。
func sumResult(t *testing.T, out apiResp) BatchSummary {
	t.Helper()
	var data struct {
		Mode    string       `json:"mode"`
		Summary BatchSummary `json:"summary"`
	}
	if err := json.Unmarshal(out.Data, &data); err != nil {
		t.Fatalf("解析 data 失败: %v", err)
	}
	return data.Summary
}

// ---------- parseManifest：六组边界 ----------

func TestParseManifestZeroEntries(t *testing.T) {
	// 缺省 manifest（旧契约）→ nil
	for _, raw := range []string{"", "   ", "\n"} {
		got, err := parseManifest(raw, 3)
		if err != nil || got != nil {
			t.Fatalf("缺省 manifest 应返回 (nil, nil)，实际 (%v, %v)", got, err)
		}
	}
	// 显式空数组 + 0 字节 → 合法空批次（不报错，由调用方判「无内容可传」）
	got, err := parseManifest("[]", 0)
	if err != nil {
		t.Fatalf("空 manifest 不应报错: %v", err)
	}
	if len(got) != 0 {
		t.Fatalf("空 manifest 应解析为空切片，实际 %d 条", len(got))
	}
	// 空数组但带了字节 → file 条数不符 → 整批拒绝
	if _, err := parseManifest("[]", 1); err == nil {
		t.Fatal("manifest 声明 0 个文件却收到 1 个，应整批拒绝")
	} else {
		assertCode(t, err, 40001)
	}
}

func TestParseManifestAllRef(t *testing.T) {
	raw := manifestJSON(t,
		map[string]any{"kind": "ref", "md5": strings.Repeat("a", 32), "name": "a.png", "size": 10},
		map[string]any{"kind": "ref", "md5": strings.Repeat("B", 32), "name": "b.png", "size": 20},
	)
	got, err := parseManifest(raw, 0)
	if err != nil {
		t.Fatalf("全 ref 应解析成功: %v", err)
	}
	if len(got) != 2 || got[0].Kind != "ref" || got[1].Kind != "ref" {
		t.Fatalf("全 ref 解析不符: %+v", got)
	}
	// md5 归一为小写（大写输入不应被拒）
	if got[1].MD5 != strings.Repeat("b", 32) {
		t.Fatalf("md5 应归一为小写，实际 %s", got[1].MD5)
	}
	if got[0].Name != "a.png" || got[0].Size != 10 {
		t.Fatalf("name/size 未被保留: %+v", got[0])
	}
}

func TestParseManifestAllFile(t *testing.T) {
	raw := manifestJSON(t,
		map[string]any{"kind": "file", "name": "a.png", "size": 1},
		map[string]any{"kind": "file", "name": "b.png", "size": 2},
	)
	got, err := parseManifest(raw, 2)
	if err != nil {
		t.Fatalf("全 file 应解析成功: %v", err)
	}
	if len(got) != 2 || got[0].Kind != "file" || got[1].Kind != "file" {
		t.Fatalf("全 file 解析不符: %+v", got)
	}
}

func TestParseManifestMixedOrderPreserved(t *testing.T) {
	raw := manifestJSON(t,
		map[string]any{"kind": "ref", "md5": strings.Repeat("1", 32), "name": "r0.png", "size": 1},
		map[string]any{"kind": "file", "name": "f1.html", "size": 2},
		map[string]any{"kind": "ref", "md5": strings.Repeat("2", 32), "name": "r2.html", "size": 3},
		map[string]any{"kind": "file", "name": "f3.png", "size": 4},
	)
	got, err := parseManifest(raw, 2)
	if err != nil {
		t.Fatalf("混合提交应解析成功: %v", err)
	}
	want := []string{"ref", "file", "ref", "file"}
	if len(got) != len(want) {
		t.Fatalf("条数不符: %d", len(got))
	}
	for i := range want {
		if got[i].Kind != want[i] {
			t.Fatalf("第 %d 条 kind 应为 %s，实际 %s（顺序必须原样保留）", i, want[i], got[i].Kind)
		}
	}
	if got[0].Name != "r0.png" || got[1].Name != "f1.html" || got[2].Name != "r2.html" || got[3].Name != "f3.png" {
		t.Fatalf("条目顺序/名称错位: %+v", got)
	}
}

func TestParseManifestFileCountTooFew(t *testing.T) {
	// manifest 声明 2 个待传输文件，实际只收到 1 个 → 少传（字节与条目错位，必须整批拒绝）
	raw := manifestJSON(t,
		map[string]any{"kind": "file", "name": "a.png", "size": 1},
		map[string]any{"kind": "file", "name": "b.png", "size": 2},
	)
	_, err := parseManifest(raw, 1)
	assertCode(t, err, 40001)
	if !strings.Contains(err.Error(), "2") || !strings.Contains(err.Error(), "1") {
		t.Fatalf("错误文案应同时给出声明数与实收数: %v", err)
	}
}

func TestParseManifestFileCountTooMany(t *testing.T) {
	// manifest 只声明 1 个待传输文件，实际收到 2 个 → 多传
	raw := manifestJSON(t, map[string]any{"kind": "file", "name": "a.png", "size": 1})
	_, err := parseManifest(raw, 2)
	assertCode(t, err, 40001)
}

// ---------- parseManifest：非法输入 ----------

func TestParseManifestInvalid(t *testing.T) {
	cases := []struct {
		name string
		raw  string
	}{
		{"非法 JSON", `{`},
		{"尾部多余内容", `[{"kind":"file","name":"a","size":1}] {"x":1}`},
		{"非数组", `{"kind":"file"}`},
		{"非法 kind", manifestJSON(t, map[string]any{"kind": "image", "name": "a.png", "size": 1})},
		{"空 kind", manifestJSON(t, map[string]any{"kind": "", "name": "a.png", "size": 1})},
		{"kind 大小写敏感", manifestJSON(t, map[string]any{"kind": "REF", "md5": strings.Repeat("a", 32), "name": "a.png", "size": 1})},
		{"ref md5 位数不足", manifestJSON(t, map[string]any{"kind": "ref", "md5": strings.Repeat("a", 31), "name": "a.png", "size": 1})},
		{"ref md5 非 hex", manifestJSON(t, map[string]any{"kind": "ref", "md5": strings.Repeat("z", 32), "name": "a.png", "size": 1})},
		{"ref md5 缺失", manifestJSON(t, map[string]any{"kind": "ref", "name": "a.png", "size": 1})},
		{"缺文件名", manifestJSON(t, map[string]any{"kind": "file", "name": "  ", "size": 1})},
		{"size 为负", manifestJSON(t, map[string]any{"kind": "file", "name": "a.png", "size": -1})},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := parseManifest(tc.raw, 1)
			assertCode(t, err, 40001)
		})
	}
}

// ---------- summarize ----------

func TestSummarize(t *testing.T) {
	// 契约（§12.2.2）：summary = {received, referenced, written}
	//  - received  = 实际收到的文件段数
	//  - referenced = manifest 中 kind=ref 的条数 − refFailed（下限 0）
	//  - written   = 实际新写的 CAS 对象数
	// 旧契约（manifest 缺省）：没有引用式入库，Referenced 恒为 0
	s := summarize(nil, 3, 1, 0)
	if s.Received != 3 || s.Referenced != 0 || s.Written != 0 {
		t.Fatalf("旧契约汇总不符: %+v", s)
	}
	// 两阶段：manifest = 2 ref + 1 file；实际收到 1 个文件段、0 个 ref 失败、新写 2 个对象
	m := []BatchManifestEntry{
		{Kind: "ref", MD5: strings.Repeat("a", 32), Name: "a", Size: 1},
		{Kind: "file", Name: "b", Size: 2},
		{Kind: "ref", MD5: strings.Repeat("b", 32), Name: "c", Size: 3},
	}
	s = summarize(m, 1, 0, 2)
	if s.Received != 1 || s.Referenced != 2 || s.Written != 2 {
		t.Fatalf("两阶段汇总不符: %+v", s)
	}
	// refFailed 多于 ref 条数时 Referenced 下限为 0（不出现负数）
	s = summarize(m, 1, 3, 1)
	if s.Referenced != 0 {
		t.Fatalf("Referenced 应被下限截断为 0，实际 %d", s.Referenced)
	}
	// 部分 ref 失败：2 个 ref 失败 1 个 → Referenced = 1
	s = summarize(m, 1, 1, 1)
	if s.Referenced != 1 {
		t.Fatalf("Referenced 应为 2-1=1，实际 %d", s.Referenced)
	}
}

// ---------- 端到端：原型混合提交（标题对齐） ----------

func TestPrototypeManifestMixedAlignment(t *testing.T) {
	testEnv(t)
	u := mkTestUser(t, 1)
	doc := mkBatchDoc(t, u.ID, "prototype")
	r := batchRouter(u.ID)

	// 种内容：走一次真实上传（旧契约，无 manifest），把 CAS 原件 + 派生缓存准备好。
	seedA := []byte("<!doctype html><html><body>seed-A</body></html>")
	_, out, _ := postMultipart(t, r, fmt.Sprintf("/api/docs/%d/prototype/items", doc.ID),
		map[string]string{"titles": `["种子"]`, "descs": `["seed"]`},
		[]mpFile{{field: "files", name: "seed.html", data: seedA}},
	)
	if out.Code != 0 {
		t.Fatalf("种子上传失败: code=%d msg=%s", out.Code, out.Message)
	}
	md5A := md5Of(seedA)

	fileB := []byte("<!doctype html><html><body>fresh-B</body></html>")

	manifest := manifestJSON(t,
		map[string]any{"kind": "ref", "md5": md5A, "name": "a.html", "size": len(seedA)},
		map[string]any{"kind": "file", "name": "b.html", "size": len(fileB)},
		map[string]any{"kind": "ref", "md5": md5A, "name": "a2.html", "size": len(seedA)},
	)
	_, out, raw := postMultipart(t, r, fmt.Sprintf("/api/docs/%d/prototype/items", doc.ID),
		map[string]string{
			"manifest": manifest,
			"titles":   `["T0","T1","T2"]`,
			"descs":    `["D0","D1","D2"]`,
		},
		[]mpFile{{field: "files", name: "b.html", data: fileB}},
	)
	if out.Code != 0 {
		t.Fatalf("混合提交失败: code=%d msg=%s raw=%s", out.Code, out.Message, raw)
	}

	// 响应：mode=manifest，summary 计数正确
	var data struct {
		Items    []service.PrototypeItem   `json:"items"`
		Rejected []service.PrototypeReject `json:"rejected"`
		Mode     string                    `json:"mode"`
		Summary  BatchSummary              `json:"summary"`
	}
	if err := json.Unmarshal(out.Data, &data); err != nil {
		t.Fatalf("解析 data 失败: %v", err)
	}
	if data.Mode != "manifest" {
		t.Fatalf("mode 应为 manifest，实际 %q", data.Mode)
	}
	if len(data.Rejected) != 0 {
		t.Fatalf("不应有拒绝条目: %+v", data.Rejected)
	}
	if len(data.Items) != 3 {
		t.Fatalf("应入库 3 条，实际 %d", len(data.Items))
	}
	if data.Summary.Received != 1 || data.Summary.Referenced != 2 || data.Summary.Written != 1 {
		t.Fatalf("summary 不符: %+v", data.Summary)
	}

	// 核心断言：标题/文件名按 manifest 下标严格对齐（不串位）
	wantTitle := []string{"T0", "T1", "T2"}
	wantName := []string{"a.html", "b.html", "a2.html"}
	wantDedup := []bool{true, false, true}
	for i, it := range data.Items {
		if it.Title != wantTitle[i] || it.Filename != wantName[i] {
			t.Fatalf("第 %d 条错位：title=%q filename=%q（期望 %q / %q）",
				i, it.Title, it.Filename, wantTitle[i], wantName[i])
		}
		if it.Dedup != wantDedup[i] {
			t.Fatalf("第 %d 条 dedup 应为 %v，实际 %v", i, wantDedup[i], it.Dedup)
		}
	}

	// 落库正文同样按顺序对齐
	var persisted struct {
		Items []service.PrototypeItem `json:"items"`
	}
	raw2, err := repository.FindDocByID(doc.ID)
	if err != nil {
		t.Fatalf("读回文档失败: %v", err)
	}
	if err := json.Unmarshal([]byte(raw2.Content), &persisted); err != nil {
		t.Fatalf("解析正文失败: %v\n正文: %s", err, raw2.Content)
	}
	if len(persisted.Items) != 4 { // 种子 1 + 本次 3
		t.Fatalf("正文应有 4 条，实际 %d", len(persisted.Items))
	}
	for i, it := range persisted.Items[1:] {
		if it.Title != wantTitle[i] || it.Filename != wantName[i] {
			t.Fatalf("落库第 %d 条错位：%+v", i, it)
		}
	}
}

// TestPrototypeManifestCountMismatchRejectsWholeBatch 少传/多传必须整批拒绝，且**正文一字未改**。
func TestPrototypeManifestCountMismatchRejectsWholeBatch(t *testing.T) {
	testEnv(t)
	u := mkTestUser(t, 1)
	doc := mkBatchDoc(t, u.ID, "prototype")
	r := batchRouter(u.ID)

	before := docContent(t, doc.ID)
	path := fmt.Sprintf("/api/docs/%d/prototype/items", doc.ID)

	// 少传：声明 2 个 file，只给 1 个
	man := manifestJSON(t,
		map[string]any{"kind": "file", "name": "a.html", "size": 1},
		map[string]any{"kind": "file", "name": "b.html", "size": 2},
	)
	_, out, _ := postMultipart(t, r, path,
		map[string]string{"manifest": man, "titles": `["T0","T1"]`},
		[]mpFile{{field: "files", name: "a.html", data: []byte("<html>a</html>")}},
	)
	if out.Code != 40001 {
		t.Fatalf("少传应 40001，实际 code=%d msg=%s", out.Code, out.Message)
	}
	if got := docContent(t, doc.ID); got != before {
		t.Fatalf("整批拒绝时正文不得改动\n前: %s\n后: %s", before, got)
	}

	// 多传：声明 1 个 file，给 2 个
	man = manifestJSON(t, map[string]any{"kind": "file", "name": "a.html", "size": 1})
	_, out, _ = postMultipart(t, r, path,
		map[string]string{"manifest": man, "titles": `["T0"]`},
		[]mpFile{
			{field: "files", name: "a.html", data: []byte("<html>a</html>")},
			{field: "files", name: "b.html", data: []byte("<html>b</html>")},
		},
	)
	if out.Code != 40001 {
		t.Fatalf("多传应 40001，实际 code=%d msg=%s", out.Code, out.Message)
	}
	if got := docContent(t, doc.ID); got != before {
		t.Fatalf("整批拒绝时正文不得改动\n前: %s\n后: %s", before, got)
	}
}

// ---------- 端到端：图片库（旧契约向后兼容 + 引用式入库） ----------

func TestGalleryLegacyAndManifest(t *testing.T) {
	testEnv(t)
	u := mkTestUser(t, 1)
	doc := mkBatchDoc(t, u.ID, "gallery")
	r := batchRouter(u.ID)
	path := fmt.Sprintf("/api/docs/%d/gallery/images", doc.ID)

	// ① 旧契约：只给 files[]，不带 manifest → mode=bytes，仍能入库
	seed := testPNG(t, 64, 48, 1)
	_, out, raw := postMultipart(t, r, path, nil, []mpFile{{field: "files", name: "seed.png", data: seed}})
	if out.Code != 0 {
		t.Fatalf("旧契约上传失败: code=%d msg=%s raw=%s", out.Code, out.Message, raw)
	}
	var legacy struct {
		Images  []service.GalleryImage `json:"images"`
		Mode    string                 `json:"mode"`
		Summary BatchSummary           `json:"summary"`
	}
	if err := json.Unmarshal(out.Data, &legacy); err != nil {
		t.Fatalf("解析 data 失败: %v", err)
	}
	if legacy.Mode != "legacy" { // §12.2.2：mode 取值是 manifest | legacy（无 manifest = legacy）
		t.Fatalf("无 manifest 时 mode 应为 bytes，实际 %q", legacy.Mode)
	}
	if len(legacy.Images) != 1 || legacy.Summary.Received != 1 || legacy.Summary.Written != 1 || legacy.Summary.Referenced != 0 {
		t.Fatalf("旧契约入库不符: images=%d summary=%+v", len(legacy.Images), legacy.Summary)
	}

	// ② 两阶段：ref(已有) + file(新图) → 字节只传新图，ref 不写盘
	fresh := testPNG(t, 64, 48, 2)
	man := manifestJSON(t,
		map[string]any{"kind": "ref", "md5": md5Of(seed), "name": "seed.png", "size": len(seed)},
		map[string]any{"kind": "file", "name": "fresh.png", "size": len(fresh)},
	)
	_, out, raw = postMultipart(t, r, path,
		map[string]string{"manifest": man},
		[]mpFile{{field: "files", name: "fresh.png", data: fresh}},
	)
	if out.Code != 0 {
		t.Fatalf("混合提交失败: code=%d msg=%s raw=%s", out.Code, out.Message, raw)
	}
	var mixed struct {
		Images   []service.GalleryImage  `json:"images"`
		Rejected []service.GalleryReject `json:"rejected"`
		Mode     string                  `json:"mode"`
		Summary  BatchSummary            `json:"summary"`
	}
	if err := json.Unmarshal(out.Data, &mixed); err != nil {
		t.Fatalf("解析 data 失败: %v", err)
	}
	if mixed.Mode != "manifest" || len(mixed.Rejected) != 0 || len(mixed.Images) != 2 {
		t.Fatalf("混合提交不符: mode=%s rejected=%+v images=%d", mixed.Mode, mixed.Rejected, len(mixed.Images))
	}
	if mixed.Summary.Received != 1 || mixed.Summary.Referenced != 1 || mixed.Summary.Written != 1 {
		t.Fatalf("summary 不符: %+v", mixed.Summary)
	}
	if !mixed.Images[0].Dedup || mixed.Images[1].Dedup {
		t.Fatalf("dedup 标记不符: %v / %v", mixed.Images[0].Dedup, mixed.Images[1].Dedup)
	}
	// ref 条目必须复用原作者名（manifest 为唯一真源）
	if mixed.Images[0].Name != "seed.png" || mixed.Images[1].Name != "fresh.png" {
		t.Fatalf("名称应按 manifest 对齐: %q / %q", mixed.Images[0].Name, mixed.Images[1].Name)
	}
}

// TestGalleryManifestRefExpired 引用式入库查不到 md5 → 该条进 rejected（固定文案）、其余继续。
func TestGalleryManifestRefExpired(t *testing.T) {
	testEnv(t)
	u := mkTestUser(t, 1)
	doc := mkBatchDoc(t, u.ID, "gallery")
	r := batchRouter(u.ID)
	path := fmt.Sprintf("/api/docs/%d/gallery/images", doc.ID)

	fresh := testPNG(t, 48, 48, 3)
	man := manifestJSON(t,
		map[string]any{"kind": "ref", "md5": strings.Repeat("f", 32), "name": "ghost.png", "size": 123},
		map[string]any{"kind": "file", "name": "ok.png", "size": len(fresh)},
	)
	_, out, raw := postMultipart(t, r, path,
		map[string]string{"manifest": man},
		[]mpFile{{field: "files", name: "ok.png", data: fresh}},
	)
	if out.Code != 0 {
		t.Fatalf("宽容语义：单条 ref 失效不应整批失败，实际 code=%d msg=%s raw=%s", out.Code, out.Message, raw)
	}
	var data struct {
		Images   []service.GalleryImage  `json:"images"`
		Rejected []service.GalleryReject `json:"rejected"`
		Summary  BatchSummary            `json:"summary"`
	}
	if err := json.Unmarshal(out.Data, &data); err != nil {
		t.Fatalf("解析 data 失败: %v", err)
	}
	if len(data.Images) != 1 || len(data.Rejected) != 1 {
		t.Fatalf("应「1 入库 + 1 拒绝」，实际 images=%d rejected=%+v", len(data.Images), data.Rejected)
	}
	if data.Rejected[0].Reason != service.ReferenceExpiredReason {
		t.Fatalf("拒绝文案必须是固定文案 %q，实际 %q", service.ReferenceExpiredReason, data.Rejected[0].Reason)
	}
	if data.Rejected[0].Name != "ghost.png" {
		t.Fatalf("拒绝条目名应对齐 manifest: %q", data.Rejected[0].Name)
	}
	// 1 个 ref 失效（进 rejected）+ 1 个 file 入库：Referenced = 1-1 = 0
	if data.Summary.Received != 1 || data.Summary.Referenced != 0 || data.Summary.Written != 1 {
		t.Fatalf("summary 不符: %+v", data.Summary)
	}
}
