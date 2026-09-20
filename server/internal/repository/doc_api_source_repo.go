package repository

import (
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"haiku-wiki/server/internal/model"
)

// DeleteDocApiSource 清除单篇文档的 URL 导入来源（正文被改成非接口内容时调用）。
// 幂等：行不存在时影响 0 行、不报错。
func DeleteDocApiSource(docID uint64) error {
	if docID == 0 {
		return nil
	}
	return db.Where("doc_id = ?", docID).Delete(&model.DocApiSource{}).Error
}

// UpsertDocApiSource 写入/更新一篇文档的 URL 导入来源。
//
// 关键语义：**首建保留 imported_at**——重复导入同一篇（或刷新）时不能把「首次导入时间」
// 改写成「最近一次操作时间」；首次导入时间只在该行不存在时写入。
func UpsertDocApiSource(s *model.DocApiSource) error {
	if s == nil || s.DocID == 0 {
		return gorm.ErrInvalidData
	}
	now := time.Now().UTC()
	if s.ImportedAt.IsZero() {
		s.ImportedAt = now
	}
	if s.CreatedAt.IsZero() {
		s.CreatedAt = now
	}
	s.UpdatedAt = now
	// DoUpdates 的字段里**不含 imported_at / created_at**：列出的字段才会被覆盖。
	return db.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "doc_id"}},
		DoUpdates: clause.Assignments(map[string]any{
			"source_url": s.SourceURL,
			"updated_at": s.UpdatedAt,
		}),
	}).Create(s).Error
}

// FindDocApiSource 按文档 ID 取来源元数据；无来源行时返回 gorm.ErrRecordNotFound。
func FindDocApiSource(docID uint64) (*model.DocApiSource, error) {
	var s model.DocApiSource
	if err := db.Where("doc_id = ?", docID).First(&s).Error; err != nil {
		return nil, err
	}
	return &s, nil
}

// ListRefreshableDocIDSources 列出可刷新的来源行（有非空 source_url）。
//
// limit <= 0 表示不限制。逐行取自身 URL 即可，**不需要**按 source_url 建索引
// （§13.3-①：那条索引在 MySQL 下会让 AutoMigrate 直接失败）。
func ListRefreshableDocIDSources(limit int) ([]model.DocApiSource, error) {
	q := db.Where("source_url <> ''").Order("doc_id ASC")
	if limit > 0 {
		q = q.Limit(limit)
	}
	var out []model.DocApiSource
	err := q.Find(&out).Error
	return out, err
}

// UpdateRefreshResult 记录一次刷新的结果与状态（不改 imported_at）。
func UpdateRefreshResult(docID uint64, status, errMsg string, added, updated, removed int) error {
	if len(errMsg) > 512 {
		errMsg = errMsg[:512]
	}
	now := time.Now().UTC()
	return db.Model(&model.DocApiSource{}).Where("doc_id = ?", docID).Updates(map[string]any{
		"refresh_status":    status,
		"refresh_error":     errMsg,
		"last_refreshed_at": now,
		"last_added":        added,
		"last_updated":      updated,
		"last_removed":      removed,
		"updated_at":        now,
	}).Error
}

// DeleteDocApiSourceByDocIDs 按文档 ID 批量删除来源行（文档被彻底删除时调用，避免孤儿行）。
func DeleteDocApiSourceByDocIDs(docIDs []uint64) error {
	if len(docIDs) == 0 {
		return nil
	}
	return db.Where("doc_id IN ?", docIDs).Delete(&model.DocApiSource{}).Error
}
