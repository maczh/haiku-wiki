// Package repository GORM 数据访问层 + 数据库初始化。
package repository

import (
	"database/sql"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/glebarez/sqlite"
	"golang.org/x/crypto/bcrypt"
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
		// 空 DSN → 默认落 <DataDir>/haiku.db（最常见部署形态，Docker 部署即此）。
		if dsn == "" {
			dsn = filepath.Join(cfg.DataDir, "haiku.db")
		} else if dsnLooksLikeConnString(dsn) {
			// DB_DRIVER=sqlite 却给了 MySQL/PG 连接串：典型配置失误（把 mysql 的 dsn
			// 误填进了 sqlite 部署）。不要让后续把连接串当文件路径去 open —— 那只会报
			// "no such file or directory" 的怪信息，让人误以为是挂载/权限问题。
			return nil, fmt.Errorf(
				"DB_DRIVER=sqlite 但 DB_DSN 是数据库连接串格式（%q）。\n"+
					"请二选一：\n"+
					"  ① 用本地 SQLite → 把 DB_DSN 置空（默认打开 %s/haiku.db）；\n"+
					"  ② 用 MySQL     → 把 DB_DRIVER 改为 mysql，并正确配置 host/port/user/password/name 或 dsn。",
				dsn, cfg.DataDir)
		}
		// 追加 WAL 与 busy_timeout 参数（glebarez/sqlite 的 pragma 写法）
		sep := "?"
		if strings.Contains(dsn, "?") {
			sep = "&"
		}
		dsn = dsn + sep + "_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)"
		// SQLite(WAL) 不仅要求 db 文件本身可写，还要求「所在目录」可写：驱动需要在
		// 目录里创建 <db>-wal / <db>-shm。Docker 把宿主机目录 bind mount 进容器、而
		// 目录属主不是运行用户时，glebarez 纯 Go 驱动只会丢出一句摸不着头脑的
		// "unable to open database file: out of memory (14)"（14 = SQLITE_CANTOPEN，
		// "out of memory" 文案纯属误导）。先用探针文件把真实原因查出来，直接给出
		// 可操作的处理建议，别让用户对着 "out of memory" 排查内存。
		if err := ensureDirWritable(cfg.DataDir); err != nil {
			return nil, fmt.Errorf(
				"数据目录不可写: %s\n"+
					"SQLite(WAL) 需要在数据目录中创建 <db>-wal/-shm 文件，因此目录本身必须可写。\n"+
					"常见原因是 Docker 挂载的宿主机目录属主与容器运行用户（镜像内为 UID 10001）不一致，\n"+
					"请在宿主机执行: chown -R 10001:10001 <宿主机数据目录>（挂载的配置目录同理），\n"+
					"或使用 v2.1+ 镜像（入口脚本启动时自动修正挂载卷属主）。\n"+
					"底层错误: %w", cfg.DataDir, err)
		}
		// 目录可写 ≠ db 文件可打开：再对「文件本体」做一次 O_RDWR 打开测试，把真实
		// errno（EACCES/EPERM/EROFS…）照出来。实战中出现过目录 777、属主全对仍报
		// CANTOPEN 的部署，最终是文件被 chattr +i / AppArmor 拦截——只有直接 open
		// 文件才能把这类问题与普通属主问题区分开。
		dbFile := dsn
		if i := strings.IndexByte(dbFile, '?'); i >= 0 {
			dbFile = dbFile[:i]
		}
		if f, e := os.OpenFile(dbFile, os.O_RDWR|os.O_CREATE, 0o644); e != nil {
			hint := "请检查文件属主与权限（容器运行用户为 UID 10001）: chown 10001:10001 <db文件>；"
			if errors.Is(e, fs.ErrPermission) {
				hint += "权限被拒（EACCES/EPERM）：属主正确仍失败时，在宿主机用 lsattr <db文件> 检查是否被 chattr +i 锁定" +
					"（用 chattr -i 解锁），并检查 ACL(getfacl) 与安全模块（AppArmor/SELinux，容器可临时用 --security-opt apparmor=unconfined 验证）"
			} else {
				hint += "另请检查挂载是否只读(:ro)、磁盘是否写满"
			}
			return nil, fmt.Errorf("无法以读写方式打开 SQLite 数据库文件: %s\n%s\n底层错误: %w", dbFile, hint, e)
		} else {
			_ = f.Close()
		}
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
		// R5 新增域模型
		&model.Team{},
		&model.TeamMember{},
		&model.DocCollaborator{},
		// 公司知识库写授权表
		&model.BookWriter{},
		// 接口文档调试历史
		&model.ApiDebugHistory{},
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

// SeedData 启动种子数据（在 AutoMigrate + MigrateData 之后调用）：
//  1. 回填旧用户缺失的 username（=email）与 status（=1），phone 保持为空；
//  2. 内置管理员：若不存在 username='admin' 则插入 admin / Jihai2026。
func SeedData(g *gorm.DB) error {
	// 补 username（username 为空时取 email，保持唯一）
	if err := g.Exec("UPDATE users SET username = email WHERE username = '' OR username IS NULL").Error; err != nil {
		return fmt.Errorf("backfill username: %w", err)
	}
	// 补 status（缺省/异常值统一置为启用）
	if err := g.Exec("UPDATE users SET status = 1 WHERE status IS NULL OR status = 0").Error; err != nil {
		return fmt.Errorf("backfill status: %w", err)
	}

	// 内置管理员种子
	var cnt int64
	if err := g.Model(&model.User{}).Where("username = ?", "admin").Count(&cnt).Error; err != nil {
		return fmt.Errorf("count admin: %w", err)
	}
	if cnt > 0 {
		return nil
	}
	hash, err := bcrypt.GenerateFromPassword([]byte("Jihai2026"), bcrypt.DefaultCost)
	if err != nil {
		return fmt.Errorf("hash admin password: %w", err)
	}
	admin := &model.User{
		Username:     "admin",
		Email:        "admin@haiku.local",
		PasswordHash: string(hash),
		Nickname:     "管理员",
		Name:         "管理员",
		Role:         "admin",
		Status:       1,
	}
	if err := g.Create(admin).Error; err != nil {
		return fmt.Errorf("create admin: %w", err)
	}

	// 系统自动创建「公司知识库」（全员只读，管理员可授权协作编辑）
	if err := EnsureCompanyKB(); err != nil {
		return fmt.Errorf("auto create company kb: %w", err)
	}
	return nil
}

// isNoRows 供上层判断"查无记录"（保留给未来扩展）。
var _ = sql.ErrNoRows

// ensureDirWritable 通过「创建并删除一个探针文件」检测目录是否可写。
// 比只看权限位可靠：只读 bind mount、属主不一致等场景都能真实暴露。
func ensureDirWritable(dir string) error {
	probe, err := os.CreateTemp(dir, ".haiku-write-probe-*")
	if err != nil {
		return err
	}
	name := probe.Name()
	_ = probe.Close()
	_ = os.Remove(name)
	return nil
}

// dsnLooksLikeConnString 判断一个 DSN 是否像 MySQL/PostgreSQL 连接串而非文件路径。
// SQLite 的 DSN 是文件路径（可带 ?_pragma= 查询参数），绝不会含 @ / tcp( / ://；
// 这些字符是连接串的标志（user@host、mysql 的 @tcp(...)、postgres 的 scheme://）。
// 用于拦截「DB_DRIVER=sqlite 却填了 mysql dsn」这类配置失误，避免把连接串当文件 open。
func dsnLooksLikeConnString(s string) bool {
	if i := strings.IndexByte(s, '?'); i >= 0 {
		s = s[:i]
	}
	return strings.Contains(s, "@") || strings.Contains(s, "tcp(") || strings.Contains(s, "://")
}
