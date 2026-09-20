package service

// 迁移成对改动的护栏测试（C4 / F7 硬约束）。
//
// `AutoMigrate` 与 `migrateTables` 必须在**同一次提交**改完：只加前者，新表会在
// "系统迁移"（SQLite ↔ MySQL）时被**静默漏掉**（迁移显示成功，数据却少了几张表）。
// 这里用「AutoMigrate 建出的每张业务表都必须有 copier」把它钉死。

import (
	"path/filepath"
	"testing"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"

	"haiku-wiki/server/internal/repository"
)

// TestMigrateTablesCoverAllAutoMigratedTables 表集合必须一一对应。
func TestMigrateTablesCoverAllAutoMigratedTables(t *testing.T) {
	g, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "cover.db")), &gorm.Config{})
	if err != nil {
		t.Fatalf("打开测试库失败: %v", err)
	}
	if err := repository.AutoMigrate(g); err != nil {
		t.Fatalf("建表失败: %v", err)
	}

	var names []string
	if err := g.Raw("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").
		Scan(&names).Error; err != nil {
		t.Fatalf("读取表名失败: %v", err)
	}
	if len(names) == 0 {
		t.Fatal("AutoMigrate 未建出任何表")
	}

	covered := map[string]bool{}
	for _, t2 := range migrateTables {
		covered[t2.name] = true
	}
	for _, n := range names {
		if !covered[n] {
			t.Fatalf("表 %s 已由 AutoMigrate 建出，但 migrateTables 没有对应 copier（迁移会静默丢表）", n)
		}
	}
	// 反向：copier 不得指向不存在的表（拼写错误会让迁移直接失败）
	exist := map[string]bool{}
	for _, n := range names {
		exist[n] = true
	}
	for _, t2 := range migrateTables {
		if !exist[t2.name] {
			t.Fatalf("migrateTables 里的 %s 不是 AutoMigrate 建出的表（表名写错了？）", t2.name)
		}
	}
}

// TestMigrateTablesLabelFixed 表名标签修正（F8/C9）：仅文案，但影响运维按标签排查。
func TestMigrateTablesLabelFixed(t *testing.T) {
	var sawFixed, sawOld bool
	for _, t2 := range migrateTables {
		if t2.name == "api_debug_history" {
			sawFixed = true
		}
		if t2.name == "api_debug_histories" {
			sawOld = true
		}
	}
	if !sawFixed {
		t.Fatal("标签应修正为真实表名 api_debug_history")
	}
	if sawOld {
		t.Fatal("不应再出现旧标签 api_debug_histories")
	}
}
