package repository

import (
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"haiku-wiki/server/internal/model"
)

// LoadDerived 按原件 md5 读取派生元数据缓存；无缓存行返回 (nil, gorm.ErrRecordNotFound)。
//
// md5 一律经 normalizeMD5 归一（A1：MySQL 默认 CI 排序规则下大小写会互相覆盖）。
// 用 Find + RowsAffected 避免"缓存未命中"这一**正常路径**刷 GORM 日志。
func LoadDerived(md5 string) (*model.AttachmentDerived, error) {
	key := normalizeMD5(md5)
	if key == "" {
		return nil, gorm.ErrRecordNotFound
	}
	var d model.AttachmentDerived
	res := db.Where("md5 = ?", key).Limit(1).Find(&d)
	if res.Error != nil {
		return nil, res.Error
	}
	if res.RowsAffected == 0 {
		return nil, gorm.ErrRecordNotFound
	}
	return &d, nil
}

// UpsertDerived 写入/覆盖派生元数据缓存（幂等）。
//
// `UpdateAll` 是"覆盖"语义，对本表**安全且正确**（§13.1-B5：唯一性由 md5 主键满足两方言；
// MySQL 生成 ON DUPLICATE KEY UPDATE 且更新列不含主键 md5）。
func UpsertDerived(d *model.AttachmentDerived) error {
	if d == nil {
		return gorm.ErrInvalidData
	}
	d.MD5 = normalizeMD5(d.MD5)
	if d.MD5 == "" {
		return gorm.ErrInvalidData
	}
	now := time.Now().UTC()
	if d.CreatedAt.IsZero() {
		d.CreatedAt = now
	}
	d.UpdatedAt = now
	return db.Clauses(clause.OnConflict{UpdateAll: true}).Create(d).Error
}

// DeleteDerived 删除一条派生缓存（孤儿清理 / 测试用）。
func DeleteDerived(md5 string) error {
	key := normalizeMD5(md5)
	if key == "" {
		return nil
	}
	return db.Where("md5 = ?", key).Delete(&model.AttachmentDerived{}).Error
}
