package router

// QA 独立测试（第五/六轮 R5+R6，测试轮次 1）——HTTP 路由层集成测试：
//   - 注册 / 登录（三标识符）全链路 + 唯一冲突 40901
//   - 管理员用户管理三接口：非 admin 一律 40301
//   - POST /api/import/url：只保存网址（不抓取）→ 非法协议 40001 + 目标库无写权限 40301
//   - 团队 HTTP 权限矩阵：非成员 40301、普通成员不可增删成员/建文库
//   - 文档协作者 HTTP 全链路：邀请 → 读写 → 移除后回收
//
// 与 service 层用例互补：这里验证路由装配、JWT、中间件与 JSON 契约。

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"

	"haiku-wiki/server/internal/model"
	"haiku-wiki/server/internal/pkg/jwtutil"
	"haiku-wiki/server/internal/repository"
)

// qaNewUserFull 直建用户（绕过注册限频），可指定 role，返回 id 与 token。
func qaNewUserFull(t *testing.T, username, email string, role string) (uint64, string) {
	t.Helper()
	hash, err := bcrypt.GenerateFromPassword([]byte("pass123"), bcrypt.MinCost)
	if err != nil {
		t.Fatal(err)
	}
	u := &model.User{
		Username: username, Email: email, PasswordHash: string(hash),
		Nickname: username, Name: username, Role: role, Status: 1,
	}
	if err := repository.CreateUser(u); err != nil {
		t.Fatal(err)
	}
	token, err := jwtutil.Create(u.ID, u.Role)
	if err != nil {
		t.Fatal(err)
	}
	return u.ID, token
}

// qaDoIP 与 qaDo 相同，但可指定客户端 IP（注册限频按 IP 计，需区分）。
func qaDoIP(t *testing.T, r *gin.Engine, method, path, token, clientIP string, body any) qaResp {
	t.Helper()
	var rd = strings.NewReader("")
	if body != nil {
		b, _ := json.Marshal(body)
		rd = strings.NewReader(string(b))
	}
	req := httptest.NewRequest(method, path, rd)
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	if clientIP != "" {
		req.Header.Set("X-Forwarded-For", clientIP)
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	var resp qaResp
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("%s %s 响应非 JSON (http %d): %s", method, path, w.Code, w.Body.String())
	}
	return resp
}

// qaRegister 走 HTTP 注册，返回 data 里的 token。
func qaRegister(t *testing.T, r *gin.Engine, ip string, body map[string]any) (qaResp, string) {
	t.Helper()
	resp := qaDoIP(t, r, "POST", "/api/auth/register", "", ip, body)
	var out struct {
		Token string `json:"token"`
	}
	_ = json.Unmarshal(resp.Data, &out)
	return resp, out.Token
}

// TestQAAuthRegisterLoginHTTP 注册（含姓名/部门/手机号）→ 三标识符登录 → 唯一冲突 40901。
func TestQAAuthRegisterLoginHTTP(t *testing.T) {
	r, _, _ := qaSetup(t)

	regBody := map[string]any{
		"username":   "zhaoliu",
		"name":       "赵六",
		"email":      "zhaoliu@x.com",
		"phone":      "13700137000",
		"department": "质量部",
		"password":   "pass123",
	}
	resp, token := qaRegister(t, r, "198.18.0.1", regBody)
	if resp.Code != 0 {
		t.Fatalf("注册应成功: %+v", resp)
	}
	if token == "" {
		t.Fatal("注册应返回 token")
	}
	// 新字段落库（响应体里可见）
	for _, field := range []string{`"username":"zhaoliu"`, `"name":"赵六"`, `"department":"质量部"`, `"phone":"13700137000"`, `"status":1`} {
		if !strings.Contains(string(resp.Data), field) {
			t.Fatalf("注册响应缺字段 %s: %s", field, resp.Data)
		}
	}

	// 三标识符登录
	for _, account := range []string{"zhaoliu", "13700137000", "zhaoliu@x.com"} {
		lr := qaDoIP(t, r, "POST", "/api/auth/login", "", "198.18.0.2",
			map[string]any{"account": account, "password": "pass123"})
		if lr.Code != 0 {
			t.Fatalf("用 %q 登录应成功: %+v", account, lr)
		}
	}
	// 错误密码
	if lr := qaDoIP(t, r, "POST", "/api/auth/login", "", "198.18.0.2",
		map[string]any{"account": "zhaoliu", "password": "wrong"}); lr.Code != 40001 {
		t.Fatalf("错误密码应 40001, got %+v", lr)
	}
	// 重复用户名 → 40901
	dupName := map[string]any{"username": "zhaoliu", "email": "other@x.com", "password": "pass123"}
	if dr, _ := qaRegister(t, r, "198.18.0.3", dupName); dr.Code != 40901 {
		t.Fatalf("重复用户名应 40901, got %+v", dr)
	}
	// 重复邮箱 → 40901
	dupMail := map[string]any{"username": "zhaoliu2", "email": "zhaoliu@x.com", "password": "pass123"}
	if dr, _ := qaRegister(t, r, "198.18.0.4", dupMail); dr.Code != 40901 {
		t.Fatalf("重复邮箱应 40901, got %+v", dr)
	}
	// 重复手机号 → 40901
	dupPhone := map[string]any{"username": "zhaoliu3", "email": "o3@x.com", "phone": "13700137000", "password": "pass123"}
	if dr, _ := qaRegister(t, r, "198.18.0.5", dupPhone); dr.Code != 40901 {
		t.Fatalf("重复手机号应 40901, got %+v", dr)
	}
	// 缺必填字段 → 40001
	if br, _ := qaRegister(t, r, "198.18.0.6", map[string]any{"email": "x@x.com", "password": "pass123"}); br.Code != 40001 {
		t.Fatalf("缺 username 应 40001, got %+v", br)
	}
}

// TestQAAdminOnlyEndpoints403 管理员用户管理三接口：非 admin 40301；admin 可用且生效。
func TestQAAdminOnlyEndpoints403(t *testing.T) {
	r, _, memberToken := qaSetup(t)
	adminID, adminToken := qaNewUserFull(t, "qa-r6-admin", "qa-r6-admin@x.com", "admin")
	_ = adminID
	targetID, _ := qaNewUserFull(t, "qa-r6-target", "qa-r6-target@x.com", "member")

	// 非 admin：三个接口全部 40301
	if lr := qaDo(t, r, "GET", "/api/admin/users", memberToken, nil); lr.Code != 40301 {
		t.Fatalf("非 admin 列用户应 40301, got %+v", lr)
	}
	if sr := qaDo(t, r, "PATCH", "/api/admin/users/"+uitoa(targetID)+"/status", memberToken,
		map[string]any{"status": 0}); sr.Code != 40301 {
		t.Fatalf("非 admin 改状态应 40301, got %+v", sr)
	}
	if pr := qaDo(t, r, "PATCH", "/api/admin/users/"+uitoa(targetID)+"/reset-password", memberToken,
		map[string]any{"password": "newpass1"}); pr.Code != 40301 {
		t.Fatalf("非 admin 重置密码应 40301, got %+v", pr)
	}
	// 未登录 → 40101
	if lr := qaDo(t, r, "GET", "/api/admin/users", "", nil); lr.Code != 40101 {
		t.Fatalf("未登录访问 admin 接口应 40101, got %+v", lr)
	}

	// admin：列表可用
	lr := qaDo(t, r, "GET", "/api/admin/users?page=1&page_size=20", adminToken, nil)
	if lr.Code != 0 || !strings.Contains(string(lr.Data), `"users"`) {
		t.Fatalf("admin 列用户应成功: %+v", lr)
	}

	// admin 禁用 → 该账号登录失败
	sr := qaDo(t, r, "PATCH", "/api/admin/users/"+uitoa(targetID)+"/status", adminToken,
		map[string]any{"status": 0})
	if sr.Code != 0 || !strings.Contains(string(sr.Data), `"status":0`) {
		t.Fatalf("admin 禁用用户应成功: %+v", sr)
	}
	if lg := qaDo(t, r, "POST", "/api/auth/login", "",
		map[string]any{"account": "qa-r6-target", "password": "pass123"}); lg.Code != 40001 {
		t.Fatalf("禁用后登录应 40001, got %+v", lg)
	}
	// 重新启用 → 登录恢复
	if sr := qaDo(t, r, "PATCH", "/api/admin/users/"+uitoa(targetID)+"/status", adminToken,
		map[string]any{"status": 1}); sr.Code != 0 {
		t.Fatalf("admin 启用用户应成功: %+v", sr)
	}
	if lg := qaDo(t, r, "POST", "/api/auth/login", "",
		map[string]any{"account": "qa-r6-target", "password": "pass123"}); lg.Code != 0 {
		t.Fatalf("启用后登录应恢复: %+v", lg)
	}

	// admin 重置密码（指定）→ 新密码可登录，旧密码失效
	pr := qaDo(t, r, "PATCH", "/api/admin/users/"+uitoa(targetID)+"/reset-password", adminToken,
		map[string]any{"password": "reset-pwd-1"})
	if pr.Code != 0 || !strings.Contains(string(pr.Data), "reset-pwd-1") {
		t.Fatalf("admin 重置密码应返回明文: %+v", pr)
	}
	if lg := qaDo(t, r, "POST", "/api/auth/login", "",
		map[string]any{"account": "qa-r6-target", "password": "reset-pwd-1"}); lg.Code != 0 {
		t.Fatalf("重置后应用新密码登录: %+v", lg)
	}
	if lg := qaDo(t, r, "POST", "/api/auth/login", "",
		map[string]any{"account": "qa-r6-target", "password": "pass123"}); lg.Code != 40001 {
		t.Fatalf("重置后旧密码应失效, got %+v", lg)
	}
	// 非法用户 ID → 40001
	if br := qaDo(t, r, "PATCH", "/api/admin/users/abc/status", adminToken, map[string]any{"status": 0}); br.Code != 40001 {
		t.Fatalf("非法用户 ID 应 40001, got %+v", br)
	}
}

// TestQAImportURLGuards POST /api/import/url：只保存网址（不抓取）+ 目标库权限校验。
//
// 改版要点：服务端不再发起任何网络请求，因此**不存在 SSRF 面**——私网/环回地址不再拦截
// （页面由访问者的浏览器加载，与服务端无关）。真正要守的是 iframe src 的执行权：
// 只放行 http/https，挡掉 javascript: / data: / file: 这类可脚本化的协议。
func TestQAImportURLGuards(t *testing.T) {
	r, _, token := qaSetup(t)
	_, otherToken := qaNewUser(t, "qa-r6-other@x.com")
	bookID := qaCreateBook(t, r, token, "QA导入目标库", "private")
	otherBookID := qaCreateBook(t, r, otherToken, "QA他人库", "private")

	// 未登录 → 40101
	if nr := qaDo(t, r, "POST", "/api/import/url", "", map[string]any{"url": "http://example.com", "book_id": bookID}); nr.Code != 40101 {
		t.Fatalf("未登录导入应 40101, got %+v", nr)
	}
	// 缺 url / 缺 book_id → 40001
	if br := qaDo(t, r, "POST", "/api/import/url", token, map[string]any{"book_id": bookID}); br.Code != 40001 {
		t.Fatalf("缺 url 应 40001, got %+v", br)
	}
	if br := qaDo(t, r, "POST", "/api/import/url", token, map[string]any{"url": "http://example.com"}); br.Code != 40001 {
		t.Fatalf("缺 book_id 应 40001, got %+v", br)
	}
	// 目标库不存在 → 40401
	if nf := qaDo(t, r, "POST", "/api/import/url", token,
		map[string]any{"url": "http://example.com", "book_id": 999999}); nf.Code != 40401 {
		t.Fatalf("目标库不存在应 40401, got %+v", nf)
	}
	// 目标库无写权限 → 40301（权限校验先于落库）
	if fr := qaDo(t, r, "POST", "/api/import/url", token,
		map[string]any{"url": "http://example.com/x", "book_id": otherBookID}); fr.Code != 40301 {
		t.Fatalf("无写权限的目标库应 40301, got %+v", fr)
	}

	// 协议白名单：非 http/https 一律 40001（iframe src 若允许 javascript:/data: 等于交出脚本执行权）
	bad := []string{
		"file:///etc/passwd",
		"ftp://example.com/x",
		"gopher://example.com/",
		"javascript:alert(1)",
		"data:text/html,<script>alert(1)</script>",
		"about:blank",
		"   ", // 空白
	}
	for _, u := range bad {
		got := qaDo(t, r, "POST", "/api/import/url", token, map[string]any{"url": u, "book_id": bookID})
		if got.Code != 40001 {
			t.Fatalf("非法地址 %q 应被拒（40001）, got %+v", u, got)
		}
	}
}

// TestQAImportURLHappyPath 正常网址 → 生成 web 文档落入目标库（端到端，离线可跑）。
//
// 改版后不再抓取页面，因此这个用例不再依赖外网：断言的是「网址被原样保存成网页文档」，
// 而不是「页面被转成 markdown」。正文应是 WebRef JSON，且 url 与提交值一致。
func TestQAImportURLHappyPath(t *testing.T) {
	r, _, token := qaSetup(t)
	bookID := qaCreateBook(t, r, token, "QA导入落库", "private")

	// 裸域名也要能存（用户常直接粘 www.example.com），服务端自动补 https
	const raw = "www.example.com/help"
	resp := qaDo(t, r, "POST", "/api/import/url", token,
		map[string]any{"url": raw, "book_id": bookID})
	if resp.Code != 0 {
		t.Fatalf("导入网址应成功: %+v", resp)
	}
	var out struct {
		DocID uint64 `json:"doc_id"`
		Title string `json:"title"`
	}
	if err := json.Unmarshal(resp.Data, &out); err != nil {
		t.Fatalf("导入响应解析失败: %s", resp.Data)
	}
	if out.DocID == 0 {
		t.Fatal("应返回新建文档 ID")
	}
	if strings.TrimSpace(out.Title) == "" {
		t.Fatal("导入文档标题不应为空")
	}

	// 文档确实落在目标库，且是 web 类型、正文是 WebRef JSON（原样保存网址）
	got := qaDo(t, r, "GET", "/api/docs/"+uitoa(out.DocID), token, nil)
	if got.Code != 0 {
		t.Fatalf("取导入文档应成功: %+v", got)
	}
	var wrap struct {
		Doc struct {
			ID      uint64 `json:"id"`
			BookID  uint64 `json:"book_id"`
			Title   string `json:"title"`
			DocType string `json:"doc_type"`
			Content string `json:"content"`
		} `json:"doc"`
	}
	if err := json.Unmarshal(got.Data, &wrap); err != nil {
		t.Fatalf("文档详情解析失败: %s", got.Data)
	}
	if wrap.Doc.BookID != bookID {
		t.Fatalf("导入文档应落在目标库 %d, got %d", bookID, wrap.Doc.BookID)
	}
	if wrap.Doc.DocType != "web" {
		t.Fatalf("导入文档类型应为 web, got %q", wrap.Doc.DocType)
	}
	var ref struct {
		Kind string `json:"kind"`
		URL  string `json:"url"`
	}
	if err := json.Unmarshal([]byte(wrap.Doc.Content), &ref); err != nil {
		t.Fatalf("正文应为 WebRef JSON: %s", wrap.Doc.Content)
	}
	if ref.Kind != "url" {
		t.Fatalf("kind 应为 url, got %q", ref.Kind)
	}
	if ref.URL != "https://"+raw {
		t.Fatalf("网址应原样保存（补协议）: got %q", ref.URL)
	}
	// 目录树里能看到它
	tree := qaTree(t, r, token, bookID)
	found := false
	for _, it := range tree {
		if it.ID == out.DocID {
			found = true
		}
	}
	if !found {
		t.Fatalf("导入文档应出现在目标库目录树: %+v", tree)
	}
}

// TestQATeamHTTPPermission 团队 HTTP 权限矩阵 + 自动建团队文库。
func TestQATeamHTTPPermission(t *testing.T) {
	r, _, ownerToken := qaSetup(t)
	memberID, memberToken := qaNewUser(t, "qa-r6-tm-member@x.com")
	outsiderID, outsiderToken := qaNewUser(t, "qa-r6-tm-out@x.com")
	_ = outsiderID

	// 建团队 → 自动带一个团队文库
	cr := qaDo(t, r, "POST", "/api/teams", ownerToken, map[string]any{"name": "QA六轮组", "description": "d"})
	if cr.Code != 0 {
		t.Fatalf("建团队应成功: %+v", cr)
	}
	var team struct {
		ID      uint64 `json:"id"`
		OwnerID uint64 `json:"owner_id"`
	}
	_ = json.Unmarshal(cr.Data, &team)

	lr := qaDo(t, r, "GET", "/api/teams/"+uitoa(team.ID)+"/books", ownerToken, nil)
	if lr.Code != 0 {
		t.Fatalf("取团队文库应成功: %+v", lr)
	}
	var libs []struct {
		ID     uint64  `json:"id"`
		Name   string  `json:"name"`
		TeamID *uint64 `json:"team_id"`
	}
	if err := json.Unmarshal(lr.Data, &libs); err != nil {
		t.Fatalf("团队文库解析失败: %s", lr.Data)
	}
	if len(libs) != 1 {
		t.Fatalf("新建团队应自动建 1 个文库, got %d", len(libs))
	}
	if libs[0].Name != "QA六轮组文库" {
		t.Fatalf("自动文库名 = %q", libs[0].Name)
	}
	if libs[0].TeamID == nil || *libs[0].TeamID != team.ID {
		t.Fatalf("自动文库应带 team_id, got %+v", libs[0])
	}
	teamLibID := libs[0].ID

	// 非成员：团队详情 / 成员 / 文库 均 40301
	for _, p := range []string{"/api/teams/" + uitoa(team.ID), "/api/teams/" + uitoa(team.ID) + "/members", "/api/teams/" + uitoa(team.ID) + "/books"} {
		if got := qaDo(t, r, "GET", p, outsiderToken, nil); got.Code != 40301 {
			t.Fatalf("非成员 GET %s 应 40301, got %+v", p, got)
		}
	}
	// 非成员建团队文库 / 改团队 也 40301
	if got := qaDo(t, r, "POST", "/api/teams/"+uitoa(team.ID)+"/books", outsiderToken,
		map[string]any{"name": "外人库"}); got.Code != 40301 {
		t.Fatalf("非成员建团队文库应 40301, got %+v", got)
	}
	if got := qaDo(t, r, "PUT", "/api/teams/"+uitoa(team.ID), outsiderToken,
		map[string]any{"name": "被改"}); got.Code != 40301 {
		t.Fatalf("非成员改团队应 40301, got %+v", got)
	}

	// owner 加成员
	if got := qaDo(t, r, "POST", "/api/teams/"+uitoa(team.ID)+"/members", ownerToken,
		map[string]any{"identifier": "qa-r6-tm-member@x.com", "role": "member"}); got.Code != 0 {
		t.Fatalf("owner 加成员应成功: %+v", got)
	}
	// 重复添加 → 40901
	if got := qaDo(t, r, "POST", "/api/teams/"+uitoa(team.ID)+"/members", ownerToken,
		map[string]any{"identifier": "qa-r6-tm-member@x.com"}); got.Code != 40901 {
		t.Fatalf("重复加成员应 40901, got %+v", got)
	}
	// 成员现在可见团队
	if got := qaDo(t, r, "GET", "/api/teams/"+uitoa(team.ID), memberToken, nil); got.Code != 0 {
		t.Fatalf("成员应可见团队: %+v", got)
	}
	// 普通成员不能加人 / 建文库 / 改团队
	if got := qaDo(t, r, "POST", "/api/teams/"+uitoa(team.ID)+"/members", memberToken,
		map[string]any{"identifier": "qa-r6-tm-out@x.com"}); got.Code != 40301 {
		t.Fatalf("普通成员加人应 40301, got %+v", got)
	}
	if got := qaDo(t, r, "POST", "/api/teams/"+uitoa(team.ID)+"/books", memberToken,
		map[string]any{"name": "成员库"}); got.Code != 40301 {
		t.Fatalf("普通成员建团队文库应 40301, got %+v", got)
	}
	if got := qaDo(t, r, "PUT", "/api/teams/"+uitoa(team.ID), memberToken,
		map[string]any{"name": "改名"}); got.Code != 40301 {
		t.Fatalf("普通成员改团队应 40301, got %+v", got)
	}

	// 团队文库：成员可建文档，非成员不可
	if got := qaDo(t, r, "POST", "/api/books/"+uitoa(teamLibID)+"/docs", memberToken,
		map[string]any{"parent_id": 0, "title": "成员建在团队库", "doc_type": "markdown"}); got.Code != 0 {
		t.Fatalf("成员应可在团队文库建文档: %+v", got)
	}
	if got := qaDo(t, r, "POST", "/api/books/"+uitoa(teamLibID)+"/docs", outsiderToken,
		map[string]any{"parent_id": 0, "title": "外人建在团队库", "doc_type": "markdown"}); got.Code != 40301 {
		t.Fatalf("非成员不应可在团队文库建文档, got %+v", got)
	}

	// owner 移除成员后，成员失去团队库访问
	if got := qaDo(t, r, "DELETE", "/api/teams/"+uitoa(team.ID)+"/members/"+uitoa(memberID), ownerToken, nil); got.Code != 0 {
		t.Fatalf("owner 移除成员应成功: %+v", got)
	}
	if got := qaDo(t, r, "GET", "/api/teams/"+uitoa(team.ID)+"/books", memberToken, nil); got.Code != 40301 {
		t.Fatalf("移除后成员应 40301, got %+v", got)
	}
	// 不能移除创建者
	if got := qaDo(t, r, "DELETE", "/api/teams/"+uitoa(team.ID)+"/members/"+uitoa(team.OwnerID), ownerToken, nil); got.Code != 40001 {
		t.Fatalf("移除创建者应 40001, got %+v", got)
	}
}

// TestQABookAccessVisibilityMatrix BookAccess 三档可见性回归红线（BUG-R6-01 修复后锁语义）：
// public 任何人可读；members 登录用户可读；private 仅 owner；团队文库成员可读可写。
func TestQABookAccessVisibilityMatrix(t *testing.T) {
	r, _, ownerToken := qaSetup(t)
	_, otherToken := qaNewUser(t, "qa-r6-vis-other@x.com")

	pubID := qaCreateBook(t, r, ownerToken, "QA公开库", "public")
	memID := qaCreateBook(t, r, ownerToken, "QA成员库", "members")
	privID := qaCreateBook(t, r, ownerToken, "QA私有库", "private")

	type probe struct {
		name   string
		bookID uint64
		token  string
		want   int
	}
	probes := []probe{
		{"public 库：owner 可读", pubID, ownerToken, 0},
		{"public 库：其他登录用户可读", pubID, otherToken, 0},
		// 匿名读：/api/books/** 整组挂在 JWTAuth 之下，匿名先被 40101 拦下，
		// 因此中间件「public 任何人」只是纵深防御（真正免登录的是 /api/public/share/*）。
		{"public 库：匿名被 JWT 拦下", pubID, "", 40101},
		{"members 库：登录用户可读", memID, otherToken, 0},
		{"members 库：匿名被 JWT 拦下", memID, "", 40101},
		{"private 库：owner 可读", privID, ownerToken, 0},
		{"private 库：他人不可读", privID, otherToken, 40301},
	}
	for _, p := range probes {
		got := qaDo(t, r, "GET", "/api/books/"+uitoa(p.bookID)+"/docs", p.token, nil)
		if got.Code != p.want {
			t.Fatalf("%s 应 code=%d, got %+v", p.name, p.want, got)
		}
	}

	// 写：members 库非 owner 可写；public/private 库非 owner 不可写（回归红线）
	if got := qaDo(t, r, "POST", "/api/books/"+uitoa(memID)+"/docs", otherToken,
		map[string]any{"parent_id": 0, "title": "成员写入", "doc_type": "markdown"}); got.Code != 0 {
		t.Fatalf("members 库非 owner 应可建文档, got %+v", got)
	}
	for _, id := range []uint64{pubID, privID} {
		if got := qaDo(t, r, "POST", "/api/books/"+uitoa(id)+"/docs", otherToken,
			map[string]any{"parent_id": 0, "title": "越权写入", "doc_type": "markdown"}); got.Code != 40301 {
			t.Fatalf("public/private 库非 owner 建文档应 40301 (book=%d), got %+v", id, got)
		}
	}
}

// TestQACollaboratorHTTPFlow 文档协作者 HTTP 全链路：邀请 → 读写 → 移除后回收。
func TestQACollaboratorHTTPFlow(t *testing.T) {
	r, _, ownerToken := qaSetup(t)
	collabID, collabToken := qaNewUser(t, "qa-r6-collab@x.com")
	strangerID, strangerToken := qaNewUser(t, "qa-r6-stranger@x.com")
	_ = strangerID

	_, docID := qaCreateBookDoc(t, r, ownerToken, "QA协作库", "private", "协作文档")

	// 邀请前：协作者与陌生人都 40301
	if got := qaDo(t, r, "GET", "/api/docs/"+uitoa(docID), collabToken, nil); got.Code != 40301 {
		t.Fatalf("邀请前协作者读应 40301, got %+v", got)
	}
	if got := qaDo(t, r, "GET", "/api/docs/"+uitoa(docID), strangerToken, nil); got.Code != 40301 {
		t.Fatalf("陌生人读应 40301, got %+v", got)
	}

	// owner 邀请（按邮箱）
	ar := qaDo(t, r, "POST", "/api/docs/"+uitoa(docID)+"/collaborators", ownerToken,
		map[string]any{"identifier": "qa-r6-collab@x.com"})
	if ar.Code != 0 {
		t.Fatalf("邀请协作者应成功: %+v", ar)
	}
	// 列表
	ls := qaDo(t, r, "GET", "/api/docs/"+uitoa(docID)+"/collaborators", ownerToken, nil)
	if ls.Code != 0 || !strings.Contains(string(ls.Data), `"user_id":`+uitoa(collabID)) {
		t.Fatalf("协作者列表应含受邀者: %+v", ls)
	}
	// 重复邀请 → 40901
	if got := qaDo(t, r, "POST", "/api/docs/"+uitoa(docID)+"/collaborators", ownerToken,
		map[string]any{"identifier": "qa-r6-collab@x.com"}); got.Code != 40901 {
		t.Fatalf("重复邀请应 40901, got %+v", got)
	}
	// 邀请不存在用户 → 40401
	if got := qaDo(t, r, "POST", "/api/docs/"+uitoa(docID)+"/collaborators", ownerToken,
		map[string]any{"identifier": "ghost@x.com"}); got.Code != 40401 {
		t.Fatalf("邀请不存在用户应 40401, got %+v", got)
	}
	// 无权限者邀请 → 40301
	if got := qaDo(t, r, "POST", "/api/docs/"+uitoa(docID)+"/collaborators", strangerToken,
		map[string]any{"identifier": "qa-r6-stranger@x.com"}); got.Code != 40301 {
		t.Fatalf("无权限邀请应 40301, got %+v", got)
	}

	// 协作者可读可写
	if got := qaDo(t, r, "GET", "/api/docs/"+uitoa(docID), collabToken, nil); got.Code != 0 {
		t.Fatalf("协作者应可读: %+v", got)
	}
	if got := qaDo(t, r, "PATCH", "/api/docs/"+uitoa(docID), collabToken,
		map[string]any{"content": "协作者写入的内容"}); got.Code != 0 {
		t.Fatalf("协作者应可写: %+v", got)
	}
	// 陌生人仍 40301（邀请不扩散）
	if got := qaDo(t, r, "GET", "/api/docs/"+uitoa(docID), strangerToken, nil); got.Code != 40301 {
		t.Fatalf("陌生人仍应 40301, got %+v", got)
	}

	// 移除后权限回收
	if got := qaDo(t, r, "DELETE", "/api/docs/"+uitoa(docID)+"/collaborators/"+uitoa(collabID), ownerToken, nil); got.Code != 0 {
		t.Fatalf("移除协作者应成功: %+v", got)
	}
	if got := qaDo(t, r, "GET", "/api/docs/"+uitoa(docID), collabToken, nil); got.Code != 40301 {
		t.Fatalf("移除后协作者应 40301, got %+v", got)
	}
	if got := qaDo(t, r, "PATCH", "/api/docs/"+uitoa(docID), collabToken,
		map[string]any{"content": "再写一次"}); got.Code != 40301 {
		t.Fatalf("移除后协作者不应可写, got %+v", got)
	}
}
