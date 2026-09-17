package exportx

import (
	"archive/zip"
	"bytes"
	"fmt"
	"strings"
)

// BuildDocx 把 Markdown 文本转为 .docx（Office Open XML）字节流。
//
// 采用直接格式化的段落（而非样式表），保证在 Word / WPS / LibreOffice 中一致呈现；
// 中文字体通过 w:rFonts/@w:eastAsia 指定，阅读端使用本机字体，无需嵌入。
func BuildDocx(markdown, title string) ([]byte, error) {
	blocks := ParseMarkdown(markdown)
	if strings.TrimSpace(title) == "" {
		title = docTitle(blocks, "未命名文档")
	}

	var body strings.Builder
	for _, b := range blocks {
		writeBlockXML(&body, b)
	}
	// 空文档也保证有一个段落
	if body.Len() == 0 {
		body.WriteString(`<w:p/>`)
	}
	body.WriteString(`<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>` +
		`<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="851" w:footer="992" w:gutter="0"/>` +
		`</w:sectPr>`)

	doc := `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` + "\n" +
		`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ` +
		`xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>` +
		body.String() + `</w:body></w:document>`

	contentTypes := `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` + "\n" +
		`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
		`<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
		`<Default Extension="xml" ContentType="application/xml"/>` +
		`<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
		`<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>` +
		`</Types>`

	rootRels := `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` + "\n" +
		`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
		`<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
		`</Relationships>`

	docRels := `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` + "\n" +
		`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
		`<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
		`</Relationships>`

	styles := `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` + "\n" +
		`<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
		`<w:docDefaults><w:rPrDefault><w:rPr>` +
		`<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="微软雅黑" w:cs="Calibri"/>` +
		`<w:sz w:val="21"/><w:szCs w:val="21"/>` +
		`</w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>` +
		`<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>` +
		`</w:styles>`

	buf := &bytes.Buffer{}
	zw := zip.NewWriter(buf)
	parts := []struct {
		name string
		data string
	}{
		{"[Content_Types].xml", contentTypes},
		{"_rels/.rels", rootRels},
		{"word/document.xml", doc},
		{"word/_rels/document.xml.rels", docRels},
		{"word/styles.xml", styles},
	}
	for _, p := range parts {
		w, err := zw.Create(p.name)
		if err != nil {
			return nil, fmt.Errorf("生成 docx 失败：%v", err)
		}
		if _, err := w.Write([]byte(p.data)); err != nil {
			return nil, fmt.Errorf("生成 docx 失败：%v", err)
		}
	}
	if err := zw.Close(); err != nil {
		return nil, fmt.Errorf("生成 docx 失败：%v", err)
	}
	return buf.Bytes(), nil
}

func writeBlockXML(sb *strings.Builder, b Block) {
	switch b.Kind {
	case BlockHeading:
		sizes := map[int]int{1: 44, 2: 36, 3: 32, 4: 28, 5: 26, 6: 24}
		sz := sizes[b.Level]
		if sz == 0 {
			sz = 24
		}
		before := 240
		if b.Level == 1 {
			before = 0
		}
		fmt.Fprintf(sb, `<w:p><w:pPr><w:spacing w:before="%d" w:after="120"/>`+
			`<w:outlineLvl w:val="%d"/></w:pPr>`, before, b.Level-1)
		writeRunsXML(sb, b.Spans, runFormat{SizeHalfPt: sz, Bold: true, Color: headingColor(b.Level)})
		sb.WriteString(`</w:p>`)
	case BlockParagraph:
		sb.WriteString(`<w:p><w:pPr><w:spacing w:after="120"/></w:pPr>`)
		writeRunsXML(sb, b.Spans, runFormat{SizeHalfPt: 21})
		sb.WriteString(`</w:p>`)
	case BlockList:
		for _, it := range b.Items {
			indent := 360 + it.Depth*360
			prefix := "• "
			if it.Ordered {
				prefix = fmt.Sprintf("%d. ", maxInt(it.Index, 1))
			}
			fmt.Fprintf(sb, `<w:p><w:pPr><w:spacing w:after="60"/>`+
				`<w:ind w:left="%d" w:hanging="240"/></w:pPr>`, indent)
			writeRunsXML(sb, []InlineSpan{{Text: prefix, Bold: false}}, runFormat{SizeHalfPt: 21})
			writeRunsXML(sb, ParseInline(it.Text), runFormat{SizeHalfPt: 21})
			sb.WriteString(`</w:p>`)
		}
	case BlockCode:
		sb.WriteString(`<w:p><w:pPr><w:spacing w:before="120" w:after="120"/>` +
			`<w:shd w:val="clear" w:color="auto" w:fill="F5F6F7"/></w:pPr>`)
		for i, line := range b.Lines {
			if i > 0 {
				sb.WriteString(`<w:r><w:br/></w:r>`)
			}
			fmt.Fprintf(sb, `<w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:eastAsia="宋体"/>`+
				`<w:sz w:val="19"/></w:rPr><w:t xml:space="preserve">%s</w:t></w:r>`, escapeXML(line))
		}
		if len(b.Lines) == 0 {
			sb.WriteString(`<w:r><w:t xml:space="preserve"></w:t></w:r>`)
		}
		sb.WriteString(`</w:p>`)
	case BlockQuote:
		for _, q := range b.QuoteOf {
			writeBlockXML(sb, q)
		}
	case BlockTable:
		writeTableXML(sb, b)
	case BlockRule:
		sb.WriteString(`<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="D9D9D9"/></w:pBdr></w:pPr></w:p>`)
	}
}

func writeTableXML(sb *strings.Builder, b Block) {
	if len(b.Rows) == 0 {
		return
	}
	cols := 0
	for _, row := range b.Rows {
		if len(row) > cols {
			cols = len(row)
		}
	}
	colW := 9000 / maxInt(cols, 1)
	sb.WriteString(`<w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/><w:tblBorders>`)
	for _, edge := range []string{"top", "left", "bottom", "right", "insideH", "insideV"} {
		fmt.Fprintf(sb, `<w:%s w:val="single" w:sz="4" w:space="0" w:color="D9D9D9"/>`, edge)
	}
	sb.WriteString(`</w:tblBorders></w:tblPr><w:tblGrid>`)
	for i := 0; i < cols; i++ {
		fmt.Fprintf(sb, `<w:gridCol w:w="%d"/>`, colW)
	}
	sb.WriteString(`</w:tblGrid>`)

	for r, row := range b.Rows {
		sb.WriteString(`<w:tr>`)
		for c := 0; c < cols; c++ {
			cell := ""
			if c < len(row) {
				cell = row[c]
			}
			sb.WriteString(`<w:tc><w:tcPr>`)
			fmt.Fprintf(sb, `<w:tcW w:w="%d" w:type="dxa"/>`, colW)
			if r == 0 {
				sb.WriteString(`<w:shd w:val="clear" w:color="auto" w:fill="F2F4F7"/>`)
			}
			sb.WriteString(`</w:tcPr><w:p><w:pPr><w:spacing w:before="40" w:after="40"/></w:pPr>`)
			writeRunsXML(sb, ParseInline(cell), runFormat{SizeHalfPt: 20, Bold: r == 0})
			sb.WriteString(`</w:p></w:tc>`)
		}
		sb.WriteString(`</w:tr>`)
	}
	sb.WriteString(`</w:tbl>`)
	// 表格后补一个空段落，避免连续表格粘连
	sb.WriteString(`<w:p><w:pPr><w:spacing w:after="120"/></w:pPr></w:p>`)
}

type runFormat struct {
	SizeHalfPt int
	Bold       bool
	Italic     bool
	Mono       bool
	Color      string
}

func writeRunsXML(sb *strings.Builder, spans []InlineSpan, base runFormat) {
	for _, sp := range spans {
		if sp.Text == "" {
			continue
		}
		f := base
		if sp.Bold {
			f.Bold = true
		}
		if sp.Italic {
			f.Italic = true
		}
		if sp.Code {
			f.Mono = true
		}
		text := sp.Text
		if sp.URL != "" {
			text = sp.Text + "（" + sp.URL + "）"
			f.Color = "2F54EB"
		}
		sb.WriteString(`<w:r><w:rPr>`)
		if f.Mono {
			sb.WriteString(`<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:eastAsia="宋体"/>`)
		}
		if f.Bold {
			sb.WriteString(`<w:b/><w:bCs/>`)
		}
		if f.Italic {
			sb.WriteString(`<w:i/><w:iCs/>`)
		}
		if f.Color != "" {
			fmt.Fprintf(sb, `<w:color w:val="%s"/>`, f.Color)
		}
		size := f.SizeHalfPt
		if size == 0 {
			size = 21
		}
		fmt.Fprintf(sb, `<w:sz w:val="%d"/><w:szCs w:val="%d"/>`, size, size)
		sb.WriteString(`</w:rPr>`)
		fmt.Fprintf(sb, `<w:t xml:space="preserve">%s</w:t></w:r>`, escapeXML(text))
	}
}

func headingColor(level int) string {
	switch level {
	case 1:
		return "1F2329"
	case 2:
		return "2F54EB"
	case 3:
		return "2F54EB"
	default:
		return "5F6672"
	}
}

// escapeXML 转义 XML 文本，并剔除对 XML 非法的控制字符。
func escapeXML(s string) string {
	var b strings.Builder
	b.Grow(len(s) + 8)
	for _, r := range s {
		switch r {
		case '&':
			b.WriteString("&amp;")
		case '<':
			b.WriteString("&lt;")
		case '>':
			b.WriteString("&gt;")
		case '"':
			b.WriteString("&quot;")
		case '\'':
			b.WriteString("&apos;")
		default:
			if r == '\t' || r == '\n' || r == '\r' || r >= 0x20 {
				b.WriteRune(r)
			}
		}
	}
	return b.String()
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}
