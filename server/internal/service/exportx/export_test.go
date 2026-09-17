package exportx

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const sampleMarkdown = `# 寄海文库导出测试

本文用于验证 **Markdown → docx/pdf** 的转换效果，包含*斜体*、` + "`行内代码`" + ` 与 [链接](https://example.com)。

## 二级标题

- 无序列表第一项
- 无序列表第二项，内容较长用于验证自动折行与中文换行效果是否正确
  - 嵌套子项
1. 有序列表第一项
2. 有序列表第二项

### 三级标题

> 这是一段引用文字，用于验证引用块的左边线渲染。

` + "```go" + `
func main() {
	fmt.Println("代码块中文与英文混排 test")
}
` + "```" + `

| 模块 | 说明 | 状态 |
| --- | --- | --- |
| 导出 | 服务端转换 | 完成 |
| 导入 | 原样保存 | 进行中 |

---

普通段落结束。
`

const sampleSheet = `{"version":1,"cells":{"0-0":{"text":"姓名"},"0-1":{"text":"部门"},"0-2":{"text":"工号"},"1-0":{"text":"张三"},"1-1":{"text":"研发中心"},"1-2":{"text":"A001"},"2-0":{"text":"李四"},"2-1":{"text":"市场部"},"2-2":{"text":"B102"}},"colLen":26,"rowLen":100}`

const sampleMindmap = `{"version":2,"root":{"data":{"text":"寄海文库","expand":true},"children":[{"data":{"text":"文档管理","expand":true},"children":[{"data":{"text":"导入导出","expand":true},"children":[]},{"data":{"text":"版本快照","expand":true},"children":[]}]},{"data":{"text":"表格与脑图","expand":true},"children":[{"data":{"text":"Excel 导入","expand":true},"children":[]}]}]}}`

const sampleFlowchart = `flowchart TD
  A[开始导入] --> B{文件类型判断}
  B -->|docx/pdf| C[原样保存为附件]
  B -->|xlsx| D[拆分为多个表格]
  C --> E((结束))
  D --> E
  B -.->|其它| F[文本解析入库]
  F --> E
`

// TestGenerateSamples 生成各格式样例产物，便于人工核验（EXPORTX_OUT 指定输出目录时生效）。
func TestGenerateSamples(t *testing.T) {
	out := os.Getenv("EXPORTX_OUT")
	if out == "" {
		t.Skip("未设置 EXPORTX_OUT，跳过样例生成")
	}
	if err := os.MkdirAll(out, 0o755); err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		docType, format, content, title, file string
	}{
		{"markdown", "md", sampleMarkdown, "导出测试", "doc.md"},
		{"markdown", "docx", sampleMarkdown, "导出测试", "doc.docx"},
		{"markdown", "pdf", sampleMarkdown, "导出测试", "doc.pdf"},
		{"sheet", "xlsx", sampleSheet, "人员表", "sheet.xlsx"},
		{"sheet", "csv", sampleSheet, "人员表", "sheet.csv"},
		{"sheet", "json", sampleSheet, "人员表", "sheet.json"},
		{"mindmap", "smm", sampleMindmap, "脑图", "map.smm"},
		{"mindmap", "km", sampleMindmap, "脑图", "map.km"},
		{"mindmap", "xmind", sampleMindmap, "脑图", "map.xmind"},
		{"mindmap", "mm", sampleMindmap, "脑图", "map.mm"},
		{"mindmap", "png", sampleMindmap, "脑图", "map.png"},
		{"flowchart", "md", sampleFlowchart, "流程", "flow.md"},
		{"flowchart", "svg", sampleFlowchart, "流程", "flow.svg"},
		{"flowchart", "png", sampleFlowchart, "流程", "flow.png"},
	}
	for _, c := range cases {
		data, spec, err := Convert(c.docType, c.format, c.content, c.title)
		if err != nil {
			t.Fatalf("导出 %s/%s 失败：%v", c.docType, c.format, err)
		}
		if len(data) == 0 {
			t.Fatalf("导出 %s/%s 产物为空", c.docType, c.format)
		}
		if spec.Ext != "" && !strings.HasSuffix(c.file, "."+spec.Ext) {
			t.Fatalf("扩展名不匹配：%s vs %s", spec.Ext, c.file)
		}
		if err := os.WriteFile(filepath.Join(out, c.file), data, 0o644); err != nil {
			t.Fatal(err)
		}
		t.Logf("%-14s %8d bytes -> %s", c.docType+"/"+c.format, len(data), c.file)
	}
}

func TestFormatsForDocType(t *testing.T) {
	want := map[string][]string{
		"markdown":  {"md", "docx", "pdf"},
		"sheet":     {"xlsx", "csv", "json"},
		"mindmap":   {"km", "smm", "xmind", "mm", "png"},
		"flowchart": {"md", "svg", "png"},
	}
	for docType, exts := range want {
		got := FormatsForDocType(docType)
		if len(got) != len(exts) {
			t.Fatalf("%s 格式数量不符：%d != %d", docType, len(got), len(exts))
		}
		for i, e := range exts {
			if got[i].Value != e {
				t.Fatalf("%s 第 %d 个格式应为 %s，实际 %s", docType, i, e, got[i].Value)
			}
		}
	}
	// 非法格式必须报错而不是静默返回
	if _, _, err := Convert("markdown", "xlsx", "x", "t"); err == nil {
		t.Fatal("cross-type 导出应当报错")
	}
	if _, _, err := Convert("sheet", "pdf", "x", "t"); err == nil {
		t.Fatal("sheet→pdf 应当报错")
	}
}

func TestParseMarkdownBlocks(t *testing.T) {
	blocks := ParseMarkdown(sampleMarkdown)
	kinds := map[BlockKind]int{}
	for _, b := range blocks {
		kinds[b.Kind]++
	}
	if kinds[BlockHeading] != 3 {
		t.Fatalf("标题数量应为 3，实际 %d", kinds[BlockHeading])
	}
	if kinds[BlockList] != 2 {
		t.Fatalf("列表块数量应为 2，实际 %d", kinds[BlockList])
	}
	if kinds[BlockCode] != 1 {
		t.Fatalf("代码块数量应为 1，实际 %d", kinds[BlockCode])
	}
	if kinds[BlockTable] != 1 {
		t.Fatalf("表格数量应为 1，实际 %d", kinds[BlockTable])
	}
	if kinds[BlockQuote] != 1 {
		t.Fatalf("引用数量应为 1，实际 %d", kinds[BlockQuote])
	}
	if kinds[BlockRule] != 1 {
		t.Fatalf("分隔线数量应为 1，实际 %d", kinds[BlockRule])
	}
	// 行内样式
	spans := ParseInline("普通 **加粗** *斜体* `代码`")
	var bold, italic, code bool
	for _, s := range spans {
		if s.Bold && s.Text == "加粗" {
			bold = true
		}
		if s.Italic && s.Text == "斜体" {
			italic = true
		}
		if s.Code && s.Text == "代码" {
			code = true
		}
	}
	if !bold || !italic || !code {
		t.Fatalf("行内样式解析不完整 bold=%v italic=%v code=%v", bold, italic, code)
	}
}

func TestBuildDocxIsValidZip(t *testing.T) {
	data, err := BuildDocx(sampleMarkdown, "导出测试")
	if err != nil {
		t.Fatal(err)
	}
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatalf("docx 不是合法 zip：%v", err)
	}
	need := map[string]bool{"[Content_Types].xml": false, "word/document.xml": false, "_rels/.rels": false, "word/styles.xml": false}
	var docXML, stylesXML string
	for _, f := range zr.File {
		if _, ok := need[f.Name]; ok {
			need[f.Name] = true
		}
		if f.Name == "word/document.xml" || f.Name == "word/styles.xml" {
			rc, err := f.Open()
			if err != nil {
				t.Fatal(err)
			}
			var buf bytes.Buffer
			_, _ = buf.ReadFrom(rc)
			_ = rc.Close()
			if f.Name == "word/document.xml" {
				docXML = buf.String()
			} else {
				stylesXML = buf.String()
			}
		}
	}
	for name, found := range need {
		if !found {
			t.Fatalf("docx 缺少 %s", name)
		}
	}
	for _, want := range []string{"寄海文库导出测试", "二级标题", "fmt.Println", "服务端转换", "w:tbl"} {
		if !strings.Contains(docXML, want) {
			t.Fatalf("document.xml 缺少内容：%s", want)
		}
	}
	// 中文字体在默认样式中声明（eastAsia），保证 Word/WPS 下中文正常显示
	if !strings.Contains(stylesXML, `w:eastAsia="微软雅黑"`) {
		t.Fatal("styles.xml 未设置中文字体")
	}
}

func TestBuildXLSXAndCSV(t *testing.T) {
	xlsx, err := BuildXLSX(sampleSheet, "人员表")
	if err != nil {
		t.Fatal(err)
	}
	zr, err := zip.NewReader(bytes.NewReader(xlsx), int64(len(xlsx)))
	if err != nil {
		t.Fatalf("xlsx 不是合法 zip：%v", err)
	}
	found := false
	for _, f := range zr.File {
		if f.Name == "xl/worksheets/sheet1.xml" {
			found = true
			rc, _ := f.Open()
			var buf bytes.Buffer
			_, _ = buf.ReadFrom(rc)
			_ = rc.Close()
			if !bytes.Contains(buf.Bytes(), []byte("研发中心")) {
				t.Fatal("sheet1.xml 未包含单元格内容")
			}
			if !bytes.Contains(buf.Bytes(), []byte(`r="C2"`)) {
				t.Fatal("sheet1.xml 单元格引用不正确")
			}
		}
	}
	if !found {
		t.Fatal("xlsx 缺少 worksheet")
	}

	csvData, err := BuildCSV(sampleSheet)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.HasPrefix(csvData, []byte("\xEF\xBB\xBF")) {
		t.Fatal("CSV 应带 UTF-8 BOM")
	}
	if !strings.Contains(string(csvData), "张三,研发中心,A001") {
		t.Fatalf("CSV 内容不正确：%s", string(csvData))
	}
}

func TestMindmapFormats(t *testing.T) {
	root := ParseMindmap(sampleMindmap)
	if root.Text != "寄海文库" || len(root.Children) != 2 {
		t.Fatalf("思维导图解析失败：%+v", root)
	}
	// km 结构
	km, err := BuildKM(sampleMindmap)
	if err != nil {
		t.Fatal(err)
	}
	var kmObj map[string]interface{}
	if err := json.Unmarshal(km, &kmObj); err != nil {
		t.Fatalf("km 不是合法 JSON：%v", err)
	}
	if _, ok := kmObj["root"]; !ok {
		t.Fatal("km 缺少 root")
	}
	// xmind 内部结构
	xmind, err := BuildXMind(sampleMindmap)
	if err != nil {
		t.Fatal(err)
	}
	zr, err := zip.NewReader(bytes.NewReader(xmind), int64(len(xmind)))
	if err != nil {
		t.Fatalf("xmind 不是合法 zip：%v", err)
	}
	names := map[string]bool{}
	for _, f := range zr.File {
		names[f.Name] = true
	}
	for _, n := range []string{"content.json", "metadata.json", "manifest.json"} {
		if !names[n] {
			t.Fatalf("xmind 缺少 %s", n)
		}
	}
	// mm 为合法 XML 且含节点文本
	mm, err := BuildFreeMind(sampleMindmap)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(mm), `TEXT="寄海文库"`) {
		t.Fatalf("mm 内容不正确：%s", string(mm))
	}
	// v1 旧格式兼容
	v1 := `{"version":1,"tree":{"text":"旧格式根","children":[{"text":"子","children":[]}]}}`
	r1 := ParseMindmap(v1)
	if r1.Text != "旧格式根" || len(r1.Children) != 1 {
		t.Fatalf("v1 兼容解析失败：%+v", r1)
	}
}

func TestParseMermaidFlowchart(t *testing.T) {
	g, err := ParseMermaidFlowchart(sampleFlowchart)
	if err != nil {
		t.Fatal(err)
	}
	if g.Direction != "TD" {
		t.Fatalf("方向应为 TD，实际 %s", g.Direction)
	}
	if len(g.Nodes) != 6 {
		ids := []string{}
		for _, n := range g.Nodes {
			ids = append(ids, n.ID+"("+n.Shape+")")
		}
		t.Fatalf("节点数应为 6，实际 %d：%v", len(g.Nodes), ids)
	}
	if len(g.Edges) != 7 {
		t.Fatalf("连线数应为 7，实际 %d", len(g.Edges))
	}
	// 标签解析（|label| 与后置形式）
	labelFound := map[string]bool{}
	for _, e := range g.Edges {
		if e.Label != "" {
			labelFound[e.Label] = true
		}
	}
	for _, want := range []string{"docx/pdf", "xlsx", "其它"} {
		if !labelFound[want] {
			t.Fatalf("缺少连线标签 %s", want)
		}
	}
	// 节点形状
	shapes := map[string]string{}
	for _, n := range g.Nodes {
		shapes[n.ID] = n.Shape
	}
	if shapes["B"] != "diamond" {
		t.Fatalf("B 应为菱形，实际 %s", shapes["B"])
	}
	if shapes["E"] != "circle" {
		t.Fatalf("E 应为圆形，实际 %s", shapes["E"])
	}
	if shapes["A"] != "rect" {
		t.Fatalf("A 应为矩形，实际 %s", shapes["A"])
	}

	// 其它方向与样式
	g2, err := ParseMermaidFlowchart("graph LR\n  X --> Y\n  Y -.-> Z\n  Z ==> X")
	if err != nil {
		t.Fatal(err)
	}
	if g2.Direction != "LR" {
		t.Fatalf("方向应为 LR，实际 %s", g2.Direction)
	}
	if len(g2.Edges) != 3 {
		t.Fatalf("连线数应为 3，实际 %d", len(g2.Edges))
	}
	dotted, thick := false, false
	for _, e := range g2.Edges {
		if e.Dotted {
			dotted = true
		}
		if e.Thick {
			thick = true
		}
	}
	if !dotted || !thick {
		t.Fatalf("连线样式解析失败 dotted=%v thick=%v", dotted, thick)
	}

	// 带标签的长横线形式
	g3, err := ParseMermaidFlowchart("flowchart TD\n  A -- 是 --> B")
	if err != nil {
		t.Fatal(err)
	}
	if len(g3.Edges) != 1 || g3.Edges[0].Label != "是" {
		t.Fatalf("-- 是 --> 标签解析失败：%+v", g3.Edges)
	}

	// 非法输入
	if _, err := ParseMermaidFlowchart("not a mermaid"); err == nil {
		t.Fatal("非 mermaid 内容应报错")
	}
}

func TestSVGAndPNGNotEmpty(t *testing.T) {
	svg, err := BuildFlowchartSVG(sampleFlowchart)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(svg, []byte("<svg")) || !bytes.Contains(svg, []byte("开始导入")) {
		t.Fatalf("SVG 内容异常：%s", string(svg[:minInt(len(svg), 200)]))
	}
	if !bytes.Contains(svg, []byte("marker-end")) {
		t.Fatal("SVG 缺少箭头标记")
	}
	png, err := BuildFlowchartPNG(sampleFlowchart)
	if err != nil {
		t.Fatal(err)
	}
	if len(png) < 1000 || !bytes.HasPrefix(png, []byte("\x89PNG")) {
		t.Fatal("流程图 PNG 产物异常")
	}
	mmpng, err := BuildMindmapPNG(sampleMindmap)
	if err != nil {
		t.Fatal(err)
	}
	if len(mmpng) < 1000 || !bytes.HasPrefix(mmpng, []byte("\x89PNG")) {
		t.Fatal("思维导图 PNG 产物异常")
	}
}

func TestParseFileRef(t *testing.T) {
	ref := ParseFileRef(`{"url":"/uploads/2026/09/abc.docx","filename":"需求文档.docx","size":1024,"ext":"docx"}`)
	if ref == nil || ref.Ext != "docx" || ref.Size != 1024 {
		t.Fatalf("附件引用解析失败：%+v", ref)
	}
	if ParseFileRef("") != nil || ParseFileRef("{bad") != nil {
		t.Fatal("非法内容应返回 nil")
	}
	// 无 ext 字段时从文件名推断
	ref2 := ParseFileRef(`{"url":"/uploads/a/b.pdf","filename":"手册.pdf"}`)
	if ref2 == nil || ref2.Ext != "pdf" {
		t.Fatalf("扩展名推断失败：%+v", ref2)
	}
}

func TestNormalizeDocType(t *testing.T) {
	cases := map[string]string{
		"":          "markdown",
		"markdown":  "markdown",
		"datatable": "sheet",
		"sheet":     "sheet",
		"Mindmap":   "mindmap",
		"flowchart": "flowchart",
		"file":      "file",
		"unknown":   "markdown",
	}
	for in, want := range cases {
		if got := NormalizeDocType(in); got != want {
			t.Fatalf("NormalizeDocType(%q) = %q，期望 %q", in, got, want)
		}
	}
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}
