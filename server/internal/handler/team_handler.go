package handler

import (
	"strconv"

	"github.com/gin-gonic/gin"

	"haiku-wiki/server/internal/middleware"
	"haiku-wiki/server/internal/pkg"
	"haiku-wiki/server/internal/service"
)

var teamService = &service.TeamService{}

// teamIDFromPath 解析 :id 路由参数（团队 ID）。
func teamIDFromPath(c *gin.Context) (uint64, bool) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	return id, err == nil && id > 0
}

type createTeamReq struct {
	Name        string `json:"name" binding:"required"`
	Description string `json:"description"`
}

// CreateTeam POST /api/teams —— 创建团队（创建者自动 admin，并自动建团队文库）。
func CreateTeam(c *gin.Context) {
	var req createTeamReq
	if err := c.ShouldBindJSON(&req); err != nil {
		resp.Error(c, paramErr(err))
		return
	}
	t, err := teamService.Create(middleware.UID(c), req.Name, req.Description)
	if err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, t)
}

// ListTeams GET /api/teams —— 我参与的团队（创建或成员）。
func ListTeams(c *gin.Context) {
	out, err := teamService.List(middleware.UID(c))
	if err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, out)
}

// GetTeam GET /api/teams/:id —— 团队详情（需成员）。
func GetTeam(c *gin.Context) {
	id, ok := teamIDFromPath(c)
	if !ok {
		resp.Error(c, paramMsg("无效的团队 ID"))
		return
	}
	t, role, err := teamService.Get(middleware.UID(c), id)
	if err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, gin.H{"team": t, "my_role": role})
}

type updateTeamReq struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

// UpdateTeam PUT /api/teams/:id —— 更新团队信息（owner 或团队 admin）。
func UpdateTeam(c *gin.Context) {
	id, ok := teamIDFromPath(c)
	if !ok {
		resp.Error(c, paramMsg("无效的团队 ID"))
		return
	}
	var req updateTeamReq
	if err := c.ShouldBindJSON(&req); err != nil {
		resp.Error(c, paramErr(err))
		return
	}
	t, err := teamService.Update(middleware.UID(c), id, req.Name, req.Description)
	if err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, t)
}

// DeleteTeam DELETE /api/teams/:id —— 删除团队（owner 或团队 admin）。
func DeleteTeam(c *gin.Context) {
	id, ok := teamIDFromPath(c)
	if !ok {
		resp.Error(c, paramMsg("无效的团队 ID"))
		return
	}
	if err := teamService.Delete(middleware.UID(c), id); err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, gin.H{"deleted": true})
}

// ListTeamMembers GET /api/teams/:id/members —— 成员列表（需成员）。
func ListTeamMembers(c *gin.Context) {
	id, ok := teamIDFromPath(c)
	if !ok {
		resp.Error(c, paramMsg("无效的团队 ID"))
		return
	}
	members, err := teamService.ListMembers(middleware.UID(c), id)
	if err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, members)
}

type addMemberReq struct {
	Identifier string `json:"identifier" binding:"required"`
	Role       string `json:"role"`
}

// AddTeamMember POST /api/teams/:id/members —— 添加成员（需团队 admin）。
func AddTeamMember(c *gin.Context) {
	id, ok := teamIDFromPath(c)
	if !ok {
		resp.Error(c, paramMsg("无效的团队 ID"))
		return
	}
	var req addMemberReq
	if err := c.ShouldBindJSON(&req); err != nil {
		resp.Error(c, paramErr(err))
		return
	}
	m, err := teamService.AddMember(middleware.UID(c), id, req.Identifier, req.Role)
	if err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, m)
}

// RemoveTeamMember DELETE /api/teams/:id/members/:uid —— 移除成员（需团队 admin）。
func RemoveTeamMember(c *gin.Context) {
	id, ok := teamIDFromPath(c)
	if !ok {
		resp.Error(c, paramMsg("无效的团队 ID"))
		return
	}
	uid, ok := parseUintParam(c, "uid")
	if !ok {
		resp.Error(c, paramMsg("无效的用户 ID"))
		return
	}
	if err := teamService.RemoveMember(middleware.UID(c), id, uid); err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, gin.H{"removed": true})
}

type setMemberRoleReq struct {
	Role string `json:"role" binding:"required"`
}

// SetTeamMemberRole PATCH /api/teams/:id/members/:uid —— 设置/降权成员角色（需团队 admin）。
func SetTeamMemberRole(c *gin.Context) {
	id, ok := teamIDFromPath(c)
	if !ok {
		resp.Error(c, paramMsg("无效的团队 ID"))
		return
	}
	uid, ok := parseUintParam(c, "uid")
	if !ok {
		resp.Error(c, paramMsg("无效的用户 ID"))
		return
	}
	var req setMemberRoleReq
	if err := c.ShouldBindJSON(&req); err != nil {
		resp.Error(c, paramErr(err))
		return
	}
	m, err := teamService.SetMemberRole(middleware.UID(c), id, uid, req.Role)
	if err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, m)
}

// parseUintParam 解析指定名称的路由参数（uint64）。
func parseUintParam(c *gin.Context, name string) (uint64, bool) {
	v, err := strconv.ParseUint(c.Param(name), 10, 64)
	return v, err == nil && v > 0
}
