package exportx

import (
	"archive/zip"
	"bytes"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"
)

// SheetJSON 与前端 lib/sheet.ts 的存储契约一致：
//
//	v3（Luckysheet，当前）：{"version":3,"sheets":[{"name","row","column","celldata":[{"r","c","v"}]}]}
//	v1：{"version":1,"cells":{"行-列":{"text":"…"}},"colLen":26,"rowLen":100}（键 0 基）
//
// 对外（导出侧）统一仍是扁平的 cells 映射：v3 在这里被降级成首表的 cells，
// 因此 BuildXLSX / BuildCSV / BuildSheetJSONFile 三条链路无需感知版本差异。
type SheetJSON struct {
	Version int                    `json:"version"`
	Cells   map[string]SheetCell   `json:"cells"`
	ColLen  int                    `json:"colLen"`
	RowLen  int                    `json:"rowLen"`
	Sheets  []SheetJSON            `json:"-"`
	Extra   map[string]interface{} `json:"-"`
}

// SheetCell 单元格。
type SheetCell struct {
	Text string `json:"text"`
}

// ParseSheetJSON 解析表格文档内容；解析失败返回空表（导出不报错，导出空表更友好）。
//
// 先按 v3（Luckysheet 多工作表）解析，命中即返回；否则回落到 v1/v2 的扁平结构。
// 两个分支互不影响，历史文档与历史测试的行为完全不变。
func ParseSheetJSON(content string) SheetJSON {
	out := SheetJSON{Version: 1, Cells: map[string]SheetCell{}, ColLen: 26, RowLen: 100}
	if strings.TrimSpace(content) == "" {
		return out
	}
	if v3, ok := parseLuckysheetV3(content); ok {
		return v3
	}
	var raw struct {
		Version int                    `json:"version"`
		Cells   map[string]SheetCell   `json:"cells"`
		ColLen  *int                   `json:"colLen"`
		RowLen  *int                   `json:"rowLen"`
		Rows    map[string]interface{} `json:"rows"`
	}
	if err := json.Unmarshal([]byte(content), &raw); err != nil {
		return out
	}
	if raw.ColLen != nil && *raw.ColLen > 0 {
		out.ColLen = *raw.ColLen
	}
	if raw.RowLen != nil && *raw.RowLen > 0 {
		out.RowLen = *raw.RowLen
	}
	for k, v := range raw.Cells {
		if _, _, ok := splitCellKey(k); ok {
			out.Cells[k] = SheetCell{Text: v.Text}
		}
	}
	return out
}

// luckysheetCell v3 的稀疏单元格：v 可能是标量，也可能是 {v,m,ct,…} 富值对象。
type luckysheetCell struct {
	R int             `json:"r"`
	C int             `json:"c"`
	V json.RawMessage `json:"v"`
}

// parseLuckysheetV3 解析 {"version":3,"sheets":[…]}；不是 v3 或无法解析时返回 ok=false。
//
// current 导出链路（xlsx/csv/json）都是单工作表，因此取首表；多工作表文档导出的
// 是首个 sheet，这与阅读页默认展示首表的行为一致。
func parseLuckysheetV3(content string) (SheetJSON, bool) {
	out := SheetJSON{Version: 3, Cells: map[string]SheetCell{}, ColLen: 26, RowLen: 100}
	var raw struct {
		Version *int              `json:"version"`
		Sheets  []luckysheetSheet `json:"sheets"`
	}
	if err := json.Unmarshal([]byte(content), &raw); err != nil {
		return out, false
	}
	if len(raw.Sheets) == 0 {
		return out, false
	}
	sheet := raw.Sheets[0]
	if sheet.Column != nil && *sheet.Column > 0 {
		out.ColLen = *sheet.Column
	}
	if sheet.Row != nil && *sheet.Row > 0 {
		out.RowLen = *sheet.Row
	}
	for _, cell := range sheet.Celldata {
		if cell.R < 0 || cell.C < 0 {
			continue
		}
		text := luckysheetCellText(cell.V)
		if text == "" {
			continue
		}
		out.Cells[fmt.Sprintf("%d-%d", cell.R, cell.C)] = SheetCell{Text: text}
	}
	// 内容规模超过声明的行列数时按实际内容放宽，避免导出被截断
	if _, maxR, _, maxC, ok := out.bounds(); ok {
		if maxC+3 > out.ColLen {
			out.ColLen = maxC + 3
		}
		if maxR+10 > out.RowLen {
			out.RowLen = maxR + 10
		}
	}
	return out, true
}

// luckysheetSheet v3 单表结构（只声明导出需要的字段）。
type luckysheetSheet struct {
	Name     *string          `json:"name"`
	Row      *int             `json:"row"`
	Column   *int             `json:"column"`
	Celldata []luckysheetCell `json:"celldata"`
}

// luckysheetCellText 取单元格的可展示文本：富值对象优先 m，其次 v；标量直接字符串化。
func luckysheetCellText(v json.RawMessage) string {
	if len(v) == 0 {
		return ""
	}
	// 字符串：去掉 JSON 引号
	var s string
	if err := json.Unmarshal(v, &s); err == nil {
		return s
	}
	// 数字 / 布尔
	var n interface{}
	if err := json.Unmarshal(v, &n); err == nil {
		switch t := n.(type) {
		case float64:
			return strconv.FormatFloat(t, 'f', -1, 64)
		case bool:
			return strconv.FormatBool(t)
		}
	}
	// 富值对象 {v,m,ct,…}
	var rich struct {
		M *string     `json:"m"`
		V interface{} `json:"v"`
	}
	if err := json.Unmarshal(v, &rich); err == nil {
		if rich.M != nil {
			return *rich.M
		}
		switch t := rich.V.(type) {
		case string:
			return t
		case float64:
			return strconv.FormatFloat(t, 'f', -1, 64)
		case bool:
			return strconv.FormatBool(t)
		}
	}
	return ""
}

func splitCellKey(key string) (int, int, bool) {
	idx := strings.IndexByte(key, '-')
	if idx <= 0 {
		return 0, 0, false
	}
	r, err1 := strconv.Atoi(key[:idx])
	c, err2 := strconv.Atoi(key[idx+1:])
	if err1 != nil || err2 != nil || r < 0 || c < 0 {
		return 0, 0, false
	}
	return r, c, true
}

// sheetBounds 返回内容边界（最小/最大行列，含空表兜底）。
func (s SheetJSON) bounds() (minR, maxR, minC, maxC int, ok bool) {
	if len(s.Cells) == 0 {
		return 0, 0, 0, 0, false
	}
	first := true
	for k := range s.Cells {
		r, c, valid := splitCellKey(k)
		if !valid {
			continue
		}
		if first {
			minR, maxR, minC, maxC = r, r, c, c
			first = false
			continue
		}
		if r < minR {
			minR = r
		}
		if r > maxR {
			maxR = r
		}
		if c < minC {
			minC = c
		}
		if c > maxC {
			maxC = c
		}
	}
	if first {
		return 0, 0, 0, 0, false
	}
	return minR, maxR, minC, maxC, true
}

// matrix 展开为二维字符串矩阵（含空单元格，列宽对齐）。
func (s SheetJSON) matrix() [][]string {
	minR, maxR, minC, maxC, ok := s.bounds()
	if !ok {
		return [][]string{{}}
	}
	out := make([][]string, 0, maxR-minR+1)
	for r := minR; r <= maxR; r++ {
		row := make([]string, 0, maxC-minC+1)
		for c := minC; c <= maxC; c++ {
			if cell, has := s.Cells[fmt.Sprintf("%d-%d", r, c)]; has {
				row = append(row, cell.Text)
			} else {
				row = append(row, "")
			}
		}
		out = append(out, row)
	}
	return out
}

// BuildCSV 把表格内容导出为 CSV（UTF-8 BOM，Excel 直接打开不乱码）。
func BuildCSV(content string) ([]byte, error) {
	sheet := ParseSheetJSON(content)
	buf := &bytes.Buffer{}
	buf.WriteString("\xEF\xBB\xBF") // BOM
	cw := csv.NewWriter(buf)
	for _, row := range sheet.matrix() {
		if err := cw.Write(row); err != nil {
			return nil, fmt.Errorf("生成 CSV 失败：%v", err)
		}
	}
	cw.Flush()
	if err := cw.Error(); err != nil {
		return nil, fmt.Errorf("生成 CSV 失败：%v", err)
	}
	return buf.Bytes(), nil
}

// BuildSheetJSONFile 导出为规范化 JSON（保留行列元信息，便于二次处理）。
func BuildSheetJSONFile(content string) ([]byte, error) {
	sheet := ParseSheetJSON(content)
	payload := map[string]interface{}{
		"version": 1,
		"colLen":  sheet.ColLen,
		"rowLen":  sheet.RowLen,
		"cells":   sheet.Cells,
	}
	data, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("生成 JSON 失败：%v", err)
	}
	return data, nil
}

// BuildXLSX 把表格内容导出为 .xlsx（OOXML，内联字符串，单工作表）。
func BuildXLSX(content, sheetName string) ([]byte, error) {
	sheet := ParseSheetJSON(content)
	if strings.TrimSpace(sheetName) == "" {
		sheetName = "Sheet1"
	}
	sheetName = sanitizeSheetName(sheetName)

	rowsXML := buildSheetRowsXML(sheet)

	contentTypes := `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` + "\n" +
		`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
		`<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
		`<Default Extension="xml" ContentType="application/xml"/>` +
		`<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
		`<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
		`<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
		`</Types>`

	rootRels := `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` + "\n" +
		`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
		`<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
		`</Relationships>`

	workbook := `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` + "\n" +
		`<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
		`xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
		`<sheets><sheet name="` + escapeXML(sheetName) + `" sheetId="1" r:id="rId1"/></sheets></workbook>`

	workbookRels := `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` + "\n" +
		`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
		`<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
		`<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
		`</Relationships>`

	_, maxR, _, maxC, ok := sheet.bounds()
	if !ok {
		maxR, maxC = 0, 0
	}
	dimension := fmt.Sprintf("A1:%s%d", colName(maxC), maxR+1)
	worksheet := `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` + "\n" +
		`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
		`<dimension ref="` + dimension + `"/>` +
		`<sheetViews><sheetView workbookViewId="0"/></sheetViews>` +
		`<sheetFormatPr defaultRowHeight="16"/>` +
		`<sheetData>` + rowsXML + `</sheetData></worksheet>`

	styles := `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` + "\n" +
		`<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
		`<fonts count="1"><font><sz val="11"/><name val="微软雅黑"/></font></fonts>` +
		`<fills count="1"><fill><patternFill patternType="none"/></fill></fills>` +
		`<borders count="1"><border/></borders>` +
		`<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
		`<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>` +
		`</styleSheet>`

	buf := &bytes.Buffer{}
	zw := zip.NewWriter(buf)
	parts := []struct{ name, data string }{
		{"[Content_Types].xml", contentTypes},
		{"_rels/.rels", rootRels},
		{"xl/workbook.xml", workbook},
		{"xl/_rels/workbook.xml.rels", workbookRels},
		{"xl/worksheets/sheet1.xml", worksheet},
		{"xl/styles.xml", styles},
	}
	for _, p := range parts {
		w, err := zw.Create(p.name)
		if err != nil {
			return nil, fmt.Errorf("生成 xlsx 失败：%v", err)
		}
		if _, err := w.Write([]byte(p.data)); err != nil {
			return nil, fmt.Errorf("生成 xlsx 失败：%v", err)
		}
	}
	if err := zw.Close(); err != nil {
		return nil, fmt.Errorf("生成 xlsx 失败：%v", err)
	}
	return buf.Bytes(), nil
}

func buildSheetRowsXML(sheet SheetJSON) string {
	minR, maxR, minC, maxC, ok := sheet.bounds()
	if !ok {
		return ""
	}
	var sb strings.Builder
	// 按行号排序输出（Excel 要求单元格按行列升序）
	keys := make([]string, 0, len(sheet.Cells))
	for k := range sheet.Cells {
		keys = append(keys, k)
	}
	sort.Slice(keys, func(i, j int) bool {
		ri, ci, _ := splitCellKey(keys[i])
		rj, cj, _ := splitCellKey(keys[j])
		if ri != rj {
			return ri < rj
		}
		return ci < cj
	})
	curRow := -1
	for _, k := range keys {
		r, c, valid := splitCellKey(k)
		if !valid {
			continue
		}
		if r != curRow {
			if curRow >= 0 {
				sb.WriteString(`</row>`)
			}
			fmt.Fprintf(&sb, `<row r="%d">`, r+1)
			curRow = r
		}
		text := sheet.Cells[k].Text
		if text == "" {
			continue
		}
		ref := fmt.Sprintf("%s%d", colName(c), r+1)
		fmt.Fprintf(&sb, `<c r="%s" t="inlineStr"><is><t xml:space="preserve">%s</t></is></c>`,
			ref, escapeXML(text))
	}
	if curRow >= 0 {
		sb.WriteString(`</row>`)
	}
	_ = minR
	_ = maxR
	_ = minC
	_ = maxC
	return sb.String()
}

// colName 0 基列号 → Excel 列名（0 → A、26 → AA）。
func colName(c int) string {
	if c < 0 {
		c = 0
	}
	name := ""
	for c >= 0 {
		name = string(rune('A'+c%26)) + name
		c = c/26 - 1
	}
	return name
}

// sanitizeSheetName 清理工作表名（Excel 限制：≤31 字符，且不含 : \ / ? * [ ]）。
func sanitizeSheetName(name string) string {
	replacer := strings.NewReplacer(":", "：", "\\", "＿", "/", "＿", "?", "？", "*", "＊", "[", "（", "]", "）")
	name = replacer.Replace(strings.TrimSpace(name))
	if name == "" {
		return "Sheet1"
	}
	runes := []rune(name)
	if len(runes) > 31 {
		name = string(runes[:31])
	}
	return name
}
