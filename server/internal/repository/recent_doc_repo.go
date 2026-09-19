package repository

import (
	"time"
)

// RecentDocItem 最近更新文档条目：文档基本信息 + 所属知识库名（首页「最近更新」用）。
type RecentDocItem struct {
	ID        uint64    `json:"id"`
	Title     string    `json:"title"`
	DocType   string    `json:"doc_type"`
	BookID    uint64    `json:"book_id"`
	BookName  string    `json:"book_name"`
	UpdatedAt time.Time `json:"updated_at"`
}

// ListReadableBookIDs 列出用户「可能有读权限」的知识库 id 集合，用于最近更新文档的初筛。
//
// 与 service.canReadBook 保持同一口径（此处只做粗筛，service 层还会逐条复核）：
//   - 公司知识库：所有登录用户可读
//   - 自己创建的库
//   - members / public 可见性的库
//   - 自己所属团队（或被自己创建）的团队文库
//
// 注意：返回的是「候选集」，不等于全部有读权限的文档来源 ——
// 文档协作者（doc_collaborators）可能落在用户读不到的知识库里，由
// ListRecentCollaboratorDocs 单独补齐。
func ListReadableBookIDs(uid uint64) ([]uint64, error) {
	if uid == 0 {
		return nil, nil
	}
	var ids []uint64
	err := db.Table("books").
		Where(
			"books.is_company_kb = ? OR books.owner_id = ? OR books.visibility IN ? OR "+
				"books.team_id IN (SELECT team_id FROM team_members WHERE user_id = ?) OR "+
				"books.team_id IN (SELECT id FROM teams WHERE owner_id = ?)",
			true, uid, []string{"members", "public"}, uid, uid,
		).
		Pluck("books.id", &ids).Error
	return ids, err
}

// recentDocSelect 最近更新文档的公共查询列（docs + books 联表）。
const recentDocSelect = "docs.id AS id, docs.title AS title, docs.doc_type AS doc_type, " +
	"docs.book_id AS book_id, books.name AS book_name, docs.updated_at AS updated_at"

// recentDocFilter 最近更新的公共过滤条件。
// 目录（doc_type=folder）不承载正文，出现在「最近更新」里只会挤掉真正有内容的文档，
// 因此在 SQL 层就排除（新增目录会被其它文档的更新「顶」出去，属预期行为）。
const recentDocFilter = "docs.deleted_at IS NULL AND docs.doc_type <> 'folder'"

// ListRecentDocsInBooks 在给定知识库集合内按更新时间倒序取前 limit 篇。
func ListRecentDocsInBooks(bookIDs []uint64, limit int) ([]RecentDocItem, error) {
	if len(bookIDs) == 0 || limit <= 0 {
		return nil, nil
	}
	var out []RecentDocItem
	err := db.Table("docs").
		Select(recentDocSelect).
		Joins("JOIN books ON books.id = docs.book_id").
		Where(recentDocFilter+" AND docs.book_id IN ?", bookIDs).
		Order("docs.updated_at DESC").
		Limit(limit).
		Find(&out).Error
	return out, err
}

// ListRecentCollaboratorDocs 取用户作为协作者的最近更新文档（可能位于其读不到的知识库内）。
func ListRecentCollaboratorDocs(uid uint64, limit int) ([]RecentDocItem, error) {
	if uid == 0 || limit <= 0 {
		return nil, nil
	}
	var out []RecentDocItem
	err := db.Table("docs").
		Select(recentDocSelect).
		Joins("JOIN books ON books.id = docs.book_id").
		Joins("JOIN doc_collaborators dc ON dc.doc_id = docs.id").
		Where(recentDocFilter+" AND dc.user_id = ?", uid).
		Order("docs.updated_at DESC").
		Limit(limit).
		Find(&out).Error
	return out, err
}
