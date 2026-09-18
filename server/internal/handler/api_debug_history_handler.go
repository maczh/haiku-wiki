package handler

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"haiku-wiki/server/internal/middleware"
	"haiku-wiki/server/internal/service"
)

var apiDebugHistoryService = &service.ApiDebugHistoryService{}

type apiDebugHistoryRecordReq struct {
	EndpointID string                        `json:"endpoint_id"`
	Record     service.ApiDebugHistoryRecord `json:"record"`
}

// ListApiDebugHistory GET /api/docs/:id/api-debug-history?endpoint_id=xxx
// 列出当前用户对某接口的调试历史。
func ListApiDebugHistory(c *gin.Context) {
	docID, ok := docIDFromPath(c)
	if !ok {
		resp.Error(c, paramMsg("无效的文档 ID"))
		return
	}
	endpointID := c.Query("endpoint_id")
	if endpointID == "" {
		resp.Error(c, paramMsg("endpoint_id 不能为空"))
		return
	}
	records, err := apiDebugHistoryService.LoadHistory(middleware.UID(c), docID, endpointID)
	if err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, gin.H{"records": records})
}

// SaveApiDebugHistory POST /api/docs/:id/api-debug-history
// 保存一条调试历史（同一接口最近 10 条）。
func SaveApiDebugHistory(c *gin.Context) {
	docID, ok := docIDFromPath(c)
	if !ok {
		resp.Error(c, paramMsg("无效的文档 ID"))
		return
	}
	var req apiDebugHistoryRecordReq
	if err := c.ShouldBindJSON(&req); err != nil {
		resp.Error(c, paramErr(err))
		return
	}
	if req.EndpointID == "" {
		resp.Error(c, paramMsg("endpoint_id 不能为空"))
		return
	}
	if err := apiDebugHistoryService.SaveHistory(middleware.UID(c), docID, req.EndpointID, req.Record); err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, gin.H{"saved": true})
}

// DeleteApiDebugHistory DELETE /api/docs/:id/api-debug-history?endpoint_id=xxx&index=n
// 删除指定索引的调试历史。
func DeleteApiDebugHistory(c *gin.Context) {
	docID, ok := docIDFromPath(c)
	if !ok {
		resp.Error(c, paramMsg("无效的文档 ID"))
		return
	}
	endpointID := c.Query("endpoint_id")
	if endpointID == "" {
		resp.Error(c, paramMsg("endpoint_id 不能为空"))
		return
	}
	idx, err := strconv.Atoi(c.Query("index"))
	if err != nil || idx < 0 {
		resp.Error(c, paramMsg("index 参数错误"))
		return
	}
	if err := apiDebugHistoryService.DeleteHistoryByIndex(middleware.UID(c), docID, endpointID, idx); err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, gin.H{"deleted": true})
}
