package model

import "time"

// UploadStat 去重命中率只读统计（P1-4）。
//
// 单行表（固定 ID=1），**不参与任何删除决策**；计数口径见 §12.7：
//   - 每成功新增一条 attachment meta → TotalUploads += 1（不论落盘还是复用）
//   - 本次未写盘 → DedupHits += 1 且 SavedBytes += size
//
// ⚠️ 累加必须走 `clause.OnConflict{DoUpdates: clause.Assignments{gorm.Expr("… + ?")}}`，
// **不能**用 `UpdateAll`（那会把累加值覆盖成当次值，§13.3-⑤ / B8）。
type UploadStat struct {
	ID           uint64    `gorm:"primaryKey" json:"id"` // 恒为 1
	TotalUploads int64     `json:"total_uploads"`
	DedupHits    int64     `json:"dedup_hits"`
	SavedBytes   int64     `json:"saved_bytes"`
	UpdatedAt    time.Time `json:"updated_at"`
}

func (UploadStat) TableName() string { return "upload_stats" }
