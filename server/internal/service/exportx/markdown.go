package exportx

import (
	"regexp"
	"strings"
	"unicode/utf8"
)

// BlockKind 块级元素类型（Markdown → docx/pdf 的共同中间表示）。
type BlockKind int

const (
	BlockHeading BlockKind = iota
	BlockParagraph
	BlockList
	BlockCode
	BlockQuote
	BlockTable
	BlockRule
)

// InlineSpan 行内片段（加粗/斜体/行内代码/链接）。
type InlineSpan struct {
	Text   string
	Bold   bool
	Italic bool
	Code   bool
	URL    string
}

// ListItem 列表项（Depth 为相对缩进层级，0 起）。
type ListItem struct {
	Text    string
	Depth   int
	Ordered bool
	Index   int
}

// Block 中间表示的块。
type Block struct {
	Kind    BlockKind
	Level   int // 标题层级 1..6
	Spans   []InlineSpan
	Lines   []string   // 代码块原始行
	Lang    string     // 代码块语言
	Items   []ListItem // 列表项
	Rows    [][]string // 表格单元格（原始 Markdown 文本）
	Aligns  []string   // 表格对齐
	QuoteOf []Block    // 引用块内部的块
}

var (
	reATXHeading = regexp.MustCompile(`^(#{1,6})\s+(.*?)\s*#*\s*$`)
	reFence      = regexp.MustCompile("^(```+|~~~+)\\s*([A-Za-z0-9_+\\-.]*)\\s*$")
	// Go 正则不支持反向引用，分隔线用两条规则覆盖紧凑写法与空格分隔写法
	reRule       = regexp.MustCompile(`^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$`)
	reRuleSpaced = regexp.MustCompile(`^\s{0,3}(?:-\s+){2,}-\s*$`)
	reULItem     = regexp.MustCompile(`^(\s*)([-*+])\s+(.*)$`)
	reOLItem     = regexp.MustCompile(`^(\s*)(\d{1,9})[.)]\s+(.*)$`)
	reTableSep   = regexp.MustCompile(`^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$`)
)

// isRule 判断是否为 Markdown 分隔线。
func isRule(line string) bool {
	return reRule.MatchString(line) || reRuleSpaced.MatchString(line)
}

// ParseMarkdown 把 Markdown 文本解析为块列表（覆盖导出所需的常用语法）。
func ParseMarkdown(src string) []Block {
	lines := strings.Split(strings.ReplaceAll(src, "\r\n", "\n"), "\n")
	var blocks []Block
	i := 0
	for i < len(lines) {
		line := lines[i]

		// 空行
		if strings.TrimSpace(line) == "" {
			i++
			continue
		}

		// 分隔线
		if isRule(line) {
			blocks = append(blocks, Block{Kind: BlockRule})
			i++
			continue
		}

		// 标题
		if m := reATXHeading.FindStringSubmatch(line); m != nil {
			blocks = append(blocks, Block{
				Kind:  BlockHeading,
				Level: len(m[1]),
				Spans: ParseInline(m[2]),
			})
			i++
			continue
		}

		// 围栏代码块
		if m := reFence.FindStringSubmatch(line); m != nil {
			fence := m[1][:3]
			lang := m[2]
			i++
			var code []string
			for i < len(lines) && !strings.HasPrefix(strings.TrimSpace(lines[i]), fence) {
				code = append(code, lines[i])
				i++
			}
			if i < len(lines) {
				i++ // 跳过结束围栏
			}
			blocks = append(blocks, Block{Kind: BlockCode, Lang: lang, Lines: code})
			continue
		}

		// 引用块（收集连续的 > 行后递归解析）
		if strings.HasPrefix(strings.TrimSpace(line), ">") {
			var quoted []string
			for i < len(lines) && strings.HasPrefix(strings.TrimSpace(lines[i]), ">") {
				quoted = append(quoted, strings.TrimPrefix(strings.TrimSpace(lines[i]), ">"))
				i++
			}
			blocks = append(blocks, Block{Kind: BlockQuote, QuoteOf: ParseMarkdown(strings.Join(quoted, "\n"))})
			continue
		}

		// 表格：| a | b |  + | --- | --- |
		if strings.Contains(line, "|") && i+1 < len(lines) && reTableSep.MatchString(lines[i+1]) {
			header := splitTableRow(line)
			aligns := parseTableAligns(lines[i+1])
			rows := [][]string{header}
			i += 2
			for i < len(lines) && strings.Contains(lines[i], "|") && strings.TrimSpace(lines[i]) != "" {
				rows = append(rows, splitTableRow(lines[i]))
				i++
			}
			blocks = append(blocks, Block{Kind: BlockTable, Rows: rows, Aligns: aligns})
			continue
		}

		// 列表（连续同类行合并为一个块）
		if reULItem.MatchString(line) || reOLItem.MatchString(line) {
			blk := Block{Kind: BlockList}
			kindSet := false
			ordered := false
			for i < len(lines) {
				cur := lines[i]
				if strings.TrimSpace(cur) == "" {
					// 列表内空行：若下一行仍是列表项则继续
					if i+1 < len(lines) && (reULItem.MatchString(lines[i+1]) || reOLItem.MatchString(lines[i+1])) {
						i++
						continue
					}
					break
				}
				if m := reULItem.FindStringSubmatch(cur); m != nil {
					if kindSet && ordered {
						break // 有序 → 无序：另起一块
					}
					kindSet, ordered = true, false
					blk.Items = append(blk.Items, ListItem{Text: m[3], Depth: indentDepth(m[1]), Ordered: false})
					i++
					continue
				}
				if m := reOLItem.FindStringSubmatch(cur); m != nil {
					if kindSet && !ordered {
						break // 无序 → 有序：另起一块
					}
					kindSet, ordered = true, true
					blk.Items = append(blk.Items, ListItem{Text: m[3], Depth: indentDepth(m[1]), Ordered: true, Index: atoiSafe(m[2])})
					i++
					continue
				}
				break
			}
			blocks = append(blocks, blk)
			continue
		}

		// 段落：连续非空行合并
		var para []string
		for i < len(lines) {
			cur := lines[i]
			if strings.TrimSpace(cur) == "" {
				break
			}
			if reATXHeading.MatchString(cur) || reFence.MatchString(cur) || isRule(cur) ||
				reULItem.MatchString(cur) || reOLItem.MatchString(cur) ||
				strings.HasPrefix(strings.TrimSpace(cur), ">") {
				break
			}
			para = append(para, strings.TrimSpace(cur))
			i++
		}
		if len(para) > 0 {
			blocks = append(blocks, Block{Kind: BlockParagraph, Spans: ParseInline(strings.Join(para, " "))})
		}
	}
	return blocks
}

func indentDepth(indent string) int {
	n := 0
	for _, r := range indent {
		if r == '\t' {
			n += 4
		} else {
			n++
		}
	}
	return n / 2
}

func atoiSafe(s string) int {
	n := 0
	for _, r := range s {
		if r < '0' || r > '9' {
			return n
		}
		n = n*10 + int(r-'0')
		if n > 9999 {
			return n
		}
	}
	return n
}

func splitTableRow(line string) []string {
	l := strings.TrimSpace(line)
	l = strings.TrimPrefix(l, "|")
	l = strings.TrimSuffix(l, "|")
	parts := strings.Split(l, "|")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		out = append(out, strings.TrimSpace(p))
	}
	return out
}

func parseTableAligns(sep string) []string {
	cells := splitTableRow(sep)
	out := make([]string, 0, len(cells))
	for _, c := range cells {
		left := strings.HasPrefix(c, ":")
		right := strings.HasSuffix(c, ":")
		switch {
		case left && right:
			out = append(out, "center")
		case right:
			out = append(out, "right")
		default:
			out = append(out, "left")
		}
	}
	return out
}

// ParseInline 解析行内语法为片段序列（**加粗**、*斜体*、`代码`、[文本](链接)、![alt](src)）。
func ParseInline(s string) []InlineSpan {
	var spans []InlineSpan
	var buf strings.Builder
	flush := func(bold, italic, code bool) {
		if buf.Len() == 0 {
			return
		}
		spans = append(spans, InlineSpan{Text: buf.String(), Bold: bold, Italic: italic, Code: code})
		buf.Reset()
	}

	i := 0
	for i < len(s) {
		switch {
		case strings.HasPrefix(s[i:], "**") || strings.HasPrefix(s[i:], "__"):
			marker := s[i : i+2]
			if end := strings.Index(s[i+2:], marker); end >= 0 {
				flush(false, false, false)
				inner := s[i+2 : i+2+end]
				spans = append(spans, forceStyle(ParseInline(inner), true, false)...)
				i += 2 + end + 2
				continue
			}
			buf.WriteString(marker)
			i += 2
		case strings.HasPrefix(s[i:], "`"):
			if end := strings.Index(s[i+1:], "`"); end >= 0 {
				flush(false, false, false)
				code := s[i+1 : i+1+end]
				if code != "" {
					spans = append(spans, InlineSpan{Text: code, Code: true})
				}
				i += 1 + end + 1
				continue
			}
			buf.WriteByte('`')
			i++
		case strings.HasPrefix(s[i:], "!["):
			// 图片：导出为「[图片: alt]」占位，避免远程图片带来的网络依赖
			if end := strings.Index(s[i:], "]("); end > 0 {
				close := strings.Index(s[i+end:], ")")
				if close > 0 {
					alt := s[i+2 : i+end]
					flush(false, false, false)
					spans = append(spans, InlineSpan{Text: "[图片" + orEmpty(alt, "：", alt) + "]", Italic: true})
					i += end + close + 1
					continue
				}
			}
			buf.WriteByte('!')
			i++
		case strings.HasPrefix(s[i:], "["):
			if end := strings.Index(s[i:], "]("); end > 0 {
				close := strings.Index(s[i+end:], ")")
				if close > 0 {
					text := s[i+1 : i+end]
					url := s[i+end+2 : i+end+close]
					flush(false, false, false)
					spans = append(spans, InlineSpan{Text: text, URL: url})
					i += end + close + 1
					continue
				}
			}
			buf.WriteByte('[')
			i++
		case strings.HasPrefix(s[i:], "*") || strings.HasPrefix(s[i:], "_"):
			marker := s[i : i+1]
			if end := strings.Index(s[i+1:], marker); end > 0 {
				flush(false, false, false)
				inner := s[i+1 : i+1+end]
				spans = append(spans, forceStyle(ParseInline(inner), false, true)...)
				i += 1 + end + 1
				continue
			}
			buf.WriteString(marker)
			i++
		case strings.HasPrefix(s[i:], "\\") && i+1 < len(s):
			// 转义
			buf.WriteString(s[i+1 : i+2])
			i += 2
		default:
			r, size := utf8.DecodeRuneInString(s[i:])
			buf.WriteRune(r)
			i += size
		}
	}
	flush(false, false, false)
	if len(spans) == 0 {
		spans = append(spans, InlineSpan{Text: ""})
	}
	return spans
}

func orEmpty(alt, prefix, val string) string {
	if strings.TrimSpace(val) == "" {
		return ""
	}
	return prefix + val
}

func forceStyle(in []InlineSpan, bold, italic bool) []InlineSpan {
	for i := range in {
		if bold {
			in[i].Bold = true
		}
		if italic {
			in[i].Italic = true
		}
	}
	return in
}

// PlainText 将行内片段拼为纯文本（用于搜索/尺寸测量/图片渲染）。
func PlainText(spans []InlineSpan) string {
	var b strings.Builder
	for _, s := range spans {
		b.WriteString(s.Text)
	}
	return b.String()
}

// PlainTextOf 提取块的纯文本（用于 PDF/PNG 排版测量）。
func PlainTextOf(b Block) string {
	switch b.Kind {
	case BlockHeading, BlockParagraph:
		return PlainText(b.Spans)
	case BlockCode:
		return strings.Join(b.Lines, "\n")
	case BlockQuote:
		var parts []string
		for _, q := range b.QuoteOf {
			parts = append(parts, PlainTextOf(q))
		}
		return strings.Join(parts, "\n")
	case BlockList:
		var parts []string
		for _, it := range b.Items {
			parts = append(parts, PlainText(ParseInline(it.Text)))
		}
		return strings.Join(parts, "\n")
	case BlockTable:
		var parts []string
		for _, row := range b.Rows {
			parts = append(parts, strings.Join(row, " "))
		}
		return strings.Join(parts, "\n")
	}
	return ""
}

// docTitle 取文档标题：首个 H1 优先。
func docTitle(blocks []Block, fallback string) string {
	for _, b := range blocks {
		if b.Kind == BlockHeading && b.Level == 1 {
			if t := strings.TrimSpace(PlainText(b.Spans)); t != "" {
				return t
			}
		}
	}
	return fallback
}
