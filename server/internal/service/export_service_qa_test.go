package service

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"haiku-wiki/server/internal/service/exportx"
)

// ---------- 导出服务：单篇多格式 + 附件型文档 ----------

// TestDocExportAllFormats 覆盖四类文档的全部导出格式（服务端转换）。
func TestDocExportAllFormats(t *testing.T) {
	newEnv(t)
	owner := mkUser(t, "owner@example.com", "secret123", "user")
	book := mkBook(t, owner.ID, "导出全格式", "private")
	ds := &DocService{}
	es := &ExportService{}

	samples := []struct {
		docType string
		content string
		formats map[string]func([]byte) bool // 格式 → 内容校验
	}{
		{
			docType: "markdown",
			content: "# 标题\n\n正文**加粗**与 `code`。\n\n- 列表项\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n",
			formats: map[string]func([]byte) bool{
				"md":   func(b []byte) bool { return strings.Contains(string(b), "# 标题") },
				"docx": func(b []byte) bool { return hasZipMagic(b) },
				"pdf":  func(b []byte) bool { return bytes.HasPrefix(b, []byte("%PDF")) },
			},
		},
		{
			docType: "sheet",
			content: `{"version":1,"cells":{"0-0":{"text":"姓名"},"0-1":{"text":"部门"},"1-0":{"text":"张三"},"1-1":{"text":"研发"}},"colLen":26,"rowLen":100}`,
			formats: map[string]func([]byte) bool{
				"xlsx": func(b []byte) bool { return hasZipMagic(b) },
				"csv": func(b []byte) bool {
					return strings.Contains(string(b), "姓名") && strings.Contains(string(b), "张三")
				},
				"json": func(b []byte) bool { return json.Valid(b) && strings.Contains(string(b), "研发") },
			},
		},
		{
			docType: "mindmap",
			content: `{"version":2,"root":{"data":{"text":"寄海文库"},"children":[{"data":{"text":"产品"},"children":[{"data":{"text":"文库"}}]},{"data":{"text":"研发"}}]}}`,
			formats: map[string]func([]byte) bool{
				"km":    func(b []byte) bool { return json.Valid(b) && strings.Contains(string(b), "寄海文库") },
				"smm":   func(b []byte) bool { return json.Valid(b) && strings.Contains(string(b), "研发") },
				"xmind": func(b []byte) bool { return hasZipMagic(b) },
				"mm": func(b []byte) bool {
					return strings.Contains(string(b), "<map") && strings.Contains(string(b), "文库")
				},
				"png": func(b []byte) bool { return hasPNGMagic(b) },
			},
		},
		{
			docType: "flowchart",
			content: "graph TD\n  A[开始] --> B{判断}\n  B -->|是| C(处理)\n  B -->|否| D[结束]\n",
			formats: map[string]func([]byte) bool{
				"md": func(b []byte) bool { return strings.Contains(string(b), "```mermaid") },
				"svg": func(b []byte) bool {
					return strings.Contains(string(b), "<svg") && strings.Contains(string(b), "开始")
				},
				"png": func(b []byte) bool { return hasPNGMagic(b) },
			},
		},
	}

	for _, s := range samples {
		doc, err := ds.CreateDocWithContent(book, owner.ID, 0, "样例-"+s.docType, s.docType, s.content)
		if err != nil {
			t.Fatalf("创建 %s 文档失败: %v", s.docType, err)
		}
		// 格式清单应与类型匹配
		opt, err := es.DocExportFormats(owner.ID, doc.ID)
		if err != nil {
			t.Fatalf("取格式清单失败: %v", err)
		}
		if opt.IsFile || len(opt.Formats) != len(s.formats) {
			t.Fatalf("%s 格式数 = %d, 期望 %d（isFile=%v）", s.docType, len(opt.Formats), len(s.formats), opt.IsFile)
		}
		if opt.Default == "" {
			t.Fatalf("%s 缺少默认格式", s.docType)
		}
		// 逐个导出
		for format, check := range s.formats {
			out, err := es.DocExport(owner.ID, doc.ID, format)
			if err != nil {
				t.Fatalf("导出 %s/%s 失败: %v", s.docType, format, err)
			}
			if len(out.Data) == 0 {
				t.Fatalf("导出 %s/%s 内容为空", s.docType, format)
			}
			if !strings.HasSuffix(out.Filename, "."+format) {
				t.Fatalf("导出 %s/%s 文件名 = %q, 期望 .%s 结尾", s.docType, format, out.Filename, format)
			}
			if out.MIME == "" {
				t.Fatalf("导出 %s/%s 缺少 MIME", s.docType, format)
			}
			if !check(out.Data) {
				t.Fatalf("导出 %s/%s 内容校验失败（size=%d）", s.docType, format, len(out.Data))
			}
		}
		// 空 format → 默认格式
		def, err := es.DocExport(owner.ID, doc.ID, "")
		if err != nil {
			t.Fatalf("默认格式导出失败: %v", err)
		}
		if !strings.HasSuffix(def.Filename, "."+opt.Default) {
			t.Fatalf("默认格式文件名 = %q, 期望 .%s", def.Filename, opt.Default)
		}
		// 非法格式 → 参数错误
		if _, err := es.DocExport(owner.ID, doc.ID, "exe"); codeOf(t, err) != 40001 {
			t.Fatalf("非法格式应返回 40001")
		}
	}
}

// TestAttachmentDocExport 附件型文档：原样保存、原样下载、不可改写正文。
func TestAttachmentDocExport(t *testing.T) {
	newEnv(t)
	owner := mkUser(t, "owner@example.com", "secret123", "user")
	book := mkBook(t, owner.ID, "附件库", "private")
	ds := &DocService{}
	es := &ExportService{}

	// 在 DataDir/uploads/2026/09 下造一个假 PDF
	raw := []byte("%PDF-1.7\n附件原文内容\n%%EOF\n")
	rel := filepath.Join("uploads", "2026", "09")
	if err := os.MkdirAll(filepath.Join(DataDir, rel), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(DataDir, rel, "abc.pdf"), raw, 0o644); err != nil {
		t.Fatal(err)
	}
	ref := exportx.FileRef{URL: "/uploads/2026/09/abc.pdf", Filename: "需求说明.pdf", Size: int64(len(raw)), Ext: "pdf"}
	body, _ := json.Marshal(ref)

	doc, err := ds.CreateDocWithContent(book, owner.ID, 0, "需求说明", "file", string(body))
	if err != nil {
		t.Fatalf("创建附件型文档失败: %v", err)
	}

	// 格式清单：is_file
	opt, err := es.DocExportFormats(owner.ID, doc.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !opt.IsFile || opt.Filename != "需求说明.pdf" {
		t.Fatalf("附件型格式清单 = %+v", opt)
	}

	// 原样下载
	out, err := es.DocExport(owner.ID, doc.ID, "")
	if err != nil {
		t.Fatalf("附件下载失败: %v", err)
	}
	if !bytes.Equal(out.Data, raw) {
		t.Fatalf("附件内容与原文不一致: %q", string(out.Data))
	}
	if out.Filename != "需求说明.pdf" {
		t.Fatalf("附件下载文件名 = %q", out.Filename)
	}
	if out.MIME != "application/pdf" {
		t.Fatalf("附件 MIME = %q", out.MIME)
	}

	// 正文不可编辑（已落库后再改 → 40001）
	edited := `{"url":"/uploads/2026/09/abc.pdf","filename":"改了.pdf","size":1,"ext":"pdf"}`
	if _, _, err := ds.UpdateDoc(owner.ID, doc.ID, nil, &edited, "manual"); codeOf(t, err) != 40001 {
		t.Fatalf("附件型正文应禁止编辑")
	}
	// 标题仍可改
	newTitle := "需求说明 V2"
	if _, changed, err := ds.UpdateDoc(owner.ID, doc.ID, &newTitle, nil, "manual"); err != nil || !changed {
		t.Fatalf("附件型文档标题应可修改: changed=%v err=%v", changed, err)
	}

	// 目录穿越防护
	traversal := `{"url":"/uploads/../../etc/passwd","filename":"p.txt","size":1,"ext":"txt"}`
	bad, err := ds.CreateDocWithContent(book, owner.ID, 0, "穿越", "file", traversal)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := es.DocExport(owner.ID, bad.ID, ""); codeOf(t, err) != 40401 {
		t.Fatalf("目录穿越应被拒绝")
	}
}

// TestDocExportPermission 非 owner 无法导出 private 库文档。
func TestDocExportPermission(t *testing.T) {
	newEnv(t)
	owner := mkUser(t, "owner@example.com", "secret123", "user")
	other := mkUser(t, "other@example.com", "secret123", "user")
	book := mkBook(t, owner.ID, "私有库", "private")
	doc := mkDoc(t, book, owner.ID, 0, "机密")
	_ = setDocContent(t, owner.ID, doc.ID, "# 机密")

	es := &ExportService{}
	if _, err := es.DocExport(other.ID, doc.ID, "md"); codeOf(t, err) != 40301 {
		t.Fatalf("非 owner 导出应返回 40301")
	}
	if _, err := es.DocExportFormats(other.ID, doc.ID); codeOf(t, err) != 40301 {
		t.Fatalf("非 owner 取格式清单应返回 40301")
	}
	if _, err := es.DocExport(owner.ID, doc.ID, "docx"); err != nil {
		t.Fatalf("owner 导出失败: %v", err)
	}
}

// TestBookZipIncludesAttachment 知识库打包：附件型文档写入原文件与原扩展名。
func TestBookZipIncludesAttachment(t *testing.T) {
	newEnv(t)
	owner := mkUser(t, "owner@example.com", "secret123", "user")
	book := mkBook(t, owner.ID, "打包库", "private")
	ds := &DocService{}
	es := &ExportService{}

	raw := []byte("%PDF-1.7\n打包内容\n")
	rel := filepath.Join("uploads", "2026", "09")
	if err := os.MkdirAll(filepath.Join(DataDir, rel), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(DataDir, rel, "zip.pdf"), raw, 0o644); err != nil {
		t.Fatal(err)
	}
	ref := exportx.FileRef{URL: "/uploads/2026/09/zip.pdf", Filename: "打包附件.pdf", Size: int64(len(raw)), Ext: "pdf"}
	body, _ := json.Marshal(ref)
	if _, err := ds.CreateDocWithContent(book, owner.ID, 0, "打包附件", "file", string(body)); err != nil {
		t.Fatal(err)
	}
	mdDoc := mkDoc(t, book, owner.ID, 0, "笔记")
	_ = setDocContent(t, owner.ID, mdDoc.ID, "# 笔记")

	name, data, err := es.BookZip(owner.ID, book.ID)
	if err != nil {
		t.Fatalf("知识库打包失败: %v", err)
	}
	if !strings.HasSuffix(name, ".md.zip") || len(data) == 0 {
		t.Fatalf("打包结果异常: name=%q size=%d", name, len(data))
	}
	// zip 内条目：附件按原扩展名 + 原文件字节；笔记为 .md
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatalf("打包结果不是合法 zip: %v", err)
	}
	names := map[string][]byte{}
	for _, f := range zr.File {
		rc, err := f.Open()
		if err != nil {
			t.Fatal(err)
		}
		b, _ := io.ReadAll(rc)
		rc.Close()
		names[f.Name] = b
	}
	att, ok := names["打包附件.pdf"]
	if !ok {
		t.Fatalf("zip 缺少附件条目，实有：%v", keysOf(names))
	}
	if !bytes.Equal(att, raw) {
		t.Fatalf("zip 内附件字节与原文不一致: %q", string(att))
	}
	if _, ok := names["笔记.md"]; !ok {
		t.Fatalf("zip 缺少 markdown 条目，实有：%v", keysOf(names))
	}
}

// keysOf 便于断言失败时输出 zip 条目名。
func keysOf(m map[string][]byte) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}

// ---------- 小工具 ----------

func hasZipMagic(b []byte) bool {
	return len(b) > 4 && b[0] == 'P' && b[1] == 'K' && (b[2] == 3 || b[2] == 5)
}

func hasPNGMagic(b []byte) bool {
	return len(b) > 8 && bytes.Equal(b[:8], []byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'})
}
