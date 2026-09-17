// Package repository GORM 数据访问层 + 数据库初始化。
package repository

import (
	"database/sql"
	"fmt"
	"os"
	"time"

	"github.com/glebarez/sqlite"
	"gorm.io/driver/mysql"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"haiku-wiki/server/internal/config"
	"haiku-wiki/server/internal/model"
)

var db *gorm.DB

// SetDB 注入全局 DB。
func SetDB(g *gorm.DB) { db = g }

// DB 取全局 DB。
func DB() *gorm.DB { return db }

// Connect 按配置建立数据库连接并做基础调优。
func Connect(cfg *config.Config) (*gorm.DB, error) {
	// 确保数据目录存在（SQLite 文件与 uploads 根目录）
	if err := os.MkdirAll(cfg.DataDir, 0o755); err != nil {
		return nil, fmt.Errorf("create data dir: %w", err)
	}

	var (
		g   *gorm.DB
		err error
	)
	gormLog := logger.Default.LogMode(logger.Warn)
	switch cfg.DBDriver {
	case "mysql":
		if cfg.DBDSN == "" {
			return nil, fmt.Errorf("DB_DRIVER=mysql 需要显式配置 DB_DSN")
		}
		g, err = gorm.Open(mysql.Open(cfg.DBDSN), &gorm.Config{Logger: gormLog})
	case "sqlite":
		fallthrough
	default:
		dsn := cfg.DBDSN
		// 追加 WAL 与 busy_timeout 参数（glebarez/sqlite 的 pragma 写法）
		sep := "?"
		if len(dsn) > 0 {
			for _, c := range dsn {
				if c == '?' {
					sep = "&"
					break
				}
			}
		}
		dsn = dsn + sep + "_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)"
		g, err = gorm.Open(sqlite.Open(dsn), &gorm.Config{Logger: gormLog})
	}
	if err != nil {
		return nil, fmt.Errorf("open database: %w", err)
	}
	if sqlDB, e := g.DB(); e == nil {
		sqlDB.SetMaxOpenConns(20)
		sqlDB.SetMaxIdleConns(5)
		sqlDB.SetConnMaxLifetime(time.Hour)
	}
	db = g
	return g, nil
}

// AutoMigrate 建表/补列（幂等）。
func AutoMigrate(g *gorm.DB) error {
	return g.AutoMigrate(
		&model.User{},
		&model.Book{},
		&model.Doc{},
		&model.DocVersion{},
		&model.Attachment{},
		&model.DocShare{},
	)
}

// MigrateData 一次性幂等数据修正（在 AutoMigrate 之后调用）。
// datatable 类型已下线：与 sheet 同实现、同 JSON 契约，存量记录直接改类型字段即可，内容无需转换。
// 重复执行不产生任何副作用（无 datatable 记录时 UPDATE 影响 0 行）。
func MigrateData(g *gorm.DB) error {
	if err := g.Exec("UPDATE docs SET doc_type = 'sheet' WHERE doc_type = 'datatable'").Error; err != nil {
		return fmt.Errorf("migrate datatable->sheet: %w", err)
	}
	return nil
}

// isNoRows 供上层判断"查无记录"（保留给未来扩展）。
var _ = sql.ErrNoRows
