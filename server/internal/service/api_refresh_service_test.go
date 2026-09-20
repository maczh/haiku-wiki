package service

import (
	"strings"
	"testing"

	"haiku-wiki/server/internal/model"
	"haiku-wiki/server/internal/repository"
)

// 一次刷新用的最小 Swagger2 fixture：GET /users（与既有同名）→ 应「更新」并保留 id；
// POST /posts（既有没有）→ 应「新增」。
const refreshSwaggerFixture = `{
  "swagger": "2.0",
  "info": {"title": "Demo", "version": "1.0"},
  "host": "api.example.com",
  "basePath": "/v1",
  "paths": {
    "/users": {
      "get": {
        "summary": "List users",
        "tags": ["用户"],
        "parameters": [],
        "responses": {"200": {"description": "ok"}}
      }
    },
    "/posts": {
      "post": {
        "summary": "Create post",
        "tags": ["帖子"],
        "parameters": [],
        "responses": {"200": {"description": "ok"}}
      }
    }
  }
}`

// 既有正文：仅 GET /users，endpoint id 为前端随机值 e_old1（用来验证 P0-9 调试历史锚点不被破坏）。
const existingApiContent = `{"version":1,"base_host":"","groups":[{"id":"g1","name":"用户","items":[{"id":"e_old1","name":"旧接口名","method":"GET","uri":"/users","content_type":"application/json","headers":[],"params":[],"body_type":"none","body":"","description":"旧描述","response_example":"","response_fields":[]}]}]}`

func setupRefreshDoc(t *testing.T) (owner *model.User, doc *model.Doc) {
	t.Helper()
	newEnv(t)
	owner = mkUser(t, "refresh@example.com", "secret123", "user")
	book := mkBook(t, owner.ID, "API 库", "private")
	doc = mkDoc(t, book, owner.ID, 0, "接口文档")
	doc.DocType = "api"
	doc.Content = existingApiContent
	if err := repository.UpdateDoc(doc); err != nil {
		t.Fatalf("初始化接口文档失败: %v", err)
	}
	// 登记 URL 导入来源
	if err := repository.UpsertDocApiSource(&model.DocApiSource{
		DocID:     doc.ID,
		SourceURL: "http://api.example.com/spec.json",
	}); err != nil {
		t.Fatalf("登记来源失败: %v", err)
	}
	return owner, doc
}

func TestApiRefreshPreservesHistory(t *testing.T) {
	owner, doc := setupRefreshDoc(t)

	// 覆盖抓取实现：直接返回 fixture（绕过 SSRF / 网络，专注验证合并逻辑）
	orig := fetchApiSpec
	fetchApiSpec = func(string) (string, error) { return refreshSwaggerFixture, nil }
	defer func() { fetchApiSpec = orig }()

	// 先写一条调试历史，锚定在 e_old1（验证刷新后历史仍可达 —— P0-9）
	histSvc := &ApiDebugHistoryService{}
	if err := histSvc.SaveHistory(owner.ID, doc.ID, "e_old1", ApiDebugHistoryRecord{
		Time: 123, Method: "GET", URI: "/users", BodyType: "none",
	}); err != nil {
		t.Fatalf("写入调试历史失败: %v", err)
	}

	added, updated, removed, err := apiRefreshService.RefreshDoc(owner.ID, doc.ID)
	if err != nil {
		t.Fatalf("RefreshDoc 失败: %v", err)
	}
	if added != 1 {
		t.Errorf("新增数应为 1，实际 %d", added)
	}
	if updated != 1 {
		t.Errorf("更新数应为 1，实际 %d", updated)
	}
	if removed != 0 {
		t.Errorf("失效数应为 0，实际 %d", removed)
	}

	// 读取刷新后的正文
	reloaded, err := repository.FindDocByID(doc.ID)
	if err != nil {
		t.Fatalf("读取刷新后文档失败: %v", err)
	}
	// P0-9：既有 endpoint id e_old1 必须被保留（调试历史锚点不丢）
	if !strings.Contains(reloaded.Content, "e_old1") {
		t.Errorf("刷新后未保留既有 endpoint id e_old1，正文：%s", reloaded.Content)
	}
	// 新增接口应出现（POST /posts）
	if !strings.Contains(reloaded.Content, "/posts") {
		t.Errorf("刷新后未出现新增接口 /posts，正文：%s", reloaded.Content)
	}

	// 调试历史在新正文下仍可按 e_old1 读回
	recs, err := histSvc.LoadHistory(owner.ID, doc.ID, "e_old1")
	if err != nil {
		t.Fatalf("刷新后读取调试历史失败: %v", err)
	}
	if len(recs) != 1 || recs[0].Time != 123 {
		t.Errorf("调试历史被破坏：期望 1 条 time=123，实际 %+v", recs)
	}

	// 来源结果状态应记录为 success
	src, err := repository.FindDocApiSource(doc.ID)
	if err != nil {
		t.Fatalf("读取来源结果失败: %v", err)
	}
	if src.RefreshStatus != "success" {
		t.Errorf("刷新状态应为 success，实际 %q", src.RefreshStatus)
	}
	if src.LastRefreshedAt == nil {
		t.Errorf("LastRefreshedAt 应为非 nil")
	}
	if src.LastAdded != 1 || src.LastUpdated != 1 {
		t.Errorf("来源统计应为 added=1 updated=1，实际 added=%d updated=%d", src.LastAdded, src.LastUpdated)
	}
}

func TestApiRefreshRemovesStaleToGroup(t *testing.T) {
	owner, doc := setupRefreshDoc(t)
	// 既有正文比上游多一个接口（DELETE /orphan），刷新后应计「失效」并降级进「已失效」分组
	doc.Content = `{"version":1,"base_host":"","groups":[{"id":"g1","name":"用户","items":[` +
		`{"id":"e_old1","name":"旧接口名","method":"GET","uri":"/users","content_type":"application/json","headers":[],"params":[],"body_type":"none","body":"","description":"旧描述","response_example":"","response_fields":[]},` +
		`{"id":"e_old3","name":"Orphan","method":"DELETE","uri":"/orphan","content_type":"application/json","headers":[],"params":[],"body_type":"none","body":"","description":"","response_example":"","response_fields":[]}` +
		`]}]}`
	if err := repository.UpdateDoc(doc); err != nil {
		t.Fatal(err)
	}
	orig := fetchApiSpec
	// 上游只剩 GET /users（DELETE /orphan 已不存在）
	fetchApiSpec = func(string) (string, error) {
		return `{"swagger":"2.0","info":{"title":"Demo"},"paths":{"/users":{"get":{"summary":"List users","tags":["用户"],"parameters":[],"responses":{"200":{"description":"ok"}}}}}}`, nil
	}
	defer func() { fetchApiSpec = orig }()

	added, updated, removed, err := apiRefreshService.RefreshDoc(owner.ID, doc.ID)
	if err != nil {
		t.Fatalf("RefreshDoc 失败: %v", err)
	}
	if added != 0 || updated != 1 || removed != 1 {
		t.Errorf("期望 added=0 updated=1 removed=1，实际 added=%d updated=%d removed=%d", added, updated, removed)
	}
	reloaded, _ := repository.FindDocByID(doc.ID)
	if !strings.Contains(reloaded.Content, "已失效") {
		t.Errorf("上游移除的接口应降级进「已失效」分组，正文：%s", reloaded.Content)
	}
	// 失效接口仍保留 id（历史可达）
	if !strings.Contains(reloaded.Content, "e_old3") {
		t.Errorf("失效接口应保留 id e_old3，正文：%s", reloaded.Content)
	}
}

func TestApiRefreshRunAll(t *testing.T) {
	owner, _ := setupRefreshDoc(t)
	// 再加一篇可刷新文档
	book := mkBook(t, owner.ID, "API 库2", "private")
	doc2 := mkDoc(t, book, owner.ID, 0, "接口文档2")
	doc2.DocType = "api"
	doc2.Content = existingApiContent
	if err := repository.UpdateDoc(doc2); err != nil {
		t.Fatal(err)
	}
	if err := repository.UpsertDocApiSource(&model.DocApiSource{DocID: doc2.ID, SourceURL: "http://api.example.com/spec2.json"}); err != nil {
		t.Fatal(err)
	}

	orig := fetchApiSpec
	fetchApiSpec = func(string) (string, error) { return refreshSwaggerFixture, nil }
	defer func() { fetchApiSpec = orig }()

	run, err := apiRefreshService.RunAll("auto")
	if err != nil {
		t.Fatalf("RunAll 失败: %v", err)
	}
	if run.Scanned != 2 {
		t.Errorf("Scanned 应为 2，实际 %d", run.Scanned)
	}
	if run.Succeeded != 2 {
		t.Errorf("Succeeded 应为 2，实际 %d", run.Succeeded)
	}
	if run.Failed != 0 {
		t.Errorf("Failed 应为 0，实际 %d", run.Failed)
	}
	if run.Trigger != "auto" {
		t.Errorf("Trigger 应为 auto，实际 %q", run.Trigger)
	}
	// 汇总结果应落库并可被读取
	last, err := repository.GetLastRun()
	if err != nil {
		t.Fatalf("读取 last run 失败: %v", err)
	}
	if last.Succeeded != 2 {
		t.Errorf("落库的 last run Succeeded 应为 2，实际 %d", last.Succeeded)
	}
}

func TestApiRefreshNoSourceFails(t *testing.T) {
	newEnv(t)
	owner := mkUser(t, "refresh2@example.com", "secret123", "user")
	book := mkBook(t, owner.ID, "API 库", "private")
	doc := mkDoc(t, book, owner.ID, 0, "接口文档")
	doc.DocType = "api"
	doc.Content = existingApiContent
	if err := repository.UpdateDoc(doc); err != nil {
		t.Fatal(err)
	}
	// 无来源行 → 刷新应报错（而非 panic / 误建空内容）
	_, _, _, err := apiRefreshService.RefreshDoc(owner.ID, doc.ID)
	if err == nil {
		t.Fatal("无来源时应返回错误")
	}
}
