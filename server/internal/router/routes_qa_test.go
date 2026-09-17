package router

// QA 独立测试（测试轮次 1）——HTTP 路由层集成测试：
// 验证增量路由真实注册、JWT 鉴权、公开链路、doc_type 创建枚举。
// 工程师已有用例停留在 service 层，路由装配层此前无人覆盖。

import (
	"bytes"
	"encoding/json"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"

	"haiku-wiki/server/internal/config"
	"haiku-wiki/server/internal/model"
	hkresp "haiku-wiki/server/internal/pkg"
	"haiku-wiki/server/internal/pkg/jwtutil"
	"haiku-wiki/server/internal/repository"
	"haiku-wiki/server/internal/service"
)

// qaResp 统一响应体。
type qaResp struct {
	Code    int             `json:"code"`
	Message string          `json:"message"`
	Data    json.RawMessage `json:"data"`
}

// qaSetup 独立临时环境：内存外 SQLite + 完整路由装配，返回 engine 与测试用户 token。
func qaSetup(t *testing.T) (*gin.Engine, uint64, string) {
	t.Helper()
	dir := t.TempDir()
	g, err := gorm.Open(sqlite.Open(filepath.Join(dir, "qa.db")), &gorm.Config{})
	if err != nil {
		t.Fatalf("打开 QA 测试库失败: %v", err)
	}
	if sqlDB, e := g.DB(); e == nil {
		sqlDB.SetMaxOpenConns(1)
	}
	if err := repository.AutoMigrate(g); err != nil {
		t.Fatalf("建表失败: %v", err)
	}
	repository.SetDB(g)
	jwtutil.Init("qa-route-secret")
	service.DataDir = t.TempDir()
	t.Cleanup(func() { service.DataDir = "./data" })

	hash, err := bcrypt.GenerateFromPassword([]byte("pass123"), bcrypt.MinCost)
	if err != nil {
		t.Fatal(err)
	}
	u := &model.User{Email: "qa-route@x.com", PasswordHash: string(hash), Nickname: "qaroute", Role: "member"}
	if err := repository.CreateUser(u); err != nil {
		t.Fatal(err)
	}
	token, err := jwtutil.Create(u.ID, u.Role)
	if err != nil {
		t.Fatal(err)
	}

	gin.SetMode(gin.TestMode)
	r := gin.New()
	Register(r, &config.Config{DataDir: dir})
	return r, u.ID, token
}

// qaDo 发起 JSON 请求并解析统一响应。
func qaDo(t *testing.T, r *gin.Engine, method, path, token string, body any) qaResp {
	t.Helper()
	var rd *bytes.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	} else {
		rd = bytes.NewReader(nil)
	}
	req := httptest.NewRequest(method, path, rd)
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	var resp qaResp
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("%s %s 响应非 JSON (http %d): %s", method, path, w.Code, w.Body.String())
	}
	return resp
}

// qaBookDoc 准备一本 private 库 + 一篇 markdown 文档。
func qaBookDoc(t *testing.T, r *gin.Engine, uid uint64, token, bookName string) (bookID, docID uint64) {
	t.Helper()
	resp := qaDo(t, r, "POST", "/api/books", token, map[string]any{"name": bookName, "visibility": "private"})
	if resp.Code != 0 {
		t.Fatalf("建书失败: %+v", resp)
	}
	var book struct {
		ID uint64 `json:"id"`
	}
	_ = json.Unmarshal(resp.Data, &book)

	resp2 := qaDo(t, r, "POST", "/api/books/"+uitoa(book.ID)+"/docs", token,
		map[string]any{"parent_id": 0, "title": "路由文档", "doc_type": "markdown"})
	if resp2.Code != 0 {
		t.Fatalf("建文档失败: %+v", resp2)
	}
	var doc struct {
		ID uint64 `json:"id"`
	}
	_ = json.Unmarshal(resp2.Data, &doc)
	return book.ID, doc.ID
}

func uitoa(n uint64) string {
	if n == 0 {
		return "0"
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	return string(buf[i:])
}

// TestQADocShareManagementRoutes 分享管理三接口的 HTTP 全链路（PRD P0-4 / 架构 §3.1、§3.5）。
func TestQADocShareManagementRoutes(t *testing.T) {
	r, uid, token := qaSetup(t)
	hkresp.ResetShareVerify()
	_, docID := qaBookDoc(t, r, uid, token, "QA分享管理库")

	// PUT /api/docs/:id/share —— 创建
	resp := qaDo(t, r, "PUT", "/api/docs/"+uitoa(docID)+"/share", token,
		map[string]any{"password": "qa-pass-1"})
	if resp.Code != 0 {
		t.Fatalf("PUT /docs/:id/share 应成功（路由未注册或逻辑错误）: %+v", resp)
	}
	var view struct {
		Slug        string `json:"slug"`
		HasPassword bool   `json:"has_password"`
		Enabled     bool   `json:"enabled"`
	}
	if err := json.Unmarshal(resp.Data, &view); err != nil {
		t.Fatalf("PUT 响应 data 解析失败: %s", resp.Data)
	}
	if len(view.Slug) != 12 || !view.HasPassword || !view.Enabled {
		t.Fatalf("PUT 响应字段错误: %+v", view)
	}

	// GET /api/docs/:id/share —— 回显
	resp = qaDo(t, r, "GET", "/api/docs/"+uitoa(docID)+"/share", token, nil)
	if resp.Code != 0 {
		t.Fatalf("GET /docs/:id/share 应成功: %+v", resp)
	}

	// 公开 meta（免 JWT）
	metaResp := qaDo(t, r, "GET", "/api/public/doc-share/"+view.Slug, "", nil)
	if metaResp.Code != 0 || !strings.Contains(string(metaResp.Data), `"has_password":true`) {
		t.Fatalf("公开 meta 应返回 has_password=true: %+v", metaResp)
	}

	// verify 错误密码 → 40301
	wrong := qaDo(t, r, "POST", "/api/public/doc-share/"+view.Slug+"/verify", "",
		map[string]any{"password": "nope"})
	if wrong.Code != 40301 {
		t.Fatalf("错误密码 verify 应 40301, got %+v", wrong)
	}
	// verify 正确密码 → 返回内容
	ok := qaDo(t, r, "POST", "/api/public/doc-share/"+view.Slug+"/verify", "",
		map[string]any{"password": "qa-pass-1"})
	if ok.Code != 0 || !strings.Contains(string(ok.Data), `"content"`) {
		t.Fatalf("正确密码 verify 应返回内容: %+v", ok)
	}

	// DELETE /api/docs/:id/share —— 撤销后立即失效
	resp = qaDo(t, r, "DELETE", "/api/docs/"+uitoa(docID)+"/share", token, nil)
	if resp.Code != 0 {
		t.Fatalf("DELETE /docs/:id/share 应成功: %+v", resp)
	}
	gone := qaDo(t, r, "GET", "/api/public/doc-share/"+view.Slug, "", nil)
	if gone.Code != 40401 {
		t.Fatalf("撤销后公开 meta 应 40401, got %+v", gone)
	}
}

// TestQADocShareRoutesRequireJWT 管理接口必须登录（无 token → 40101）。
func TestQADocShareRoutesRequireJWT(t *testing.T) {
	r, _, token := qaSetup(t)
	_, docID := qaBookDoc(t, r, 0, token, "QA鉴权库")

	for _, m := range []string{"GET", "PUT", "DELETE"} {
		resp := qaDo(t, r, m, "/api/docs/"+uitoa(docID)+"/share", "", nil)
		if resp.Code != 40101 {
			t.Fatalf("%s /docs/:id/share 无 token 应 40101, got %+v", m, resp)
		}
	}
}

// TestQAFetchTitleRouteRegistered /api/fetch-title 路由存在且 SSRF 拒绝返回 40001（架构 §3.5）。
func TestQAFetchTitleRouteRegistered(t *testing.T) {
	r, _, token := qaSetup(t)
	resp := qaDo(t, r, "GET", "/api/fetch-title?url="+url.QueryEscape("http://127.0.0.1/x"), token, nil)
	if resp.Code != 40001 {
		t.Fatalf("GET /api/fetch-title 应存在且对环回地址返回 40001, got %+v", resp)
	}
}

// TestQADocTypeCreateViaAPI 四种合法类型经 HTTP 创建；非法类型（含已下线的 datatable）回退 markdown（PRD P0-5：缺省/非法回退 markdown）。
func TestQADocTypeCreateViaAPI(t *testing.T) {
	r, uid, token := qaSetup(t)
	bookID, _ := qaBookDoc(t, r, uid, token, "QA类型库")
	base := "/api/books/" + uitoa(bookID) + "/docs"

	for _, dt := range []string{"markdown", "sheet", "mindmap", "flowchart"} {
		resp := qaDo(t, r, "POST", base, token, map[string]any{"parent_id": 0, "title": "T-" + dt, "doc_type": dt})
		if resp.Code != 0 {
			t.Fatalf("创建 %s 类型应成功: %+v", dt, resp)
		}
		if !strings.Contains(string(resp.Data), `"doc_type":"`+dt+`"`) {
			t.Fatalf("创建 %s 类型响应 doc_type 不符: %s", dt, resp.Data)
		}
	}

	// 缺省 doc_type → markdown
	resp := qaDo(t, r, "POST", base, token, map[string]any{"parent_id": 0, "title": "T-default"})
	if resp.Code != 0 || !strings.Contains(string(resp.Data), `"doc_type":"markdown"`) {
		t.Fatalf("缺省 doc_type 应回退 markdown: %+v", resp)
	}

	// 非法 doc_type（含已下线的 datatable）→ 按 PRD/架构设计回退 markdown 落库
	for _, badType := range []string{"comic", "datatable"} {
		bad := qaDo(t, r, "POST", base, token, map[string]any{"parent_id": 0, "title": "T-bad-" + badType, "doc_type": badType})
		if bad.Code != 0 || !strings.Contains(string(bad.Data), `"doc_type":"markdown"`) {
			t.Fatalf("非法 doc_type %q 应回退 markdown（PRD P0-5）, got code=%d data=%s", badType, bad.Code, bad.Data)
		}
	}

	// 目录树节点带 doc_type
	tree := qaDo(t, r, "GET", base, token, nil)
	if tree.Code != 0 || !strings.Contains(string(tree.Data), `"doc_type":"sheet"`) {
		t.Fatalf("目录树应包含 doc_type 字段: %+v", tree)
	}
}

// TestQAPublicDocShareRoutesExist 公开路由注册（免 JWT 可达，不存在 slug 返回 40401 而非 404 路由缺失）。
func TestQAPublicDocShareRoutesExist(t *testing.T) {
	r, _, _ := qaSetup(t)
	meta := qaDo(t, r, "GET", "/api/public/doc-share/ghost-slug", "", nil)
	if meta.Code != 40401 {
		t.Fatalf("公开 meta 路由应存在且返回 40401, got %+v", meta)
	}
	verify := qaDo(t, r, "POST", "/api/public/doc-share/ghost-slug/verify", "", map[string]any{})
	if verify.Code != 40401 {
		t.Fatalf("公开 verify 路由应存在且返回 40401, got %+v", verify)
	}
}

// TestQABookLevelShareRegression 书级公开分享回归红线：/api/public/share/:slug 行为不变。
func TestQABookLevelShareRegression(t *testing.T) {
	r, _, token := qaSetup(t)
	// public 库自带 share_slug
	resp := qaDo(t, r, "POST", "/api/books", token, map[string]any{"name": "QA书级回归库", "visibility": "public"})
	if resp.Code != 0 {
		t.Fatalf("建 public 库失败: %+v", resp)
	}
	var book struct {
		ID        uint64  `json:"id"`
		ShareSlug *string `json:"share_slug"`
	}
	_ = json.Unmarshal(resp.Data, &book)
	if book.ShareSlug == nil || *book.ShareSlug == "" {
		t.Fatal("public 库应返回 share_slug")
	}
	// 书级公开接口（免 JWT）仍工作
	got := qaDo(t, r, "GET", "/api/public/share/"+*book.ShareSlug, "", nil)
	if got.Code != 0 {
		t.Fatalf("书级公开分享应工作: %+v", got)
	}
	bad := qaDo(t, r, "GET", "/api/public/share/no-such-book-slug", "", nil)
	if bad.Code != 40401 {
		t.Fatalf("书级无效 slug 应 40401, got %+v", bad)
	}
}
