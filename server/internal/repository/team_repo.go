package repository

import (
	"haiku-wiki/server/internal/model"
)

// ---------- Team ----------

// CreateTeam 新建团队。
func CreateTeam(t *model.Team) error { return db.Create(t).Error }

// FindTeamByID 按 ID 查团队。
func FindTeamByID(id uint64) (*model.Team, error) {
	var t model.Team
	if err := db.First(&t, id).Error; err != nil {
		return nil, err
	}
	return &t, nil
}

// UpdateTeam 保存团队变更。
func UpdateTeam(t *model.Team) error { return db.Save(t).Error }

// DeleteTeam 删除团队（调用方负责清理成员关系与团队文库）。
func DeleteTeam(t *model.Team) error { return db.Delete(t).Error }

// ListTeamsForUser 用户参与的团队（自己是 owner 或已是成员），含文库数。
func ListTeamsForUser(userID uint64) ([]model.TeamWithCount, error) {
	var out []model.TeamWithCount
	err := db.Model(&model.Team{}).
		Select("teams.*, (SELECT COUNT(*) FROM books WHERE books.team_id = teams.id) AS book_count").
		Where("teams.id IN (SELECT team_id FROM team_members WHERE user_id = ?) OR teams.owner_id = ?", userID, userID).
		Order("teams.created_at DESC").
		Find(&out).Error
	return out, err
}

// ---------- TeamMember ----------

// CreateTeamMember 添加团队成员。
func CreateTeamMember(m *model.TeamMember) error { return db.Create(m).Error }

// FindTeamMember 查某用户在团队中的成员关系。
func FindTeamMember(teamID, userID uint64) (*model.TeamMember, error) {
	var m model.TeamMember
	if err := db.Where("team_id = ? AND user_id = ?", teamID, userID).First(&m).Error; err != nil {
		return nil, err
	}
	return &m, nil
}

// ListTeamMembers 列出团队成员（按加入顺序）。
func ListTeamMembers(teamID uint64) ([]model.TeamMember, error) {
	var ms []model.TeamMember
	err := db.Where("team_id = ?", teamID).Order("created_at ASC").Find(&ms).Error
	return ms, err
}

// UpdateTeamMember 保存成员变更（角色）。
func UpdateTeamMember(m *model.TeamMember) error { return db.Save(m).Error }

// DeleteTeamMember 移除团队成员。
func DeleteTeamMember(teamID, userID uint64) error {
	return db.Where("team_id = ? AND user_id = ?", teamID, userID).Delete(&model.TeamMember{}).Error
}

// CountTeamAdmins 统计团队管理员数量（保证至少保留一名）。
func CountTeamAdmins(teamID uint64) (int64, error) {
	var n int64
	err := db.Model(&model.TeamMember{}).Where("team_id = ? AND role = 'admin'", teamID).Count(&n).Error
	return n, err
}

// ---------- 团队文库 ----------

// ListBooksByTeam 列出某团队的文库（团队文库 = team_id 非空的 book）。
func ListBooksByTeam(teamID uint64) ([]model.Book, error) {
	var out []model.Book
	err := db.Where("team_id = ?", teamID).Order("created_at DESC").Find(&out).Error
	return out, err
}
