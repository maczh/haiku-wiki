package exportx

// QA 独立测试（第六轮 R6，测试轮次 1）——表格存储契约升级 v3（Luckysheet）后的导出边界：
//   - 空表 / 空 celldata / 空字符串
//   - 多工作表取首表（与阅读页默认展示首表一致）
//   - 富值对象缺 m（回落 v）、缺 v（取 m）、v 为 null / 布尔 / 浮点
//   - 负数行列跳过、声明行列小于实际内容时放宽（不被截断）
//   - v1/v2 不被误判为 v3
//   - CSV / XLSX 产物在空表下仍合法
//
// 工程师已有 TestSheetV3LuckysheetCompat 覆盖 happy path，本文件补齐边界。

import (
	"archive/zip"
	"bytes"
	"strings"
	"testing"
)

// v3Doc 拼一个 v3 文档（单表）。
func v3Doc(celldata string) string {
	return `{"version":3,"sheets":[{"name":"Sheet1","index":0,"order":0,"status":1,"row":100,"column":26,"celldata":[` + celldata + `]}]}`
}

// TestQASheetV3EmptyAndMalformed 空表与异常结构不得让导出崩溃或产出非法文件。
func TestQASheetV3EmptyAndMalformed(t *testing.T) {
	cases := []struct {
		name    string
		content string
	}{
		{"空字符串", ""},
		{"空白字符串", "   \n"},
		{"非法 JSON", "{not json"},
		{"v3 空 celldata", v3Doc("")},
		{"v3 无 sheets", `{"version":3}`},
		{"v3 空 sheets 数组", `{"version":3,"sheets":[]}`},
		{"标量 JSON", `"文本"`},
		{"数组 JSON", `[]`},
	}
	for _, c := range cases {
		s := ParseSheetJSON(c.content)
		if s.Cells == nil {
			t.Fatalf("%s: Cells 不应为 nil（下游 range 会 panic）", c.name)
		}
		if len(s.Cells) != 0 {
			t.Fatalf("%s: 应解析为空表, got %v", c.name, s.Cells)
		}
		// 空表 CSV：不报错，仅 BOM 或一条空行
		csvData, err := BuildCSV(c.content)
		if err != nil {
			t.Fatalf("%s: BuildCSV 不应报错: %v", c.name, err)
		}
		if len(csvData) < 3 {
			t.Fatalf("%s: CSV 应至少含 BOM, got %d bytes", c.name, len(csvData))
		}
		// 空表 XLSX：仍是合法 zip 且含 worksheet
		xlsx, err := BuildXLSX(c.content, "空表")
		if err != nil {
			t.Fatalf("%s: BuildXLSX 不应报错: %v", c.name, err)
		}
		if name, ok := qaZipHasFile(xlsx, "xl/worksheets/sheet1.xml"); !ok {
			t.Fatalf("%s: xlsx 缺 worksheet（zip 内容: %v）", c.name, name)
		}
	}
}

// qaZipHasFile 校验 zip 内是否含指定条目。
func qaZipHasFile(data []byte, want string) ([]string, bool) {
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, false
	}
	var names []string
	for _, f := range zr.File {
		names = append(names, f.Name)
		if f.Name == want {
			return names, true
		}
	}
	return names, false
}

// TestQASheetV3MultiSheetTakesFirst 多工作表导出取首表（与阅读页默认展示首表一致）。
func TestQASheetV3MultiSheetTakesFirst(t *testing.T) {
	content := `{"version":3,"sheets":[
		{"name":"第一表","row":10,"column":5,"celldata":[{"r":0,"c":0,"v":{"m":"A1","v":"A1"}},{"r":1,"c":0,"v":"B1"}]},
		{"name":"第二表","row":10,"column":5,"celldata":[{"r":0,"c":0,"v":{"m":"第二表内容","v":"第二表内容"}}]}
	]}`
	s := ParseSheetJSON(content)
	if s.Cells["0-0"].Text != "A1" || s.Cells["1-0"].Text != "B1" {
		t.Fatalf("应取首表内容, got %v", s.Cells)
	}
	if _, has := s.Cells["0-1"]; has {
		t.Fatal("不应混入第二表的单元格")
	}
	csvData, err := BuildCSV(content)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(csvData), "第二表内容") {
		t.Fatalf("CSV 不应含第二表内容: %s", csvData)
	}
	if !strings.Contains(string(csvData), "A1") || !strings.Contains(string(csvData), "B1") {
		t.Fatalf("CSV 应含首表内容: %s", csvData)
	}
}

// TestQASheetV3RichValueFallback 富值对象 m/v 缺失与各类标量取值。
func TestQASheetV3RichValueFallback(t *testing.T) {
	cases := []struct {
		name string
		v    string
		want string
	}{
		{"m 与 v 齐全：优先 m（展示值）", `{"m":"2026-09-18","v":45918,"ct":{"fa":"yyyy-mm-dd"}}`, "2026-09-18"},
		{"缺 m：回落 v 字符串", `{"v":"原始值"}`, "原始值"},
		{"缺 m：回落 v 数字", `{"v":42}`, "42"},
		{"缺 m：回落 v 浮点", `{"v":3.14159}`, "3.14159"},
		{"缺 m：回落 v 布尔", `{"v":true}`, "true"},
		// 已知取舍：m 为空串被当作「展示值为空」而跳过，不回落 v。
		// Luckysheet 实际产出的单元格 m 与 v 同值，该分支只在极端数据下触发，
		// 记录现状以便后续有人改动取值优先级时被测试捕获（见报告「观察项」）。
		{"m 为空串：视为空展示值，跳过", `{"m":"","v":"回落"}`, ""},
		{"v 为 null：跳过该格", `{"m":null,"v":null}`, ""},
		{"标量字符串", `"纯文本"`, "纯文本"},
		{"标量数字", `1024`, "1024"},
		{"标量布尔", `false`, "false"},
		{"空对象：跳过", `{}`, ""},
	}
	for _, c := range cases {
		content := v3Doc(`{"r":0,"c":0,"v":` + c.v + `}`)
		s := ParseSheetJSON(content)
		got := s.Cells["0-0"].Text
		if c.want == "" {
			if _, has := s.Cells["0-0"]; has {
				t.Fatalf("%s: 空值单元格应被跳过, got %q", c.name, got)
			}
			continue
		}
		if got != c.want {
			t.Fatalf("%s: got %q, want %q", c.name, got, c.want)
		}
	}
}

// TestQASheetV3BoundsAndNegativeIndex 负数行列跳过；声明行列小于内容时放宽，不被截断。
func TestQASheetV3BoundsAndNegativeIndex(t *testing.T) {
	// 声明 row=2/column=2，但内容写到 r=10,c=8：导出必须包含全部内容
	content := `{"version":3,"sheets":[{"name":"T","row":2,"column":2,"celldata":[
		{"r":0,"c":0,"v":"A1"},{"r":10,"c":8,"v":"I11"},
		{"r":-1,"c":0,"v":"非法行"},{"r":0,"c":-3,"v":"非法列"}
	]}]}`
	s := ParseSheetJSON(content)
	if s.Cells["10-8"].Text != "I11" {
		t.Fatalf("内容不应被声明行列截断: %v", s.Cells)
	}
	for _, bad := range []string{"-1-0", "0--3"} {
		if _, has := s.Cells[bad]; has {
			t.Fatalf("负数索引不应入库: %s", bad)
		}
	}
	if s.RowLen <= 10 || s.ColLen <= 8 {
		t.Fatalf("声明行列小于内容时应放宽: row=%d col=%d", s.RowLen, s.ColLen)
	}
	csvData, err := BuildCSV(content)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(csvData), "I11") {
		t.Fatalf("CSV 应含超出声明范围的内容: %s", csvData)
	}
	// 负数单元格内容不得出现在产物里
	if strings.Contains(string(csvData), "非法行") || strings.Contains(string(csvData), "非法列") {
		t.Fatalf("负数索引内容不应进入导出: %s", csvData)
	}
}

// TestQASheetV1V2NotMistakenForV3 v1/v2 历史契约不被 v3 分支误吞（历史文档导出行为不变）。
func TestQASheetV1V2NotMistakenForV3(t *testing.T) {
	v1 := `{"version":1,"cells":{"0-0":{"text":"姓名"},"1-0":{"text":"张三"}},"colLen":26,"rowLen":100}`
	s := ParseSheetJSON(v1)
	if s.Version != 1 {
		t.Fatalf("v1 应仍按 v1 解析, got version=%d", s.Version)
	}
	if s.Cells["1-0"].Text != "张三" || s.Cells["0-0"].Text != "姓名" {
		t.Fatalf("v1 内容解析错误: %v", s.Cells)
	}
	if s.ColLen != 26 || s.RowLen != 100 {
		t.Fatalf("v1 行列元信息应保留: col=%d row=%d", s.ColLen, s.RowLen)
	}
	// v2（x-data-spreadsheet 的 rows 结构，无扁平 cells）
	v2 := `{"version":2,"rows":{"0":{"cells":{"0":{"text":"甲"}}}},"colLen":8,"rowLen":50}`
	s2 := ParseSheetJSON(v2)
	if s2.Version != 1 {
		t.Fatalf("无 sheets 的 v2 不应被判为 v3, got version=%d", s2.Version)
	}
	if s2.ColLen != 8 || s2.RowLen != 50 {
		t.Fatalf("v2 行列元信息应保留: col=%d row=%d", s2.ColLen, s2.RowLen)
	}
	// CSV 仍能产出（空表不报错）
	if _, err := BuildCSV(v2); err != nil {
		t.Fatalf("v2 导出不应报错: %v", err)
	}
}

// TestQASheetV3ExportRoundtrip v3 → CSV/XLSX 内容保真（含中文与特殊字符转义）。
func TestQASheetV3ExportRoundtrip(t *testing.T) {
	content := v3Doc(`{"r":0,"c":0,"v":{"m":"姓名","v":"姓名"}},{"r":0,"c":1,"v":{"m":"备注","v":"备注"}},
		{"r":1,"c":0,"v":"张三"},{"r":1,"c":1,"v":"含,逗号"},{"r":2,"c":0,"v":"<a>&b"},{"r":2,"c":1,"v":"多\"引号"}`)

	csvData, err := BuildCSV(content)
	if err != nil {
		t.Fatal(err)
	}
	csvText := string(csvData)
	for _, want := range []string{"姓名", "张三", "备注"} {
		if !strings.Contains(csvText, want) {
			t.Fatalf("CSV 缺 %q: %s", want, csvText)
		}
	}
	if !strings.HasPrefix(csvText, "\xEF\xBB\xBF") {
		t.Fatal("CSV 应带 UTF-8 BOM（Excel 打开不乱码）")
	}
	// 含逗号的值应被 CSV 引号包裹，而不是破坏列结构
	if !strings.Contains(csvText, `"含,逗号"`) {
		t.Fatalf("含逗号单元格应被引号包裹: %s", csvText)
	}

	xlsx, err := BuildXLSX(content, "人员表")
	if err != nil {
		t.Fatal(err)
	}
	zr, err := zip.NewReader(bytes.NewReader(xlsx), int64(len(xlsx)))
	if err != nil {
		t.Fatalf("xlsx 不是合法 zip: %v", err)
	}
	var sheetXML, workbookXML string
	for _, f := range zr.File {
		rc, _ := f.Open()
		var buf bytes.Buffer
		_, _ = buf.ReadFrom(rc)
		_ = rc.Close()
		switch f.Name {
		case "xl/worksheets/sheet1.xml":
			sheetXML = buf.String()
		case "xl/workbook.xml":
			workbookXML = buf.String()
		}
	}
	if sheetXML == "" {
		t.Fatal("xlsx 缺 worksheet")
	}
	for _, want := range []string{"姓名", "张三"} {
		if !strings.Contains(sheetXML, want) {
			t.Fatalf("xlsx 缺内容 %q: %s", want, sheetXML)
		}
	}
	// XML 特殊字符必须转义，否则文件损坏
	if strings.Contains(sheetXML, "<a>&b") {
		t.Fatalf("xlsx 未转义 XML 特殊字符: %s", sheetXML)
	}
	for _, want := range []string{"&lt;a&gt;", "&amp;", "&quot;"} {
		if !strings.Contains(sheetXML, want) {
			t.Fatalf("xlsx 应转义 %s: %s", want, sheetXML)
		}
	}
	// 工作表名落进 workbook.xml
	if !strings.Contains(workbookXML, `name="人员表"`) {
		t.Fatalf("workbook.xml 应含工作表名: %s", workbookXML)
	}
	// 非法工作表名被净化（Excel 限制 31 字符且不含 : \ / ? * [ ]）
	xlsx2, err := BuildXLSX(content, "a/b?c*d[e]:f"+strings.Repeat("长", 40))
	if err != nil {
		t.Fatal(err)
	}
	zr2, _ := zip.NewReader(bytes.NewReader(xlsx2), int64(len(xlsx2)))
	for _, f := range zr2.File {
		if f.Name != "xl/workbook.xml" {
			continue
		}
		rc, _ := f.Open()
		var buf bytes.Buffer
		_, _ = buf.ReadFrom(rc)
		_ = rc.Close()
		for _, bad := range []string{"/", "?", "*", "[", "]", ":"} {
			if strings.Contains(buf.String(), `name="`+bad) || strings.Contains(buf.String(), bad+`"`) {
				t.Fatalf("工作表名未净化，含非法字符 %q: %s", bad, buf.String())
			}
		}
	}
}
