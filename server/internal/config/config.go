// Package config 负责从环境变量加载服务配置。
package config

import (
	"os"
	"path/filepath"
	"strconv"
)

// Config 全局配置项（均来自环境变量，详见 .env.example）。
type Config struct {
	Port      string // HTTP 监听端口
	DBDriver  string // sqlite | mysql
	DBDSN     string // 数据库连接串
	JWTSecret string // JWT 签名密钥
	DataDir   string // 数据目录（SQLite 文件 + uploads/）
	GINMode   string // gin 运行模式 debug | release
}

func getenv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

// Load 读取环境变量并填充默认值。
func Load() *Config {
	dataDir := getenv("DATA_DIR", "./data")
	driver := getenv("DB_DRIVER", "sqlite")

	dsn := os.Getenv("DB_DSN")
	if dsn == "" {
		// SQLite 默认落在数据目录，开启 WAL 由连接串参数控制
		if driver == "sqlite" {
			dsn = filepath.Join(dataDir, "haiku.db")
		}
	}

	// JWT 密钥必须有值：开发默认值仅供本地调试
	secret := getenv("JWT_SECRET", "haiku-wiki-dev-secret-change-me")

	port := getenv("PORT", "8080")
	if _, err := strconv.Atoi(port); err != nil {
		port = "8080"
	}

	return &Config{
		Port:      port,
		DBDriver:  driver,
		DBDSN:     dsn,
		JWTSecret: secret,
		DataDir:   dataDir,
		GINMode:   getenv("GIN_MODE", "debug"),
	}
}
