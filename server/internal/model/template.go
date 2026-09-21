package model

import "time"

// DocTemplate 文档模板（仿语雀/WPS）：预置一批企业办公常用模板，用户在「新建文档」时
// 按业务分类 + 文档类型筛选后套用，创建出的文档正文即模板正文，再改成自己需要的文档。
//
// 模板正文直接复用各 doc_type 现有的正文契约（markdown 字符串 / sheet v3 JSON /
// 思维导图 JSON / 甘特图 JSON），编辑器分发链（DocContent）与 iconForDocType 无需改动。
type DocTemplate struct {
	ID       uint64 `gorm:"primaryKey" json:"id"`
	Category string `gorm:"size:64;index:idx_tpl_cat_type,priority:1" json:"category"`  // 业务分类（行政办公/通知/总结汇报/项目管理/软件项目/工程施工/营销报表/财务报表/工作计划/报销/需求分析脑图/营销方案脑图/财务分析脑图/投资分析脑图）
	DocType  string `gorm:"size:16;index:idx_tpl_cat_type,priority:2" json:"doc_type"` // markdown|sheet|mindmap|gantt
	Name     string `gorm:"size:128" json:"name"`                                     // 模板名（卡片标题）
	Title    string `gorm:"size:256" json:"title"`                                    // 用模板创建文档时的默认标题
	Content  string `gorm:"type:longtext" json:"content"`                             // 模板正文（与各 doc_type 契约一致）
	Builtin  bool   `gorm:"default:true;index" json:"builtin"`                        // true=系统预置，false=用户另存为的自定义模板
	Sort     int    `gorm:"default:0" json:"sort"`                                    // 分类内排序
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (DocTemplate) TableName() string { return "doc_templates" }
