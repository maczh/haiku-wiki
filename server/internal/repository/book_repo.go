package repository

import (
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
func ListBooksVisible(userID uint64) ([]model.BookWithCount, error) {
	var out []model.BookWithCount
	err := db.Model(&model.Book{}).
		Select(bookWithCountSelect).
		Where("books.owner_id <> ? AND books.team_id IS NULL AND books.visibility IN ?", userID, []string{"members", "public"}).
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
