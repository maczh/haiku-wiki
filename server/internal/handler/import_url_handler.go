package handler

import (
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"

	"github.com/gin-gonic/gin"
	"golang.org/x/net/html"

	"haiku-wiki/server/internal/middleware"
	"haiku-wiki/server/internal/pkg"
	"haiku-wiki/server/internal/repository"
	"haiku-wiki/server/internal/service"
)

// ImportURL POST /api/import/url —— 抓取网页并转为 Markdown 文档落入目标知识库（JWT）。
// 全程复用 fetch-title 的 SSRF 四重防护：仅 http(s)、解析 IP 黑名单校验、5s 超时、
// 重定向每跳重校验、1MB 正文上限；图片下载同样做 IP 校验 + 超时 + 20MB 上限。
func ImportURL(c *gin.Context) {
	var in struct {
		URL      string `json:"url" binding:"required"`
		BookID   uint64 `json:"book_id" binding:"required"`
		ParentID uint64 `json:"parent_id"` // 可选：导入到指定目录（文档）下，默认 0=根目录
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		resp.Error(c, paramErr(err))
		return
	}
	uid := middleware.UID(c)

	book, err := repository.FindBookByID(in.BookID)
	if err != nil {
		resp.Error(c, resp.NotFound("知识库不存在"))
		return
	}
	if !service.CanWriteBook(book, uid) {
		resp.Error(c, resp.Forbidden())
		return
	}

	raw := strings.TrimSpace(in.URL)
	if err := validateFetchTarget(raw); err != nil { // SSRF：IP/协议黑名单校验
		resp.Error(c, err)
		return
	}
	client := fetchTitleClient()
	req, err := http.NewRequest(http.MethodGet, raw, nil)
	if err != nil {
		resp.Error(c, resp.Param("URL 无效"))
		return
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (compatible; haiku-wiki-import/1.0)")
	httpResp, err := client.Do(req)
	if err != nil {
		resp.Error(c, resp.Param("抓取网页失败，请检查链接是否可访问"))
		return
	}
	defer httpResp.Body.Close()
	if httpResp.StatusCode != http.StatusOK {
		resp.Error(c, resp.Param("网页返回异常状态，无法导入"))
		return
	}
	if ct := strings.ToLower(httpResp.Header.Get("Content-Type")); !strings.Contains(ct, "text/html") {
		resp.Error(c, resp.Param("仅支持抓取 HTML 网页（Content-Type 需为 text/html）"))
		return
	}
	body, err := io.ReadAll(io.LimitReader(httpResp.Body, 1<<20))
	if err != nil || len(body) == 0 {
		resp.Error(c, resp.Param("抓取网页失败或内容为空"))
		return
	}

	base := httpResp.Request.URL
	title, markdown, _ := convertHtmlToMarkdown(string(body), base)
	// 图片本地化（失败不阻断，保留原链接）
	markdown = localizeImages(uid, base, markdown)

	if title == "" {
		title = "网页导入"
	}
	doc, err := docService.CreateDocWithContent(book, uid, in.ParentID, title, "markdown", markdown)
	if err != nil {
		resp.Error(c, err)
		return
	}
	resp.OK(c, gin.H{"doc_id": doc.ID, "title": doc.Title})
}

// ---------- HTML → Markdown（best-effort，附带 SSRF 安全的图片收集） ----------

type mdBuilder struct {
	sb        *strings.Builder
	base      *url.URL
	images    []string
	needBlank bool
}

func convertHtmlToMarkdown(body string, base *url.URL) (title, markdown string, images []string) {
	doc, err := html.Parse(strings.NewReader(body))
	if err != nil {
		return "", strings.TrimSpace(stripTags(body)), nil
	}
	title = findTitle(doc)
	b := &mdBuilder{sb: &strings.Builder{}, base: base}
	b.walk(doc)
	md := strings.TrimSpace(renderClean(b.sb.String()))
	return strings.TrimSpace(title), md, b.images
}

func (b *mdBuilder) walk(n *html.Node) {
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		b.render(c)
	}
}

func (b *mdBuilder) blank() {
	if b.needBlank {
		b.sb.WriteString("\n\n")
	}
	b.needBlank = false
}

func (b *mdBuilder) render(n *html.Node) {
	switch n.Type {
	case html.TextNode:
		b.sb.WriteString(html.UnescapeString(n.Data))
	case html.ElementNode:
		switch n.Data {
		case "script", "style", "head", "noscript", "iframe", "object", "embed", "meta", "link":
			return
		case "h1", "h2", "h3", "h4", "h5", "h6":
			b.blank()
			level := int(n.Data[1] - '0')
			b.sb.WriteString(strings.Repeat("#", level) + " ")
			b.inline(n)
			b.sb.WriteString("\n")
			b.needBlank = true
		case "p", "div":
			b.blank()
			b.inline(n)
			b.sb.WriteString("\n")
			b.needBlank = true
		case "br":
			b.sb.WriteString("\n")
		case "hr":
			b.blank()
			b.sb.WriteString("---\n")
			b.needBlank = true
		case "blockquote":
			b.blank()
			var inner strings.Builder
			tmp := &mdBuilder{sb: &inner, base: b.base}
			tmp.inline(n)
			for _, line := range strings.Split(strings.TrimSpace(inner.String()), "\n") {
				if line == "" {
					continue
				}
				b.sb.WriteString("> " + line + "\n")
			}
			b.needBlank = true
		case "ul", "ol":
			b.blank()
			marker := "- "
			if n.Data == "ol" {
				marker = ""
			}
			b.renderList(n, marker)
			b.needBlank = true
		case "pre":
			b.blank()
			b.sb.WriteString("```\n" + strings.TrimRight(textContent(n), "\n") + "\n```\n")
			b.needBlank = true
		case "img":
			src := attr(n, "src")
			alt := attr(n, "alt")
			if src != "" {
				b.images = append(b.images, src)
				b.sb.WriteString("![" + alt + "](" + src + ")")
			}
		default:
			// 未知容器元素（html/body/span/table 等）继续向下递归，保留结构。
			b.walk(n)
		}
	}
}

// inline 内联渲染（文本 + a/img/strong/em/code/br），用于段落与标题内部。
func (b *mdBuilder) inline(n *html.Node) {
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		switch c.Type {
		case html.TextNode:
			b.sb.WriteString(html.UnescapeString(c.Data))
		case html.ElementNode:
			switch c.Data {
			case "script", "style", "head", "noscript", "iframe", "object", "embed", "meta", "link":
				continue
			case "a":
				txt := textContent(c)
				href := attr(c, "href")
				if href == "" {
					b.sb.WriteString(txt)
					break
				}
				b.sb.WriteString("[" + txt + "](" + href + ")")
			case "img":
				src := attr(c, "src")
				alt := attr(c, "alt")
				if src != "" {
					b.images = append(b.images, src)
					b.sb.WriteString("![" + alt + "](" + src + ")")
				}
			case "strong", "b":
				b.sb.WriteString("**" + textContent(c) + "**")
			case "em", "i":
				b.sb.WriteString("*" + textContent(c) + "*")
			case "code":
				b.sb.WriteString("`" + textContent(c) + "`")
			case "br":
				b.sb.WriteString("\n")
			default:
				b.sb.WriteString(textContent(c))
			}
		}
	}
}

// renderList 渲染 ul/ol 为 Markdown 列表；嵌套列表缩进两格。
func (b *mdBuilder) renderList(n *html.Node, marker string) {
	idx := 1
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		if c.Type != html.ElementNode || c.Data != "li" {
			continue
		}
		label := marker
		if label == "" {
			label = itoa(idx) + ". "
			idx++
		}
		b.sb.WriteString(label)
		// li 内部直接内容（文本/内联元素），并收集嵌套列表单独渲染
		var nested []*html.Node
		for ch := c.FirstChild; ch != nil; ch = ch.NextSibling {
			if ch.Type == html.ElementNode && (ch.Data == "ul" || ch.Data == "ol") {
				nested = append(nested, ch)
				continue
			}
			if ch.Type == html.TextNode {
				b.sb.WriteString(html.UnescapeString(ch.Data))
				continue
			}
			if ch.Type == html.ElementNode {
				b.inline(ch)
			}
		}
		b.sb.WriteString("\n")
		for _, nl := range nested {
			sub := &mdBuilder{sb: &strings.Builder{}, base: b.base}
			m := "- "
			if nl.Data == "ol" {
				m = ""
			}
			sub.renderList(nl, m)
			for _, l := range strings.Split(strings.TrimRight(sub.sb.String(), "\n"), "\n") {
				if l == "" {
					continue
				}
				b.sb.WriteString("  " + l + "\n")
			}
		}
	}
}

func findTitle(n *html.Node) string {
	var title string
	var rec func(*html.Node)
	rec = func(node *html.Node) {
		if title != "" {
			return
		}
		if node.Type == html.ElementNode && node.Data == "title" && node.Parent != nil && node.Parent.Data == "head" {
			title = strings.TrimSpace(html.UnescapeString(textContent(node)))
			return
		}
		for c := node.FirstChild; c != nil; c = c.NextSibling {
			rec(c)
		}
	}
	rec(n)
	if title == "" {
		// 退化为首个 h1
		var rec2 func(*html.Node)
		rec2 = func(node *html.Node) {
			if title != "" {
				return
			}
			if node.Type == html.ElementNode && node.Data == "h1" {
				title = strings.TrimSpace(html.UnescapeString(textContent(node)))
				return
			}
			for c := node.FirstChild; c != nil; c = c.NextSibling {
				rec2(c)
			}
		}
		rec2(n)
	}
	return title
}

func textContent(n *html.Node) string {
	if n.Type == html.TextNode {
		return html.UnescapeString(n.Data)
	}
	var sb strings.Builder
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		sb.WriteString(textContent(c))
	}
	return sb.String()
}

func attr(n *html.Node, key string) string {
	for _, a := range n.Attr {
		if a.Key == key {
			return a.Val
		}
	}
	return ""
}

func stripTags(s string) string {
	// 简易去标签（fallback），不追求完美。
	var b strings.Builder
	inTag := false
	for _, r := range s {
		switch {
		case r == '<':
			inTag = true
		case r == '>':
			inTag = false
		case !inTag:
			b.WriteRune(r)
		}
	}
	return b.String()
}

func renderClean(s string) string {
	// 合并多余空行（>2 个换行 → 2 个）
	for strings.Contains(s, "\n\n\n") {
		s = strings.ReplaceAll(s, "\n\n\n", "\n\n")
	}
	return s
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	return string(buf[i:])
}

// ---------- 图片本地化（复用 SSRF 防护） ----------

var imgRe = regexp.MustCompile(`!\[([^\]]*)\]\(([^)\s]+)\)`)

// localizeImages 把 Markdown 中的远程图片下载到 uploads 并改写为 /uploads/... 链接。
// 失败（SSRF 拦截 / 超时 / 非图片 / 限流）时保留原链接，不阻断导入。
func localizeImages(uid uint64, base *url.URL, md string) string {
	return imgRe.ReplaceAllStringFunc(md, func(m string) string {
		parts := imgRe.FindStringSubmatch(m)
		if len(parts) < 3 {
			return m
		}
		alt, src := parts[1], strings.TrimSpace(parts[2])
		if !strings.HasPrefix(src, "http://") && !strings.HasPrefix(src, "https://") {
			return m
		}
		u, err := url.Parse(src)
		if err != nil {
			return m
		}
		abs := base.ResolveReference(u)
		// SSRF 防护：复用 fetch-title 的 IP/协议黑名单校验
		if err := validateFetchTarget(abs.String()); err != nil {
			return m
		}
		client := fetchTitleClient()
		req, err := http.NewRequest(http.MethodGet, abs.String(), nil)
		if err != nil {
			return m
		}
		req.Header.Set("User-Agent", "Mozilla/5.0 (compatible; haiku-wiki-import/1.0)")
		resp2, err := client.Do(req)
		if err != nil {
			return m
		}
		defer resp2.Body.Close()
		if resp2.StatusCode != http.StatusOK {
			return m
		}
		ct := resp2.Header.Get("Content-Type")
		if !strings.HasPrefix(strings.ToLower(ct), "image/") {
			return m
		}
		data, err := io.ReadAll(io.LimitReader(resp2.Body, 20<<20))
		if err != nil || len(data) == 0 {
			return m
		}
		filename := "image" + extFromContentType(ct)
		out, err := uploadService.SaveBytes(uid, filename, data)
		if err != nil {
			return m
		}
		return "![" + alt + "](" + out.URL + ")"
	})
}

func extFromContentType(ct string) string {
	switch {
	case strings.Contains(ct, "png"):
		return ".png"
	case strings.Contains(ct, "jpeg"), strings.Contains(ct, "jpg"):
		return ".jpg"
	case strings.Contains(ct, "gif"):
		return ".gif"
	case strings.Contains(ct, "webp"):
		return ".webp"
	case strings.Contains(ct, "svg"):
		return ".svg"
	case strings.Contains(ct, "bmp"):
		return ".bmp"
	default:
		return ".img"
	}
}
