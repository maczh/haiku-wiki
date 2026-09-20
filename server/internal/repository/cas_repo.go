package repository

import (
	"strings"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"haiku-wiki/server/internal/model"
)

// ---------- 内容寻址（CAS）相关查询 ----------

// FindAttachmentByMD5 按内容摘要取一条附件 meta。
//
// 同一 md5 允许多行 meta（不同上传者/文件名/文库），它们**共享同一 storage_path**；
// 这里固定按最早一行（id 最小）返回，其 storage_path 即该内容的物理对象键。
// 空 md5 直接返回未找到——历史存量行 md5 为空，不能参与秒传。
//
// 用 Find + RowsAffected 而非 First：First 命中不到时会返回 ErrRecordNotFound 并被
// GORM logger 打成 Warn 日志；秒传预检是**每次上传都会走**的热路径，不能刷日志。
func FindAttachmentByMD5(md5 string) (*model.Attachment, error) {
	key := normalizeMD5(md5)
	if key == "" {
		return nil, gorm.ErrRecordNotFound
	}
	var a model.Attachment
	res := db.Where("md5 = ?", key).Order("id ASC").Limit(1).Find(&a)
	if res.Error != nil {
		return nil, res.Error
	}
	if res.RowsAffected == 0 {
		return nil, gorm.ErrRecordNotFound
	}
	return &a, nil
}

// FindAttachmentByStoragePath 按物理路径取一条附件 meta。
func FindAttachmentByStoragePath(storagePath string) (*model.Attachment, error) {
	if strings.TrimSpace(storagePath) == "" {
		return nil, gorm.ErrRecordNotFound
	}
	var a model.Attachment
	res := db.Where("storage_path = ?", storagePath).Order("id ASC").Limit(1).Find(&a)
	if res.Error != nil {
		return nil, res.Error
	}
	if res.RowsAffected == 0 {
		return nil, gorm.ErrRecordNotFound
	}
	return &a, nil
}

// CountAttachmentsByPath 同一物理路径被多少条 meta 引用（删除守卫用）。
//
// 精确匹配用 `= ?`，**不用 LIKE**：两方言天然安全，也不存在通配符逃逸问题（§13.3-⑥）。
func CountAttachmentsByPath(storagePath string) (int64, error) {
	var n int64
	err := db.Model(&model.Attachment{}).Where("storage_path = ?", storagePath).Count(&n).Error
	return n, err
}

// CountAttachmentsUnderPrefix 前缀下有多少条 meta（zip 内页目录等）。
//
// 前缀必须是**受控常量**（如 uploads/prototype/<uuid-hex>/）——不含 % 与 _，
// 因此**不加 ESCAPE**（§13.1-B6：`ESCAPE '\'` 在 MySQL 是语法错误，裸删 ESCAPE 又会让
// SQLite 把含 % / _ 的关键词搜成假阴性）。若将来前缀可能含通配符，改用
// `substr(storage_path,1,?) = ?`（两方言均支持 substr）。
func CountAttachmentsUnderPrefix(prefix string) (int64, error) {
	var n int64
	err := db.Model(&model.Attachment{}).Where("storage_path LIKE ?", prefix+"%").Count(&n).Error
	return n, err
}

// normalizeMD5 统一 md5 出入口：一律小写去空白（§13.3-②）。
//
// 为什么必须在**应用层**做：SQLite 的文本主键默认 BINARY → 大小写敏感；MySQL 默认
// utf8mb4_0900_ai_ci → 大小写**不敏感**，同一个 md5 的两种大小写会撞主键并可能
// 静默 upsert 覆盖他人元数据。
func normalizeMD5(s string) string { return strings.ToLower(strings.TrimSpace(s)) }

// UpdateAttachmentsByPath 覆盖同一物理路径下**所有** meta 的摘要与大小。
//
// 用途：.pptx 外链图片本地化会**就地改写**CAS 原件字节（replaceUploadedFile），
// 若不同步 meta 的 md5，就会出现「meta 的 md5 与实际内容不符」——后续按旧 md5 秒传
// 会拿到被改写过的文件（静默给错内容）。这里把该路径下所有行一起刷新，保持一致。
func UpdateAttachmentsByPath(storagePath, md5 string, size int64) error {
	if strings.TrimSpace(storagePath) == "" {
		return nil
	}
	return db.Model(&model.Attachment{}).Where("storage_path = ?", storagePath).
		Updates(map[string]any{"md5": normalizeMD5(md5), "size": size}).Error
}

// ---------- 去重统计（单行表） ----------

// GetUploadStat 读取单行统计；尚未建行时返回零值行（不报错，也不刷 GORM 日志）。
func GetUploadStat() (*model.UploadStat, error) {
	var s model.UploadStat
	res := db.Where("id = ?", 1).Limit(1).Find(&s)
	if res.Error != nil {
		return nil, res.Error
	}
	if res.RowsAffected == 0 {
		return &model.UploadStat{ID: 1}, nil
	}
	return &s, nil
}

// EnsureUploadStatRow 幂等地建立 ID=1 的单行统计（SeedData 调用）。
func EnsureUploadStatRow() error {
	return db.Clauses(clause.OnConflict{DoNothing: true}).
		Create(&model.UploadStat{ID: 1, UpdatedAt: time.Now().UTC()}).Error
}

// BumpUploadStat 累加统计（只在"新增一条 attachment meta"处调用一次）。
//
// hit=true 表示本次未写盘（秒传/复用），同时累加 DedupHits 与 SavedBytes。
//
// ⚠️ 必须用 `DoUpdates + gorm.Expr("… + ?")` 累加：`UpdateAll` 是"覆盖"语义，
// 会把累加值覆盖成当次值（§13.1-B8 / §13.3-⑤）。`Columns` 在 MySQL 被忽略（走主键），
// 在 SQLite 用于定位冲突目标，两边都安全。
func BumpUploadStat(hit bool, bytes int64) error {
	var hits, saved int64
	if hit {
		hits, saved = 1, bytes
	}
	now := time.Now().UTC()
	return db.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "id"}},
		DoUpdates: clause.Assignments(map[string]any{
			"total_uploads": gorm.Expr("total_uploads + ?", 1),
			"dedup_hits":    gorm.Expr("dedup_hits + ?", hits),
			"saved_bytes":   gorm.Expr("saved_bytes + ?", saved),
			"updated_at":    now,
		}),
	}).Create(&model.UploadStat{
		ID:           1,
		TotalUploads: 1,
		DedupHits:    hits,
		SavedBytes:   saved,
		UpdatedAt:    now,
	}).Error
}
