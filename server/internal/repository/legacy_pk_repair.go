package repository

import (
	"fmt"
	"log"
	"sort"
	"strings"

	"gorm.io/gorm"
)

// legacyPKTarget 一张需要「补自增 id 主键」的历史表。
//
// 背景：TeamMember / DocCollaborator 现在的形态是「自增 id 作唯一主键 + (业务对) 组合唯一
// 索引」。但历史库里的这两张表是 2 列复合主键、**没有 id 列** —— GORM 无法给已存在的
// 复合主键表就地补自增主键列，AutoMigrate 在两种方言上都直接失败，而 main.go 对
// AutoMigrate 失败是 log.Fatalf ⇒ 所有存量部署升级后进程起不来（R20）：
//   - MySQL:  Error 1068 (42000): Multiple primary key defined
//   - SQLite: SQL logic error: Cannot add a PRIMARY KEY column (1)
//
// 所以必须在 AutoMigrate **之前**把这两张表的结构修到「有 id 列」。
// 修复只负责把列补上；(业务对) 的组合唯一索引交给随后的 AutoMigrate 按模型创建 ——
// 那是 GORM 自己的职责，且它幂等。
// 只修这两张表（写死清单）：book_writers 仍是 2 列复合主键、结构与模型一致，**必须排除**
// （R21）。不做通用反射式 schema 修复 —— 过度设计且风险高（§14.4）。
type legacyPKTarget struct {
	Table    string   // 表名
	LegacyPK []string // 旧复合主键列（迁移前的 PRIMARY KEY）
	Cols     []string // 搬数据时要带的业务列（不含 id）
	// SQLite 重建用：新表 DDL，逐字符对齐 GORM 在全新空库上的产出。
	// ⚠️ 绝不能再写表级 PRIMARY KEY 子句 —— 内联 `PRIMARY KEY AUTOINCREMENT` 与表级
	// PRIMARY KEY 并存会报 `has more than one primary key`，而失败点在 DROP TABLE 之后
	// ⇒ 旧表已删、数据只剩 0 行（数据丢失，不是干净报错）。
	SQLiteNewDDL string
}

var legacyPKTargets = []legacyPKTarget{
	{
		Table:        "team_members",
		LegacyPK:     []string{"team_id", "user_id"},
		Cols:         []string{"team_id", "user_id", "role", "created_at"},
		SQLiteNewDDL: "CREATE TABLE `team_members__new` (`id` integer PRIMARY KEY AUTOINCREMENT,`team_id` integer,`user_id` integer,`role` text DEFAULT \"read_write\",`created_at` datetime)",
	},
	{
		Table:        "doc_collaborators",
		LegacyPK:     []string{"doc_id", "user_id"},
		Cols:         []string{"doc_id", "user_id", "created_at"},
		SQLiteNewDDL: "CREATE TABLE `doc_collaborators__new` (`id` integer PRIMARY KEY AUTOINCREMENT,`doc_id` integer,`user_id` integer,`created_at` datetime)",
	},
}

// RepairLegacyPrimaryKeys 幂等地修复历史库中 team_members / doc_collaborators 的主键结构。
//
// 幂等判据（三项**同时**成立才修）：
//  1. 表存在；
//  2. 缺 `id` 列；
//  3. 主键列集合恰好等于旧复合主键集合。
//
// 其余一律 no-op：表不存在（交给 AutoMigrate 按新模型建）、已有 `id`（已修过或全新库）、
// 既无 `id` 又非旧复合主键（异常态 —— 记日志跳过，不猜、不自动乱改）。
// 已修过的库二次进入时**零写入**，启动日志里不会再出现 `repair legacy PK` 行。
func RepairLegacyPrimaryKeys(g *gorm.DB) error {
	if g == nil {
		return nil
	}
	dialect := g.Dialector.Name()
	if dialect != "sqlite" && dialect != "mysql" {
		// 未适配的方言不做任何事（AutoMigrate 自己会给出它自己的错误）。
		log.Printf("[migrate] repair legacy PK: dialect %q 未适配，跳过", dialect)
		return nil
	}
	for _, t := range legacyPKTargets {
		done, err := repairLegacyPKOne(g, dialect, t)
		if err != nil {
			return fmt.Errorf("repair legacy PK table=%s: %w", t.Table, err)
		}
		if done {
			log.Printf("[migrate] repair legacy PK table=%s from=(%s) to=(id)", t.Table, strings.Join(t.LegacyPK, ","))
		}
	}
	return nil
}

// repairLegacyPKOne 修一张表；返回是否真的做了修复（false = no-op）。
func repairLegacyPKOne(g *gorm.DB, dialect string, t legacyPKTarget) (bool, error) {
	if !g.Migrator().HasTable(t.Table) {
		return false, nil // 全新库：交给 AutoMigrate 建表
	}
	hasID, err := columnExists(g, dialect, t.Table, "id")
	if err != nil {
		return false, err
	}
	if hasID {
		return false, nil // 已修过（或全新库已由 AutoMigrate 建好）：零写入
	}

	pk, err := primaryKeyColumns(g, dialect, t.Table)
	if err != nil {
		return false, err
	}
	if !sameStringSet(pk, t.LegacyPK) {
		// 异常态：既没有 id、主键也不是我们认识的那副旧样子。不猜。
		log.Printf("[migrate] repair legacy PK table=%s: 主键为 (%s) 而非预期的旧复合主键 (%s)，跳过（不自动改动）",
			t.Table, strings.Join(pk, ","), strings.Join(t.LegacyPK, ","))
		return false, nil
	}

	if dialect == "mysql" {
		// 单条 ALTER 原子完成；必须带 DROP PRIMARY KEY，否则 Error 1068。
		// 组合唯一索引交给随后的 AutoMigrate 按模型创建。
		ddl := fmt.Sprintf("ALTER TABLE `%s` ADD `id` bigint unsigned NOT NULL AUTO_INCREMENT, DROP PRIMARY KEY, ADD PRIMARY KEY (`id`)", t.Table)
		if err := g.Exec(ddl).Error; err != nil {
			return false, err
		}
		return true, nil
	}

	// SQLite 不能 ALTER 加主键，走表重建。整段包进事务：任何一步失败都回滚，
	// 绝不出现「旧表已 DROP 而新表没建好」的半截状态。
	return true, g.Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec(t.SQLiteNewDDL).Error; err != nil {
			return err
		}
		// 只搬旧表里真实存在的列：容忍旧库列序/缺列的形状漂移（缺的列由新表默认值兜底）。
		oldCols, err := allColumns(tx, dialect, t.Table)
		if err != nil {
			return err
		}
		present := make([]string, 0, len(t.Cols))
		for _, c := range t.Cols {
			if _, ok := oldCols[c]; ok {
				present = append(present, c)
			}
		}
		if len(present) > 0 {
			// 不指定 id，让 SQLite 自增顺序补号（保住旧数据）。
			q := fmt.Sprintf("INSERT INTO `%s__new` (`%s`) SELECT `%s` FROM `%s`",
				t.Table, strings.Join(present, "`,`"), strings.Join(present, "`,`"), t.Table)
			if err := tx.Exec(q).Error; err != nil {
				return err
			}
		}
		if err := tx.Exec(fmt.Sprintf("DROP TABLE `%s`", t.Table)).Error; err != nil {
			return err
		}
		return tx.Exec(fmt.Sprintf("ALTER TABLE `%s__new` RENAME TO `%s`", t.Table, t.Table)).Error
	})
}

// primaryKeyColumns 取一张表的主键列（按序）。SQLite 走 pragma_table_info 的 pk 位次；
// MySQL 走 information_schema.statistics 的 seq_in_index。
func primaryKeyColumns(g *gorm.DB, dialect, table string) ([]string, error) {
	var cols []string
	var q string
	switch dialect {
	case "sqlite":
		q = "SELECT name FROM pragma_table_info(?) WHERE pk > 0 ORDER BY pk"
	case "mysql":
		q = "SELECT column_name FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? AND index_name = 'PRIMARY' ORDER BY seq_in_index"
	default:
		return nil, fmt.Errorf("dialect %q 未适配", dialect)
	}
	if err := g.Raw(q, table).Scan(&cols).Error; err != nil {
		return nil, err
	}
	return cols, nil
}

// allColumns 取一张表的全部列名集合。
func allColumns(g *gorm.DB, dialect, table string) (map[string]struct{}, error) {
	out := map[string]struct{}{}
	var q string
	switch dialect {
	case "sqlite":
		q = "SELECT name FROM pragma_table_info(?)"
	case "mysql":
		q = "SELECT column_name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ?"
	default:
		return nil, fmt.Errorf("dialect %q 未适配", dialect)
	}
	var cols []string
	if err := g.Raw(q, table).Scan(&cols).Error; err != nil {
		return nil, err
	}
	for _, c := range cols {
		out[c] = struct{}{}
	}
	return out, nil
}

// columnExists 判断某列是否存在。
func columnExists(g *gorm.DB, dialect, table, col string) (bool, error) {
	cols, err := allColumns(g, dialect, table)
	if err != nil {
		return false, err
	}
	_, ok := cols[col]
	return ok, nil
}

// sameStringSet 集合相等比较（顺序无关）。
func sameStringSet(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	x, y := append([]string(nil), a...), append([]string(nil), b...)
	sort.Strings(x)
	sort.Strings(y)
	for i := range x {
		if x[i] != y[i] {
			return false
		}
	}
	return true
}
