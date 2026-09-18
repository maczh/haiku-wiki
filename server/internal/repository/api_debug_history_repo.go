package repository

import (
	"errors"

	"gorm.io/gorm"

	"haiku-wiki/server/internal/model"
)

// FindApiDebugHistory 查询某文档/接口/用户下的调试历史。
func FindApiDebugHistory(docID uint64, endpointID string, userID uint64) (*model.ApiDebugHistory, error) {
	var h model.ApiDebugHistory
	err := db.Where("doc_id = ? AND endpoint_id = ? AND user_id = ?", docID, endpointID, userID).First(&h).Error
	if err != nil {
		return nil, err
	}
	return &h, nil
}

// SaveApiDebugHistory 保存/覆盖调试历史（按 doc+endpoint+user 唯一）。
func SaveApiDebugHistory(h *model.ApiDebugHistory) error {
	return db.Save(h).Error
}

// UpsertApiDebugHistory 查询或创建记录后更新 Records。
func UpsertApiDebugHistory(docID uint64, endpointID string, userID uint64, records string) error {
	var h model.ApiDebugHistory
	err := db.Where("doc_id = ? AND endpoint_id = ? AND user_id = ?", docID, endpointID, userID).First(&h).Error
	if err != nil {
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		h = model.ApiDebugHistory{
			DocID:      docID,
			EndpointID: endpointID,
			UserID:     userID,
			Records:    records,
		}
		return db.Create(&h).Error
	}
	h.Records = records
	return db.Save(&h).Error
}
