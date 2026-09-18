package repository

import (
	"gorm.io/gorm/clause"

	"haiku-wiki/server/internal/model"
)

// CreateBook 新建知识库。
func CreateBook(b *model.Book) error { return db.Create(b).Error }

// FindBookByID 按 ID 查知识库。
func FindBookByID(id uint64) (*model.Book, error) {
	var b model.Book
	if err := db.First(&b, id).Error; err != nil {
		return nil, err
	}
	return &b, nil
}

// FindBookBySlug 按 share_slug 查公开知识库。
func FindBookBySlug(slug string) (*model.Book, error) {
	var b model.Book
	if err := db.Where("share_slug = ? AND visibility = ?", slug, "public").First(&b).Error; err != nil {
		return nil, err
	}
	return &b, nil
}

// UpdateBook 保存知识库变更。
func UpdateBook(b *model.Book) error { return db.Save(b).Error }

// DeleteBook 删除知识库（调用方负责级联软删文档）。
func DeleteBook(b *model.Book) error { return db.Delete(b).Error }

const bookWithCountSelect = `books.*, ` +
	`(SELECT COUNT(*) FROM docs WHERE docs.book_id = books.id AND docs.deleted_at IS NULL) AS doc_count`

// ListBooksByOwner 我的个人知识库（含文档数，team_id 为 NULL 的个人库）。
// 团队文库（team_id 非空）归团队，不计入个人「我的库」，改由 ListTeamLibraries 呈现。
func ListBooksByOwner(ownerID uint64) ([]model.BookWithCount, error) {
	var out []model.BookWithCount
	err := db.Model(&model.Book{}).
		Select(bookWithCountSelect).
		Where("books.owner_id = ? AND books.team_id IS NULL", ownerID).
		Order("books.created_at DESC").
		Find(&out).Error
	return out, err
}

// ListBooksVisible 对我可见、但非我创建的个人知识库（members/public；team_id 为 NULL）。
// 另含系统自动创建的「公司知识库」（is_company_kb=true，对所有登录用户只读）。
func ListBooksVisible(userID uint64) ([]model.BookWithCount, error) {
	var out []model.BookWithCount
	err := db.Model(&model.Book{}).
		Select(bookWithCountSelect).
		Where(
			"(books.owner_id <> ? AND books.team_id IS NULL AND books.visibility IN ?) OR books.is_company_kb = ?",
			userID, []string{"members", "public"}, true,
		).
		Order("books.created_at DESC").
		Find(&out).Error
	return out, err
}

// ListTeamLibraries 我参与的团队的文库（我是团队成员或团队创建者，任意角色均可读写）。
// 团队文库 team_id 非空、visibility=private，仅团队内可见；不计入「我的库」/「可见库」。
func ListTeamLibraries(userID uint64) ([]model.BookWithCount, error) {
	var out []model.BookWithCount
	err := db.Model(&model.Book{}).
		Select(bookWithCountSelect).
		Where("books.team_id IN (SELECT team_id FROM team_members WHERE user_id = ?) OR books.team_id IN (SELECT id FROM teams WHERE owner_id = ?)",
			userID, userID).
		Order("books.created_at DESC").
		Find(&out).Error
	return out, err
}

// CountBooksByOwner 所有者拥有的知识库数量。
func CountBooksByOwner(ownerID uint64) (int64, error) {
	var n int64
	err := db.Model(&model.Book{}).Where("owner_id = ?", ownerID).Count(&n).Error
	return n, err
}

// CountCompanyKBs 统计公司知识库数量（用于种子幂等判定）。
func CountCompanyKBs() (int64, error) {
	var n int64
	err := db.Model(&model.Book{}).Where("is_company_kb = ?", true).Count(&n).Error
	return n, err
}

// EnsureCompanyKB 种子幂等：不存在公司知识库时自动创建一个（系统持有，owner_id=0）。
// 实际读写权限由 service.canReadBook / canWriteDoc 的特殊分支控制。
func EnsureCompanyKB() error {
	n, err := CountCompanyKBs()
	if err != nil {
		return err
	}
	if n > 0 {
		return nil
	}
	b := &model.Book{
		OwnerID:     0,
		Name:        "公司知识库",
		Description: "全员可读的公司公共知识库，管理员可授权成员协作编辑。",
		CoverColor:  "#722ed1",
		Visibility:  "private",
		IsCompanyKB: true,
	}
	return CreateBook(b)
}

// CreateBookWriter 授予某用户某知识库的写权限（幂等：冲突忽略）。
func CreateBookWriter(bw *model.BookWriter) error {
	// 唯一键冲突（book_id, user_id）时视为已授权，忽略错误。
	err := db.Clauses(clause.OnConflict{DoNothing: true}).Create(bw).Error
	return err
}

// DeleteBookWriter 撤销某用户某知识库的写权限。
func DeleteBookWriter(bookID, userID uint64) error {
	return db.Where("book_id = ? AND user_id = ?", bookID, userID).Delete(&model.BookWriter{}).Error
}

// IsBookWriter 判断用户是否拥有某知识库的写授权（公司知识库场景）。
func IsBookWriter(bookID, userID uint64) bool {
	if userID == 0 {
		return false
	}
	var n int64
	if err := db.Model(&model.BookWriter{}).Where("book_id = ? AND user_id = ?", bookID, userID).Count(&n).Error; err != nil {
		return false
	}
	return n > 0
}

// ListBookWriters 列出某知识库的写授权用户（含用户展示信息）。
func ListBookWriters(bookID uint64) ([]model.BookWriterView, error) {
	var out []model.BookWriterView
	err := db.Model(&model.BookWriter{}).
		Select("book_writers.*, users.username AS username, users.name AS name, users.email AS email, users.nickname AS nickname").
		Joins("LEFT JOIN users ON users.id = book_writers.user_id").
		Where("book_writers.book_id = ?", bookID).
		Order("book_writers.created_at ASC").
		Find(&out).Error
	return out, err
}
