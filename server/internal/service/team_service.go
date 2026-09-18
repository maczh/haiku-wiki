package service

import (
	"strings"
	"time"

	"haiku-wiki/server/internal/model"
	hkerr "haiku-wiki/server/internal/pkg"
	"haiku-wiki/server/internal/repository"
)

// TeamService 团队管理业务。
type TeamService struct{}

// Create 创建团队：创建者自动成为团队 admin，并自动创建「团队文库」（团队名+"文库"）。
func (s *TeamService) Create(ownerID uint64, name, description string) (*model.Team, error) {
	if name == "" {
		return nil, hkerr.Param("团队名称不能为空")
	}
	if len(name) > 128 {
		return nil, hkerr.Param("团队名称过长")
	}
	t := &model.Team{Name: name, Description: description, OwnerID: ownerID}
	if err := repository.CreateTeam(t); err != nil {
		return nil, hkerr.Internal("创建失败")
	}
	// 创建者自动成为团队 admin
	if err := repository.CreateTeamMember(&model.TeamMember{TeamID: t.ID, UserID: ownerID, Role: "admin"}); err != nil {
		return nil, hkerr.Internal("创建失败")
	}
	// 自动创建团队文库
	if _, err := (&BookService{}).CreateTeamLibrary(t.ID, ownerID, name+"文库"); err != nil {
		return nil, hkerr.Internal("创建团队文库失败")
	}
	return t, nil
}

// ListLibraries 列出团队文库（需团队成员，任意角色可见）。
func (s *TeamService) ListLibraries(userID, teamID uint64) ([]model.Book, error) {
	if _, _, err := s.Get(userID, teamID); err != nil {
		return nil, err
	}
	return repository.ListBooksByTeam(teamID)
}

// CreateLibrary 团队管理员为团队新建文库（团队名缺省时用团队名 + "文库"）。
// 复用 Create 里的 CreateTeamLibrary：team_id 非空、默认私有，团队成员任意角色可读写。
func (s *TeamService) CreateLibrary(userID, teamID uint64, name string) (*model.Book, error) {
	t, role, err := s.Get(userID, teamID)
	if err != nil {
		return nil, err
	}
	if role != "admin" {
		return nil, hkerr.Forbidden()
	}
	name = strings.TrimSpace(name)
	if name == "" {
		name = t.Name + "文库"
	}
	if len(name) > 128 {
		return nil, hkerr.Param("文库名称过长")
	}
	return (&BookService{}).CreateTeamLibrary(teamID, userID, name)
}

// List 列出用户参与的团队（自己创建或已是成员），含文库数。
func (s *TeamService) List(userID uint64) ([]model.TeamWithCount, error) {
	return repository.ListTeamsForUser(userID)
}

// TeamMemberView 团队成员列表项（含用户展示信息，供前端直接渲染）。
type TeamMemberView struct {
	TeamID     uint64    `json:"team_id"`
	UserID     uint64    `json:"user_id"`
	Role       string    `json:"role"`
	CreatedAt  time.Time `json:"created_at"`
	Username   string    `json:"username"`
	Name       string    `json:"name"`
	Email      string    `json:"email"`
	Nickname   string    `json:"nickname"`
	Department string    `json:"department"`
	IsOwner    bool      `json:"is_owner"`
}

// toMemberView 拼装成员视图：成员 + 用户展示信息 + 是否创建者。
func (s *TeamService) toMemberView(t *model.Team, m model.TeamMember) TeamMemberView {
	v := TeamMemberView{
		TeamID:    m.TeamID,
		UserID:    m.UserID,
		Role:      m.Role,
		CreatedAt: m.CreatedAt,
		IsOwner:   t.OwnerID == m.UserID,
	}
	if u, err := repository.FindUserByID(m.UserID); err == nil && u != nil {
		v.Username = u.Username
		v.Name = u.Name
		v.Email = u.Email
		v.Nickname = u.Nickname
		v.Department = u.Department
	}
	return v
}

// roleOf 取用户在团队中的角色；创建者视为 admin；非成员返回空。
func (s *TeamService) roleOf(userID uint64, t *model.Team) string {
	if t.OwnerID == userID {
		return "admin"
	}
	m, err := repository.FindTeamMember(t.ID, userID)
	if err == nil {
		return m.Role
	}
	return ""
}

// Get 取团队并校验访问权限（非成员拒绝）；返回团队与当前用户角色。
func (s *TeamService) Get(userID, teamID uint64) (*model.Team, string, error) {
	t, err := repository.FindTeamByID(teamID)
	if err != nil {
		return nil, "", hkerr.NotFound("团队不存在")
	}
	role := s.roleOf(userID, t)
	if role == "" {
		return nil, "", hkerr.Forbidden()
	}
	return t, role, nil
}

// Update 更新团队信息（仅 owner 或团队 admin）。
func (s *TeamService) Update(userID, teamID uint64, name, description string) (*model.Team, error) {
	t, role, err := s.Get(userID, teamID)
	if err != nil {
		return nil, err
	}
	if role != "admin" {
		return nil, hkerr.Forbidden()
	}
	if name != "" {
		t.Name = name
	}
	if description != "" {
		t.Description = description
	}
	if err := repository.UpdateTeam(t); err != nil {
		return nil, hkerr.Internal("保存失败")
	}
	return t, nil
}

// Delete 删除团队（仅 owner 或团队 admin）。
func (s *TeamService) Delete(userID, teamID uint64) error {
	t, role, err := s.Get(userID, teamID)
	if err != nil {
		return err
	}
	if role != "admin" {
		return hkerr.Forbidden()
	}
	return repository.DeleteTeam(t)
}

// ListMembers 列出团队成员（需团队成员），含用户展示信息。
func (s *TeamService) ListMembers(userID, teamID uint64) ([]TeamMemberView, error) {
	t, _, err := s.Get(userID, teamID)
	if err != nil {
		return nil, err
	}
	ms, err := repository.ListTeamMembers(teamID)
	if err != nil {
		return nil, err
	}
	out := make([]TeamMemberView, 0, len(ms))
	for _, m := range ms {
		out = append(out, s.toMemberView(t, m))
	}
	return out, nil
}

// AddMember 添加成员（仅团队 admin）：按 username/phone/name/email 搜索，默认读写。
func (s *TeamService) AddMember(adminID, teamID uint64, identifier, role string) (*TeamMemberView, error) {
	t, myRole, err := s.Get(adminID, teamID)
	if err != nil {
		return nil, err
	}
	if myRole != "admin" {
		return nil, hkerr.Forbidden()
	}
	if role == "member" || role == "" {
		role = "read_write"
	}
	if role != "admin" && role != "read_write" && role != "read_only" {
		role = "read_write"
	}
	u, err := repository.FindUserByIdentifier(identifier)
	if err != nil {
		return nil, hkerr.NotFound("未找到该用户（按用户名/手机号/姓名/邮箱）")
	}
	if u.ID == t.OwnerID {
		return nil, hkerr.Param("创建者已在团队中")
	}
	if _, err := repository.FindTeamMember(teamID, u.ID); err == nil {
		return nil, hkerr.Conflict("该用户已是团队成员")
	}
	m := &model.TeamMember{TeamID: teamID, UserID: u.ID, Role: role}
	if err := repository.CreateTeamMember(m); err != nil {
		return nil, hkerr.Internal("添加失败")
	}
	v := s.toMemberView(t, *m)
	return &v, nil
}

// RemoveMember 移除成员（仅团队 admin）：不能移除创建者；至少保留一名 admin。
func (s *TeamService) RemoveMember(adminID, teamID, userID uint64) error {
	t, myRole, err := s.Get(adminID, teamID)
	if err != nil {
		return err
	}
	if myRole != "admin" {
		return hkerr.Forbidden()
	}
	if userID == t.OwnerID {
		return hkerr.Param("不能移除团队创建者")
	}
	m, err := repository.FindTeamMember(teamID, userID)
	if err != nil {
		return hkerr.NotFound("成员不存在")
	}
	if m.Role == "admin" {
		n, err := repository.CountTeamAdmins(teamID)
		if err != nil {
			return hkerr.Internal("查询失败")
		}
		if n <= 1 {
			return hkerr.Param("团队至少需保留一名管理员")
		}
	}
	return repository.DeleteTeamMember(teamID, userID)
}

// SetMemberRole 设置/降权成员角色（仅团队 admin）：不能改创建者；至少保留一名 admin。
func (s *TeamService) SetMemberRole(adminID, teamID, userID uint64, role string) (*model.TeamMember, error) {
	t, myRole, err := s.Get(adminID, teamID)
	if err != nil {
		return nil, err
	}
	if myRole != "admin" {
		return nil, hkerr.Forbidden()
	}
	if userID == t.OwnerID {
		return nil, hkerr.Param("创建者角色不可更改")
	}
	if role == "member" {
		role = "read_write"
	}
	if role != "admin" && role != "read_write" && role != "read_only" {
		return nil, hkerr.Param("角色值非法（admin/read_write/read_only）")
	}
	m, err := repository.FindTeamMember(teamID, userID)
	if err != nil {
		return nil, hkerr.NotFound("成员不存在")
	}
	if m.Role == "admin" && role != "admin" {
		n, err := repository.CountTeamAdmins(teamID)
		if err != nil {
			return nil, hkerr.Internal("查询失败")
		}
		if n <= 1 {
			return nil, hkerr.Param("团队至少需保留一名管理员")
		}
	}
	m.Role = role
	if err := repository.UpdateTeamMember(m); err != nil {
		return nil, hkerr.Internal("保存失败")
	}
	return m, nil
}
