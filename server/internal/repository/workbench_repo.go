package repository

import "time"

// WorkbenchDocItem 工作台聚合条目：文档基本信息 + **正文**。
//
// 与 RecentDocItem 的关键差异是带上 content —— 首页工作台要展示「待办完成率、
// 甘特图进度、今日日程」，这些都必须解析正文JSON 才能算出来，只看元数据做不到。
// 因此这里的查询**必须**限定 doc_type，且 limit 要小；否则一次把全库正文捞出来。
type WorkbenchDocItem struct {
	ID        uint64    `json:"id"`
	Title     string    `json:"title"`
	DocType   string    `json:"doc_type"`
	BookID    uint64    `json:"book_id"`
	BookName  string    `json:"book_name"`
	UpdatedAt time.Time `json:"updated_at"`
	Content   string    `json:"content"`
}

// workbenchDocSelect 工作台聚合的公共查询列（docs + books 联表，含正文）。
const workbenchDocSelect = "docs.id AS id, docs.title AS title, docs.doc_type AS doc_type, " +
	"docs.book_id AS book_id, books.name AS book_name, docs.updated_at AS updated_at, " +
	"docs.content AS content"

// workbenchDocFilter 工作台聚合的公共过滤条件。
// 软删文档排除；类型由调用方以 IN 追加（不允许空集合，否则会退化成全表扫描）。
const workbenchDocFilter = "docs.deleted_at IS NULL"

// ListWorkbenchDocsInBooks 在给定知识库集合内，按类型取最近更新的文档（含正文）。
func ListWorkbenchDocsInBooks(bookIDs []uint64, docTypes []string, limit int) ([]WorkbenchDocItem, error) {
	if len(bookIDs) == 0 || len(docTypes) == 0 || limit <= 0 {
		return nil, nil
	}
	var out []WorkbenchDocItem
	err := db.Table("docs").
		Select(workbenchDocSelect).
		Joins("JOIN books ON books.id = docs.book_id").
		Where(workbenchDocFilter+" AND docs.doc_type IN ? AND docs.book_id IN ?", docTypes, bookIDs).
		Order("docs.updated_at DESC").
		Limit(limit).
		Find(&out).Error
	return out, err
}

// ListWorkbenchCollaboratorDocs 取用户作为协作者的同类文档（可能位于其读不到的知识库内）。
func ListWorkbenchCollaboratorDocs(uid uint64, docTypes []string, limit int) ([]WorkbenchDocItem, error) {
	if uid == 0 || len(docTypes) == 0 || limit <= 0 {
		return nil, nil
	}
	var out []WorkbenchDocItem
	err := db.Table("docs").
		Select(workbenchDocSelect).
		Joins("JOIN books ON books.id = docs.book_id").
		Joins("JOIN doc_collaborators dc ON dc.doc_id = docs.id").
		Where(workbenchDocFilter+" AND docs.doc_type IN ? AND dc.user_id = ?", docTypes, uid).
		Order("docs.updated_at DESC").
		Limit(limit).
		Find(&out).Error
	return out, err
}

// CountWorkbenchDocsByType 统计各类型文档数量（工作台卡片标题用，不取正文）。
func CountWorkbenchDocsByType(bookIDs []uint64, docTypes []string) (map[string]int, error) {
	out := make(map[string]int, len(docTypes))
	if len(bookIDs) == 0 || len(docTypes) == 0 {
		return out, nil
	}
	type row struct {
		DocType string
		N       int
	}
	var rows []row
	err := db.Table("docs").
		Select("docs.doc_type AS doc_type, COUNT(*) AS n").
		Where(workbenchDocFilter+" AND docs.doc_type IN ? AND docs.book_id IN ?", docTypes, bookIDs).
		Group("docs.doc_type").
		Find(&rows).Error
	if err != nil {
		return out, err
	}
	for _, r := range rows {
		out[r.DocType] = r.N
	}
	return out, nil
}
