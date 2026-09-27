package handler

import (
	"encoding/json"
	"testing"

	"haiku-wiki/server/internal/service"
)

// TestOfficeTemplateExtMapping 校验 9 种办公模板扩展名都能映射到正确的文档类型。
func TestOfficeTemplateExtMapping(t *testing.T) {
	want := map[string]string{
		".doc": "word", ".docx": "word", ".dotx": "word",
		".xls": "sheet", ".xlsx": "sheet", ".xltx": "sheet",
		".ppt": "ppt", ".pptx": "ppt", ".potx": "ppt",
	}
	for ext, dt := range want {
		if got, ok := officeTemplateExt[ext]; !ok || got != dt {
			t.Errorf("officeTemplateExt[%q] = %q, ok=%v; want %q", ext, got, ok, dt)
		}
	}
	// 不应误映射非办公扩展名
	for _, bad := range []string{".json", ".pdf", ".txt", ".md", ".png"} {
		if _, ok := officeTemplateExt[bad]; ok {
			t.Errorf("officeTemplateExt 不应包含 %q", bad)
		}
	}
}

// TestBuildOfficeTemplate 校验办公模板记录的字段与正文引用结构。
func TestBuildOfficeTemplate(t *testing.T) {
	out := &service.UploadOutput{
		URL:      "/uploads/cas/ab/abcdef-123456.docx",
		Filename: "会议纪要.docx",
		Size:     12345,
	}
	t.Run("默认分类按类型归类", func(t *testing.T) {
		tpl := buildOfficeTemplate("会议纪要.docx", out, "word", "", 0)
		if tpl.Name != "会议纪要" {
			t.Errorf("Name = %q; want 会议纪要", tpl.Name)
		}
		if tpl.DocType != "word" {
			t.Errorf("DocType = %q; want word", tpl.DocType)
		}
		if tpl.Category != "Word 模板" {
			t.Errorf("Category = %q; want Word 模板", tpl.Category)
		}
		if tpl.Title != "会议纪要" {
			t.Errorf("Title = %q; want 会议纪要", tpl.Title)
		}
		if tpl.Sort != 10 {
			t.Errorf("Sort = %d; want 10", tpl.Sort)
		}
	})

	t.Run("显式分类覆盖", func(t *testing.T) {
		tpl := buildOfficeTemplate("budget.XLSX", out, "sheet", "财务报表", 2)
		if tpl.Category != "财务报表" {
			t.Errorf("Category = %q; want 财务报表", tpl.Category)
		}
		if tpl.Name != "budget" {
			t.Errorf("Name = %q; want budget", tpl.Name)
		}
	})

	t.Run("正文引用结构", func(t *testing.T) {
		tpl := buildOfficeTemplate("汇报.pptx", out, "ppt", "PPT 模板", 0)
		var ref map[string]interface{}
		if err := json.Unmarshal([]byte(tpl.Content), &ref); err != nil {
			t.Fatalf("Content 不是合法 JSON: %v", err)
		}
		if ref["url"] != out.URL {
			t.Errorf("url = %v; want %v", ref["url"], out.URL)
		}
		if ref["filename"] != out.Filename {
			t.Errorf("filename = %v; want %v", ref["filename"], out.Filename)
		}
		if ref["size"] != float64(out.Size) {
			t.Errorf("size = %v; want %v", ref["size"], out.Size)
		}
		if ref["ext"] != "pptx" {
			t.Errorf("ext = %v; want pptx", ref["ext"])
		}
	})

	t.Run("模板格式扩展名保留", func(t *testing.T) {
		outDot := &service.UploadOutput{URL: "/uploads/cas/ab/x.dotx", Filename: "x.dotx", Size: 1}
		tpl := buildOfficeTemplate("x.dotx", outDot, "word", "", 0)
		var ref map[string]interface{}
		_ = json.Unmarshal([]byte(tpl.Content), &ref)
		if ref["ext"] != "dotx" {
			t.Errorf("ext = %v; want dotx（模板格式扩展名应保留）", ref["ext"])
		}
	})
}
