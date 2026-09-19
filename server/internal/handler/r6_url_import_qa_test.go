package handler

// QA 独立测试（第五轮 R5 URL 导入，测试轮次 1）——网页抓取转 Markdown 的纯函数边界：
//   - script / style / noscript / iframe / head 等非正文节点不入正文（脚本文本不外泄）
//   - <title> 缺失时回退首个 h1；head 外的 title 不被误取
//   - 图片链接：SSRF 黑名单目标 / 非 http / 相对路径 一律保留原链接，不改写、不落盘
//   - 多余空行合并、正文结构保真
//
// 与既有 import_test.go（happy path 结构）互补，这里专测「不该进正文的东西」。

import (
	"net/url"
	"strings"
	"testing"

	"haiku-wiki/server/internal/service"
	"haiku-wiki/server/internal/storage"
)

// TestQAConvertHtmlToMarkdownStripsNonContent 脚本与样式内容不得进入正文。
//
// 注意：URL 导入走的是后端 convertHtmlToMarkdown（结构与标签级剥离）；
// 「display:none / visibility:hidden / [hidden] 等不可见元素剔除」是本地 .html 文件导入
// 的前端链路（web/src/lib/import/htmlClean.ts，由 npm run verify:import 覆盖），
// 后端转换器不做 CSS 计算——这里只断言后端该负责的范围。
func TestQAConvertHtmlToMarkdownStripsNonContent(t *testing.T) {
	const secret = "SHOULD_NOT_APPEAR_IN_MARKDOWN"
	page := `<html><head>` +
		`<title>正常标题</title>` +
		`<meta name="k" content="` + secret + `">` +
		`<style>body{color:red}/*` + secret + `*/</style>` +
		`<script>var x = "` + secret + `";</script>` +
		`<link rel="stylesheet" href="` + secret + `">` +
		`</head><body>` +
		`<h1>可见标题</h1>` +
		`<p>可见段落 <script>alert("` + secret + `")</script> 尾部。</p>` +
		`<noscript>` + secret + `</noscript>` +
		`<iframe src="http://evil/x">` + secret + `</iframe>` +
		`<object data="` + secret + `"></object>` +
		`<embed src="` + secret + `">` +
		`</body></html>`

	title, md, _ := convertHtmlToMarkdown(page, nil)
	if title != "正常标题" {
		t.Fatalf("title = %q", title)
	}
	if strings.Contains(md, secret) {
		t.Fatalf("非正文内容泄漏进 Markdown:\n%s", md)
	}
	for _, want := range []string{"# 可见标题", "可见段落"} {
		if !strings.Contains(md, want) {
			t.Fatalf("正文缺失 %q:\n%s", want, md)
		}
	}
	// 空行不得无限堆叠
	if strings.Contains(md, "\n\n\n") {
		t.Fatalf("空行未合并:\n%q", md)
	}
}

// TestQAConvertHtmlToMarkdownTitleFallback 标题优先 <title>，缺失时回退首个 h1。
func TestQAConvertHtmlToMarkdownTitleFallback(t *testing.T) {
	// 无 title → 首个 h1
	if title, _, _ := convertHtmlToMarkdown(`<html><body><h1>回退标题</h1><p>x</p></body></html>`, nil); title != "回退标题" {
		t.Fatalf("无 title 时应回退 h1, got %q", title)
	}
	// head 内的 title 优先于 h1
	if title, _, _ := convertHtmlToMarkdown(`<html><head><title>真标题</title></head><body><h1>假标题</h1></body></html>`, nil); title != "真标题" {
		t.Fatalf("应优先 head 内 title, got %q", title)
	}
	// body 里的 <title> 元素不算页标题（只有 head 下的才认）
	if title, _, _ := convertHtmlToMarkdown(`<html><body><title>伪标题</title><h1>真回退</h1></body></html>`, nil); title != "真回退" {
		t.Fatalf("body 内的 title 不应被认作页标题, got %q", title)
	}
	// 完全无标题 → 空（由调用方兜底为「网页导入」）
	if title, _, _ := convertHtmlToMarkdown(`<html><body><p>无标题页</p></body></html>`, nil); title != "" {
		t.Fatalf("无标题页应返回空标题, got %q", title)
	}
	// 首尾空白被裁剪（内部连续空白原样保留——后端 findTitle 不做折叠，
	// 与 fetch-title 的 extractTitle 行为不同，记录现状以防有人改动时被捕获）
	if title, _, _ := convertHtmlToMarkdown(`<html><head><title>  多   空白   标题  </title></head><body></body></html>`, nil); title != "多   空白   标题" {
		t.Fatalf("标题空白处理异常: %q", title)
	}
}

// TestQALocalizeImagesKeepsOriginalWhenBlocked 图片本地化失败时保留原链接，不阻断导入。
func TestQALocalizeImagesKeepsOriginalWhenBlocked(t *testing.T) {
	dir := t.TempDir()
	service.DataDir = dir
	storage.InitLocal(dir) // 上传落盘走 storage，不设会掉到 ./data 兜底目录
	t.Cleanup(func() { service.DataDir = "./data" })

	base, err := url.Parse("https://site.example.com/page")
	if err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		name string
		src  string
	}{
		{"环回地址（SSRF 黑名单）", "http://127.0.0.1/a.png"},
		{"私网地址", "http://10.0.0.5/a.png"},
		{"云元数据地址", "http://169.254.169.254/a.png"},
		{"非 http 协议", "file:///etc/passwd.png"},
		{"相对路径不解析", "./rel.png"},
		{"data URI", "data:image/png;base64,AAAA"},
	}
	for _, c := range cases {
		md := "![" + c.name + "](" + c.src + ")"
		got := localizeImages(1, base, md)
		if got != md {
			t.Fatalf("%s: 应保留原链接，got %q", c.name, got)
		}
	}
	// 正文里的普通文本不受影响
	plain := "正文文本，无图片"
	if got := localizeImages(1, base, plain); got != plain {
		t.Fatalf("无图片正文应原样返回: %q", got)
	}
}

// TestQAConvertHtmlToMarkdownImagesCollected 图片链接被收集（供本地化改写）。
func TestQAConvertHtmlToMarkdownImagesCollected(t *testing.T) {
	page := `<html><head><title>t</title></head><body>` +
		`<img src="https://img.example.com/a.png" alt="图A"/>` +
		`<p><img src="https://img.example.com/b.jpg" alt="图B"></p>` +
		`</body></html>`
	_, md, imgs := convertHtmlToMarkdown(page, nil)
	if len(imgs) != 2 {
		t.Fatalf("应收集 2 张图片, got %v", imgs)
	}
	if !strings.Contains(md, "![图A](https://img.example.com/a.png)") ||
		!strings.Contains(md, "![图B](https://img.example.com/b.jpg)") {
		t.Fatalf("Markdown 图片语法错误: %s", md)
	}
}

// TestQAImportURLHTMLToDocContent 网页 → Markdown 文档正文的落地契约（复用真实建文档链路）。
func TestQAImportURLHTMLToDocContent(t *testing.T) {
	page := `<html><head><title>海库导入页</title></head><body>` +
		`<h1>一级标题</h1><h2>二级标题</h2>` +
		`<p>段落文本，含 <strong>粗体</strong> 与 <em>斜体</em> 与 <code>行内代码</code>。</p>` +
		`<ul><li>无序一</li><li>无序二</li></ul>` +
		`<ol><li>有序一</li><li>有序二</li></ol>` +
		`<blockquote>引用内容</blockquote>` +
		`<pre>预格式化
第二行</pre>` +
		`<hr>` +
		`<p><a href="https://link.example.com">外链</a> 与 <a>无 href 链接</a></p>` +
		`</body></html>`

	title, md, _ := convertHtmlToMarkdown(page, nil)
	if title != "海库导入页" {
		t.Fatalf("title = %q", title)
	}
	wants := []string{
		"# 一级标题", "## 二级标题",
		"段落文本，含 **粗体** 与 *斜体* 与 `行内代码`",
		"- 无序一", "- 无序二",
		"1. 有序一", "2. 有序二",
		"> 引用内容",
		"```", "第二行",
		"---",
		"[外链](https://link.example.com)",
		"无 href 链接", // 无 href 的 <a> 退化为纯文本，不产出空链接
	}
	for _, w := range wants {
		if !strings.Contains(md, w) {
			t.Fatalf("Markdown 缺 %q:\n%s", w, md)
		}
	}
}
