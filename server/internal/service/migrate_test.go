package service

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"haiku-wiki/server/internal/config"
	"haiku-wiki/server/internal/model"
	"haiku-wiki/server/internal/repository"
	"haiku-wiki/server/internal/storage"
)

// waitMigrate 轮询等待异步迁移结束（迁移跑在 goroutine，测试必须等）。
func waitMigrate(t *testing.T, ms *MigrateService) MigrateStatus {
	t.Helper()
	deadline := time.Now().Add(30 * time.Second)
	for time.Now().Before(deadline) {
		st := ms.Status()
		if st.Status != "running" {
			return st
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("迁移超时未完成")
	return MigrateStatus{}
}

func TestMigrateDatabaseRejectsBadDriver(t *testing.T) {
	newEnv(t)
	ms := &MigrateService{}
	if _, err := ms.MigrateDatabase(DBMigrateInput{Driver: "oracle", DSN: "x"}); err == nil {
		t.Fatal("非法 driver 应报错")
	}
	if _, err := ms.MigrateDatabase(DBMigrateInput{Driver: config.DBSQLite}); err == nil {
		t.Fatal("SQLite 缺 dsn 应报错")
	}
	if _, err := ms.MigrateDatabase(DBMigrateInput{Driver: config.DBMySQL, Name: ""}); err == nil {
		t.Fatal("MySQL 缺 dsn/name 应报错")
	}
}

func TestMigrateStorageRejectsBadType(t *testing.T) {
	newEnv(t)
	ms := &MigrateService{}
	if _, err := ms.MigrateStorage(StorageMigrateInput{Type: "gcs"}); err == nil {
		t.Fatal("非法存储类型应报错")
	}
	if _, err := ms.MigrateStorage(StorageMigrateInput{Type: config.StorageS3}); err == nil {
		t.Fatal("S3 缺 bucket 应报错")
	}
}

// TestMigrateDatabaseSQLiteToSQLite 真实复制：源库 → 另一个 SQLite 文件，逐表核对。
//
// 用 SQLite→SQLite 而不是拉起 MySQL：单测不该依赖外部服务，而复制逻辑（分批、upsert、
// 依赖顺序）与具体驱动无关，能在这里被完整验证。
func TestMigrateDatabaseSQLiteToSQLite(t *testing.T) {
	newEnv(t)

	// 造源数据
	owner := mkUser(t, "mig@x.com", "pass123", "member")
	book := mkBook(t, owner.ID, "待迁移的库", "personal")
	doc := mkDoc(t, book, owner.ID, 0, "待迁移的文档")
	if _, _, err := (&DocService{}).UpdateDoc(owner.ID, doc.ID, nil, strPtr("# 正文"), "auto"); err != nil {
		t.Fatal(err)
	}
	if err := repository.CreateAttachment(&model.Attachment{
		UploaderID: owner.ID, Filename: "a.png", StoragePath: "uploads/2026/09/a.png",
		MimeType: "image/png", Size: 10,
	}); err != nil {
		t.Fatal(err)
	}

	dstFile := filepath.Join(t.TempDir(), "target.db")
	ms := &MigrateService{}
	if _, err := ms.MigrateDatabase(DBMigrateInput{
		Driver: config.DBSQLite, DSN: dstFile, Overwrite: true,
	}); err != nil {
		t.Fatal(err)
	}
	// 先记住运行库：下面核对数据时要自己连目标库，而 Connect 会顶掉全局 db，
	// 所以「未切换」的断言必须在连目标库之前做
	srcDB := repository.DB()
	st := waitMigrate(t, ms)
	if st.Status != "done" {
		t.Fatalf("迁移失败: %+v", st)
	}
	if st.Done != len(migrateTables) {
		t.Fatalf("应迁 %d 张表，实际 %d", len(migrateTables), st.Done)
	}
	if repository.DB() != srcDB {
		t.Fatal("switch=false 时不应切换运行库")
	}

	// 打开目标库核对
	dst, err := repository.Connect(&config.Config{
		DBDriver: config.DBSQLite, DBDSN: dstFile, DataDir: t.TempDir(),
	})
	if err != nil {
		t.Fatal(err)
	}
	var n int64
	if err := dst.Model(&model.Book{}).Where("id = ?", book.ID).Count(&n).Error; err != nil || n != 1 {
		t.Fatalf("目标库 book 缺失: n=%d err=%v", n, err)
	}
	var got model.Doc
	if err := dst.Where("id = ?", doc.ID).First(&got).Error; err != nil {
		t.Fatalf("目标库 doc 缺失: %v", err)
	}
	if got.Content != "# 正文" || got.Title != "待迁移的文档" {
		t.Fatalf("正文未保真: %+v", got)
	}
	var total int64
	dst.Model(&model.Attachment{}).Count(&total)
	if total != 1 {
		t.Fatalf("attachments 应 1 条，实际 %d", total)
	}
}

// TestMigrateDatabaseSwitchUpdatesConfig 迁移 + 切换：写配置并热切换运行库。
func TestMigrateDatabaseSwitchUpdatesConfig(t *testing.T) {
	newEnv(t)

	confDir := t.TempDir()
	t.Setenv("CONF_DIR", confDir)
	confPath := filepath.Join(confDir, "application.yml")
	if err := os.WriteFile(confPath, []byte("database:\n  # 保留我\n  driver: sqlite\n  dsn: /old/haiku.db\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	owner := mkUser(t, "mig2@x.com", "pass123", "member")
	mkBook(t, owner.ID, "源库", "personal")

	dstFile := filepath.Join(t.TempDir(), "new.db")
	ms := &MigrateService{}
	if _, err := ms.MigrateDatabase(DBMigrateInput{
		Driver: config.DBSQLite, DSN: dstFile, Switch: true, Overwrite: true,
	}); err != nil {
		t.Fatal(err)
	}
	st := waitMigrate(t, ms)
	if st.Status != "done" || !st.Switched {
		t.Fatalf("切换未生效: %+v", st)
	}

	// 配置必须被改写，且用户注释不能丢
	raw, err := os.ReadFile(confPath)
	if err != nil {
		t.Fatal(err)
	}
	s := string(raw)
	if !contains(s, "driver: sqlite") || !contains(s, dstFile) {
		t.Fatalf("配置未写入新 dsn:\n%s", s)
	}
	if !contains(s, "# 保留我") {
		t.Fatalf("注释被洗掉了:\n%s", s)
	}
	// 重新加载后应指向新库
	if c := config.Load(); c.DBDSN != dstFile {
		t.Fatalf("回读配置 dsn=%q", c.DBDSN)
	}
	// 热切换：运行库已指向目标
	var n int64
	repository.DB().Model(&model.Book{}).Where("owner_id = ?", owner.ID).Count(&n)
	if n != 1 {
		t.Fatalf("切换后运行库应能查到数据，实际 %d", n)
	}
}

// TestMigrateStorageLocalToLocal 文件迁移：源目录 → 目标目录，逐个核对内容。
func TestMigrateStorageLocalToLocal(t *testing.T) {
	newEnv(t)

	// 存储迁移切换时要改写配置，给个可写的配置目录
	t.Setenv("CONF_DIR", t.TempDir())
	// 源与目标必须是平级目录：t.TempDir() 每次调用返回同一目录，
	// 若把目标放在源的子目录下，列举与写入会互相干扰
	srcDir := filepath.Join(t.TempDir(), "src")
	dstDir := filepath.Join(t.TempDir(), "dst")
	storage.InitLocal(srcDir)
	st := storage.Default()
	files := map[string]string{
		"uploads/2026/09/a.png": "AAA",
		"uploads/2026/09/b.png": "BBBB",
		"uploads/2026/10/c.pdf": "C",
	}
	for k, v := range files {
		if err := st.Put(k, []byte(v), ""); err != nil {
			t.Fatal(err)
		}
	}

	ms := &MigrateService{}
	if _, err := ms.MigrateStorage(StorageMigrateInput{
		Type: config.StorageLocal, LocalDir: dstDir, Switch: true,
	}); err != nil {
		t.Fatal(err)
	}
	got := waitMigrate(t, ms)
	t.Logf("存储迁移状态: %+v", got)
	if got.Status != "done" || got.Failed != 0 {
		t.Fatalf("存储迁移失败: %+v", got)
	}
	if got.Done != len(files) {
		t.Fatalf("应迁 %d 个文件，实际 %d", len(files), got.Done)
	}
	for k, v := range files {
		b, err := os.ReadFile(filepath.Join(dstDir, filepath.FromSlash(k)))
		if err != nil {
			t.Fatalf("目标缺少 %s: %v", k, err)
		}
		if string(b) != v {
			t.Fatalf("%s 内容不符: %q", k, b)
		}
	}
	if !got.Switched {
		t.Fatal("未切换存储")
	}
}

func contains(s, sub string) bool {
	return len(s) >= len(sub) && (func() bool {
		for i := 0; i+len(sub) <= len(s); i++ {
			if s[i:i+len(sub)] == sub {
				return true
			}
		}
		return false
	})()
}
