package repository

import (
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// openLegacySQLite 造一个「历史库」形状的旧库：两张表是 2 列复合主键、没有 id 列，
// book_writers 与现行模型一致（不该被修）。返回的库已含旧结构与若干旧数据。
func openLegacySQLite(t *testing.T) *gorm.DB {
	t.Helper()
	g, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "legacy.db")), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	stmts := []string{
		// 旧 team_members：复合主键、无 id、role 带默认值 —— 与线上旧库形状一致
		"CREATE TABLE `team_members` (`team_id` integer,`user_id` integer,`role` text DEFAULT \"read_write\",`created_at` datetime,PRIMARY KEY (`team_id`,`user_id`))",
		"CREATE TABLE `doc_collaborators` (`doc_id` integer,`user_id` integer,`created_at` datetime,PRIMARY KEY (`doc_id`,`user_id`))",
		// book_writers 本就与现行模型一致（仍是 2 列复合主键），必须原样保留
		"CREATE TABLE `book_writers` (`book_id` integer,`user_id` integer,`created_at` datetime,PRIMARY KEY (`book_id`,`user_id`))",
		"INSERT INTO `team_members` (`team_id`,`user_id`,`role`,`created_at`) VALUES (1,10,'admin','2026-01-01 00:00:00'),(1,11,'read_write','2026-01-02 00:00:00'),(2,12,'read_only','2026-01-03 00:00:00')",
		"INSERT INTO `doc_collaborators` (`doc_id`,`user_id`,`created_at`) VALUES (5,10,'2026-02-01 00:00:00'),(6,11,'2026-02-02 00:00:00')",
		"INSERT INTO `book_writers` (`book_id`,`user_id`,`created_at`) VALUES (7,10,'2026-03-01 00:00:00')",
	}
	for _, s := range stmts {
		if e := g.Exec(s).Error; e != nil {
			t.Fatalf("建旧库失败: %v\nSQL: %s", e, s)
		}
	}
	return g
}

func pkSet(t *testing.T, g *gorm.DB, table string) []string {
	t.Helper()
	var cols []string
	if err := g.Raw("SELECT name FROM pragma_table_info(?) WHERE pk > 0 ORDER BY pk", table).Scan(&cols).Error; err != nil {
		t.Fatalf("读 %s 主键失败: %v", table, err)
	}
	return cols
}

func mustCount(t *testing.T, g *gorm.DB, table string) int64 {
	t.Helper()
	var n int64
	if err := g.Table(table).Count(&n).Error; err != nil {
		t.Fatalf("count %s: %v", table, err)
	}
	return n
}

func noLeftoverNewTables(t *testing.T, g *gorm.DB) {
	t.Helper()
	var names []string
	if err := g.Raw("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%__new'").Scan(&names).Error; err != nil {
		t.Fatalf("查残留表失败: %v", err)
	}
	if len(names) != 0 {
		t.Fatalf("存在重建残留表（说明重建半途而废）: %v", names)
	}
}

// TestAutoMigrateRepairsLegacySQLite 【核心回归】线上故障的精确复现：
// 旧结构库 + AutoMigrate（正是启动时那条调用链）必须成功，且旧数据一行不丢。
// 修复前这里会死在 `Cannot add a PRIMARY KEY column (1)`（R20）。
func TestAutoMigrateRepairsLegacySQLite(t *testing.T) {
	g := openLegacySQLite(t)

	if err := AutoMigrate(g); err != nil { // ← 启动时的原样调用
		t.Fatalf("旧库 AutoMigrate 失败（R20 未修好）: %v", err)
	}

	// 结构：id 存在且为主键；模型声明的组合唯一索引也应由 AutoMigrate 建出来
	for _, tc := range []struct{ table, idx string }{
		{"team_members", "idx_team_user"},
		{"doc_collaborators", "idx_doc_user"},
	} {
		pk := pkSet(t, g, tc.table)
		if len(pk) != 1 || pk[0] != "id" {
			t.Fatalf("%s 修复后主键应为 (id)，实际 %v", tc.table, pk)
		}
		var ddl string
		g.Raw("SELECT sql FROM sqlite_master WHERE type='table' AND name=?", tc.table).Scan(&ddl)
		if !strings.Contains(ddl, "AUTOINCREMENT") {
			t.Fatalf("%s 的 id 应为自增（AUTOINCREMENT），DDL: %s", tc.table, ddl)
		}
		var idxCount int64
		if err := g.Raw("SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name=?", tc.idx).Scan(&idxCount).Error; err != nil {
			t.Fatalf("查索引失败: %v", err)
		}
		if idxCount != 1 {
			t.Fatalf("%s 应有组合唯一索引 %s（由 AutoMigrate 创建）", tc.table, tc.idx)
		}
	}

	// 数据：三表行数与内容都不能丢
	if got := mustCount(t, g, "team_members"); got != 3 {
		t.Fatalf("team_members 应保留 3 行，实际 %d", got)
	}
	if got := mustCount(t, g, "doc_collaborators"); got != 2 {
		t.Fatalf("doc_collaborators 应保留 2 行，实际 %d", got)
	}
	var roles []string
	if err := g.Table("team_members").Order("id").Pluck("role", &roles).Error; err != nil {
		t.Fatalf("读回 role 失败: %v", err)
	}
	sort.Strings(roles)
	// 重建后行序不保证与插入序一致（自增补号按存储顺序），断言按集合比较
	if len(roles) != 3 || roles[0] != "admin" || roles[1] != "read_only" || roles[2] != "read_write" {
		t.Fatalf("team_members 的 role 数据应原样保留，实际 %v", roles)
	}

	// 未误伤：book_writers 的结构与数据必须原样
	bw := pkSet(t, g, "book_writers")
	if len(bw) != 2 || bw[0] != "book_id" || bw[1] != "user_id" {
		t.Fatalf("book_writers 不应被改动，主键实际 %v", bw)
	}
	if got := mustCount(t, g, "book_writers"); got != 1 {
		t.Fatalf("book_writers 行数不应变，实际 %d", got)
	}

	// 幂等：再次 AutoMigrate 必须零写入（无残留表、行数不变）
	if err := AutoMigrate(g); err != nil {
		t.Fatalf("第二次 AutoMigrate 失败（幂等性破坏）: %v", err)
	}
	noLeftoverNewTables(t, g)
	if got := mustCount(t, g, "team_members"); got != 3 {
		t.Fatalf("二次启动后 team_members 行数变了：%d", got)
	}
}

// TestRepairLegacyPKNoopOnAlreadyRepaired 已修过的库直接调修复 → no-op（不报错、不改数据）。
func TestRepairLegacyPKNoopOnAlreadyRepaired(t *testing.T) {
	g := openLegacySQLite(t)
	if err := RepairLegacyPrimaryKeys(g); err != nil {
		t.Fatalf("首次修复失败: %v", err)
	}
	if err := RepairLegacyPrimaryKeys(g); err != nil {
		t.Fatalf("对已修库重复修复不应报错: %v", err)
	}
	if got := mustCount(t, g, "team_members"); got != 3 {
		t.Fatalf("重复修复不应改动行数，实际 %d", got)
	}
	noLeftoverNewTables(t, g)
}

// TestRepairLegacyPKSkipsAbnormalShape 既没有 id、主键又不是旧复合主键（异常态）→ 记日志跳过，不猜。
func TestRepairLegacyPKSkipsAbnormalShape(t *testing.T) {
	g, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "weird.db")), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	// 单列非自增主键：既不是旧复合主键，也不是 (id) 已修复态
	if e := g.Exec("CREATE TABLE `team_members` (`team_id` integer PRIMARY KEY,`user_id` integer,`role` text,`created_at` datetime)").Error; e != nil {
		t.Fatalf("建异常表失败: %v", e)
	}
	if e := g.Exec("INSERT INTO `team_members` (`team_id`,`user_id`,`role`) VALUES (1,2,'admin')").Error; e != nil {
		t.Fatalf("造数失败: %v", e)
	}
	if err := RepairLegacyPrimaryKeys(g); err != nil {
		t.Fatalf("异常形态应跳过而非报错: %v", err)
	}
	// 且没被乱改：仍是旧结构（没有多出 id 列）
	pk := pkSet(t, g, "team_members")
	if len(pk) != 1 || pk[0] != "team_id" {
		t.Fatalf("异常形态不应被改动，主键实际 %v", pk)
	}
	if got := mustCount(t, g, "team_members"); got != 1 {
		t.Fatalf("异常形态行数不应变，实际 %d", got)
	}
}

// TestFreshSQLiteAutoMigrateNoRepair 全新空库：AutoMigrate 直接建出新结构，无需修复。
func TestFreshSQLiteAutoMigrateNoRepair(t *testing.T) {
	g, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "fresh.db")), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	if err := AutoMigrate(g); err != nil {
		t.Fatalf("全新库 AutoMigrate 不应失败: %v", err)
	}
	pk := pkSet(t, g, "team_members")
	if len(pk) != 1 || pk[0] != "id" {
		t.Fatalf("全新库 team_members 主键应为 (id)，实际 %v", pk)
	}
	if err := AutoMigrate(g); err != nil {
		t.Fatalf("全新库二次 AutoMigrate 失败: %v", err)
	}
	noLeftoverNewTables(t, g)
}
