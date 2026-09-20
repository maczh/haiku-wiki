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
	"haiku-wiki/server/internal/storage"
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
	// 种子数据：回填旧用户 username/status + 内置管理员
	if err := repository.SeedData(g); err != nil {
		log.Fatalf("[haiku] 种子数据失败: %v", err)
	}

	// 上传根目录注入（仅作兜底：真正的读写已走 storage 抽象）
	service.DataDir = cfg.DataDir
	// 存储后端初始化：local 写数据目录，S3 写对象存储。
	// 放这里而非更早：S3 初始化会探测桶可达性并 panic，让配置错误在启动期暴露，
	// 而不是等到第一次上传才报 500。
	storage.Init(cfg)
	// DWG 转换等需要落临时文件的导出流程：临时目录放在数据目录下，
	// 不能用系统 /tmp（容器与部分环境下 /tmp 是容量很小的 tmpfs，放不下图纸）。
	exportx.TempDir = filepath.Join(cfg.DataDir, "tmp")

	if cfg.GINMode == "release" {
		gin.SetMode(gin.ReleaseMode)
	}
	r := gin.New()
	r.Use(gin.Logger(), gin.Recovery())
	router.Register(r, cfg)

	// 接口文档 URL 导入来源的每日 02:00 自动刷新调度（C5：单机进程内 ticker，非 cron）。
	go service.StartApiRefreshScheduler()

	log.Printf("[haiku] 寄海文库启动于 :%s（DB=%s, DATA_DIR=%s, STORAGE=%s）",
		cfg.Port, cfg.DBDriver, cfg.DataDir, storage.Default().Kind())
	log.Printf("[haiku] DWG 转换能力：%s", exportx.DWGConverterStatus())
	if err := r.Run(":" + cfg.Port); err != nil {
		log.Fatalf("[haiku] 服务启动失败: %v", err)
	}
}
