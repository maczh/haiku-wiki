package handler

import (
	"github.com/gin-gonic/gin"

	"haiku-wiki/server/internal/middleware"
	"haiku-wiki/server/internal/repository"
	resp "haiku-wiki/server/internal/pkg"
	"haiku-wiki/server/internal/service"
)

var apiRefreshService = &service.ApiRefreshService{}

// RefreshDocApi POST /api/docs/:id/refresh —— 手动刷新单篇接口文档（需写权限；P0-8）。
//
// 抓取 doc_api_sources.source_url → 解析 → 原地合并（保留 endpoint id）→ 回写内容。
// 返回本次（新增, 更新, 失效）接口数；失败返回错误（不含原文，便于前端提示）。
func RefreshDocApi(c *gin.Context) {
	docID, ok := docIDFromPath(c)
	if !ok {
		resp.Error(c, paramMsg("无效的文档 ID"))
		return
	}
	added, updated, removed, err := apiRefreshService.RefreshDoc(middleware.UID(c), docID)
	if err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, gin.H{"added": added, "updated": updated, "removed": removed})
}

// GetApiRefreshStatus GET /api/docs/:id/api-refresh-status —— 当前文档的导入来源与上次刷新结果（需读权限；P1-2）。
//
// 未登记来源时返回 { source: null }（不报错，前端据此隐藏「上次刷新」信息）。
func GetApiRefreshStatus(c *gin.Context) {
	docID, ok := docIDFromPath(c)
	if !ok {
		resp.Error(c, paramMsg("无效的文档 ID"))
		return
	}
	if _, _, err := (&service.DocService{}).LoadForRead(middleware.UID(c), docID); err != nil {
		resp.Error(c, err)
		return
	}
	src, err := repository.FindDocApiSource(docID)
	if err != nil {
		resp.OK(c, gin.H{"source": nil})
		return
	}
	resp.OK(c, gin.H{"source": src})
}

// GetApiRefreshLastRun GET /api/admin/api-refresh/last —— 最近一次刷新任务汇总（仅管理员；P1-3）。
func GetApiRefreshLastRun(c *gin.Context) {
	run, err := repository.GetLastRun()
	if err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, run)
}
