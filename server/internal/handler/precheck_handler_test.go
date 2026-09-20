package handler

// T03 验收测试：秒传预检 / 秒传落 meta 的 HTTP 契约。
//
// 覆盖点（与派单一致）：
//   - 单条命中 / 未命中
//   - 批量 1 条 / 100 条 / 101 条（101 → 40001）
//   - `md5` + `items` 互斥 → 40001
//   - 非法 md5（31/33 位、非 hex、**大写**）→ 40001；`size < 0` → 40001
//   - 批量响应 JSON 中**不存在** `url` 字段，也不回显请求方的 filename（信息最小化）
//   - `index` 与请求下标一致（顺序敏感）
//   - 秒传 `40401` 未知 md5 / `40901` size 不符
//
// 预检/秒传都会真读 `attachments`，因此这里接**真实仓储**（临时 SQLite + 本地存储），
// 只用 httptest 替换网络层，不做 repository 打桩 —— 契约测试才有意义。

import (
	"bytes"
	"crypto/md5"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"

	"haiku-wiki/server/internal/middleware"
	"haiku-wiki/server/internal/model"
	"haiku-wiki/server/internal/repository"
	"haiku-wiki/server/internal/storage"
)

// ---------- 夹具 ----------

func testEnv(t *testing.T) {
	t.Helper()
	dir := t.TempDir()
	g, err := gorm.Open(sqlite.Open(filepath.Join(dir, "test.db")), &gorm.Config{})
	if err != nil {
		t.Fatalf("打开测试库失败: %v", err)
	}
	if sqlDB, e := g.DB(); e == nil {
		sqlDB.SetMaxOpenConns(1) // 串行化，避免 SQLite 锁竞争
	}
	if err := repository.AutoMigrate(g); err != nil {
		t.Fatalf("建表失败: %v", err)
	}
	repository.SetDB(g)
	// 上传读写走 storage 抽象，测试用独立的本地目录（与 service 层测试同口径）。
	storage.InitLocal(t.TempDir())
}

func mkTestUser(t *testing.T, id uint64) *model.User {
	t.Helper()
	u := &model.User{
		ID: id, Username: fmt.Sprintf("u%d", id), Email: fmt.Sprintf("u%d@hk.io", id),
		PasswordHash: "x", Nickname: fmt.Sprintf("u%d", id), Role: "member", Status: 1,
	}
	if err := repository.CreateUser(u); err != nil {
		t.Fatalf("建用户失败: %v", err)
	}
	return u
}

// newAPIRouter 只装配被测的两条路由；uid 直接塞进 gin context 模拟 JWT 中间件。
func newAPIRouter(uid uint64) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	g := r.Group("", func(c *gin.Context) {
		c.Set(middleware.CtxUID, uid)
		c.Next()
	})
	g.POST("/api/uploads/precheck", PrecheckUpload)
	g.POST("/api/uploads/instant", InstantUpload)
	return r
}

type apiResp struct {
	Code    int             `json:"code"`
	Message string          `json:"message"`
	Data    json.RawMessage `json:"data"`
}

// postJSON 发一个 JSON 请求，返回 HTTP 状态码、解析后的统一响应体与**原始响应文本**。
// 原始文本用于「响应中不得出现某字段」这类结构断言。
func postJSON(t *testing.T, r *gin.Engine, path string, payload any) (int, apiResp, string) {
	t.Helper()
	b, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("序列化请求失败: %v", err)
	}
	return postRaw(t, r, path, string(b))
}

func postRaw(t *testing.T, r *gin.Engine, path, body string) (int, apiResp, string) {
	t.Helper()
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, path, bytes.NewReader([]byte(body)))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	raw := w.Body.String()
	var out apiResp
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		t.Fatalf("响应不是合法 JSON: %v\n原文: %s", err, raw)
	}
	return w.Code, out, raw
}

func md5Of(data []byte) string {
	s := md5.Sum(data)
	return hex.EncodeToString(s[:])
}

// seedContent 用真实上传路径造一份已有内容，返回其 md5（用于命中场景）。
func seedContent(t *testing.T, uid uint64, name string, data []byte) string {
	t.Helper()
	out, err := uploadService.SaveBytes(uid, name, data)
	if err != nil {
		t.Fatalf("预置内容失败: %v", err)
	}
	return out.MD5
}

// ---------- 单条形态 ----------

func TestPrecheckSingleHitAndMiss(t *testing.T) {
	testEnv(t)
	u := mkTestUser(t, 1)
	data := []byte("content-addressable-payload-for-precheck")
	sum := seedContent(t, u.ID, "pic.png", data)
	r := newAPIRouter(u.ID)

	// 命中
	_, out, raw := postJSON(t, r, "/api/uploads/precheck", map[string]any{
		"md5": sum, "size": len(data), "filename": "pic.png",
	})
	if out.Code != 0 {
		t.Fatalf("命中预检应成功，实际 code=%d msg=%s", out.Code, out.Message)
	}
	var hit struct {
		Hit  bool   `json:"hit"`
		MD5  string `json:"md5"`
		Size int64  `json:"size"`
	}
	if err := json.Unmarshal(out.Data, &hit); err != nil {
		t.Fatalf("解析 data 失败: %v", err)
	}
	if !hit.Hit || hit.MD5 != sum || hit.Size != int64(len(data)) {
		t.Fatalf("命中结果不符: %+v", hit)
	}
	// 信息最小化：单条响应也**不得**回 url（§12.0 修订）。
	if strings.Contains(raw, `"url"`) {
		t.Fatalf("预检响应不得包含 url 字段: %s", raw)
	}

	// 未命中
	_, out, _ = postJSON(t, r, "/api/uploads/precheck", map[string]any{
		"md5": strings.Repeat("0", 32), "size": 10, "filename": "pic.png",
	})
	if out.Code != 0 {
		t.Fatalf("未命中预检应成功（hit=false），实际 code=%d", out.Code)
	}
	if err := json.Unmarshal(out.Data, &hit); err != nil {
		t.Fatalf("解析 data 失败: %v", err)
	}
	if hit.Hit {
		t.Fatal("未知 md5 不应命中")
	}
}

// ---------- 批量形态 ----------

func TestPrecheckBatchSizes(t *testing.T) {
	testEnv(t)
	u := mkTestUser(t, 1)
	r := newAPIRouter(u.ID)

	items := func(n int) []map[string]any {
		out := make([]map[string]any, 0, n)
		for i := 0; i < n; i++ {
			out = append(out, map[string]any{
				"md5":      fmt.Sprintf("%032x", i+1),
				"size":     1024,
				"filename": "a.png",
			})
		}
		return out
	}

	// 1 条
	_, out, raw := postJSON(t, r, "/api/uploads/precheck", map[string]any{"items": items(1)})
	if out.Code != 0 {
		t.Fatalf("1 条批量预检失败: code=%d msg=%s", out.Code, out.Message)
	}
	var res struct {
		Results []struct {
			Index int    `json:"index"`
			Hit   bool   `json:"hit"`
			MD5   string `json:"md5"`
			Size  int64  `json:"size"`
		} `json:"results"`
	}
	if err := json.Unmarshal(out.Data, &res); err != nil {
		t.Fatalf("解析 results 失败: %v", err)
	}
	if len(res.Results) != 1 || res.Results[0].Index != 0 {
		t.Fatalf("1 条批量结果不符: %s", raw)
	}
	if strings.Contains(raw, `"url"`) {
		t.Fatalf("批量预检响应不得包含 url 字段: %s", raw)
	}

	// 100 条（上限内）
	_, out, _ = postJSON(t, r, "/api/uploads/precheck", map[string]any{"items": items(100)})
	if out.Code != 0 {
		t.Fatalf("100 条批量预检应通过，实际 code=%d msg=%s", out.Code, out.Message)
	}
	if err := json.Unmarshal(out.Data, &res); err != nil {
		t.Fatalf("解析 results 失败: %v", err)
	}
	if len(res.Results) != 100 {
		t.Fatalf("应返回 100 条结果，实际 %d", len(res.Results))
	}

	// 101 条（超限 → 40001）
	_, out, _ = postJSON(t, r, "/api/uploads/precheck", map[string]any{"items": items(101)})
	if out.Code != 40001 {
		t.Fatalf("101 条应返回 40001，实际 code=%d", out.Code)
	}
}

// TestPrecheckBatchIndexAndMinimalInfo 批量结果必须保序、且不泄漏他人信息。
func TestPrecheckBatchIndexAndMinimalInfo(t *testing.T) {
	testEnv(t)
	u := mkTestUser(t, 1)
	data := []byte("batched-hit-payload")
	sum := seedContent(t, u.ID, "secret-original.png", data)
	r := newAPIRouter(u.ID)

	missA := fmt.Sprintf("%032x", 111)
	missB := fmt.Sprintf("%032x", 222)
	// 命中项夹在中间：index 必须仍是 1，不能被命中与否重排。
	body := map[string]any{"items": []map[string]any{
		{"md5": missA, "size": 5, "filename": "request-only-name-aaa.png"},
		{"md5": sum, "size": len(data), "filename": "request-only-name-bbb.png"},
		{"md5": missB, "size": 7, "filename": "request-only-name-ccc.png"},
	}}
	_, out, raw := postJSON(t, r, "/api/uploads/precheck", body)
	if out.Code != 0 {
		t.Fatalf("批量预检失败: code=%d msg=%s", out.Code, out.Message)
	}
	var res struct {
		Results []struct {
			Index int    `json:"index"`
			Hit   bool   `json:"hit"`
			MD5   string `json:"md5"`
			Size  int64  `json:"size"`
		} `json:"results"`
	}
	if err := json.Unmarshal(out.Data, &res); err != nil {
		t.Fatalf("解析 results 失败: %v", err)
	}
	if len(res.Results) != 3 {
		t.Fatalf("应返回 3 条结果，实际 %d", len(res.Results))
	}
	for i, want := range []string{missA, sum, missB} {
		if res.Results[i].Index != i {
			t.Fatalf("results[%d].index = %d，期望 %d", i, res.Results[i].Index, i)
		}
		if res.Results[i].MD5 != want {
			t.Fatalf("results[%d].md5 = %s，期望 %s", i, res.Results[i].MD5, want)
		}
	}
	if !res.Results[1].Hit {
		t.Fatal("中间那条应命中（服务端已有同内容）")
	}
	if res.Results[0].Hit || res.Results[2].Hit {
		t.Fatal("未知 md5 不应命中")
	}

	// 信息最小化：不回 url、不回 filename（响应里不得出现请求方提交的文件名，
	// 更不得出现他人的原文件名 secret-original.png）。
	for _, forbidden := range []string{`"url"`, `"filename"`, "secret-original.png", "request-only-name"} {
		if strings.Contains(raw, forbidden) {
			t.Fatalf("响应不得包含 %q: %s", forbidden, raw)
		}
	}
}

// ---------- 入参校验 ----------

func TestPrecheckValidation(t *testing.T) {
	testEnv(t)
	u := mkTestUser(t, 1)
	r := newAPIRouter(u.ID)
	good := strings.Repeat("a", 32)

	cases := []struct {
		name string
		body string
	}{
		{"md5 与 items 互斥", `{"md5":"` + good + `","size":1,"items":[{"md5":"` + good + `","size":1,"filename":"a.png"}]}`},
		{"items 为空数组", `{"items":[]}`},
		{"md5 31 位", `{"md5":"` + strings.Repeat("a", 31) + `","size":1,"filename":"a.png"}`},
		{"md5 33 位", `{"md5":"` + strings.Repeat("a", 33) + `","size":1,"filename":"a.png"}`},
		{"md5 非 hex", `{"md5":"` + strings.Repeat("z", 32) + `","size":1,"filename":"a.png"}`},
		{"md5 大写", `{"md5":"` + strings.Repeat("A", 32) + `","size":1,"filename":"a.png"}`},
		{"size 为负", `{"md5":"` + good + `","size":-1,"filename":"a.png"}`},
		{"批量内 md5 非法", `{"items":[{"md5":"` + good + `","size":1,"filename":"a.png"},{"md5":"BAD","size":1,"filename":"a.png"}]}`},
		{"批量内 size 为负", `{"items":[{"md5":"` + good + `","size":-3,"filename":"a.png"}]}`},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			_, out, raw := postRaw(t, r, "/api/uploads/precheck", c.body)
			if out.Code != 40001 {
				t.Fatalf("期望 40001，实际 code=%d: %s", out.Code, raw)
			}
		})
	}
}

// ---------- 秒传 ----------

func TestInstantUpload(t *testing.T) {
	testEnv(t)
	u := mkTestUser(t, 1)
	data := []byte("instant-reuse-payload")
	sum := seedContent(t, u.ID, "pic.png", data)
	r := newAPIRouter(u.ID)

	// 命中：返回与普通上传同构的 data（含 url / md5 / dedup=true）
	_, out, raw := postJSON(t, r, "/api/uploads/instant", map[string]any{
		"md5": sum, "size": len(data), "filename": "another-name.png", "mime": "image/png",
	})
	if out.Code != 0 {
		t.Fatalf("秒传应成功，实际 code=%d msg=%s", out.Code, out.Message)
	}
	var inst struct {
		URL      string `json:"url"`
		Filename string `json:"filename"`
		Size     int64  `json:"size"`
		MD5      string `json:"md5"`
		Dedup    bool   `json:"dedup"`
	}
	if err := json.Unmarshal(out.Data, &inst); err != nil {
		t.Fatalf("解析 data 失败: %v", err)
	}
	if inst.URL == "" || inst.MD5 != sum || !inst.Dedup {
		t.Fatalf("秒传结果不符: %s", raw)
	}
	if inst.Filename != "another-name.png" {
		t.Fatalf("秒传应沿用本次提交的文件名，实际 %q", inst.Filename)
	}

	// 未知 md5 → 40401（前端据此降级普通上传）
	_, out, _ = postJSON(t, r, "/api/uploads/instant", map[string]any{
		"md5": strings.Repeat("0", 32), "size": 1, "filename": "pic.png",
	})
	if out.Code != 40401 {
		t.Fatalf("未知 md5 应返回 40401，实际 code=%d", out.Code)
	}

	// size 不符 → 40901
	_, out, _ = postJSON(t, r, "/api/uploads/instant", map[string]any{
		"md5": sum, "size": len(data) + 999, "filename": "pic.png",
	})
	if out.Code != 40901 {
		t.Fatalf("size 不符应返回 40901，实际 code=%d", out.Code)
	}

	// 非法 md5 / size<0 → 40001
	_, out, _ = postJSON(t, r, "/api/uploads/instant", map[string]any{
		"md5": "NOT-A-MD5", "size": 1, "filename": "pic.png",
	})
	if out.Code != 40001 {
		t.Fatalf("非法 md5 应返回 40001，实际 code=%d", out.Code)
	}
	_, out, _ = postJSON(t, r, "/api/uploads/instant", map[string]any{
		"md5": sum, "size": -1, "filename": "pic.png",
	})
	if out.Code != 40001 {
		t.Fatalf("size<0 应返回 40001，实际 code=%d", out.Code)
	}
}

// TestIsHexMD5Str 直接钉住入口校验的口径（只收 32 位小写 hex）。
func TestIsHexMD5Str(t *testing.T) {
	cases := []struct {
		in   string
		want bool
	}{
		{"", false},
		{strings.Repeat("a", 32), true},
		{"0123456789abcdef0123456789abcdef", true},
		{strings.Repeat("a", 31), false},
		{strings.Repeat("a", 33), false},
		{strings.Repeat("A", 32), false}, // 大写不合法（方言大小写敏感性）
		{strings.Repeat("z", 32), false},
		{"0123456789abcdef0123456789abcdeg", false},
	}
	for _, c := range cases {
		if got := isHexMD5Str(c.in); got != c.want {
			t.Errorf("isHexMD5Str(%q) = %v, 期望 %v", c.in, got, c.want)
		}
	}
}
