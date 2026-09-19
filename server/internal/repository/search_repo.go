package repository

import (
	"strings"
	"time"
)

// SearchRow 搜索原始行（含正文，供 service 截取片段）。
type SearchRow struct {
	ID        uint64    `gorm:"column:id"`
	BookID    uint64    `gorm:"column:book_id"`
	BookName  string    `gorm:"column:book_name"`
	Title     string    `gorm:"column:title"`
	DocType   string    `gorm:"column:doc_type"`
	Content   string    `gorm:"column:content"`
	UpdatedAt time.Time `gorm:"column:updated_at"`
}

// escapeLike 转义 LIKE 通配符，配合 ESCAPE '\\' 使用。
func escapeLike(kw string) string {
	r := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)
	return r.Replace(kw)
}

// SearchDocs 按类型搜索（markdown 搜 title+content；其余仅 title，JSON 内容进 LIKE 噪声过大），
// 按知识库可见性过滤：
//   - public：任何人（含匿名）
//   - members：登录用户（userID > 0）
//   - private：仅 owner
//
// bookID > 0 时限定在单个知识库内（文库工作台的「文库内搜索」），可见性口径不变。
func SearchDocs(userID uint64, keyword string, bookID uint64, limit int) ([]SearchRow, error) {
	kw := "%" + escapeLike(keyword) + "%"
	q := db.Table("docs").
		Select("docs.id, docs.book_id, docs.title, docs.doc_type, docs.content, docs.updated_at, books.name AS book_name").
		Joins("JOIN books ON books.id = docs.book_id").
		Where("docs.deleted_at IS NULL").
		Where(
			"(docs.doc_type = 'markdown' AND (docs.title LIKE ? ESCAPE '\\' OR docs.content LIKE ? ESCAPE '\\')"+
				" OR docs.doc_type <> 'markdown' AND docs.title LIKE ? ESCAPE '\\')",
			kw, kw, kw,
		)
	if bookID > 0 {
		q = q.Where("docs.book_id = ?", bookID)
	}
	if userID > 0 {
		q = q.Where("books.visibility = ? OR books.visibility = ? OR books.owner_id = ?",
			"public", "members", userID)
	} else {
		q = q.Where("books.visibility = ?", "public")
	}
	var out []SearchRow
	err := q.Order("docs.updated_at DESC").Limit(limit).Find(&out).Error
	return out, err
}

// ensure model import used（TrashItem 之外保留 model 引用以防未来扩展）
