// 方言安全的 schema 不变量测试（§13.1 的护栏）。
//
// 为什么要有这层测试：这两个缺陷都**只在 MySQL 上炸**，本地 SQLite 一切正常——
// 一旦回归，只有切到生产才暴露（A3 是启动即失败，C4 是静默丢表）。
package repository

import (
	"path/filepath"
	"strings"
	"testing"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

// schemaRow sqlite_master 行。
type schemaRow struct {
	Type string `gorm:"column:type"`
	Name string `gorm:"column:name"`
	SQL  string `gorm:"column:sql"`
}

// indexInfoRow PRAGMA index_info 行。
type indexInfoRow struct {
	Name string `gorm:"column:name"`
}

func newSchemaDB(t *testing.T) *gorm.DB {
	t.Helper()
	g, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "schema.db")), &gorm.Config{})
	if err != nil {
		t.Fatalf("打开测试库失败: %v", err)
	}
	if err := AutoMigrate(g); err != nil {
		t.Fatalf("建表失败: %v", err)
	}
	return g
}

// TestNewTablesCreated 四张新表都必须建出来（漏了会静默丢功能）。
func TestNewTablesCreated(t *testing.T) {
	g := newSchemaDB(t)
	var rows []schemaRow
	if err := g.Raw("SELECT type, name, sql FROM sqlite_master").Scan(&rows).Error; err != nil {
		t.Fatalf("读取 schema 失败: %v", err)
	}
	has := map[string]bool{}
	for _, r := range rows {
		if r.Type == "table" {
			has[r.Name] = true
		}
	}
	for _, want := range []string{"doc_api_sources", "upload_stats", "api_refresh_runs", "attachment_derived"} {
		if !has[want] {
			t.Fatalf("表 %s 未创建（AutoMigrate 名单漏了？）", want)
		}
	}
	// 新增列（加列由 AutoMigrate 自动完成）
	if !strings.Contains(tableSQL(t, rows, "attachments"), "md5") {
		t.Fatal("attachments.md5 列缺失")
	}
	if !strings.Contains(tableSQL(t, rows, "docs"), "content_md5") {
		t.Fatal("docs.content_md5 列缺失")
	}
}

// TestDocApiSourceNoIndexOnSourceURL 守住 A3：`DocApiSource.SourceURL` **不得建索引**。
//
// MySQL 下 varchar(1024)×4B = 4096B > InnoDB 3072B 索引上限 ⇒ AutoMigrate 报
// `ERROR 1071 Specified key was too long`；而 Connect() 之后紧接着 AutoMigrate()
// ⇒ 切到 MySQL 时**进程启动即失败**（不是某个接口 500，是整站起不来）。
// 全设计也不存在"按 source_url 查询"的路径（刷新是遍历本表逐行取自身 URL）。
func TestDocApiSourceNoIndexOnSourceURL(t *testing.T) {
	g := newSchemaDB(t)

	var idx []indexInfoRow
	if err := g.Raw("PRAGMA index_list('doc_api_sources')").Scan(&idx).Error; err != nil {
		t.Fatalf("读取索引列表失败: %v", err)
	}
	for _, ix := range idx {
		var cols []indexInfoRow
		if err := g.Raw("PRAGMA index_info('" + ix.Name + "')").Scan(&cols).Error; err != nil {
			t.Fatalf("读取索引列失败: %v", err)
		}
		for _, c := range cols {
			if c.Name == "source_url" {
				t.Fatalf("doc_api_sources.source_url 不得建索引（MySQL 下 AutoMigrate 会 ERROR 1071）；命中索引 %q", ix.Name)
			}
		}
	}
	// GORM 过去用过的索引名也不应出现
	if err := g.Raw("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE '%doc_api_source_url%'").
		Scan(&idx).Error; err != nil {
		t.Fatalf("查索引名失败: %v", err)
	}
	if len(idx) != 0 {
		t.Fatalf("不应存在名为 doc_api_source_url* 的索引: %+v", idx)
	}
}

// TestAttachmentDerivedPrimaryKeyIsMD5 守住 A1/B5：派生缓存的主键是 md5（CAS 键），
// 两方言的 upsert 都靠它定位冲突目标。
func TestAttachmentDerivedPrimaryKeyIsMD5(t *testing.T) {
	g := newSchemaDB(t)
	type colRow struct {
		Name string `gorm:"column:name"`
		PK   int    `gorm:"column:pk"`
	}
	var cols []colRow
	if err := g.Raw("PRAGMA table_info('attachment_derived')").Scan(&cols).Error; err != nil {
		t.Fatalf("读取列信息失败: %v", err)
	}
	var pkCols []string
	for _, c := range cols {
		if c.PK > 0 {
			pkCols = append(pkCols, c.Name)
		}
	}
	if len(pkCols) != 1 || pkCols[0] != "md5" {
		t.Fatalf("attachment_derived 主键应为单个 md5，实际 %v", pkCols)
	}
}

func tableSQL(t *testing.T, rows []schemaRow, name string) string {
	t.Helper()
	for _, r := range rows {
		if r.Type == "table" && r.Name == name {
			return r.SQL
		}
	}
	t.Fatalf("表 %s 不存在", name)
	return ""
}
