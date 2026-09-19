package repository

import (
	"time"

	"gorm.io/gorm"

	"haiku-wiki/server/internal/model"
)

// CreateDoc 新建文档。
func CreateDoc(d *model.Doc) error { return db.Create(d).Error }

// FindDocByID 按 ID 查文档（自动排除软删）。
func FindDocByID(id uint64) (*model.Doc, error) {
	var d model.Doc
	if err := db.First(&d, id).Error; err != nil {
		return nil, err
	}
	return &d, nil
}

// FindDocUnscopedByID 按 ID 查文档（含软删，回收站用）。
func FindDocUnscopedByID(id uint64) (*model.Doc, error) {
	var d model.Doc
	if err := db.Unscoped().First(&d, id).Error; err != nil {
		return nil, err
	}
	return &d, nil
}

// ListTreeByBook 知识库目录树平铺列表（软删外）。
// 排序：置顶文档优先（pinned_at 非空在前），同级内按 pos 字典序，前端组树。
// CASE WHEN 写法在 SQLite / MySQL 双方言下语义一致（NULL 参与比较结果不可靠，故显式 CASE）。
func ListTreeByBook(bookID uint64) ([]model.Doc, error) {
	var out []model.Doc
	err := db.Select("id", "book_id", "parent_id", "title", "doc_type", "pos", "pinned_at", "updated_at").
		Where("book_id = ?", bookID).
		Order("CASE WHEN pinned_at IS NULL THEN 1 ELSE 0 END ASC, pos ASC").
		Find(&out).Error
	return out, err
}

// ListSiblings 同一父节点下的兄弟（不含指定文档，可传 0 表示不过滤），按 pos 升序。
func ListSiblings(bookID, parentID, excludeID uint64) ([]model.Doc, error) {
	var out []model.Doc
	q := db.Select("id", "book_id", "parent_id", "title", "doc_type", "pos").
		Where("book_id = ? AND parent_id = ?", bookID, parentID)
	if excludeID > 0 {
		q = q.Where("id <> ?", excludeID)
	}
	err := q.Order("pos ASC").Find(&out).Error
	return out, err
}

// ListChildDocs 取某父节点下的**直接子文档（含正文）**，按 pos 升序。
//
// 与 ListSiblings 的区别：后者只 Select 树字段（供排序用），本函数取全字段，
// 专供「递归复制子树」（service.DocService.Copy）使用 —— 复制必须带上 content，
// 否则目录树复制出来的子文档全是空壳。
func ListChildDocs(bookID, parentID uint64) ([]model.Doc, error) {
	return ListChildDocsTx(db, bookID, parentID)
}

// ListChildDocsTx 与 ListChildDocs 同语义，但走调用方传入的事务。
//
// **必须有这个版本，不能图省事在事务里调用 ListChildDocs。**
// 原因（真实踩过）：本项目的 SQLite 测试环境把连接池限成 MaxOpenConns(1)
// （service_test.go，为串行化避免锁竞争），事务会独占那唯一一条连接；
// 事务内再用全局 db 发查询就永远拿不到连接而**永久阻塞** ——
// 表现是 `go test` 跑满 10 分钟被 timeout 杀掉，栈停在 database/sql.(*DB).conn，
// 极难从「测试挂了」这个现象反推到根因。生产环境连接池是 20，
// 不会死锁，但同样有「读不到本事务未提交的写入」和写锁争用两个隐患。
func ListChildDocsTx(tx *gorm.DB, bookID, parentID uint64) ([]model.Doc, error) {
	var out []model.Doc
	err := tx.Where("book_id = ? AND parent_id = ?", bookID, parentID).
		Order("pos ASC").
		Find(&out).Error
	return out, err
}

// UpdateDoc 保存文档变更（标题/内容/pos/parent）。
func UpdateDoc(d *model.Doc) error { return db.Save(d).Error }

// SoftDeleteDoc 软删文档（进回收站）。
func SoftDeleteDoc(d *model.Doc) error { return db.Delete(d).Error }

// RestoreDoc 恢复软删文档（deleted_at 置 NULL）。
func RestoreDoc(id uint64) error {
	return db.Unscoped().Model(&model.Doc{}).Where("id = ?", id).
		Update("deleted_at", nil).Error
}

// UpdateDocsPos 批量更新 pos（兄弟重排兜底时使用）。
func UpdateDocsPos(updates map[uint64]string) error {
	if len(updates) == 0 {
		return nil
	}
	return db.Transaction(func(tx *gorm.DB) error {
		for id, pos := range updates {
			if err := tx.Model(&model.Doc{}).Where("id = ?", id).Update("pos", pos).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

// SoftDeleteDocsByBook 级联软删某知识库下全部文档。
func SoftDeleteDocsByBook(bookID uint64) error {
	return db.Where("book_id = ?", bookID).Delete(&model.Doc{}).Error
}

// ListDescendantIDs 迭代收集子孙节点 ID（含自身，软删内外均可，回收站/级联删除用）。
func ListDescendantIDs(bookID, rootID uint64) ([]uint64, error) {
	ids := []uint64{rootID}
	frontier := []uint64{rootID}
	for len(frontier) > 0 {
		var next []uint64
		err := db.Unscoped().Model(&model.Doc{}).
			Where("book_id = ? AND parent_id IN ?", bookID, frontier).
			Pluck("id", &next).Error
		if err != nil {
			return nil, err
		}
		ids = append(ids, next...)
		frontier = next
	}
	return ids, nil
}

// PurgeDocs 彻底删除文档（物理删除）。
func PurgeDocs(ids []uint64) error {
	if len(ids) == 0 {
		return nil
	}
	return db.Unscoped().Where("id IN ?", ids).Delete(&model.Doc{}).Error
}

// RestoreDocWithAncestors 恢复文档及其所有已删除祖先（保证树结构完整）。
func RestoreDocWithAncestors(d *model.Doc) error {
	// 自身先恢复
	if err := RestoreDoc(d.ID); err != nil {
		return err
	}
	// 沿 parent 链向上恢复仍处于软删状态的祖先
	cur := d.ParentID
	for cur != 0 {
		var p model.Doc
		if err := db.Unscoped().First(&p, cur).Error; err != nil {
			if IsNotFound(err) {
				break // 祖先已物理删除，到此为止
			}
			return err
		}
		if p.DeletedAt.Valid {
			if err := RestoreDoc(p.ID); err != nil {
				return err
			}
		}
		cur = p.ParentID
	}
	return nil
}

// TrashItem 回收站列表项。
type TrashItem struct {
	DocID     uint64     `json:"doc_id"`
	BookID    uint64     `json:"book_id"`
	ParentID  uint64     `json:"parent_id"`
	Title     string     `json:"title"`
	DeletedAt *time.Time `json:"deleted_at"`
	BookName  string     `json:"book_name"`
}

// ListTrash 查询处于软删状态的文档（限定书主，按删除时间倒序）。
func ListTrash(ownerID uint64) ([]TrashItem, error) {
	var out []TrashItem
	err := db.Unscoped().
		Table("docs").
		Select("docs.id AS doc_id, docs.book_id, docs.parent_id, docs.title, docs.deleted_at, books.name AS book_name").
		Joins("JOIN books ON books.id = docs.book_id").
		Where("docs.deleted_at IS NOT NULL AND books.owner_id = ?", ownerID).
		Order("docs.deleted_at DESC").
		Find(&out).Error
	return out, err
}

// UpdateDocPublicEdit 更新文档的「所有人可编辑」标记。
func UpdateDocPublicEdit(docID uint64, enabled bool) error {
	return db.Model(&model.Doc{}).Where("id = ?", docID).
		Update("public_edit", enabled).Error
}
