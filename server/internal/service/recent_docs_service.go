package service

import (
	"sort"

	"haiku-wiki/server/internal/model"
	hkerr "haiku-wiki/server/internal/pkg"
	"haiku-wiki/server/internal/repository"
)

// RecentDocView 最近更新文档条目（首页 Dashboard 用）。
type RecentDocView struct {
	ID        uint64 `json:"id"`
	Title     string `json:"title"`
	DocType   string `json:"doc_type"`
	BookID    uint64 `json:"book_id"`
	BookName  string `json:"book_name"`
	UpdatedAt string `json:"updated_at"`
	CanWrite  bool   `json:"can_write"`
}

// recentDocsMaxLimit 单次返回上限（首页只展示十余条，避免被当成列表接口滥用）。
const recentDocsMaxLimit = 50

// recentDocsDefaultLimit 默认条数。
const recentDocsDefaultLimit = 12

// RecentDocs 取当前用户「最近更新的文档」。
//
// 数据来源有两类，合并后按更新时间倒序、去重：
//  1. 用户可读知识库内的文档（自己 / 公司库 / members / public / 所属团队文库）；
//  2. 用户作为协作者的文档（可能位于其读不到的知识库里，协作者拥有等价 owner 权限）。
//
// 初筛在 repository 完成，此处对每一条再做一次读权限复核（canReadBook 或
// isDocCollaborator），避免 SQL 条件与业务权限口径漂移时把越权文档泄露出去。
func (s *DocService) RecentDocs(uid uint64, limit int) ([]RecentDocView, error) {
	if uid == 0 {
		return nil, hkerr.Unauthorized()
	}
	if limit <= 0 {
		limit = recentDocsDefaultLimit
	}
	if limit > recentDocsMaxLimit {
		limit = recentDocsMaxLimit
	}

	bookIDs, err := repository.ListReadableBookIDs(uid)
	if err != nil {
		return nil, hkerr.Internal("查询失败")
	}
	// 初筛窗口放宽到 limit 的若干倍，保证「合并 + 权限过滤」后仍有足够条目可选。
	window := limit * 4
	inBooks, err := repository.ListRecentDocsInBooks(bookIDs, window)
	if err != nil {
		return nil, hkerr.Internal("查询失败")
	}
	collab, err := repository.ListRecentCollaboratorDocs(uid, window)
	if err != nil {
		return nil, hkerr.Internal("查询失败")
	}

	// 合并去重（同一文档可能同时来自两条路径，保留首次出现的即最新副本）
	merged := make([]repository.RecentDocItem, 0, len(inBooks)+len(collab))
	seen := make(map[uint64]bool, len(inBooks)+len(collab))
	for _, it := range append(append([]repository.RecentDocItem{}, inBooks...), collab...) {
		if it.ID == 0 || seen[it.ID] {
			continue
		}
		seen[it.ID] = true
		merged = append(merged, it)
	}
	sort.SliceStable(merged, func(i, j int) bool {
		return merged[i].UpdatedAt.After(merged[j].UpdatedAt)
	})

	// 权限复核 + 组装视图（知识库只查一次，避免 N+1）
	books := make(map[uint64]*model.Book, len(bookIDs))
	loadBook := func(id uint64) *model.Book {
		if b, ok := books[id]; ok {
			return b
		}
		b, e := repository.FindBookByID(id)
		if e != nil {
			books[id] = nil
			return nil
		}
		books[id] = b
		return b
	}

	out := make([]RecentDocView, 0, limit)
	for _, it := range merged {
		if len(out) >= limit {
			break
		}
		book := loadBook(it.BookID)
		if book == nil {
			continue
		}
		if !canReadBook(book, uid) && !isDocCollaborator(it.ID, uid) {
			continue
		}
		out = append(out, RecentDocView{
			ID:        it.ID,
			Title:     it.Title,
			DocType:   it.DocType,
			BookID:    it.BookID,
			BookName:  it.BookName,
			UpdatedAt: it.UpdatedAt.Format("2006-01-02T15:04:05Z07:00"),
			CanWrite:  canWriteDoc(book, uid),
		})
	}
	return out, nil
}
