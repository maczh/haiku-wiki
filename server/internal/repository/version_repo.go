package repository

import (
	"time"

	"haiku-wiki/server/internal/model"
)

const keepVersions = 20 // 每文档保留最近 20 版

// CreateVersion 插入版本快照。
func CreateVersion(v *model.DocVersion) error { return db.Create(v).Error }

// ListVersionMeta 版本元信息列表（不含正文，倒序）。
type VersionMeta struct {
	ID        uint64    `json:"id"`
	DocID     uint64    `json:"doc_id"`
	Title     string    `json:"title"`
	Source    string    `json:"source"`
	Size      int       `json:"size"`
	CreatedAt time.Time `json:"created_at"`
}

// ListVersionsByDoc 某文档快照列表（倒序，最多 20 条）。
func ListVersionsByDoc(docID uint64) ([]VersionMeta, error) {
	var out []VersionMeta
	err := db.Model(&model.DocVersion{}).
		Select("id", "doc_id", "title", "source", "LENGTH(content) AS size", "created_at").
		Where("doc_id = ?", docID).
		Order("created_at DESC, id DESC").
		Limit(keepVersions).
		Find(&out).Error
	return out, err
}

// FindVersionByID 查单个快照（含正文）。
func FindVersionByID(id uint64) (*model.DocVersion, error) {
	var v model.DocVersion
	if err := db.First(&v, id).Error; err != nil {
		return nil, err
	}
	return &v, nil
}

// TrimVersions 保留最近 20 版，删除更早的旧快照。
func TrimVersions(docID uint64) error {
	var ids []uint64
	if err := db.Model(&model.DocVersion{}).
		Where("doc_id = ?", docID).
		Order("created_at DESC, id DESC").
		Limit(keepVersions).
		Pluck("id", &ids).Error; err != nil {
		return err
	}
	if len(ids) < keepVersions {
		return nil
	}
	return db.Where("doc_id = ? AND id NOT IN ?", docID, ids).
		Delete(&model.DocVersion{}).Error
}

// DeleteVersionsByDocs 彻底删除一批文档的快照（purge 时用）。
func DeleteVersionsByDocs(docIDs []uint64) error {
	if len(docIDs) == 0 {
		return nil
	}
	return db.Where("doc_id IN ?", docIDs).Delete(&model.DocVersion{}).Error
}
