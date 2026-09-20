// SQLite 数据目录可写性预检的回归测试。
// 场景来源：Docker 部署时宿主机 bind mount 目录属主为 root，容器内 UID 10001
// 无法在目录创建 SQLite -wal/-shm，glebarez 驱动报 "out of memory (14)" 的误导性错误。
package repository

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"haiku-wiki/server/internal/config"
)

// TestEnsureDirWritable 探针在可写目录应成功、只读目录必须失败。
func TestEnsureDirWritable(t *testing.T) {
	dir := t.TempDir()
	if err := ensureDirWritable(dir); err != nil {
		t.Fatalf("可写目录探针应成功: %v", err)
	}

	// root 对只读目录仍可写，该用例仅在非 root 下有意义
	if os.Geteuid() == 0 {
		t.Skip("当前以 root 运行，跳过只读目录用例")
	}
	ro := filepath.Join(t.TempDir(), "readonly")
	if err := os.Mkdir(ro, 0o555); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	defer os.Chmod(ro, 0o755) // 便于 TempDir 清理
	if err := ensureDirWritable(ro); err == nil {
		t.Fatal("只读目录探针应失败，却成功了")
	}
}

// TestConnectSQLiteReadOnlyDir 数据目录不可写时，Connect 必须给出
// 「数据目录不可写」的可操作提示，而不是透出驱动那句 "out of memory (14)"。
func TestConnectSQLiteReadOnlyDir(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("当前以 root 运行，只读目录用例无意义")
	}
	dir := t.TempDir()
	ro := filepath.Join(dir, "readonly")
	if err := os.Mkdir(ro, 0o555); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	defer os.Chmod(ro, 0o755)

	cfg := &config.Config{
		DBDriver: config.DBSQLite,
		DBDSN:    "", // 留空 → 默认落 <DataDir>/haiku.db
		DataDir:  ro,
	}
	_, err := Connect(cfg)
	if err == nil {
		t.Fatal("数据目录只读时 Connect 应失败")
	}
	if !strings.Contains(err.Error(), "数据目录不可写") {
		t.Fatalf("错误应包含可操作提示「数据目录不可写」，实际: %v", err)
	}
	if strings.Contains(err.Error(), "out of memory") {
		t.Fatalf("不应再把误导性的驱动文案透给用户，实际: %v", err)
	}
}

// TestConnectSQLiteReadOnlyFile 目录可写、但 db 文件本体不可写（如被 chattr +i、
// 属主错乱）时，Connect 应报「无法以读写方式打开 SQLite 数据库文件」并给出真实
// errno 提示，而不是让 gorm 透出 out of memory (14)。
func TestConnectSQLiteReadOnlyFile(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("当前以 root 运行，只读文件用例无意义")
	}
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "haiku.db")
	if err := os.WriteFile(dbPath, []byte("SQLite format 3\x00"), 0o444); err != nil {
		t.Fatalf("seed db file: %v", err)
	}
	defer os.Chmod(dbPath, 0o644) // 便于清理

	cfg := &config.Config{
		DBDriver: config.DBSQLite,
		DBDSN:    dbPath,
		DataDir:  dir, // 目录可写 → 目录预检通过，失败必须落在文件级预检
	}
	_, err := Connect(cfg)
	if err == nil {
		t.Fatal("db 文件不可写时 Connect 应失败")
	}
	if !strings.Contains(err.Error(), "无法以读写方式打开 SQLite 数据库文件") {
		t.Fatalf("错误应包含文件级预检提示，实际: %v", err)
	}
	if strings.Contains(err.Error(), "out of memory") {
		t.Fatalf("不应透出驱动误导文案，实际: %v", err)
	}
}

// TestConnectSQLiteConnStringDSN DB_DRIVER=sqlite 却给了 MySQL 连接串时，
// 必须立刻报「driver/DSN 不匹配」的可操作错误，而不是把连接串当文件路径去 open
// （那会报 no such file or directory 的怪信息，让人误以为是挂载/权限问题）。
func TestConnectSQLiteConnStringDSN(t *testing.T) {
	cfg := &config.Config{
		DBDriver: config.DBSQLite,
		DBDSN:    "haiku:secret@tcp(192.168.31.252:3306)/haiku",
		DataDir:  t.TempDir(),
	}
	_, err := Connect(cfg)
	if err == nil {
		t.Fatal("sqlite 分支给了 mysql 连接串时应失败")
	}
	if !strings.Contains(err.Error(), "DB_DSN 是数据库连接串格式") {
		t.Fatalf("应报 driver/DSN 不匹配，实际: %v", err)
	}
	if strings.Contains(err.Error(), "no such file or directory") {
		t.Fatalf("不应把连接串当文件路径去 open，实际: %v", err)
	}
}
