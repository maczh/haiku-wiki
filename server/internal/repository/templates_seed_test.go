package repository

import (
	"encoding/json"
	"regexp"
	"strings"
	"testing"
)

// templatePlaceholderRe 识别「方括号填空型」占位符：【____】【…】【__】等，
// 但放过【测试 A】【安全】【业务方】这类团队/环节标签。
var templatePlaceholderRe = regexp.MustCompile(`【[_\s…—\-]*】|【[^】]*__[^】]*】`)

// hasNestedDefs 报告 SVG 里是否出现嵌套 <defs>（即两个 <defs 之间没有 </defs>）。
// 不用正则：Go 的 RE2 没有负向前瞻，而 `(?s)<defs\b.*?<defs\b` 会把「两个各自闭合的
// 顶层 <defs> 块」误判成嵌套。这里手写一次括号配平，语义精确。
func hasNestedDefs(svg string) bool {
	depth := 0
	for i := 0; i < len(svg); {
		switch {
		case strings.HasPrefix(svg[i:], "<defs"):
			depth++
			if depth > 1 {
				return true
			}
			i += len("<defs")
		case strings.HasPrefix(svg[i:], "</defs>"):
			if depth > 0 {
				depth--
			}
			i += len("</defs>")
		default:
			i++
		}
	}
	return false
}

// templateUnderscoreRe 匹配连续下划线（裸填空，如「超 ____% 触发预警」）。
var templateUnderscoreRe = regexp.MustCompile(`_{2,}`)

// findTemplatePlaceholder 返回模板正文里的填空占位符原文，没有则返回空串。
//
// 裸下划线要额外判断前后字符：Flyway 迁移脚本名 `V2.3.0__add_field.sql` 里的 `__`
// 是命名约定的一部分、不是填空，必须放过；因此要求下划线两侧都不是词字符。
func findTemplatePlaceholder(s string) string {
	if m := templatePlaceholderRe.FindString(s); m != "" {
		return m
	}
	for _, loc := range templateUnderscoreRe.FindAllStringIndex(s, -1) {
		wordy := func(b byte) bool {
			// < > 也当作「词内字符」：`V<版本>__<描述>.sql` 这类命名约定模板不是填空
			return b == '_' || b == '<' || b == '>' ||
				b >= '0' && b <= '9' || b >= 'a' && b <= 'z' ||
				b >= 'A' && b <= 'Z' || b >= 0x80
		}
		before := byte(' ')
		if loc[0] > 0 {
			before = s[loc[0]-1]
		}
		after := byte(' ')
		if loc[1] < len(s) {
			after = s[loc[1]]
		}
		if !wordy(before) && !wordy(after) {
			return s[loc[0]:loc[1]]
		}
	}
	return ""
}

// TestLoadBuiltinTemplates 校验内置模板集的结构契约。
//
// 这个用例守的是「内置模板 JSON 与正文契约一致」——模板是纯数据，改错了不会编译报错，
// 只会在用户点开模板时白屏或提示语法错误，因此必须在 CI 阶段拦住。
func TestLoadBuiltinTemplates(t *testing.T) {
	items, err := LoadBuiltinTemplates()
	if err != nil {
		t.Fatalf("LoadBuiltinTemplates: %v", err)
	}
	if len(items) == 0 {
		t.Fatal("内置模板为空")
	}

	byType := map[string]int{}
	byCategory := map[string]int{}
	for _, tpl := range items {
		byType[tpl.DocType]++
		byCategory[tpl.Category]++

		if !validTemplateDocTypes[tpl.DocType] {
			t.Errorf("模板 %q 的 doc_type=%q 不在白名单", tpl.Name, tpl.DocType)
		}
		if strings.TrimSpace(tpl.Category) == "" {
			t.Errorf("模板 %q 缺 category", tpl.Name)
		}
		if strings.TrimSpace(tpl.Name) == "" || strings.TrimSpace(tpl.Title) == "" {
			t.Errorf("模板 %q 的 name/title 为空", tpl.Name)
		}
		if strings.TrimSpace(tpl.Content) == "" {
			t.Errorf("模板 %q 的 content 为空", tpl.Name)
		}
		// 注意：Builtin 由 SeedTemplates 落库时显式置 true，
		// LoadBuiltinTemplates 只解析数据文件，这里不校验该字段。
		// 占位符是模板大忌：套用后忘了替换会留在正式文档里。
		if m := findTemplatePlaceholder(tpl.Content); m != "" {
			t.Errorf("模板 %q 的正文含填空占位符 %q", tpl.Name, m)
		}

		switch tpl.DocType {
		case "drawing":
			// 绘图文档正文必须是 {version,xml,svg}，且 xml 为 mxGraphModel、svg 可直接渲染
			var c struct {
				Version int    `json:"version"`
				XML     string `json:"xml"`
				SVG     string `json:"svg"`
			}
			if err := json.Unmarshal([]byte(tpl.Content), &c); err != nil {
				t.Errorf("模板 %q 的 drawing 正文不是合法 JSON: %v", tpl.Name, err)
				continue
			}
			if c.Version != 1 {
				t.Errorf("模板 %q 的 version=%d，期望 1", tpl.Name, c.Version)
			}
			if !strings.Contains(c.XML, "<mxGraphModel") {
				t.Errorf("模板 %q 的 xml 不含 mxGraphModel（draw.io 打不开）", tpl.Name)
			}
			if !strings.HasPrefix(strings.TrimSpace(c.SVG), "<svg") {
				t.Errorf("模板 %q 的 svg 预览缺失（阅读页会显示「尚未生成矢量预览」）", tpl.Name)
			}
			svg := strings.TrimSpace(c.SVG)
			if !strings.HasSuffix(svg, "</svg>") {
				t.Errorf("模板 %q 的 svg 未以 </svg> 结尾（缺闭合，浏览器会渲染失败）", tpl.Name)
			}
			if hasNestedDefs(svg) {
				// 曾把网格 pattern 用 out.insert 插进箭头 defs 内部，形成 <defs><defs>
				t.Errorf("模板 %q 的 svg 出现嵌套 <defs>（渲染器会告警）", tpl.Name)
			}
		case "flowchart":
			// 流程图正文即 mermaid 源码，首行关键字决定图型
			head := strings.Fields(strings.TrimSpace(tpl.Content))
			if len(head) == 0 {
				t.Errorf("模板 %q 的正文为空", tpl.Name)
				continue
			}
			kind := head[0]
			if !mermaidKindsForTest[kind] {
				t.Errorf("模板 %q 的 mermaid 图型 %q 不受支持", tpl.Name, kind)
			}
		}
	}

	// 数量下限：需求要求「绘图 ≥40 个」「8 种 mermaid 图型各 ≥20 个」
	if byType["drawing"] < 40 {
		t.Errorf("绘图模板只有 %d 个，要求 ≥40", byType["drawing"])
	}
	if byType["flowchart"] < 160 {
		t.Errorf("流程图模板只有 %d 个，要求 ≥160（8 图型 × 20）", byType["flowchart"])
	}
	t.Logf("内置模板 %d 个，按类型 %v", len(items), byType)
}

// mermaidKindsForTest mermaid 首行关键字白名单（与 tools/templates/gen-flowchart.py 保持一致）。
var mermaidKindsForTest = map[string]bool{
	"flowchart": true, "graph": true, "sequenceDiagram": true, "classDiagram": true,
	"gantt": true, "erDiagram": true, "timeline": true, "pie": true, "mindmap": true,
}

// TestMermaidTemplateKindsCoverage 保证 8 种图型每种都有足量模板（防止某一类被误删空）。
func TestMermaidTemplateKindsCoverage(t *testing.T) {
	items, err := LoadBuiltinTemplates()
	if err != nil {
		t.Fatal(err)
	}
	kinds := map[string]int{}
	for _, tpl := range items {
		if tpl.DocType != "flowchart" {
			continue
		}
		kinds[strings.Fields(strings.TrimSpace(tpl.Content))[0]]++
	}
	want := []string{"flowchart", "sequenceDiagram", "classDiagram", "gantt", "erDiagram",
		"timeline", "pie", "mindmap"}
	for _, k := range want {
		if kinds[k] < 20 {
			t.Errorf("mermaid %s 模板只有 %d 个，要求 ≥20", k, kinds[k])
		}
	}
	t.Logf("mermaid 图型分布：%v", kinds)
}

// TestDrawingTemplateCategories 保证绘图模板按四大场景分类铺开（画廊筛选依赖 category）。
func TestDrawingTemplateCategories(t *testing.T) {
	items, err := LoadBuiltinTemplates()
	if err != nil {
		t.Fatal(err)
	}
	cats := map[string]int{}
	for _, tpl := range items {
		if tpl.DocType == "drawing" {
			cats[tpl.Category]++
		}
	}
	if len(cats) < 4 {
		t.Errorf("绘图模板分类只有 %d 类，期望 ≥4 类：%v", len(cats), cats)
	}
	t.Logf("绘图模板分类：%v", cats)
}

// TestHasNestedDefs 给 hasNestedDefs 这个守卫本身做反向验证 —— 一个无法被证伪的
// 守卫等于没有守卫：这里既要它抓到真的嵌套，也不能把「多个各自闭合的顶层 <defs>」误判。
func TestHasNestedDefs(t *testing.T) {
	cases := []struct {
		svg  string
		want bool
	}{
		{`<svg><defs><marker/></defs><rect/></svg>`, false},
		{`<svg><defs><marker/></defs><defs><pattern/></defs></svg>`, false},
		{`<svg><defs><marker/><defs><pattern/></defs></defs></svg>`, true},
		{`<svg><defs><defs/></defs></svg>`, true},
		{`<svg></svg>`, false},
	}
	for _, c := range cases {
		if got := hasNestedDefs(c.svg); got != c.want {
			t.Errorf("hasNestedDefs(%q) = %v，期望 %v", c.svg, got, c.want)
		}
	}
}

// TestBuiltinTemplateNamesUnique 保证内置模板的 (name, doc_type) 唯一。
//
// 灌库的 upsert 键是 (category, doc_type, name)，所以「跨分类同名同类型」在库里是合法
// 的两行 —— 但画廊按 doc_type 筛选时会出现两个一模一样的卡片名，用户无法分辨。
// 曾经「在线教育课程 / 能源抄表计费 / 保险保单理赔 / SaaS多租户权限」在
// 类图与 ER 图两侧同名（同一业务域建两种模型），这里把命名差异固化为契约。
func TestBuiltinTemplateNamesUnique(t *testing.T) {
	items, err := LoadBuiltinTemplates()
	if err != nil {
		t.Fatal(err)
	}
	seen := map[string]string{} // "doc_type/name" -> category
	for _, tpl := range items {
		k := tpl.DocType + "/" + tpl.Name
		if prev, ok := seen[k]; ok {
			t.Errorf("内置模板重名：%s（%s 与 %s 同名，画廊里无法分辨）", k, prev, tpl.Category)
			continue
		}
		seen[k] = tpl.Category
	}
	t.Logf("内置模板 (name, doc_type) 唯一性：%d/%d", len(seen), len(items))
}
