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
