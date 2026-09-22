package repository

import (
	"bytes"
	"embed"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"sort"
	"strings"

	"gorm.io/gorm"

	"haiku-wiki/server/internal/model"
)

// ─────────────────────────────────────────────────────────────────────────────
// 文档模板数据源
//
// 模板正文不再硬编码在 Go 代码里，而是放在同目录的 templates/*.json 外部数据文件中：
//   - 打包进二进制（//go:embed），首次启动时自动建表并灌入，升级时同步新增/修订的内置模板；
//   - 管理员可在「系统管理 → 导入模板」里上传模板数据文件，或选择整个模板目录批量导入；
//   - 导入进来的模板 builtin=false，不会被内置模板覆盖，也不会在启动时被改写。
// ─────────────────────────────────────────────────────────────────────────────

//go:embed templates/*.json
var builtinTemplateFS embed.FS

// validTemplateDocTypes 模板允许的文档类型（创建文档时按类型分发编辑器，必须与正文契约一致）。
var validTemplateDocTypes = map[string]bool{
	"markdown": true, "sheet": true, "mindmap": true, "gantt": true, "whiteboard": true,
}

// TemplateFile 单个模板数据文件的结构。
// category / doc_type 可写在文件级作为缺省值，条目级同名字段优先。
type TemplateFile struct {
	Category  string             `json:"category"`
	DocType   string             `json:"doc_type"`
	Templates []TemplateFileItem `json:"templates"`
}

// TemplateFileItem 文件中单条模板。content 既可以是字符串（markdown 正文），
// 也可以是对象/数组（sheet/mindmap/gantt 的 JSON 正文，便于人工编写与阅读）。
type TemplateFileItem struct {
	Name     string          `json:"name"`
	Title    string          `json:"title"`
	Category string          `json:"category"`
	DocType  string          `json:"doc_type"`
	Sort     *int            `json:"sort"`
	Content  json.RawMessage `json:"content"`
}

// ParseTemplateFile 解析一个模板数据文件（内置集与管理员导入共用）。
func ParseTemplateFile(r io.Reader) ([]model.DocTemplate, error) {
	var f TemplateFile
	// 不做 DisallowUnknownFields：管理员导入的第三方文件可能带 version/description 等附加字段，
	// 关键字段缺失会在下面的 normalize 里给出明确报错。
	if err := json.NewDecoder(r).Decode(&f); err != nil {
		return nil, fmt.Errorf("解析模板数据文件失败: %w", err)
	}
	if len(f.Templates) == 0 {
		return nil, fmt.Errorf("模板数据文件为空（缺少 templates）")
	}
	out := make([]model.DocTemplate, 0, len(f.Templates))
	for i, it := range f.Templates {
		t, err := normalizeTemplate(it, f.Category, f.DocType, i)
		if err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, nil
}

// normalizeTemplate 校验并补全单条模板（分类/类型缺省、标题缺省、排序缺省、正文归一化）。
func normalizeTemplate(it TemplateFileItem, defCategory, defDocType string, idx int) (model.DocTemplate, error) {
	category := strings.TrimSpace(firstNonEmpty(it.Category, defCategory))
	name := strings.TrimSpace(it.Name)
	if category == "" {
		return model.DocTemplate{}, fmt.Errorf("第 %d 条模板缺少 category", idx+1)
	}
	if name == "" {
		return model.DocTemplate{}, fmt.Errorf("第 %d 条模板缺少 name", idx+1)
	}
	docType := strings.TrimSpace(firstNonEmpty(it.DocType, defDocType))
	if !validTemplateDocTypes[docType] {
		return model.DocTemplate{}, fmt.Errorf("第 %d 条模板（%s）的 doc_type 非法: %q", idx+1, name, docType)
	}
	content, err := normalizeTemplateContent(it.Content)
	if err != nil {
		return model.DocTemplate{}, fmt.Errorf("第 %d 条模板（%s）的 content 非法: %w", idx+1, name, err)
	}
	sortNo := (idx + 1) * 10
	if it.Sort != nil {
		sortNo = *it.Sort
	}
	return model.DocTemplate{
		Category: category,
		DocType:  docType,
		Name:     name,
		Title:    strings.TrimSpace(firstNonEmpty(it.Title, name)),
		Content:  content,
		Sort:     sortNo,
	}, nil
}

// normalizeTemplateContent 把 content 归一化为入库字符串：
// JSON 字符串原样取用；对象/数组（sheet、mindmap、gantt 正文）压缩成单行 JSON。
func normalizeTemplateContent(raw json.RawMessage) (string, error) {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 {
		return "", fmt.Errorf("content 为空")
	}
	if trimmed[0] == '"' {
		var s string
		if err := json.Unmarshal(trimmed, &s); err != nil {
			return "", err
		}
		return s, nil
	}
	var buf bytes.Buffer
	if err := json.Compact(&buf, trimmed); err != nil {
		return "", err
	}
	return buf.String(), nil
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

// LoadBuiltinTemplates 读取内置模板数据文件（按文件名排序，保证分类顺序稳定）。
func LoadBuiltinTemplates() ([]model.DocTemplate, error) {
	entries, err := builtinTemplateFS.ReadDir("templates")
	if err != nil {
		return nil, fmt.Errorf("读取内置模板目录失败: %w", err)
	}
	names := make([]string, 0, len(entries))
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".json") {
			continue
		}
		names = append(names, e.Name())
	}
	sort.Strings(names)
	out := make([]model.DocTemplate, 0, 128)
	for _, n := range names {
		b, err := builtinTemplateFS.ReadFile("templates/" + n)
		if err != nil {
			return nil, fmt.Errorf("读取内置模板文件 %s 失败: %w", n, err)
		}
		items, err := ParseTemplateFile(bytes.NewReader(b))
		if err != nil {
			return nil, fmt.Errorf("内置模板文件 %s: %w", n, err)
		}
		out = append(out, items...)
	}
	return out, nil
}

// SeedTemplates 初始化/同步内置文档模板（幂等）：
//   - 表由 AutoMigrate 自动创建，这里只灌数据；
//   - 库内没有的模板直接插入（builtin=true）；
//   - 已存在且 builtin=true 的模板，用内置集覆盖正文/标题/排序（随版本升级同步）；
//   - 已存在但 builtin=false 的同名模板（管理员导入或改过的）一律跳过，不覆盖。
func SeedTemplates(g *gorm.DB) error {
	items, err := LoadBuiltinTemplates()
	if err != nil {
		return err
	}
	if len(items) == 0 {
		return nil
	}
	return g.Transaction(func(tx *gorm.DB) error {
		for _, t := range items {
			t.Builtin = true
			if err := upsertTemplate(tx, t, false); err != nil {
				return err
			}
		}
		return nil
	})
}

// RepairBuiltinFlag 把「不在内置集里却标着 builtin=true」的模板归位为自定义模板（幂等）。
//
// 背景：Builtin 字段早期带 `default:true` 标签，GORM 对带默认值的字段会跳过零值，
// 于是「批量导入 / 另存为」写入的 builtin=false 根本没进 SQL，被数据库默认值翻成 true。
// 后果是导入与另存的模板都成了「系统内置」，管理员改不动也删不掉。
// 内置集是权威来源，因此用内置集的 (category, doc_type, name) 三元组反查修正。
func RepairBuiltinFlag(g *gorm.DB) error {
	items, err := LoadBuiltinTemplates()
	if err != nil {
		return err
	}
	if len(items) == 0 {
		return nil
	}
	// 逐个内置模板把「同名同分类同类型」的行标回内置（顺带覆盖历史脏数据里的 false），
	// 再把剩下的 builtin=true 全部降级为自定义模板。两步都是幂等的。
	keys := make([][3]string, 0, len(items))
	for _, t := range items {
		keys = append(keys, [3]string{t.Category, t.DocType, t.Name})
	}
	// 第一步：把不在内置集内的 builtin=true 行降级
	q := g.Model(&model.DocTemplate{}).Where("builtin = ?", true)
	for _, k := range keys {
		q = q.Where("NOT (category = ? AND doc_type = ? AND name = ?)", k[0], k[1], k[2])
	}
	res := q.Update("builtin", false)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected > 0 {
		log.Printf("[haiku] 模板归属修复：%d 条误标为内置的模板已归位为自定义模板", res.RowsAffected)
	}
	// 第二步：内置集内的行统一标回内置（防止历史数据把内置模板标成了 false）
	for _, k := range keys {
		if err := g.Model(&model.DocTemplate{}).
			Where("category = ? AND doc_type = ? AND name = ? AND builtin = ?", k[0], k[1], k[2], false).
			Update("builtin", true).Error; err != nil {
			return err
		}
	}
	return nil
}

// ImportTemplates 管理员导入模板数据（builtin=false）。
// overwrite=true 时覆盖同名同类型的既有模板正文；false 时只补新模板。
// 返回新增条数、更新条数、跳过条数。
func ImportTemplates(g *gorm.DB, items []model.DocTemplate, overwrite bool) (created, updated, skipped int, err error) {
	if len(items) == 0 {
		return 0, 0, 0, nil
	}
	err = g.Transaction(func(tx *gorm.DB) error {
		for _, t := range items {
			t.Builtin = false
			var exist model.DocTemplate
			// 同 upsertTemplate：用 Find + 判空主键，避免 GORM 对「预期内的查不到」打 record not found
			//（批量导入上千条时这一处会刷出上千行日志）。
			if e := tx.Where("category = ? AND doc_type = ? AND name = ?", t.Category, t.DocType, t.Name).
				Limit(1).Find(&exist).Error; e != nil {
				return e
			}
			if exist.ID == 0 {
				if err := tx.Create(&t).Error; err != nil {
					return err
				}
				created++
				continue
			}
			if !overwrite {
				skipped++
				continue
			}
			if err := tx.Model(&exist).Updates(map[string]interface{}{
				"title": t.Title, "content": t.Content, "sort": t.Sort, "builtin": false,
			}).Error; err != nil {
				return err
			}
			updated++
		}
		return nil
	})
	return created, updated, skipped, err
}

// upsertTemplate 单条模板 upsert。overwrite=false 时：不存在则插入，存在则仅在 builtin 模板上同步内置正文。
func upsertTemplate(tx *gorm.DB, t model.DocTemplate, overwrite bool) error {
	var exist model.DocTemplate
	// ⚠️ 这里用 Find + 判空主键，**不要**用 First：First 查不到会返回 gorm.ErrRecordNotFound，
	// 而 GORM 对该错误照默认 Error 级别打印 `record not found` —— 属于「预期内的查不到」，
	// 每次启动会为库里缺失的每条内置模板各打一行（实测首次灌库 136 行，占启动日志 1/3），
	// 把真正的错误淹掉、也让运维 grep 日志时误判。Find 不产生该错误，语义上也更贴合「探查是否存在」。
	if err := tx.Where("category = ? AND doc_type = ? AND name = ?", t.Category, t.DocType, t.Name).
		Limit(1).Find(&exist).Error; err != nil {
		return err
	}
	if exist.ID == 0 {
		return tx.Create(&t).Error
	}
	if !exist.Builtin {
		// 同名自定义模板（管理员导入）优先，内置集不覆盖
		return nil
	}
	if err := tx.Model(&exist).Updates(map[string]interface{}{
		"title": t.Title, "content": t.Content, "sort": t.Sort,
	}).Error; err != nil {
		return err
	}
	return nil
}
