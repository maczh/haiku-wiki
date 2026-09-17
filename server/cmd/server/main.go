// 寄海文库（haiku-wiki）服务入口：配置加载 → 数据库初始化 → 路由装配 → 启动。
package main

import (
	"log"
	"path/filepath"

	"github.com/gin-gonic/gin"

	"haiku-wiki/server/internal/config"
	"haiku-wiki/server/internal/pkg/jwtutil"
	"haiku-wiki/server/internal/repository"
	"haiku-wiki/server/internal/router"
	"haiku-wiki/server/internal/service"
	"haiku-wiki/server/internal/service/exportx"
)

func main() {
	cfg := config.Load()

	// JWT 密钥注入
	jwtutil.Init(cfg.JWTSecret)

	// 数据库连接 + 自动迁移
	g, err := repository.Connect(cfg)
	if err != nil {
		log.Fatalf("[haiku] 数据库初始化失败: %v", err)
	}
	if err := repository.AutoMigrate(g); err != nil {
		log.Fatalf("[haiku] 自动迁移失败: %v", err)
	}
	// 一次性幂等数据修正：datatable 存量 → sheet
	if err := repository.MigrateData(g); err != nil {
		log.Fatalf("[haiku] 数据修正失败: %v", err)
	}

	// 上传根目录注入
	service.DataDir = cfg.DataDir
	// DWG 转换等需要落临时文件的导出流程：临时目录放在数据目录下，
	// 不能用系统 /tmp（容器与部分环境下 /tmp 是容量很小的 tmpfs，放不下图纸）。
	exportx.TempDir = filepath.Join(cfg.DataDir, "tmp")

	if cfg.GINMode == "release" {
		gin.SetMode(gin.ReleaseMode)
	}
	r := gin.New()
	r.Use(gin.Logger(), gin.Recovery())
	router.Register(r, cfg)

	log.Printf("[haiku] 寄海文库启动于 :%s（DB=%s, DATA_DIR=%s）", cfg.Port, cfg.DBDriver, cfg.DataDir)
	log.Printf("[haiku] DWG 转换能力：%s", exportx.DWGConverterStatus())
	if err := r.Run(":" + cfg.Port); err != nil {
		log.Fatalf("[haiku] 服务启动失败: %v", err)
	}
}
