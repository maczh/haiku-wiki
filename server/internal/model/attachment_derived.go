package model

import "time"

// AttachmentDerived 内容 → 派生元数据 缓存，主键 = 原件 md5。
//
// 为什么必须有这张表：派生 URL 对**图片库**是原件路径的确定性函数，但条目里的
// width/height/degraded/note/kind/entry **不是原件的纯函数**——宽高需解码、entry 来自
// zip 解包选页、kind 来自解析结果；原型的 zip 网页包更极端：内页落在
// uploads/prototype/<随机 uuid>/…（与原件路径毫无关系），**无法从 md5 推导**。
// 所以引用式入库（不传字节、不重派生）必须有这个按 md5 索引的缓存。
//
// 只读用途（引用式入库复用），不参与权限、不做引用计数（D2）。
//
// ⚠️ MD5 是 CAS 键，必须全小写（A1）：MySQL 默认 utf8mb4_0900_ai_ci 是**大小写不敏感**的，
// 同一个 md5 的两种大小写会互相覆盖（静默 upsert 覆盖他人元数据，比报错更隐蔽）。
// 因此所有出入口统一过 normalizeMD5。**禁用** GORM 的 `collate:` tag（§13.1-A1-注）。
type AttachmentDerived struct {
	MD5       string `gorm:"primaryKey;size:32" json:"md5"`
	App       string `gorm:"size:16" json:"app"` // gallery | prototype（同一内容可能被两类文档引用，元数据同构，取首次写入者）
	Ext       string `gorm:"size:16" json:"ext"`
	Kind      string `gorm:"size:16" json:"kind"`        // image | html | other（原型）；gallery 恒 image
	OriginURL string `gorm:"size:512" json:"origin_url"` // 首次落盘的原件 URL（派生文件就是围绕它命名的）
	Preview   string `gorm:"size:512" json:"preview"`
	Thumb     string `gorm:"size:512" json:"thumb"`
	Original  string `gorm:"size:512" json:"original"`
	Entry     string `gorm:"size:512" json:"entry"` // 原型网页入口（zip 包用，指向随机目录）
	Width     int    `json:"width"`
	Height    int    `json:"height"`
	Degraded  bool   `json:"degraded"`
	Note      string `gorm:"size:512" json:"note"`
	// ExtraPrefix 该内容拥有的额外存储前缀（如 zip 内页目录 uploads/prototype/<uuid>/），
	// 供删除守卫判断"删这条是否会毁掉别处正在引用的内页"。
	ExtraPrefix string    `gorm:"size:512" json:"extra_prefix"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

func (AttachmentDerived) TableName() string { return "attachment_derived" }
