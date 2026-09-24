package repository

import (
	"haiku-wiki/server/internal/model"
)

// FindWeChatBindingByUnionID 按开放平台 unionid 查绑定（跨应用识别同一人）。
func FindWeChatBindingByUnionID(unionID string) (*model.WeChatBinding, error) {
	var b model.WeChatBinding
	if err := db.Where("union_id = ?", unionID).First(&b).Error; err != nil {
		return nil, err
	}
	return &b, nil
}

// FindWeChatBindingByAppOpenID 按 (app_id, open_id) 查绑定（同一应用内重复登录稳定命中）。
func FindWeChatBindingByAppOpenID(appID, openID string) (*model.WeChatBinding, error) {
	var b model.WeChatBinding
	if err := db.Where("app_id = ? AND open_id = ?", appID, openID).First(&b).Error; err != nil {
		return nil, err
	}
	return &b, nil
}

// CreateWeChatBinding 落库一条微信绑定关系。
func CreateWeChatBinding(b *model.WeChatBinding) error { return db.Create(b).Error }

// UpdateWeChatBinding 保存绑定变更（昵称/头像/unionid 同步）。
func UpdateWeChatBinding(b *model.WeChatBinding) error { return db.Save(b).Error }
