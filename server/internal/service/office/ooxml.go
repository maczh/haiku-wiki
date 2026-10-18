package office

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"io"
	"path"
	"sort"
	"strconv"
	"strings"
)

const maxExpanded = 64 << 20
const maxCells = 100000

func sortedKeys[T any](items map[string]T) []string {
	keys := make([]string, 0, len(items))
	for key := range items {
		keys = append(keys, key)
	}
	sort.Slice(keys, func(i, j int) bool { a, _ := strconv.Atoi(keys[i]); b, _ := strconv.Atoi(keys[j]); return a < b })
	return keys
}

func unpack(data []byte) (map[string][]byte, error) {
	z, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, fmt.Errorf("不是有效的 OOXML 文件: %w", err)
	}
	if len(z.File) > 4096 {
		return nil, fmt.Errorf("压缩包条目过多")
	}
	files := make(map[string][]byte)
	total := 0
	for _, f := range z.File {
		if f.FileInfo().IsDir() {
			continue
		}
		if f.UncompressedSize64 > maxExpanded || total >= maxExpanded {
			return nil, fmt.Errorf("解压内容超过限制")
		}
		r, err := f.Open()
		if err != nil {
			return nil, err
		}
		b, err := io.ReadAll(io.LimitReader(r, int64(maxExpanded-total)+1))
		r.Close()
		if err != nil {
			return nil, err
		}
		total += len(b)
		if total > maxExpanded {
			return nil, fmt.Errorf("解压内容超过限制")
		}
		if _, exists := files[f.Name]; exists {
			return nil, fmt.Errorf("压缩包条目重复")
		}
		files[f.Name] = b
	}
	return files, nil
}

func pack(files map[string]string) ([]byte, error) {
	var b bytes.Buffer
	w := zip.NewWriter(&b)
	for name, content := range files {
		f, err := w.Create(name)
		if err != nil {
			return nil, err
		}
		if _, err = io.WriteString(f, content); err != nil {
			return nil, err
		}
	}
	if err := w.Close(); err != nil {
		return nil, err
	}
	return b.Bytes(), nil
}

func escape(s string) string {
	var b bytes.Buffer
	_ = xml.EscapeText(&b, []byte(s))
	return b.String()
}

func importDoc(files map[string][]byte) (any, error) {
	data, ok := files["word/document.xml"]
	if !ok {
		return nil, fmt.Errorf("缺少 word/document.xml")
	}
	d := xml.NewDecoder(bytes.NewReader(data))
	var text strings.Builder
	offset := 0
	paragraphs := []map[string]any{}
	for {
		t, err := d.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, err
		}
		switch token := t.(type) {
		case xml.StartElement:
			switch token.Name.Local {
			case "t":
				var value string
				if err := d.DecodeElement(&value, &token); err != nil {
					return nil, err
				}
				text.WriteString(value)
				offset += utf16len(value)
			case "tab":
				text.WriteString("\t")
				offset++
			case "br":
				text.WriteString("\v")
				offset++
			}
		case xml.EndElement:
			if token.Name.Local == "p" {
				if len(paragraphs) >= maxCells {
					return nil, fmt.Errorf("段落数量超过限制")
				}
				paragraphs = append(paragraphs, map[string]any{"startIndex": offset})
				text.WriteString("\r")
				offset++
			}
		}
	}
	if len(paragraphs) == 0 {
		paragraphs = append(paragraphs, map[string]any{"startIndex": 0})
		text.WriteString("\r")
	}
	text.WriteString("\n")
	return map[string]any{"body": map[string]any{"dataStream": text.String(), "paragraphs": paragraphs}, "documentStyle": map[string]any{}}, nil
}

// Univer offsets count UTF-16 code units, not UTF-8 bytes or Unicode runes.
func utf16len(s string) int {
	n := 0
	for _, r := range s {
		n++
		if r > 0xffff {
			n++
		}
	}
	return n
}

const wordNS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
const sheetNS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
const relNS = "http://schemas.openxmlformats.org/package/2006/relationships"
const officeRel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"

func baseFiles(target, contentType string) map[string]string {
	return map[string]string{
		"[Content_Types].xml": `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/` + target + `" ContentType="` + contentType + `"/></Types>`,
		"_rels/.rels":         `<Relationships xmlns="` + relNS + `"><Relationship Id="rId1" Type="` + officeRel + `/officeDocument" Target="` + target + `"/></Relationships>`,
	}
}

func exportDoc(raw json.RawMessage) ([]byte, error) {
	var snapshot struct {
		Body *struct {
			DataStream string `json:"dataStream"`
		} `json:"body"`
	}
	if err := json.Unmarshal(raw, &snapshot); err != nil {
		return nil, err
	}
	if snapshot.Body == nil {
		return nil, fmt.Errorf("文档快照缺少 body")
	}
	var body strings.Builder
	for _, p := range strings.Split(strings.TrimSuffix(strings.TrimSuffix(snapshot.Body.DataStream, "\n"), "\r"), "\r") {
		body.WriteString(`<w:p><w:r>`)
		for i, line := range strings.Split(p, "\v") {
			if i > 0 {
				body.WriteString(`<w:br/>`)
			}
			body.WriteString(`<w:t xml:space="preserve">` + escape(line) + `</w:t>`)
		}
		body.WriteString(`</w:r></w:p>`)
	}
	files := baseFiles("word/document.xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml")
	files["word/document.xml"] = `<w:document xmlns:w="` + wordNS + `"><w:body>` + body.String() + `</w:body></w:document>`
	return pack(files)
}

type richText struct {
	Text string `xml:"t"`
	Runs []struct {
		Text string `xml:"t"`
	} `xml:"r"`
}

func (r richText) value() string {
	var s strings.Builder
	s.WriteString(r.Text)
	for _, run := range r.Runs {
		s.WriteString(run.Text)
	}
	return s.String()
}

type cell struct {
	V any    `json:"v,omitempty"`
	F string `json:"f,omitempty"`
}
type worksheet struct {
	ID          string                     `json:"id"`
	Name        string                     `json:"name"`
	RowCount    int                        `json:"rowCount"`
	ColumnCount int                        `json:"columnCount"`
	CellData    map[string]map[string]cell `json:"cellData"`
}
type workbook struct {
	SheetOrder []string             `json:"sheetOrder"`
	Sheets     map[string]worksheet `json:"sheets"`
}

func importSheet(files map[string][]byte) (any, error) {
	var book struct {
		Sheets []struct {
			Name string `xml:"name,attr"`
			ID   string `xml:"id,attr"`
		} `xml:"sheets>sheet"`
	}
	if err := xml.Unmarshal(files["xl/workbook.xml"], &book); err != nil {
		return nil, err
	}
	if len(book.Sheets) == 0 || len(book.Sheets) > 256 {
		return nil, fmt.Errorf("工作表数量应在 1 到 256 之间")
	}
	var rels struct {
		Items []struct {
			ID     string `xml:"Id,attr"`
			Target string `xml:"Target,attr"`
			Mode   string `xml:"TargetMode,attr"`
		} `xml:"Relationship"`
	}
	if err := xml.Unmarshal(files["xl/_rels/workbook.xml.rels"], &rels); err != nil {
		return nil, err
	}
	targets := map[string]string{}
	for _, rel := range rels.Items {
		if rel.Mode == "External" {
			continue
		}
		target := path.Join("xl", rel.Target)
		if strings.HasPrefix(rel.Target, "/") {
			target = strings.TrimPrefix(rel.Target, "/")
		}
		targets[rel.ID] = target
	}
	var shared struct {
		Items []richText `xml:"si"`
	}
	if b, ok := files["xl/sharedStrings.xml"]; ok {
		if err := xml.Unmarshal(b, &shared); err != nil {
			return nil, err
		}
	}
	out := workbook{Sheets: map[string]worksheet{}}
	count := 0
	for i, sheet := range book.Sheets {
		var xmlSheet struct {
			Rows []struct {
				Cells []struct {
					Ref     string `xml:"r,attr"`
					Type    string `xml:"t,attr"`
					Value   string `xml:"v"`
					Formula struct {
						Text string `xml:",chardata"`
						Type string `xml:"t,attr"`
					} `xml:"f"`
					Inline richText `xml:"is"`
				} `xml:"c"`
			} `xml:"sheetData>row"`
		}
		if err := xml.Unmarshal(files[targets[sheet.ID]], &xmlSheet); err != nil {
			return nil, err
		}
		ws := worksheet{Name: sheet.Name, RowCount: 100, ColumnCount: 26, CellData: map[string]map[string]cell{}}
		for _, row := range xmlSheet.Rows {
			for _, c := range row.Cells {
				count++
				if count > maxCells {
					return nil, fmt.Errorf("单元格数量超过限制")
				}
				r, col, err := address(c.Ref)
				if err != nil {
					return nil, err
				}
				var v any = c.Value
				switch c.Type {
				case "s":
					n, err := strconv.Atoi(c.Value)
					if err != nil || n < 0 || n >= len(shared.Items) {
						return nil, fmt.Errorf("共享字符串索引无效")
					}
					v = shared.Items[n].value()
				case "inlineStr":
					v = c.Inline.value()
				case "b":
					v = c.Value == "1"
				case "", "n":
					if n, err := strconv.ParseFloat(c.Value, 64); err == nil {
						v = n
					}
				}
				key := strconv.Itoa(r)
				if ws.CellData[key] == nil {
					ws.CellData[key] = map[string]cell{}
				}
				if c.Formula.Type != "" && c.Formula.Type != "normal" {
					return nil, fmt.Errorf("基础转换器不支持 %s 公式，请使用增强 OOXML 适配器或下载原文件", c.Formula.Type)
				}
				formula := c.Formula.Text
				if formula != "" {
					formula = "=" + formula
				}
				ws.CellData[key][strconv.Itoa(col)] = cell{V: v, F: formula}
				ws.RowCount = max(ws.RowCount, r+1)
				ws.ColumnCount = max(ws.ColumnCount, col+1)
			}
		}
		id := fmt.Sprintf("sheet-%d", i+1)
		ws.ID = id
		out.SheetOrder = append(out.SheetOrder, id)
		out.Sheets[id] = ws
	}
	return out, nil
}

func address(ref string) (int, int, error) {
	i, col := 0, 0
	for i < len(ref) && ref[i] >= 'A' && ref[i] <= 'Z' {
		col = col*26 + int(ref[i]-'A') + 1
		i++
	}
	row, err := strconv.Atoi(ref[i:])
	if err != nil || row < 1 || row > 1048576 || col < 1 || col > 16384 {
		return 0, 0, fmt.Errorf("无效单元格地址 %q", ref)
	}
	return row - 1, col - 1, nil
}

func columnName(col int) string {
	name := ""
	for col++; col > 0; col = (col - 1) / 26 {
		name = string(rune('A'+(col-1)%26)) + name
	}
	return name
}

func exportSheet(raw json.RawMessage) ([]byte, error) {
	var book workbook
	if err := json.Unmarshal(raw, &book); err != nil {
		return nil, err
	}
	if len(book.SheetOrder) == 0 || len(book.SheetOrder) > 256 {
		return nil, fmt.Errorf("工作表数量无效")
	}
	files := baseFiles("xl/workbook.xml", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml")
	var sheets, rels, overrides strings.Builder
	count := 0
	for i, id := range book.SheetOrder {
		ws, ok := book.Sheets[id]
		if !ok {
			return nil, fmt.Errorf("工作表引用无效")
		}
		n := strconv.Itoa(i + 1)
		sheets.WriteString(`<sheet name="` + escape(ws.Name) + `" sheetId="` + n + `" r:id="rId` + n + `"/>`)
		rels.WriteString(`<Relationship Id="rId` + n + `" Type="` + officeRel + `/worksheet" Target="worksheets/sheet` + n + `.xml"/>`)
		overrides.WriteString(`<Override PartName="/xl/worksheets/sheet` + n + `.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
		var rows strings.Builder
		// Numeric order is required by spreadsheet consumers.
		rowKeys := sortedKeys(ws.CellData)
		for _, row := range rowKeys {
			r, err := strconv.Atoi(row)
			if err != nil || r < 0 || r >= 1048576 {
				return nil, fmt.Errorf("行号无效")
			}
			rows.WriteString(`<row r="` + strconv.Itoa(r+1) + `">`)
			for _, col := range sortedKeys(ws.CellData[row]) {
				c, err := strconv.Atoi(col)
				if err != nil || c < 0 || c >= 16384 {
					return nil, fmt.Errorf("列号无效")
				}
				count++
				if count > maxCells {
					return nil, fmt.Errorf("单元格数量超过限制")
				}
				value := ws.CellData[row][col]
				ref := columnName(c) + strconv.Itoa(r+1)
				if value.F != "" {
					rows.WriteString(`<c r="` + ref + `"><f>` + escape(strings.TrimPrefix(value.F, "=")) + `</f></c>`)
				} else {
					switch v := value.V.(type) {
					case float64:
						rows.WriteString(`<c r="` + ref + `"><v>` + strconv.FormatFloat(v, 'g', -1, 64) + `</v></c>`)
					case bool:
						b := "0"
						if v {
							b = "1"
						}
						rows.WriteString(`<c r="` + ref + `" t="b"><v>` + b + `</v></c>`)
					case nil:
					default:
						rows.WriteString(`<c r="` + ref + `" t="inlineStr"><is><t xml:space="preserve">` + escape(fmt.Sprint(v)) + `</t></is></c>`)
					}
				}
			}
			rows.WriteString(`</row>`)
		}
		files["xl/worksheets/sheet"+n+".xml"] = `<worksheet xmlns="` + sheetNS + `"><sheetData>` + rows.String() + `</sheetData></worksheet>`
	}
	files["[Content_Types].xml"] = strings.Replace(files["[Content_Types].xml"], "</Types>", overrides.String()+"</Types>", 1)
	files["xl/workbook.xml"] = `<workbook xmlns="` + sheetNS + `" xmlns:r="` + officeRel + `"><sheets>` + sheets.String() + `</sheets></workbook>`
	files["xl/_rels/workbook.xml.rels"] = `<Relationships xmlns="` + relNS + `">` + rels.String() + `</Relationships>`
	return pack(files)
}
