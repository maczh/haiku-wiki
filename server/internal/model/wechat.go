package model

import "time"

// WeChatBinding 微信账号 ↔ 站内用户的绑定关系。
//
// 设计要点：
//   - 同一微信号在不同应用（网站应用扫码 / 公众号）下的 openid **不同**，所以匹配键是
//     (app_id, open_id) 的组合唯一索引；
//   - unionid 是「同一开放平台账号下跨应用唯一」的 ID，是识别「同一个人在扫码端和
//     微信内是同一人」的关键，故单独建索引并优先用它匹配；
//   - 微信开放平台未绑定（或公众号未关联开放平台）时不返回 unionid，此时退化为按
//     (app_id, open_id) 匹配 —— 这也是可接受的：同一入口重复登录仍能命中同一条记录。
type WeChatBinding struct {
	ID     uint64 `gorm:"primaryKey" json:"id"`
	UserID uint64 `gorm:"index;not null" json:"user_id"`
	// AppID 来源应用标识（网站应用 / 公众号各自的 appid）
	AppID  string `gorm:"size:64;uniqueIndex:uk_wx_app_openid;not null" json:"app_id"`
	OpenID string `gorm:"size:128;uniqueIndex:uk_wx_app_openid;not null" json:"open_id"`
	// UnionID 开放平台级唯一 ID（可空）
	UnionID string `gorm:"size:128;index" json:"union_id"`
	// 微信侧昵称 / 头像（仅作展示与首次注册时的默认值，不覆盖用户自己填的资料）
	Nickname  string    `gorm:"size:64" json:"nickname"`
	Avatar    string    `gorm:"size:512" json:"avatar"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (WeChatBinding) TableName() string { return "wechat_bindings" }
