package service

// QA 独立测试（测试轮次 1）——doc_type 多文档类型：枚举落库、JSON 契约存取、
// 类型化搜索过滤、版本快照对非 markdown 类型生效（P0-5 / P0-9 / 架构 §5.2、§3.3）。

import (
	"strings"
	"testing"

	"haiku-wiki/server/internal/model"
	"haiku-wiki/server/internal/repository"
)

var qaAllDocTypes = []string{"markdown", "sheet", "mindmap", "flowchart"}

// TestQADocTypeCreateEachEnum 四种合法类型逐一创建并读回（datatable 已下线）。
func TestQADocTypeCreateEachEnum(t *testing.T) {
	newEnv(t)
	owner := mkUser(t, "qa-type@x.com", "pass123", "member")
	book := mkBook(t, owner.ID, "QA类型库", "private")
	ds := &DocService{}

	for _, dt := range qaAllDocTypes {
		doc, err := ds.CreateDoc(book, owner.ID, 0, "类型-"+dt, dt)
		if err != nil {
			t.Fatalf("创建 %s 类型文档失败: %v", dt, err)
		}
		if doc.DocType != dt {
			t.Fatalf("doc_type = %q, 期望 %q", doc.DocType, dt)
		}
		// 读回校验
		got, _, err := ds.LoadForRead(owner.ID, doc.ID)
		if err != nil {
			t.Fatalf("读取 %s 文档失败: %v", dt, err)
		}
		if got.DocType != dt {
			t.Fatalf("读回 doc_type = %q, 期望 %q", got.DocType, dt)
		}
	}
	// 目录树节点应带 doc_type
	tree, err := ds.Tree(book)
	if err != nil {
		t.Fatal(err)
	}
	seen := map[string]string{}
	for _, d := range tree {
		seen[d.Title] = d.DocType
	}
	for _, dt := range qaAllDocTypes {
		if seen["类型-"+dt] != dt {
			t.Fatalf("目录树节点 doc_type 缺失或错误: %q → %q", "类型-"+dt, seen["类型-"+dt])
		}
	}
	// 缺省类型回退 markdown（服务层）
	d0, err := ds.CreateDoc(book, owner.ID, 0, "缺省类型", "")
	if err != nil || d0.DocType != "markdown" {
		t.Fatalf("缺省 doc_type 应回退 markdown: %+v err=%v", d0, err)
	}
}

// TestQADocTypeSearchFiltering markdown 搜正文，非 markdown 仅搜标题（snippet 置空）。
func TestQADocTypeSearchFiltering(t *testing.T) {
	newEnv(t)
	owner := mkUser(t, "qa-search@x.com", "pass123", "member")
	book := mkBook(t, owner.ID, "QA搜索库", "public")
	ds, ss := &DocService{}, &SearchService{}

	// markdown：关键词仅在正文 → 命中
	mdDoc, err := ds.CreateDoc(book, owner.ID, 0, "普通笔记", "markdown")
	if err != nil {
		t.Fatal(err)
	}
	setDocContent(t, owner.ID, mdDoc.ID, "这段正文里藏着量子猫出没记录")

	// sheet：标题含关键词 → 命中但 snippet 为空；正文含关键词 → 不命中
	sheetTitle, err := ds.CreateDoc(book, owner.ID, 0, "量子猫观测表格", "sheet")
	if err != nil {
		t.Fatal(err)
	}
	sheetJSON := `{"version":1,"cells":{"0-0":{"text":"量子猫"},"0-1":{"text":"3 只"}},"colLen":26,"rowLen":100}`
	setDocContent(t, owner.ID, sheetTitle.ID, sheetJSON)
	sheetBody, err := ds.CreateDoc(book, owner.ID, 0, "普通表格", "sheet")
	if err != nil {
		t.Fatal(err)
	}
	setDocContent(t, owner.ID, sheetBody.ID, `{"version":1,"cells":{"0-0":{"text":"量子猫数据"}},"colLen":26,"rowLen":100}`)

	// mindmap：正文含关键词 → 不命中
	mind, err := ds.CreateDoc(book, owner.ID, 0, "思维导图", "mindmap")
	if err != nil {
		t.Fatal(err)
	}
	setDocContent(t, owner.ID, mind.ID, `{"version":1,"tree":{"text":"量子猫中心","children":[]}}`)

	hits, err := ss.Search(owner.ID, "量子猫")
	if err != nil {
		t.Fatal(err)
	}
	byID := map[uint64]Hit{}
	for _, h := range hits {
		byID[h.DocID] = h
	}
	if _, ok := byID[mdDoc.ID]; !ok {
		t.Fatal("markdown 正文命中应返回")
	}
	h, ok := byID[sheetTitle.ID]
	if !ok {
		t.Fatal("非 markdown 标题命中应返回")
	}
	if h.Snippet != "" {
		t.Fatalf("非 markdown 命中 snippet 应为空串, got %q", h.Snippet)
	}
	if _, ok := byID[sheetBody.ID]; ok {
		t.Fatal("sheet 正文关键词不应命中（仅搜标题）")
	}
	if _, ok := byID[mind.ID]; ok {
		t.Fatal("mindmap 正文关键词不应命中（仅搜标题）")
	}

	// markdown 专属正文词：非 markdown 不参与正文搜索
	hits2, _ := ss.Search(owner.ID, "出没记录")
	if len(hits2) != 1 || hits2[0].DocID != mdDoc.ID {
		t.Fatalf("正文词应仅命中 markdown 文档: %+v", hits2)
	}
	// markdown 命中时 snippet 非空
	if _, ok := byID[mdDoc.ID]; ok && byID[mdDoc.ID].Snippet == "" {
		t.Fatal("markdown 命中应提供 snippet")
	}
}

// TestQADocTypeContractStorageAndRollback JSON 契约原样存取 + 非 markdown 类型快照回滚（P0-9）。
func TestQADocTypeContractStorageAndRollback(t *testing.T) {
	newEnv(t)
	owner := mkUser(t, "qa-cnt@x.com", "pass123", "member")
	book := mkBook(t, owner.ID, "QA契约库", "private")
	ds := &DocService{}

	cases := []struct {
		docType string
		v1      string
		v2      string
	}{
		{"sheet", `{"version":1,"cells":{"0-0":{"text":"名称"},"2-3":{"text":"=A1+B1"}},"colLen":26,"rowLen":100}`,
			`{"version":1,"cells":{"0-0":{"text":"改"},"9-9":{"text":"x"}},"colLen":26,"rowLen":100}`},
		{"mindmap", `{"version":1,"tree":{"text":"中心主题","children":[{"text":"分支A","children":[]}]}}`,
			`{"version":1,"tree":{"text":"新主题","children":[]}}`},
		{"flowchart", "flowchart TD\n  A[开始] --> B[结束]", "flowchart TD\n  A --> B --> C"},
	}
	for _, c := range cases {
		doc, err := ds.CreateDoc(book, owner.ID, 0, "契约-"+c.docType, c.docType)
		if err != nil {
			t.Fatal(err)
		}
		setDocContent(t, owner.ID, doc.ID, c.v1)
		setDocContent(t, owner.ID, doc.ID, c.v2)

		// 当前内容 = v2（字符串原样存取，不做任何转义/裁剪）
		got, _, err := ds.LoadForRead(owner.ID, doc.ID)
		if err != nil {
			t.Fatal(err)
		}
		if got.Content != c.v2 {
			t.Fatalf("[%s] content 存取不一致:\n got  %q\n want %q", c.docType, got.Content, c.v2)
		}
		// 快照裁剪到 20：这里只有 2 版，直接回滚到最早一版
		vs, err := (&VersionService{}).List(doc.ID)
		if err != nil {
			t.Fatal(err)
		}
		if len(vs) != 2 {
			t.Fatalf("[%s] 应有 2 个快照, got %d", c.docType, len(vs))
		}
		var firstID uint64
		for _, v := range vs {
			if v.Source == "auto" {
				// 倒序，最后一个 auto 即最早的 v1
				firstID = v.ID
			}
		}
		if firstID == 0 {
			t.Fatalf("[%s] 未找到 v1 快照", c.docType)
		}
		rolled, err := (&VersionService{}).Rollback(owner.ID, doc.ID, firstID)
		if err != nil {
			t.Fatalf("[%s] 回滚失败: %v", c.docType, err)
		}
		if rolled.Content != c.v1 {
			t.Fatalf("[%s] 回滚后内容不符:\n got  %q\n want %q", c.docType, rolled.Content, c.v1)
		}
		if rolled.DocType != c.docType {
			t.Fatalf("[%s] 回滚后 doc_type 不应变化: %q", c.docType, rolled.DocType)
		}
	}
}

// TestQADocTypeMigrationLegacyDefault 存量语义：直接落库的无 doc_type 记录应读出 markdown 默认值。
func TestQADocTypeMigrationLegacyDefault(t *testing.T) {
	newEnv(t)
	owner := mkUser(t, "qa-mig@x.com", "pass123", "member")
	book := mkBook(t, owner.ID, "QA迁移库", "private")
	// 绕过服务层直接插入无 doc_type 的行（模拟存量数据）
	legacy := &model.Doc{BookID: book.ID, ParentID: 0, Title: "存量文档", Content: "旧内容", Pos: "aaa"}
	if err := repository.DB().Create(legacy).Error; err != nil {
		t.Fatal(err)
	}
	got, _, err := (&DocService{}).LoadForRead(owner.ID, legacy.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.DocType != "markdown" {
		t.Fatalf("存量文档 doc_type 应默认 markdown, got %q", got.DocType)
	}
	if !strings.Contains(got.Content, "旧内容") {
		t.Fatalf("存量内容应保留: %q", got.Content)
	}
}

// TestQADocTypeMigrationDatatableToSheet datatable 已下线：存量 datatable 记录经
// MigrateData 一次性修正为 sheet（同实现同 JSON 契约，内容无需转换），迁移幂等。
func TestQADocTypeMigrationDatatableToSheet(t *testing.T) {
	newEnv(t)
	owner := mkUser(t, "qa-mig2@x.com", "pass123", "member")
	book := mkBook(t, owner.ID, "QA迁移库2", "private")

	// 绕过服务层直接插入 datatable 存量行（模拟旧版本数据）
	sheetJSON := `{"version":1,"cells":{"0-0":{"text":"列1"}},"colLen":26,"rowLen":100}`
	legacy := &model.Doc{BookID: book.ID, ParentID: 0, Title: "旧数据表", DocType: "datatable", Content: sheetJSON, Pos: "bbb"}
	if err := repository.DB().Create(legacy).Error; err != nil {
		t.Fatal(err)
	}

	// 执行迁移（重复执行两次验证幂等）
	if err := repository.MigrateData(repository.DB()); err != nil {
		t.Fatalf("迁移失败: %v", err)
	}
	if err := repository.MigrateData(repository.DB()); err != nil {
		t.Fatalf("重复迁移失败（应幂等）: %v", err)
	}

	got, _, err := (&DocService{}).LoadForRead(owner.ID, legacy.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.DocType != "sheet" {
		t.Fatalf("存量 datatable 应迁移为 sheet, got %q", got.DocType)
	}
	if got.Content != sheetJSON {
		t.Fatalf("迁移不应改动内容:\n got  %q\n want %q", got.Content, sheetJSON)
	}
}
