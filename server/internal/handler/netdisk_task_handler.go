package handler

import (
	"strconv"

	"github.com/gin-gonic/gin"

	"haiku-wiki/server/internal/middleware"
	resp "haiku-wiki/server/internal/pkg"
	"haiku-wiki/server/internal/service"
)

// 本文件：网盘任务中心（列表 / 详情 / 重试 / 取消 / 取导入产物）。
//
// 任务是「库 + 内存队列」双写：前端轮询 GET /:id 看进度，
// 取消与重试都是改库里的 status，worker 在下一个读块协作式退出。

// ListNetdiskTasks GET /api/netdisk-tasks?conn_id=&status=&limit=
func ListNetdiskTasks(c *gin.Context) {
	uid := middleware.UID(c)
	connID, _ := strconv.ParseUint(c.Query("conn_id"), 10, 64)
	limit, _ := strconv.Atoi(c.Query("limit"))
	list, err := service.NetdiskTaskSvc.List(uid, connID, c.Query("status"), limit)
	if err != nil {
		resp.Error(c, err)
		return
	}
	running, _ := service.NetdiskTaskSvc.CountRunning(uid)
	resp.OK(c, netdiskTaskListResp{Items: list, Running: running})
}

// GetNetdiskTask GET /api/netdisk-tasks/:id —— 任务详情（轮询进度）。
func GetNetdiskTask(c *gin.Context) {
	id, ok := netdiskTaskIDFromPath(c)
	if !ok {
		resp.Error(c, paramMsg("任务 ID 无效"))
		return
	}
	task, err := service.NetdiskTaskSvc.Get(id, middleware.UID(c))
	if err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, task)
}

// RetryNetdiskTask POST /api/netdisk-tasks/:id/retry —— 重试（仅 failed 且 retries<3）。
func RetryNetdiskTask(c *gin.Context) {
	id, ok := netdiskTaskIDFromPath(c)
	if !ok {
		resp.Error(c, paramMsg("任务 ID 无效"))
		return
	}
	task, err := service.NetdiskTaskSvc.Retry(id, middleware.UID(c))
	if err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, task)
}

// CancelNetdiskTask DELETE /api/netdisk-tasks/:id —— 取消。
func CancelNetdiskTask(c *gin.Context) {
	id, ok := netdiskTaskIDFromPath(c)
	if !ok {
		resp.Error(c, paramMsg("任务 ID 无效"))
		return
	}
	task, err := service.NetdiskTaskSvc.Cancel(id, middleware.UID(c))
	if err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, task)
}

// GetNetdiskTaskBlob GET /api/netdisk-tasks/:id/blob —— 导入成功后取回文件字节。
//
// 前端拿到字节后走**既有**的导入链路解析（不重写导入），这样格式支持与本地导入完全一致。
// 归属校验在 service.TaskBlob 里做（task.user_id 必须等于当前 uid）。
func GetNetdiskTaskBlob(c *gin.Context) {
	id, ok := netdiskTaskIDFromPath(c)
	if !ok {
		resp.Error(c, paramMsg("任务 ID 无效"))
		return
	}
	task, localPath, err := service.NetdiskFileSvc.TaskBlob(id, middleware.UID(c))
	if err != nil {
		resp.Error(c, err)
		return
	}
	c.FileAttachment(localPath, task.FileName)
}
