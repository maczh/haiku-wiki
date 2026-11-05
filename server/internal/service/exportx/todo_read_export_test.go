package exportx

import (
	"archive/zip"
	"bytes"
	"io"
	"strings"
	"testing"
)

const groupedTodoFixture = `{"version":1,"items":[{"text":"共同任务","done":false,"assignees":["乙","甲","乙"],"project":"项目一","progress":42,"priority":"high","due":"2026-10-23","note":"第一行\n第二行"},{"text":"完成任务","done":true,"assignees":["甲"],"progress":5},{"text":"未分配任务","done":false,"progress":0}]}`

func TestTodoReadingGroups(t *testing.T) {
	doc := parseTodoExportDoc(groupedTodoFixture)
	groups := groupTodoExports(doc.Items)
	if len(groups) != 3 {
		t.Fatalf("expected 3 groups, got %d", len(groups))
	}
	for i, name := range []string{"乙", "甲", "未分配负责人"} {
		if groups[i].Name != name {
			t.Fatalf("group %d: got %q", i, groups[i].Name)
		}
	}
	if len(groups[0].Items) != 1 || len(groups[1].Items) != 2 {
		t.Fatal("multi-assignee tasks not grouped correctly")
	}
	if groups[1].Items[1].Progress != 100 {
		t.Fatal("completed task must have 100% progress")
	}
	if todoExportProgress(false, 42.6) != 43 {
		t.Fatal("progress must use the same rounding as the reader")
	}
}

func TestTodoMarkdownReadingExport(t *testing.T) {
	data, err := BuildTodoMD(groupedTodoFixture, "验收清单")
	if err != nil {
		t.Fatal(err)
	}
	md := string(data)
	for _, text := range []string{
		"已完成 1 / 3", "## 乙 · 1 项 · 已完成 0 项", "## 甲 · 2 项 · 已完成 1 项",
		"## 未分配负责人", "项目 项目一", "截止 2026-10-23", "优先级 高", "████░░░░░░ 42%",
		"  第一行  \n  第二行", "██████████ 100%", "- [x] 完成任务",
	} {
		if !strings.Contains(md, text) {
			t.Errorf("missing %q in Markdown:\n%s", text, md)
		}
	}
	if strings.Count(md, "- [ ] 共同任务") != 2 {
		t.Fatal("shared task must appear in each group exactly once")
	}
	if strings.Index(md, "## 乙") > strings.Index(md, "## 甲") {
		t.Fatal("group order changed")
	}
}

func TestTodoXLSXReadingExport(t *testing.T) {
	data, err := BuildTodoXLSX(groupedTodoFixture, "验收清单")
	if err != nil {
		t.Fatal(err)
	}
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatal(err)
	}
	sheet := ""
	for _, file := range reader.File {
		if file.Name != "xl/worksheets/sheet1.xml" {
			continue
		}
		stream, err := file.Open()
		if err != nil {
			t.Fatal(err)
		}
		raw, err := io.ReadAll(stream)
		stream.Close()
		if err != nil {
			t.Fatal(err)
		}
		sheet = string(raw)
	}
	for _, text := range []string{"已完成 1 / 3", "乙 · 1 项 · 已完成 0 项", "甲 · 2 项 · 已完成 1 项", "未分配负责人", "████░░░░░░ 42%", "项目一", "第一行", "██████████ 100%"} {
		if !strings.Contains(sheet, text) {
			t.Errorf("missing %q in worksheet", text)
		}
	}
	if strings.Count(sheet, ">共同任务<") != 2 {
		t.Fatal("worksheet must repeat the shared task in each assignee group")
	}
}

func TestTodoEmptyReadingExport(t *testing.T) {
	md, err := BuildTodoMD(`{"version":1,"items":[]}`, "空清单")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(md), "已完成 0 / 0") || !strings.Contains(string(md), "还没有条目") {
		t.Fatal(string(md))
	}
}
