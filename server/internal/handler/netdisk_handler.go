package handler

import (
	"github.com/gin-gonic/gin"

	"haiku-wiki/server/internal/middleware"
	resp "haiku-wiki/server/internal/pkg"
	"haiku-wiki/server/internal/service"
)

// 本文件：网盘连接的 CRUD + 测试 + 状态刷新 + 列目录。
// 所有出参都经 ToConnectionDTO（脱敏），响应体里**永不出现**凭据字段。

// ListNetdiskProviders GET /api/netdisks/providers —— 能力清单（夸克置灰由后端给出原因）。
func ListNetdiskProviders(c *gin.Context) {
	resp.OK(c, service.NetdiskSvc.ListProviders())
}

// ListNetdisks GET /api/netdisks —— 当前用户的连接列表。
func ListNetdisks(c *gin.Context) {
	list, err := service.NetdiskSvc.List(middleware.UID(c))
	if err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, list)
}

// CreateNetdisk POST /api/netdisks —— 新建（SMB / FTP / WebDAV）。
//
// 百度 / 阿里云盘会被 service 拒绝（必须走 OAuth），UI 里点它们走的是授权弹窗。
func CreateNetdisk(c *gin.Context) {
	var req service.CreateReq
	if err := c.ShouldBindJSON(&req); err != nil {
		resp.Error(c, paramErr(err))
		return
	}
	dto, err := service.NetdiskSvc.Create(middleware.UID(c), req)
	if err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, dto)
}

// TestNetdiskUnsaved POST /api/netdisks/test —— 测试**未保存**的配置（保存前先测）。
func TestNetdiskUnsaved(c *gin.Context) {
	var req service.CreateReq
	if err := c.ShouldBindJSON(&req); err != nil {
		resp.Error(c, paramErr(err))
		return
	}
	res, err := service.NetdiskSvc.TestUnsaved(middleware.UID(c), req)
	if err != nil {
		// 测试失败也要把可读原因带回去（TestResult.Message），故单独输出
		if res != nil {
			resp.OK(c, res)
			return
		}
		resp.Error(c, err)
		return
	}
	resp.OK(c, res)
}

// ListSMBShares POST /api/netdisks/smb/shares —— 列举 SMB 服务器共享（两步添加第 1→2 步）。
//
// 不落库：只是临时拨号枚举共享并探测权限，供前端第 2 步让用户勾选。
// 必须排在 /netdisks/:id 之前（静态路径优先匹配）。
func ListSMBShares(c *gin.Context) {
	var req service.SMBSharesReq
	if err := c.ShouldBindJSON(&req); err != nil {
		resp.Error(c, paramErr(err))
		return
	}
	res, err := service.NetdiskSvc.ListSMBShares(middleware.UID(c), req)
	if err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, gin.H{"shares": res})
}

// GetNetdisk GET /api/netdisks/:id —— 详情（脱敏）。
func GetNetdisk(c *gin.Context) {
	id, ok := netdiskIDFromPath(c)
	if !ok {
		resp.Error(c, paramMsg("网盘连接 ID 无效"))
		return
	}
	dto, err := service.NetdiskSvc.Get(id, middleware.UID(c))
	if err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, dto)
}

// UpdateNetdisk PUT /api/netdisks/:id —— 编辑（password 留空 = 不修改）。
func UpdateNetdisk(c *gin.Context) {
	id, ok := netdiskIDFromPath(c)
	if !ok {
		resp.Error(c, paramMsg("网盘连接 ID 无效"))
		return
	}
	var req service.CreateReq
	if err := c.ShouldBindJSON(&req); err != nil {
		resp.Error(c, paramErr(err))
		return
	}
	dto, err := service.NetdiskSvc.Update(id, middleware.UID(c), req)
	if err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, dto)
}

// DeleteNetdisk DELETE /api/netdisks/:id —— 删除（软删除）。
func DeleteNetdisk(c *gin.Context) {
	id, ok := netdiskIDFromPath(c)
	if !ok {
		resp.Error(c, paramMsg("网盘连接 ID 无效"))
		return
	}
	if err := service.NetdiskSvc.Delete(id, middleware.UID(c)); err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, gin.H{"deleted": true})
}

// TestNetdiskSaved POST /api/netdisks/:id/test —— 测试已保存连接并回写状态。
func TestNetdiskSaved(c *gin.Context) {
	id, ok := netdiskIDFromPath(c)
	if !ok {
		resp.Error(c, paramMsg("网盘连接 ID 无效"))
		return
	}
	res, err := service.NetdiskSvc.TestSaved(id, middleware.UID(c))
	if err != nil {
		if res != nil {
			resp.OK(c, res)
			return
		}
		resp.Error(c, err)
		return
	}
	resp.OK(c, res)
}

// RefreshNetdisk POST /api/netdisks/:id/refresh —— 重新探测状态（OAuth 重新授权后也走它）。
func RefreshNetdisk(c *gin.Context) {
	id, ok := netdiskIDFromPath(c)
	if !ok {
		resp.Error(c, paramMsg("网盘连接 ID 无效"))
		return
	}
	dto, err := service.NetdiskSvc.Refresh(id, middleware.UID(c))
	if err != nil {
		if dto != nil {
			resp.OK(c, dto)
			return
		}
		resp.Error(c, err)
		return
	}
	resp.OK(c, dto)
}

// ListNetdiskDirs GET /api/netdisks/:id/dirs?path=&force= —— 列目录（懒加载）。
func ListNetdiskDirs(c *gin.Context) {
	id, ok := netdiskIDFromPath(c)
	if !ok {
		resp.Error(c, paramMsg("网盘连接 ID 无效"))
		return
	}
	out, err := service.NetdiskSvc.ListDir(id, middleware.UID(c), netdiskQueryPath(c), netdiskForce(c))
	if err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, out)
}
