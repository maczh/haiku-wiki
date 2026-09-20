package handler

import (
	"github.com/gin-gonic/gin"

	"haiku-wiki/server/internal/pkg"
	"haiku-wiki/server/internal/service"
	"haiku-wiki/server/internal/storage"
)

// 路由挂在 /api/admin 组下，管理员鉴权由 middleware.RequireAdmin() 统一负责，
// 这里不再重复校验（避免两处口径漂移）。

var migrateService service.MigrateService

// MigrateStatus GET /api/admin/migrate/status —— 查询迁移进度。
func MigrateStatus(c *gin.Context) {
	resp.OK(c, gin.H{"job": migrateService.Status()})
}

// MigrateConfig GET /api/admin/migrate/config —— 当前生效的数据库与存储配置。
// 密钥类字段一律不回传：这里只回答「现在用的是什么」。
func MigrateConfig(c *gin.Context) {
	cfg := storage.Cfg()
	driver, stType, s3Bucket, s3Endpoint, path := "", "", "", "", ""
	if cfg != nil {
		driver, stType = cfg.DBDriver, cfg.StorageType
		s3Bucket, s3Endpoint, path = cfg.S3.Bucket, cfg.S3.Endpoint, cfg.Path
	}
	resp.OK(c, gin.H{
		"database_driver": driver,
		"storage_type":    stType,
		"s3_bucket":       s3Bucket,
		"s3_endpoint":     s3Endpoint,
		// 配置文件为空说明是纯环境变量模式，迁移后无法自动改写配置
		"config_file": path,
	})
}

// MigrateDatabase POST /api/admin/migrate/database —— 迁移数据库（异步）。
// 请求体见 service.DBMigrateInput；switch=true 时成功后立即切到新库并改写配置。
func MigrateDatabase(c *gin.Context) {
	var in service.DBMigrateInput
	if err := c.ShouldBindJSON(&in); err != nil {
		resp.Error(c, paramMsg("请求体解析失败"))
		return
	}
	st, err := migrateService.MigrateDatabase(in)
	if err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, gin.H{"job": st})
}

// MigrateStorage POST /api/admin/migrate/storage —— 迁移文件存储（异步）。
func MigrateStorage(c *gin.Context) {
	var in service.StorageMigrateInput
	if err := c.ShouldBindJSON(&in); err != nil {
		resp.Error(c, paramMsg("请求体解析失败"))
		return
	}
	st, err := migrateService.MigrateStorage(in)
	if err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, gin.H{"job": st})
}

// TestDatabaseConnection POST /api/admin/migrate/database/test —— 迁移前测试数据库连接。
func TestDatabaseConnection(c *gin.Context) {
	var in service.DBMigrateInput
	if err := c.ShouldBindJSON(&in); err != nil {
		resp.Error(c, paramMsg("请求体解析失败"))
		return
	}
	if err := migrateService.TestDatabaseConnection(in); err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, gin.H{"message": "连接成功"})
}

// TestStorageConnection POST /api/admin/migrate/storage/test —— 迁移前测试存储连接。
func TestStorageConnection(c *gin.Context) {
	var in service.StorageMigrateInput
	if err := c.ShouldBindJSON(&in); err != nil {
		resp.Error(c, paramMsg("请求体解析失败"))
		return
	}
	if err := migrateService.TestStorageConnection(in); err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, gin.H{"message": "连接成功"})
}
