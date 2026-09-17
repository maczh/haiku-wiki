package exportx

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"strings"
	"testing"
)

// 思维导图导入的契约：任意受支持格式进来，都产出内置 .smm（v2）正文，
// 且节点文本/层级与源文件一致；不支持的输入必须报错而不是产出半截内容。

// smmShape 校验导入结果的结构，返回「层级化的文本路径」便于断言。
func smmShape(t *testing.T, content string) []string {
	t.Helper()
	var doc struct {
		Version int `json:"version"`
		Root    struct {
			Data struct {
				Text string `json:"text"`
			} `json:"data"`
			Children []json.RawMessage `json:"children"`
		} `json:"root"`
	}
	if err := json.Unmarshal([]byte(content), &doc); err != nil {
		t.Fatalf("导入结果不是合法 JSON：%v\n%s", err, content)
	}
	if doc.Version != 2 {
		t.Fatalf("导入结果版本应为 2，实际 %d", doc.Version)
	}
	var out []string
	var walk func(raw json.RawMessage, depth int)
	walk = func(raw json.RawMessage, depth int) {
		var n struct {
			Data struct {
				Text string `json:"text"`
			} `json:"data"`
			Children []json.RawMessage `json:"children"`
		}
		if err := json.Unmarshal(raw, &n); err != nil {
			return
		}
		out = append(out, strings.Repeat("  ", depth)+n.Data.Text)
		for _, c := range n.Children {
			walk(c, depth+1)
		}
	}
	root := map[string]interface{}{"data": doc.Root.Data, "children": doc.Root.Children}
	raw, _ := json.Marshal(root)
	out = out[:0]
	walk(raw, 0)
	return out
}

func TestImportMindmapSMM(t *testing.T) {
	src := `{"version":2,"root":{"data":{"text":"根","expand":true},"children":[{"data":{"text":"A","expand":false},"children":[{"data":{"text":"A1","expand":true},"children":[]}]},{"data":{"text":"B","expand":true},"children":[]}]}}`
	content, title, err := ImportMindmapFile("x.smm", []byte(src))
	if err != nil {
		t.Fatalf("smm 导入失败：%v", err)
	}
	if title != "根" {
		t.Fatalf("标题应为根节点文本，实际 %q", title)
	}
	got := smmShape(t, content)
	want := []string{"根", "  A", "    A1", "  B"}
	if strings.Join(got, "|") != strings.Join(want, "|") {
		t.Fatalf("层级不符：\n实际 %v\n期望 %v", got, want)
	}
	// expand=false 必须被保留（否则导入后所有分支都被强制展开）
	if !strings.Contains(content, `"expand":false`) {
		t.Fatal("expand=false 未保留")
	}
}

func TestImportMindmapSMMV1(t *testing.T) {
	// 旧版 v1 结构（{"version":1,"tree":{text,children}}）也要能吃
	src := `{"version":1,"tree":{"text":"旧根","children":[{"text":"子","children":[]}]}}`
	content, title, err := ImportMindmapFile("old.smm", []byte(src))
	if err != nil {
		t.Fatalf("v1 smm 导入失败：%v", err)
	}
	if title != "旧根" {
		t.Fatalf("标题应为旧根，实际 %q", title)
	}
	got := smmShape(t, content)
	if strings.Join(got, "|") != "旧根|  子" {
		t.Fatalf("层级不符：%v", got)
	}
}

func TestImportMindmapKM(t *testing.T) {
	// KityMinder：文本在 data.text，展开态用 expandState=collapse 表达
	src := `{"root":{"data":{"id":"n1","text":"项目","expandState":"expand"},"children":[
	  {"data":{"id":"n2","text":"需求","expandState":"collapse"},"children":[{"data":{"id":"n3","text":"调研","expandState":"expand"}}]},
	  {"data":{"id":"n4","text":"开发","expandState":"expand"}}]},"template":"default","theme":"fresh-blue","version":"1.4.43"}`
	content, title, err := ImportMindmapFile("脑图.km", []byte(src))
	if err != nil {
		t.Fatalf("km 导入失败：%v", err)
	}
	if title != "项目" {
		t.Fatalf("标题应为「项目」，实际 %q", title)
	}
	got := smmShape(t, content)
	want := []string{"项目", "  需求", "    调研", "  开发"}
	if strings.Join(got, "|") != strings.Join(want, "|") {
		t.Fatalf("层级不符：\n实际 %v\n期望 %v", got, want)
	}
	if !strings.Contains(content, `"expand":false`) {
		t.Fatal("collapse 未被映射为 expand=false")
	}
}

func TestImportMindmapKMTextAtTopLevel(t *testing.T) {
	// 部分导出工具把文本放在顶层 text 而非 data.text
	src := `{"root":{"text":"顶层文本","children":[{"text":"子项"}]}}`
	content, title, err := ImportMindmapFile("t.km", []byte(src))
	if err != nil {
		t.Fatalf("顶层 text 形态 km 导入失败：%v", err)
	}
	if title != "顶层文本" {
		t.Fatalf("标题应为「顶层文本」，实际 %q", title)
	}
	if got := smmShape(t, content); strings.Join(got, "|") != "顶层文本|  子项" {
		t.Fatalf("层级不符：%v", got)
	}
}

func TestImportMindmapFreeMind(t *testing.T) {
	src := `<?xml version="1.0" encoding="UTF-8"?>
<map version="1.0.1">
  <node TEXT="销售流程">
    <node TEXT="线索" FOLDED="true">
      <node TEXT="来源"/>
    </node>
    <node TEXT="成交"/>
  </node>
</map>`
	content, title, err := ImportMindmapFile("流程.mm", []byte(src))
	if err != nil {
		t.Fatalf("mm 导入失败：%v", err)
	}
	if title != "销售流程" {
		t.Fatalf("标题应为「销售流程」，实际 %q", title)
	}
	got := smmShape(t, content)
	want := []string{"销售流程", "  线索", "    来源", "  成交"}
	if strings.Join(got, "|") != strings.Join(want, "|") {
		t.Fatalf("层级不符：\n实际 %v\n期望 %v", got, want)
	}
	if !strings.Contains(content, `"expand":false`) {
		t.Fatal("FOLDED=true 未被映射为 expand=false")
	}
}

// buildXMind 拼一个 .xmind（zip）用于测试。
func buildXMind(t *testing.T, parts map[string]string) []byte {
	t.Helper()
	buf := &bytes.Buffer{}
	zw := zip.NewWriter(buf)
	for name, data := range parts {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := w.Write([]byte(data)); err != nil {
			t.Fatal(err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func TestImportMindmapXMindZen(t *testing.T) {
	// 新版 XMind（Zen / 2020+）：zip 内 content.json
	contentJSON := `[{"id":"sheet-1","class":"sheet","title":"画布 1","rootTopic":{
	  "id":"t1","class":"topic","title":"年度目标","children":{"attached":[
	    {"id":"t2","class":"topic","title":"Q1","children":{"attached":[{"id":"t3","class":"topic","title":"上线"}]}},
	    {"id":"t4","class":"topic","title":"Q2"}]}}}]`
	data := buildXMind(t, map[string]string{
		"content.json":  contentJSON,
		"metadata.json": `{"creator":{"name":"XMind"}}`,
		"manifest.json": `{"file-entries":{"content.json":{}}}`,
	})
	content, title, err := ImportMindmapFile("目标.xmind", data)
	if err != nil {
		t.Fatalf("xmind 导入失败：%v", err)
	}
	if title != "年度目标" {
		t.Fatalf("标题应为「年度目标」，实际 %q", title)
	}
	got := smmShape(t, content)
	want := []string{"年度目标", "  Q1", "    上线", "  Q2"}
	if strings.Join(got, "|") != strings.Join(want, "|") {
		t.Fatalf("层级不符：\n实际 %v\n期望 %v", got, want)
	}
}

func TestImportMindmapXMindLegacyXML(t *testing.T) {
	// 旧版 XMind 8：zip 内 content.xml
	contentXML := `<?xml version="1.0" encoding="UTF-8"?>
<xmap-content xmlns="urn:xmind:xmap:xmlns:content:2.0">
  <sheet id="s1"><topic id="t1"><title>旧版根</title>
    <children><topics type="attached">
      <topic id="t2"><title>分支</title></topic>
    </topics></children>
  </topic></sheet>
</xmap-content>`
	data := buildXMind(t, map[string]string{"content.xml": contentXML})
	content, title, err := ImportMindmapFile("legacy.xmind", data)
	if err != nil {
		t.Fatalf("旧版 xmind 导入失败：%v", err)
	}
	if title != "旧版根" {
		t.Fatalf("标题应为「旧版根」，实际 %q", title)
	}
	if got := smmShape(t, content); strings.Join(got, "|") != "旧版根|  分支" {
		t.Fatalf("层级不符：%v", got)
	}
}

func TestImportMindmapRejectsBadInput(t *testing.T) {
	cases := []struct {
		name string
		file string
		data string
	}{
		{"空文件", "a.smm", ""},
		{"非法 JSON", "a.smm", "{not json"},
		{"km 缺 root", "a.km", `{"template":"default"}`},
		{"mm 非 XML", "a.mm", "TEXT 不是 XML"},
		{"xmind 不是 zip", "a.xmind", "就是一段文本"},
		{"xmind 缺内容", "a.xmind", ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			var data []byte
			if c.name == "xmind 缺内容" {
				data = buildXMind(t, map[string]string{"other.txt": "nothing"})
			} else {
				data = []byte(c.data)
			}
			if _, _, err := ImportMindmapFile(c.file, data); err == nil {
				t.Fatal("应当报错，但成功返回了内容")
			}
		})
	}
}

func TestImportMindmapSniffWithoutExt(t *testing.T) {
	// 扩展名缺失/不可信时按内容嗅探：XML → mm，zip → xmind
	mm := `<?xml version="1.0"?><map version="1.0.1"><node TEXT="嗅探根"/></map>`
	if _, title, err := ImportMindmapFile("noext", []byte(mm)); err != nil || title != "嗅探根" {
		t.Fatalf("XML 嗅探失败：title=%q err=%v", title, err)
	}
	zipData := buildXMind(t, map[string]string{
		"content.json": `[{"rootTopic":{"title":"压缩包根"}}]`,
	})
	if _, title, err := ImportMindmapFile("noext", zipData); err != nil || title != "压缩包根" {
		t.Fatalf("zip 嗅探失败：title=%q err=%v", title, err)
	}
}
