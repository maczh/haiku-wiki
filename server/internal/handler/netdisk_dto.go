package handler

import (
	"strconv"

	"github.com/gin-gonic/gin"

	"haiku-wiki/server/internal/model"
	"haiku-wiki/server/internal/service"
)

// ---------- 出参 ----------

// ToConnectionDTO handler 层**唯一**的网盘连接出参转换入口。
//
// 直接委托 service.ToConnectionDTO（全仓只有那一处会读 CredEnc）：
// 这里多包一层是为了让 handler 侧有唯一出口，避免有人图省事把 model 直接丢进 resp.OK
// —— 那样会把凭据密文一起序列化出去（设计文档 §7-T03 把脱敏定为硬要求）。
func ToConnectionDTO(c *model.NetdiskConnection) service.ConnectionDTO {
	return service.ToConnectionDTO(c)
}

// netdiskTaskListResp 任务列表出参（带上「仍在跑的数量」，前端据此决定是否继续轮询）。
type netdiskTaskListResp struct {
	Items   []service.TaskDTO `json:"items"`
	Running int64             `json:"running"`
}

// netdiskOAuthAuthorizeResp 发起授权的出参。
type netdiskOAuthAuthorizeResp struct {
	AuthorizeURL string `json:"authorize_url"`
	State        string `json:"state"`
}

// ---------- 入参 ----------

// netdiskPathReq 只带路径的入参（列目录 / 删除）。
type netdiskPathReq struct {
	Path string `json:"path"`
}

// netdiskMkdirReq 新建目录：在 path 下建 name。
type netdiskMkdirReq struct {
	Path string `json:"path"`
	Name string `json:"name" binding:"required"`
}

// netdiskRenameReq 改名。
type netdiskRenameReq struct {
	Path string `json:"path" binding:"required"`
	Name string `json:"name" binding:"required"`
}

// netdiskMoveReq 移动：把 path 移到 target_dir 下。
type netdiskMoveReq struct {
	Path      string `json:"path" binding:"required"`
	TargetDir string `json:"target_dir"`
}

// ---------- 路径参数 ----------

// netdiskIDFromPath 解析 :id 为网盘连接 ID。
func netdiskIDFromPath(c *gin.Context) (uint64, bool) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	return id, err == nil && id > 0
}

// netdiskTaskIDFromPath 解析 :id 为任务 ID（与连接 ID 同名为 :id，分开便于各自加日志）。
func netdiskTaskIDFromPath(c *gin.Context) (uint64, bool) {
	return netdiskIDFromPath(c)
}

// netdiskQueryPath 取 path 查询参数（空 = 根目录）。
func netdiskQueryPath(c *gin.Context) string {
	return c.Query("path")
}

// netdiskForce 是否强制刷新（跳过服务端短缓存）。
func netdiskForce(c *gin.Context) bool {
	v := c.Query("force")
	return v == "1" || v == "true"
}
