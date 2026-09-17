package exportx

import (
	"fmt"
	"regexp"
	"strings"
)

// FlowNode 流程图节点（含布局结果）。
type FlowNode struct {
	ID    string
	Text  string
	Shape string // rect|round|stadium|circle|diamond|hexagon|subroutine|cylinder|parallelogram|doc

	// 布局结果（由 LayoutFlowchart 填充）
	X, Y          float64 // 左上角
	W, H          float64
	Layer, Order  int
	textLines     []string
	textLineWidth []float64
}

// FlowEdge 流程图连线。
type FlowEdge struct {
	From, To *FlowNode
	Label    string
	Arrow    bool
	Dotted   bool
	Thick    bool
	LabelX   float64
	LabelY   float64
	Points   [][2]float64 // 折线路径（布局后填充）
}

// MermaidGraph 解析结果。
type MermaidGraph struct {
	Direction string // TD | TB | BT | LR | RL
	Nodes     []*FlowNode
	Edges     []*FlowEdge
	byID      map[string]*FlowNode
}

var (
	reFlowHeader = regexp.MustCompile(`^\s*(?:flowchart|graph)\s*(?:-{1,2}>)?\s*([A-Za-z]{2})?\s*$`)
	reSkipStmt   = regexp.MustCompile(`^\s*(?:subgraph|end|direction|style|classDef|class|linkStyle|click|accTitle|accDescr)\b`)
)

// isIDStartByte 判定节点 ID 的首字节（字母/数字/下划线/UTF-8 多字节字符）。
func isIDStartByte(c byte) bool {
	return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' || c >= 0x80
}

// supportedDirections 支持的布局方向。
var supportedDirections = map[string]bool{"TD": true, "TB": true, "BT": true, "LR": true, "RL": true}

// ParseMermaidFlowchart 解析 mermaid 流程图源码（覆盖导出所需的常用语法子集）。
//
// 支持：方向声明（TD/TB/BT/LR/RL）、节点形状 [] () ([]) (()) {} {{}} [[]] [()] [/ /] > ]、
// 连线 --> --- -.-> -.- ==> === 与 |label| / -- label --> 标签、以及 %%注释与 style/class 等指令的忽略。
func ParseMermaidFlowchart(src string) (*MermaidGraph, error) {
	g := &MermaidGraph{Direction: "TD", byID: map[string]*FlowNode{}}
	lines := strings.Split(strings.ReplaceAll(src, "\r\n", "\n"), "\n")

	headerFound := false
	for _, raw := range lines {
		line := strings.TrimSpace(raw)
		if line == "" {
			continue
		}
		if !headerFound {
			if m := reFlowHeader.FindStringSubmatch(line); m != nil {
				headerFound = true
				if dir := strings.ToUpper(m[1]); supportedDirections[dir] {
					g.Direction = normalizeDirection(dir)
				}
				continue
			}
		}
		if strings.HasPrefix(line, "%%") || reSkipStmt.MatchString(line) {
			continue
		}
		// 一行内可能有多条语句（; 分隔）
		for _, stmt := range strings.Split(line, ";") {
			stmt = strings.TrimSpace(stmt)
			if stmt == "" {
				continue
			}
			if err := g.parseStatement(stmt); err != nil {
				return nil, err
			}
		}
	}
	// 既没有 flowchart/graph 头，也没有解析出任何连线 → 判定为非流程图内容
	if !headerFound && len(g.Edges) == 0 {
		return nil, fmt.Errorf("未识别到 mermaid 流程图内容（需以 flowchart / graph 开头）")
	}
	if len(g.Nodes) == 0 {
		return nil, fmt.Errorf("流程图中没有节点")
	}
	if len(g.Nodes) > 300 {
		return nil, fmt.Errorf("流程图节点过多（%d 个），暂不支持导出", len(g.Nodes))
	}
	return g, nil
}

func normalizeDirection(dir string) string {
	if dir == "TB" {
		return "TD"
	}
	return dir
}

// skipSpaces 跳过空白字符。
func skipSpaces(s string, i int) int {
	for i < len(s) && (s[i] == ' ' || s[i] == '\t') {
		i++
	}
	return i
}

func (g *MermaidGraph) node(id string) *FlowNode {
	if n, ok := g.byID[id]; ok {
		return n
	}
	n := &FlowNode{ID: id, Text: id, Shape: "rect"}
	g.byID[id] = n
	g.Nodes = append(g.Nodes, n)
	return n
}

func (g *MermaidGraph) parseStatement(stmt string) error {
	start, i, err := g.readNodeSpec(stmt, 0)
	if err != nil {
		return err
	}
	if start == nil {
		return nil
	}
	prev := start
	linked := false
	for {
		label, arrow, dotted, thick, ni, ok := readLink(stmt, i)
		if !ok {
			break
		}
		// 后置标签写法：A -->|yes| B
		if j := skipSpaces(stmt, ni); j < len(stmt) && stmt[j] == '|' {
			if idx := strings.Index(stmt[j+1:], "|"); idx >= 0 {
				if label == "" {
					label = strings.TrimSpace(stmt[j+1 : j+1+idx])
				}
				ni = j + 1 + idx + 1
			}
		}
		nextNode, end, err := g.readNodeSpec(stmt, ni)
		if err != nil {
			return err
		}
		if nextNode == nil {
			break
		}
		g.Edges = append(g.Edges, &FlowEdge{From: prev, To: nextNode, Label: label, Arrow: arrow, Dotted: dotted, Thick: thick})
		prev = nextNode
		i = end
		linked = true
	}
	// 尾部剩余内容无法解析时宽容忽略（mermaid 指令/扩展语法）
	_ = linked
	return nil
}

// readNodeSpec 读取一个节点描述（ID + 可选形状文本），返回节点与新的下标。
func (g *MermaidGraph) readNodeSpec(s string, i int) (*FlowNode, int, error) {
	for i < len(s) && (s[i] == ' ' || s[i] == '\t') {
		i++
	}
	if i >= len(s) || !isIDStartByte(s[i]) {
		return nil, i, nil
	}
	start := i
	// 节点 ID 仅取字母/数字/下划线/中文字符：横线与点号属于连线运算符，必须在此截断
	for i < len(s) {
		c := s[i]
		if (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') ||
			c == '_' || c >= 0x80 {
			i++
			continue
		}
		break
	}
	id := s[start:i]
	if id == "" {
		return nil, i, nil
	}
	text, shape, ni := readShape(s, i)
	node := g.node(id)
	if text != "" {
		node.Text = text
		node.Shape = shape
	} else if node.Shape == "" {
		node.Shape = "rect"
	}
	return node, ni, nil
}

// shapeDelims 形状开始/结束标记（按最长优先匹配）。
var shapeDelims = []struct {
	open, close, shape string
}{
	{"(((", ")))", "circle"},
	{"((", "))", "circle"},
	{"([", "])", "stadium"},
	{"[[", "]]", "subroutine"},
	{"[(", ")]", "cylinder"},
	{"{{", "}}", "hexagon"},
	{"[/", "/]", "parallelogram"},
	{`[\`, `\]`, "parallelogram"},
	{"[", "]", "rect"},
	{"(", ")", "round"},
	{"{", "}", "diamond"},
	{">", "]", "doc"},
}

func readShape(s string, i int) (text, shape string, next int) {
	for i < len(s) && (s[i] == ' ' || s[i] == '\t') {
		i++
	}
	if i >= len(s) {
		return "", "", i
	}
	for _, d := range shapeDelims {
		if !strings.HasPrefix(s[i:], d.open) {
			continue
		}
		rest := s[i+len(d.open):]
		idx := strings.Index(rest, d.close)
		if idx < 0 {
			continue
		}
		raw := rest[:idx]
		// 去掉引号与 <br/>
		raw = strings.Trim(strings.TrimSpace(raw), `"'`)
		raw = strings.ReplaceAll(raw, "<br/>", "\n")
		raw = strings.ReplaceAll(raw, "<br>", "\n")
		return strings.TrimSpace(raw), d.shape, i + len(d.open) + idx + len(d.close)
	}
	return "", "", i
}

// readLink 读取连线运算符，返回标签与样式。
func readLink(s string, i int) (label string, arrow, dotted, thick bool, next int, ok bool) {
	for i < len(s) && (s[i] == ' ' || s[i] == '\t') {
		i++
	}
	if i >= len(s) {
		return "", false, false, false, i, false
	}
	rest := s[i:]
	switch {
	case strings.HasPrefix(rest, "-.->"):
		return "", true, true, false, i + 4, true
	case strings.HasPrefix(rest, "-.-"):
		return "", false, true, false, i + 3, true
	case strings.HasPrefix(rest, "==>"):
		return "", true, false, true, i + 3, true
	case strings.HasPrefix(rest, "==="):
		return "", false, false, true, i + 3, true
	case strings.HasPrefix(rest, "-->"):
		return "", true, false, false, i + 3, true
	case strings.HasPrefix(rest, "---"):
		return "", false, false, false, i + 3, true
	case strings.HasPrefix(rest, "--o") || strings.HasPrefix(rest, "--x"):
		return "", true, false, false, i + 3, true
	case strings.HasPrefix(rest, "-. "), strings.HasPrefix(rest, "-."):
		// 带标签的虚线：-. text .-> / -. text .-
		if idx := strings.Index(rest[2:], "-."); idx >= 0 {
			label = strings.TrimSpace(rest[2 : 2+idx])
			end := i + 2 + idx + 2
			if end < len(s) && s[end] == '>' {
				return label, true, true, false, end + 1, true
			}
			return label, false, true, false, end, true
		}
		return "", false, false, false, i, false
	case strings.HasPrefix(rest, "--"):
		if idx := strings.Index(rest[2:], "-->"); idx >= 0 {
			return strings.TrimSpace(rest[2 : 2+idx]), true, false, false, i + 2 + idx + 3, true
		}
		if idx := strings.Index(rest[2:], "--"); idx >= 0 {
			return strings.TrimSpace(rest[2 : 2+idx]), false, false, false, i + 2 + idx + 2, true
		}
		return "", false, false, false, i, false
	case strings.HasPrefix(rest, "=="):
		if idx := strings.Index(rest[2:], "==>"); idx >= 0 {
			return strings.TrimSpace(rest[2 : 2+idx]), true, false, true, i + 2 + idx + 3, true
		}
		if idx := strings.Index(rest[2:], "=="); idx >= 0 {
			return strings.TrimSpace(rest[2 : 2+idx]), false, false, true, i + 2 + idx + 2, true
		}
		return "", false, false, false, i, false
	}
	// 连线后置标签 A -->|yes| B
	if rest[0] == '|' {
		if idx := strings.Index(rest[1:], "|"); idx >= 0 {
			return strings.TrimSpace(rest[1 : 1+idx]), false, false, false, i + 1 + idx + 1, true
		}
	}
	return "", false, false, false, i, false
}
