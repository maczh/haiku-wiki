package handler

import (
	"strings"
	"testing"
)

// TestConvertHtmlToMarkdown 验证 HTML→Markdown 转换与图片收集（无网络，纯函数）。
func TestConvertHtmlToMarkdown(t *testing.T) {
	html := `<html><head><title>测试标题</title></head><body>` +
		`<h1>主标题</h1>` +
		`<p>段落 <strong>粗体</strong> 与 <a href="https://e.com/x">链接</a>。</p>` +
		`<ul><li>项一</li><li>项二</li></ul>` +
		`<blockquote>引用</blockquote>` +
		`<pre><code>code</code></pre>` +
		`<img src="https://img.com/a.png" alt="图"/>` +
		`</body></html>`
	title, md, imgs := convertHtmlToMarkdown(html, nil)
	if title != "测试标题" {
		t.Fatalf("title=%q", title)
	}
	if !strings.Contains(md, "# 主标题") {
		t.Fatal("缺少 h1")
	}
	if !strings.Contains(md, "**粗体**") {
		t.Fatal("缺少粗体")
	}
	if !strings.Contains(md, "[链接](https://e.com/x)") {
		t.Fatal("缺少链接")
	}
	if !strings.Contains(md, "- 项一") || !strings.Contains(md, "- 项二") {
		t.Fatal("缺少列表")
	}
	if !strings.Contains(md, "> 引用") {
		t.Fatal("缺少引用")
	}
	if !strings.Contains(md, "```") {
		t.Fatal("缺少代码块")
	}
	if len(imgs) != 1 || imgs[0] != "https://img.com/a.png" {
		t.Fatalf("图片收集错误: %v", imgs)
	}
}

// TestConvertHtmlToMarkdownNestedList 嵌套列表缩进。
func TestConvertHtmlToMarkdownNestedList(t *testing.T) {
	html := `<ul><li>父项<ul><li>子项A</li><li>子项B</li></ul></li><li>兄弟</li></ul>`
	_, md, _ := convertHtmlToMarkdown(html, nil)
	if !strings.Contains(md, "- 父项") || !strings.Contains(md, "- 兄弟") {
		t.Fatalf("缺少顶层列表项: %q", md)
	}
	if !strings.Contains(md, "  - 子项A") || !strings.Contains(md, "  - 子项B") {
		t.Fatalf("缺少缩进子列表项: %q", md)
	}
}
