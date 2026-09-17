package exportx

import (
	"bytes"
	"fmt"
	"strings"

	"github.com/signintech/gopdf"
)

// PDF 版式常量（单位 pt，A4 = 595.28 × 841.89）
const (
	pdfPageW   = 595.28
	pdfPageH   = 841.89
	pdfMarginL = 56.0
	pdfMarginR = 56.0
	pdfMarginT = 64.0
	pdfMarginB = 64.0
	pdfFont    = "cn-export"
)

var (
	colorBody    = [3]uint8{31, 35, 41}
	colorHeading = [3]uint8{31, 35, 41}
	colorAccent  = [3]uint8{47, 84, 235}
	colorMuted   = [3]uint8{95, 102, 114}
	colorBorder  = [3]uint8{217, 217, 217}
	colorCodeBg  = [3]uint8{245, 246, 247}
	colorTableHd = [3]uint8{242, 244, 247}
	colorLink    = [3]uint8{47, 84, 235}
)

// BuildPDF 把 Markdown 文本转为 PDF 字节流（内嵌中文字体，按 A4 自动分页）。
func BuildPDF(markdown, title string) ([]byte, error) {
	font, err := LoadFont()
	if err != nil {
		return nil, err
	}
	blocks := ParseMarkdown(markdown)
	if strings.TrimSpace(title) == "" {
		title = docTitle(blocks, "未命名文档")
	}

	pdf := &gopdf.GoPdf{}
	pdf.Start(gopdf.Config{PageSize: gopdf.Rect{W: pdfPageW, H: pdfPageH}})
	pdf.SetMargins(pdfMarginL, pdfMarginT, pdfMarginR, pdfMarginB)
	pdf.AddPage()
	if err := pdf.AddTTFFontData(pdfFont, font); err != nil {
		return nil, fmt.Errorf("加载中文字体失败：%v", err)
	}
	pdf.SetInfo(gopdf.PdfInfo{Title: title, Creator: "寄海文库", Subject: title})

	w := &pdfWriter{pdf: pdf, y: pdfMarginT}
	if err := pdf.SetFont(pdfFont, "", 10.5); err != nil {
		return nil, err
	}

	for _, b := range blocks {
		w.writeBlock(b)
	}

	var buf bytes.Buffer
	if err := pdf.Write(&buf); err != nil {
		return nil, fmt.Errorf("生成 PDF 失败：%v", err)
	}
	return buf.Bytes(), nil
}

type pdfWriter struct {
	pdf *gopdf.GoPdf
	y   float64
}

func (w *pdfWriter) availWidth() float64 { return pdfPageW - pdfMarginL - pdfMarginR }

// ensureSpace 预留高度不足时换页。
func (w *pdfWriter) ensureSpace(h float64) {
	if w.y+h > pdfPageH-pdfMarginB {
		w.pdf.AddPage()
		w.y = pdfMarginT
	}
}

func (w *pdfWriter) newPage() {
	w.pdf.AddPage()
	w.y = pdfMarginT
}

// styledRune 逐字符排版单元。
type styledRune struct {
	r     rune
	bold  bool
	code  bool
	link  bool
	color [3]uint8
	force bool // 强制换行（原换行符）
}

func (w *pdfWriter) setFont(size float64, bold, code bool) {
	family := pdfFont
	if code {
		size = size - 1.0
	}
	_ = w.pdf.SetFont(family, "", size)
	if bold {
		w.pdf.SetTextColor(0, 0, 0)
		return
	}
}

// drawTextRun 绘制一段同风格文本（加粗用二次描边模拟）。
func (w *pdfWriter) drawTextRun(x, y float64, text string, size float64, bold, code bool, col [3]uint8) {
	if text == "" {
		return
	}
	w.setFont(size, bold, code)
	w.pdf.SetTextColor(col[0], col[1], col[2])
	w.pdf.SetXY(x, y)
	_ = w.pdf.Cell(&gopdf.Rect{W: 0, H: 0}, text)
	if bold {
		// 模拟加粗：轻微偏移再绘一次
		w.pdf.SetXY(x+0.4, y)
		_ = w.pdf.Cell(&gopdf.Rect{W: 0, H: 0}, text)
	}
}

// measureRune 返回单个字符在当前字号下的宽度。
func (w *pdfWriter) measureRune(r rune, size float64, bold, code bool) float64 {
	w.setFont(size, bold, code)
	width, err := w.pdf.MeasureTextWidth(string(r))
	if err != nil {
		return size
	}
	return width
}

// wrapStyled 把逐字符样式序列按可用宽度折行。
func (w *pdfWriter) wrapStyled(runes []styledRune, size float64, maxWidth float64) [][]styledRune {
	var lines [][]styledRune
	var cur []styledRune
	curW := 0.0
	lastSpace := -1
	for _, sr := range runes {
		if sr.force {
			lines = append(lines, cur)
			cur, curW, lastSpace = nil, 0, -1
			continue
		}
		rw := w.measureRune(sr.r, size, sr.bold, sr.code)
		if curW+rw > maxWidth && len(cur) > 0 {
			// 优先在最近空格处断行（拉丁文），否则就地断（中文）
			if lastSpace > 0 && len(cur)-lastSpace < 20 {
				head := append([]styledRune(nil), cur[:lastSpace]...)
				tail := append([]styledRune(nil), cur[lastSpace+1:]...)
				lines = append(lines, head)
				cur = tail
				curW = 0
				for _, t := range cur {
					curW += w.measureRune(t.r, size, t.bold, t.code)
				}
			} else {
				lines = append(lines, cur)
				cur, curW = nil, 0
			}
			lastSpace = -1
		}
		if sr.r == ' ' {
			lastSpace = len(cur)
		}
		if sr.r == ' ' && len(cur) == 0 {
			continue // 行首空格忽略
		}
		cur = append(cur, sr)
		curW += rw
	}
	if len(cur) > 0 {
		lines = append(lines, cur)
	}
	return lines
}

func (w *pdfWriter) spansToRunes(spans []InlineSpan, base [3]uint8) []styledRune {
	var out []styledRune
	for _, sp := range spans {
		col := base
		if sp.URL != "" {
			col = colorLink
		}
		text := sp.Text
		for _, r := range text {
			out = append(out, styledRune{r: r, bold: sp.Bold, code: sp.Code, link: sp.URL != "", color: col})
		}
	}
	return out
}

func (w *pdfWriter) writeBlock(b Block) {
	switch b.Kind {
	case BlockHeading:
		w.writeHeading(b)
	case BlockParagraph:
		w.writeFlow(w.spansToRunes(b.Spans, colorBody), 10.5, 0, "")
	case BlockList:
		for _, it := range b.Items {
			indent := 16.0 + float64(it.Depth)*16.0
			marker := "• "
			if it.Ordered {
				marker = fmt.Sprintf("%d. ", maxInt(it.Index, 1))
			}
			w.writeFlow(w.spansToRunes(ParseInline(it.Text), colorBody), 10.5, indent, marker)
		}
	case BlockCode:
		w.writeCode(b)
	case BlockQuote:
		startY := w.y
		for _, q := range b.QuoteOf {
			w.writeBlock(q)
		}
		// 左侧竖线
		w.pdf.SetLineWidth(2)
		w.pdf.SetStrokeColor(217, 217, 217)
		w.pdf.Line(pdfMarginL-10, startY+2, pdfMarginL-10, w.y-6)
	case BlockTable:
		w.writeTable(b)
	case BlockRule:
		w.ensureSpace(14)
		w.y += 6
		w.pdf.SetLineWidth(0.8)
		w.pdf.SetStrokeColor(colorBorder[0], colorBorder[1], colorBorder[2])
		w.pdf.Line(pdfMarginL, w.y, pdfPageW-pdfMarginR, w.y)
		w.y += 8
	}
}

func (w *pdfWriter) writeHeading(b Block) {
	size := 20.0
	switch b.Level {
	case 1:
		size = 20
	case 2:
		size = 16
	case 3:
		size = 14
	case 4:
		size = 12.5
	default:
		size = 11.5
	}
	col := colorHeading
	if b.Level == 2 || b.Level == 3 {
		col = colorAccent
	}
	lineH := size * 1.45
	w.ensureSpace(lineH + 10)
	if b.Level == 1 {
		w.y += 2
	}
	w.writeFlow(w.spansToRunes(forceStyle(b.Spans, true, false), col), size, 0, "")
	w.y += size * 0.35
}

// writeFlow 按 10.5pt 流式排版一段行内内容（支持前缀标记与左缩进）。
func (w *pdfWriter) writeFlow(runes []styledRune, size float64, indent float64, marker string) {
	lineH := size * 1.62
	maxW := w.availWidth() - indent
	lines := w.wrapStyled(runes, size, maxW)
	if len(lines) == 0 {
		lines = [][]styledRune{{}}
	}
	for i, line := range lines {
		w.ensureSpace(lineH)
		x := pdfMarginL + indent
		if i == 0 && marker != "" {
			w.drawTextRun(pdfMarginL+indent-12, w.y, marker, size, false, false, colorBody)
		}
		// 合并同风格连续字符后绘制
		for _, seg := range w.groupStyledLine(line, size) {
			w.drawTextRun(x, w.y, seg.text, size, seg.bold, seg.code, seg.color)
			x += seg.width
		}
		w.y += lineH
	}
	w.y += size * 0.35
}

type styledSeg struct {
	text       string
	bold, code bool
	color      [3]uint8
	width      float64
}

func (w *pdfWriter) groupStyledLine(line []styledRune, size float64) []styledSeg {
	var out []styledSeg
	var cur styledSeg
	var b strings.Builder
	for _, sr := range line {
		same := b.Len() == 0 || (sr.bold == cur.bold && sr.code == cur.code && sr.color == cur.color)
		if !same {
			cur.text = b.String()
			out = append(out, cur)
			b.Reset()
		}
		if b.Len() == 0 {
			cur = styledSeg{bold: sr.bold, code: sr.code, color: sr.color}
		}
		b.WriteRune(sr.r)
		cur.width += w.measureRune(sr.r, size, sr.bold, sr.code)
	}
	if b.Len() > 0 {
		cur.text = b.String()
		out = append(out, cur)
	}
	return out
}

func (w *pdfWriter) writeCode(b Block) {
	size := 9.0
	lineH := size * 1.55
	pad := 8.0
	// 先按宽度折行
	type codeLine struct{ text string }
	var lines []string
	for _, raw := range b.Lines {
		runes := make([]styledRune, 0, len(raw))
		for _, r := range raw {
			runes = append(runes, styledRune{r: r})
		}
		wrapped := w.wrapStyled(runes, size, w.availWidth()-2*pad)
		if len(wrapped) == 0 {
			lines = append(lines, "")
			continue
		}
		for _, l := range wrapped {
			var sb strings.Builder
			for _, r := range l {
				sb.WriteRune(r.r)
			}
			lines = append(lines, sb.String())
		}
	}
	if len(lines) == 0 {
		lines = []string{""}
	}
	blockH := float64(len(lines))*lineH + 2*pad
	if blockH > pdfPageH-pdfMarginT-pdfMarginB {
		blockH = pdfPageH - pdfMarginT - pdfMarginB
	}
	w.ensureSpace(blockH + 8)
	top := w.y
	// 背景 + 左边线（分页时不重复整块，超长代码块按当前页裁剪绘制）
	w.pdf.SetFillColor(colorCodeBg[0], colorCodeBg[1], colorCodeBg[2])
	w.pdf.RectFromUpperLeftWithStyle(pdfMarginL, top, w.availWidth(), blockH, "F")
	w.pdf.SetLineWidth(2)
	w.pdf.SetStrokeColor(214, 219, 225)
	w.pdf.Line(pdfMarginL, top, pdfMarginL, top+blockH)
	w.y = top + pad + size
	for _, line := range lines {
		if w.y > top+blockH-pad+size {
			break
		}
		w.drawTextRun(pdfMarginL+pad, w.y, line, size, false, true, colorBody)
		w.y += lineH
	}
	w.y = top + blockH + 12
}

func (w *pdfWriter) writeTable(b Block) {
	if len(b.Rows) == 0 {
		return
	}
	cols := 0
	for _, row := range b.Rows {
		if len(row) > cols {
			cols = len(row)
		}
	}
	if cols == 0 {
		return
	}
	size := 9.5
	pad := 5.0
	colW := w.availWidth() / float64(cols)
	textW := colW - 2*pad
	lineH := size * 1.5

	// 计算每行高度与折行结果
	type cellText struct{ lines []string }
	table := make([][]cellText, 0, len(b.Rows))
	heights := make([]float64, 0, len(b.Rows))
	for r, row := range b.Rows {
		cells := make([]cellText, cols)
		h := lineH + 2*pad - 4
		for c := 0; c < cols; c++ {
			raw := ""
			if c < len(row) {
				raw = row[c]
			}
			bold := r == 0
			var runes []styledRune
			for _, sr := range ParseInline(raw) {
				for _, ch := range sr.Text {
					runes = append(runes, styledRune{r: ch, bold: bold})
				}
			}
			wrapped := w.wrapStyled(runes, size, textW)
			lines := make([]string, 0, len(wrapped))
			for _, l := range wrapped {
				var sb strings.Builder
				for _, x := range l {
					sb.WriteRune(x.r)
				}
				lines = append(lines, sb.String())
			}
			if len(lines) == 0 {
				lines = []string{""}
			}
			if len(lines) == 1 {
				lines = append(lines, "") // 视觉上给表格一点呼吸空间
			}
			cells[c] = cellText{lines: lines}
			if need := float64(len(lines))*lineH + 2*pad; need > h {
				h = need
			}
		}
		table = append(table, cells)
		heights = append(heights, h)
	}

	w.ensureSpace(heights[0] + 12)
	top := w.y
	for r := range table {
		h := heights[r]
		if w.y+h > pdfPageH-pdfMarginB {
			w.pdf.AddPage()
			w.y = pdfMarginT
			top = w.y
		}
		if r == 0 {
			w.pdf.SetFillColor(colorTableHd[0], colorTableHd[1], colorTableHd[2])
			w.pdf.RectFromUpperLeftWithStyle(pdfMarginL, w.y, w.availWidth(), h, "F")
		}
		w.pdf.SetLineWidth(0.6)
		w.pdf.SetStrokeColor(colorBorder[0], colorBorder[1], colorBorder[2])
		w.pdf.RectFromUpperLeftWithStyle(pdfMarginL, w.y, w.availWidth(), h, "D")
		for c := 1; c < cols; c++ {
			x := pdfMarginL + float64(c)*colW
			w.pdf.Line(x, w.y, x, w.y+h)
		}
		for c := 0; c < cols; c++ {
			x := pdfMarginL + float64(c)*colW + pad
			ty := w.y + pad + size
			for _, line := range table[r][c].lines {
				w.drawTextRun(x, ty, line, size, r == 0, false, colorBody)
				ty += lineH
			}
		}
		w.y += h
	}
	_ = top
	w.y += 12
}
