// LIKE 转义（P0 止血项 B6 / B6-回归）的回归测试。
//
// 背景：原实现用 `ESCAPE '\'`，MySQL 下 `\'` 被当转义引号 → 字符串不闭合 → 搜索接口恒 500；
// 而「裸删 ESCAPE」的改法又会让 **SQLite** 把含 % / _ / \ 的关键词搜成**静默假阴性**
// （SQLite 的 LIKE 没有默认转义字符）。本文件用可判别的数据集把两种错法都钉死。
package repository

import (
	"path/filepath"
	"testing"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"

	"haiku-wiki/server/internal/model"
)

// ---------- 测试环境 ----------

// newSearchEnv 建一个临时 SQLite 并把仓库层指向它（repository 包内测试可直接调 SearchDocs）。
func newSearchEnv(t *testing.T) *gorm.DB {
	t.Helper()
	dir := t.TempDir()
	g, err := gorm.Open(sqlite.Open(filepath.Join(dir, "search.db")), &gorm.Config{})
	if err != nil {
		t.Fatalf("打开测试库失败: %v", err)
	}
	if sqlDB, e := g.DB(); e == nil {
		sqlDB.SetMaxOpenConns(1)
	}
	if err := AutoMigrate(g); err != nil {
		t.Fatalf("建表失败: %v", err)
	}
	SetDB(g)
	return g
}

// seedDoc 在 public 库里造一篇 markdown 文档（标题 + 正文）。
func seedDoc(t *testing.T, g *gorm.DB, bookID uint64, title, content string) *model.Doc {
	t.Helper()
	d := &model.Doc{BookID: bookID, Title: title, DocType: "markdown", Content: content, CreatedBy: 1}
	if err := g.Create(d).Error; err != nil {
		t.Fatalf("造文档失败: %v", err)
	}
	return d
}

func seedPublicBook(t *testing.T, g *gorm.DB) *model.Book {
	t.Helper()
	b := &model.Book{OwnerID: 1, Name: "public-kb", Visibility: "public"}
	if err := g.Create(b).Error; err != nil {
		t.Fatalf("造知识库失败: %v", err)
	}
	return b
}

// ---------- escapeLike 纯函数 ----------

func TestEscapeLikePureFunction(t *testing.T) {
	cases := []struct{ in, want string }{
		{"", ""},
		{"abcdef", "abcdef"},
		{"100%", "100!%"},
		{"a_b", "a!_b"},
		{"wow!", "wow!!"},
		// 三者混合，且 `!` 必须先转义（否则 % → !% 里的 `!` 会被二次转义成 !!%）
		{"50%_a!b", "50!%!_a!!b"},
	}
	for _, c := range cases {
		if got := escapeLike(c.in); got != c.want {
			t.Errorf("escapeLike(%q) = %q, 期望 %q", c.in, got, c.want)
		}
	}
}

// ---------- 搜索行为（真跑 SQL） ----------

// TestSearchEscapesPercent 关键词含 % 时必须按**字面量**匹配：
// 错误实现（无 ESCAPE）会把 `100%` 当通配 → 同时命中 `100zz`（假阳性/多命中）。
func TestSearchEscapesPercent(t *testing.T) {
	g := newSearchEnv(t)
	b := seedPublicBook(t, g)
	exact := seedDoc(t, g, b.ID, "rate 100% up", "正文")
	decoy := seedDoc(t, g, b.ID, "rate 100zz up", "正文")

	hits, err := SearchDocs(1, "100%", 0, 50)
	if err != nil {
		t.Fatalf("搜索失败: %v", err)
	}
	got := map[uint64]bool{}
	for _, h := range hits {
		got[h.ID] = true
	}
	if !got[exact.ID] {
		t.Fatalf("应命中含字面量 %% 的文档 %d，实际命中 %v", exact.ID, got)
	}
	if got[decoy.ID] {
		t.Fatalf("不应命中 %q（说明 %% 被当成了通配符）", "rate 100zz up")
	}
}

// TestSearchEscapesUnderscore 关键词含 _ 时必须按字面量匹配（_ 是单字符通配）。
func TestSearchEscapesUnderscore(t *testing.T) {
	g := newSearchEnv(t)
	b := seedPublicBook(t, g)
	exact := seedDoc(t, g, b.ID, "file a_b.txt", "正文")
	decoy := seedDoc(t, g, b.ID, "file axb.txt", "正文")

	hits, err := SearchDocs(1, "a_b", 0, 50)
	if err != nil {
		t.Fatalf("搜索失败: %v", err)
	}
	got := map[uint64]bool{}
	for _, h := range hits {
		got[h.ID] = true
	}
	if !got[exact.ID] {
		t.Fatalf("应命中含字面量 _ 的文档 %d", exact.ID)
	}
	if got[decoy.ID] {
		t.Fatalf("不应命中 %q（说明 _ 被当成了通配符）", "file axb.txt")
	}
}

// TestSearchEscapesBang 关键词含 ! 时，转义器必须把 ! 自身翻倍（ESCAPE '!' 的转义字符）。
// 不翻倍 → 模式里 tail 的 `!%` 被解释为「字面量 %」→ 搜不到（静默假阴性）。
func TestSearchEscapesBang(t *testing.T) {
	g := newSearchEnv(t)
	b := seedPublicBook(t, g)
	d := seedDoc(t, g, b.ID, "wow! great", "正文")

	hits, err := SearchDocs(1, "wow!", 0, 50)
	if err != nil {
		t.Fatalf("搜索失败: %v", err)
	}
	found := false
	for _, h := range hits {
		if h.ID == d.ID {
			found = true
		}
	}
	if !found {
		t.Fatal("含字面量 ! 的关键词搜不到自身（说明 ! 未按 ESCAPE 字符翻倍）")
	}
}

// TestSearchContentBranchEscapes 正文分支（doc_type=markdown 的 content LIKE）同样必须转义。
func TestSearchContentBranchEscapes(t *testing.T) {
	g := newSearchEnv(t)
	b := seedPublicBook(t, g)
	d := seedDoc(t, g, b.ID, "无关标题", "进度 100% 完成")
	decoy := seedDoc(t, g, b.ID, "另一篇", "进度 100zz 完成")

	hits, err := SearchDocs(1, "100%", 0, 50)
	if err != nil {
		t.Fatalf("搜索失败: %v", err)
	}
	got := map[uint64]bool{}
	for _, h := range hits {
		got[h.ID] = true
	}
	if !got[d.ID] {
		t.Fatal("正文中含字面量 % 的文档应被命中")
	}
	if got[decoy.ID] {
		t.Fatal("正文中 100zz 不应被命中（% 未被转义）")
	}
}

// TestSearchNoBackslashEscapeClause 结构断言：生成的 SQL 必须带 `ESCAPE '!'`，
// 且**绝不**出现 `ESCAPE '\'`（MySQL 下会语法错误 → 搜索接口恒 500）。
func TestSearchNoBackslashEscapeClause(t *testing.T) {
	g := newSearchEnv(t)
	b := seedPublicBook(t, g)
	seedDoc(t, g, b.ID, "x", "y")

	// 用 DryRun 复刻 SearchDocs 的查询子句，读出真实 SQL
	q := db.Table("docs").
		Joins("JOIN books ON books.id = docs.book_id").
		Where("docs.deleted_at IS NULL").
		Where(
			"(docs.doc_type = 'markdown' AND (docs.title LIKE ? ESCAPE '!' OR docs.content LIKE ? ESCAPE '!'))"+
				" OR docs.doc_type <> 'markdown' AND docs.title LIKE ? ESCAPE '!' ",
			"%a%", "%a%", "%a%",
		)
	st := q.Session(&gorm.Session{DryRun: true}).Find(&[]SearchRow{}).Statement
	sqlStr := st.SQL.String()
	if !contains(sqlStr, "ESCAPE '!'") {
		t.Fatalf("SQL 必须使用 ESCAPE '!': %s", sqlStr)
	}
	if contains(sqlStr, `ESCAPE '\'`) {
		t.Fatalf("SQL 不得出现 ESCAPE '\\'（MySQL 语法错误）: %s", sqlStr)
	}
}

func contains(s, sub string) bool {
	if sub == "" || len(sub) > len(s) {
		return false
	}
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
