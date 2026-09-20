package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// withConfDir 把 CONF_DIR 指向临时目录并写入给定内容，返回清理函数。
func withConfDir(t *testing.T, content string) string {
	t.Helper()
	dir := t.TempDir()
	if content != "" {
		if err := os.WriteFile(filepath.Join(dir, "application.yml"), []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	t.Setenv("CONF_DIR", dir)
	// 隔离环境变量：这些都是历史部署变量，测试里必须显式清掉才不会相互污染
	for _, k := range []string{"PORT", "GIN_MODE", "JWT_SECRET", "DB_DRIVER", "DB_DSN", "DATA_DIR", "STORAGE_TYPE"} {
		t.Setenv(k, "")
	}
	return filepath.Join(dir, "application.yml")
}

func TestLoadFromFile(t *testing.T) {
	withConfDir(t, `
server:
  port: 9099
  mode: release
jwt:
  secret: sss
database:
  driver: mysql
  host: db.internal
  port: 3307
  user: wiki
  password: pw
  name: haiku
storage:
  type: local
  local:
    dir: /var/lib/haiku
upload:
  max_size_mb: 128
`)
	c := Load()
	if c.Port != "9099" || c.GINMode != "release" || c.JWTSecret != "sss" {
		t.Fatalf("server/jwt 段未生效: %+v", c)
	}
	if c.DBDriver != DBMySQL {
		t.Fatalf("driver=%s", c.DBDriver)
	}
	// dsn 为空时应由拆分字段拼出 MySQL 串
	want := "wiki:pw@tcp(db.internal:3307)/haiku?charset=utf8mb4&parseTime=True&loc=Local"
	if c.DBDSN != want {
		t.Fatalf("dsn=%q want=%q", c.DBDSN, want)
	}
	if c.DataDir != "/var/lib/haiku" || c.StorageType != StorageLocal {
		t.Fatalf("storage 段未生效: %+v", c)
	}
	if c.MaxUploadMB != 128 || c.UploadMaxBytes() != 128<<20 {
		t.Fatalf("upload 段未生效: %d", c.MaxUploadMB)
	}
	if c.Path == "" {
		t.Fatal("Path 应记录生效的配置文件路径，供迁移功能改写")
	}
}

func TestLoadSQLiteDefaultDSN(t *testing.T) {
	withConfDir(t, "storage:\n  local:\n    dir: /tmp/haiku-data\n")
	c := Load()
	if c.DBDriver != DBSQLite {
		t.Fatalf("driver=%s", c.DBDriver)
	}
	if c.DBDSN != "/tmp/haiku-data/haiku.db" {
		t.Fatalf("dsn=%q，应落在数据目录下", c.DBDSN)
	}
}

// TestLoadSQLiteIgnoresMysqlFields driver=sqlite 的 yml 里残留 mysql 拆分字段
// （host/user/password/name，常见于从 MySQL 迁回 SQLite 的部署）时，绝不能把
// 这些字段拼成 MySQL 连接串去占位空 dsn —— 否则 sqlite 分支会拿连接串当文件
// 路径 open，报 "out of memory (14)" 的怪错。dsn 必须回落默认 <DataDir>/haiku.db。
func TestLoadSQLiteIgnoresMysqlFields(t *testing.T) {
	withConfDir(t, `
database:
  driver: sqlite
  dsn: ""
  host: 192.168.31.252
  port: 3306
  user: haiku
  password: "Jihai2026"
  name: haiku
storage:
  local:
    dir: /tmp/haiku-data
`)
	c := Load()
	if c.DBDriver != DBSQLite {
		t.Fatalf("driver=%s", c.DBDriver)
	}
	if strings.Contains(c.DBDSN, "@tcp(") {
		t.Fatalf("sqlite 驱动不应拼出 MySQL 连接串，dsn=%q", c.DBDSN)
	}
	if c.DBDSN != "/tmp/haiku-data/haiku.db" {
		t.Fatalf("dsn=%q，应回落默认数据目录", c.DBDSN)
	}
}

// TestLoadEnvDriverAssemblesMysqlDSN 文件只给拆分字段、由 DB_DRIVER=mysql 环境变量
// 切驱动的部署：拼装必须在 driver 终态确定后进行，这条组合不能回归。
func TestLoadEnvDriverAssemblesMysqlDSN(t *testing.T) {
	withConfDir(t, `
database:
  host: db.internal
  port: 3307
  user: wiki
  password: pw
  name: haiku
`)
	t.Setenv("DB_DRIVER", "mysql")
	c := Load()
	if c.DBDriver != DBMySQL {
		t.Fatalf("driver=%s", c.DBDriver)
	}
	want := "wiki:pw@tcp(db.internal:3307)/haiku?charset=utf8mb4&parseTime=True&loc=Local"
	if c.DBDSN != want {
		t.Fatalf("dsn=%q want=%q", c.DBDSN, want)
	}
}

func TestEnvOverridesFile(t *testing.T) {
	withConfDir(t, "server:\n  port: 9099\nstorage:\n  local:\n    dir: /from-file\n")
	t.Setenv("PORT", "7777")
	t.Setenv("DATA_DIR", "/from-env")
	t.Setenv("STORAGE_TYPE", "s3")
	c := Load()
	if c.Port != "7777" || c.DataDir != "/from-env" || !c.UseS3() {
		t.Fatalf("环境变量未覆盖文件: %+v", c)
	}
}

func TestUnknownStorageFallsBackLocal(t *testing.T) {
	withConfDir(t, "storage:\n  type: gcs\n")
	if c := Load(); c.StorageType != StorageLocal {
		t.Fatalf("未知存储类型应回落 local，实际 %s", c.StorageType)
	}
}

func TestNoConfigFileUsesDefaults(t *testing.T) {
	withConfDir(t, "") // 目录存在但无文件
	c := Load()
	if c.Port != "8080" || c.DBDriver != DBSQLite || c.StorageType != StorageLocal {
		t.Fatalf("默认值异常: %+v", c)
	}
	if c.Path != "" {
		t.Fatalf("无配置文件时 Path 应为空，实际 %q", c.Path)
	}
}

func TestUpdateKeepsComments(t *testing.T) {
	path := withConfDir(t, `# 顶部注释
server:
  # 端口说明
  port: 8080

database:
  # 驱动：sqlite 或 mysql
  driver: sqlite
`)
	if err := Update(map[string]interface{}{"database.driver": "mysql", "storage.type": "s3"}); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	s := string(raw)
	for _, want := range []string{"# 顶部注释", "# 端口说明", "# 驱动：sqlite 或 mysql"} {
		if !strings.Contains(s, want) {
			t.Fatalf("改写后丢失注释 %q：\n%s", want, s)
		}
	}
	if !strings.Contains(s, "driver: mysql") {
		t.Fatalf("driver 未改写：\n%s", s)
	}
	if !strings.Contains(s, "type: s3") {
		t.Fatalf("新增键 storage.type 未写入：\n%s", s)
	}

	// 改写结果必须能被重新加载（否则迁移后就起不来了）
	c := Load()
	if c.DBDriver != DBMySQL || !c.UseS3() || c.Port != "8080" {
		t.Fatalf("回读异常: %+v", c)
	}
}

func TestUpdateCreatesFileWhenMissing(t *testing.T) {
	path := withConfDir(t, "")
	if err := Update(map[string]interface{}{"storage.type": "s3", "s3.bucket": "b1"}); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("配置文件未创建: %v", err)
	}
	if c := Load(); !c.UseS3() || c.S3.Bucket != "b1" {
		t.Fatalf("回读异常: %+v", c)
	}
}
