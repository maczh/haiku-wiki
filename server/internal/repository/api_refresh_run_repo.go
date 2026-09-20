package repository

import (
	"gorm.io/gorm/clause"

	"haiku-wiki/server/internal/model"
)

// SaveLastRun 覆盖式保存「最近一次」刷新任务结果（单行表，固定 ID=1）。
//
// 只保留最近一次（Q8），因此这里用覆盖语义（`UpdateAll`）是**正确**的——
// 与 UploadStat 的累加语义（§13.1-B8）不同，勿混用。
func SaveLastRun(r *model.ApiRefreshRun) error {
	if r == nil {
		return nil
	}
	r.ID = 1
	return db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "id"}},
		UpdateAll: true,
	}).Create(r).Error
}

// GetLastRun 读取最近一次刷新任务结果；从未跑过时返回零值行（不报错、不刷日志）。
func GetLastRun() (*model.ApiRefreshRun, error) {
	var r model.ApiRefreshRun
	res := db.Where("id = ?", 1).Limit(1).Find(&r)
	if res.Error != nil {
		return nil, res.Error
	}
	if res.RowsAffected == 0 {
		return &model.ApiRefreshRun{ID: 1}, nil
	}
	return &r, nil
}
