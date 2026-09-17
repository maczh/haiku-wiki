package handler

import (
	"crypto/tls"
	"io"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"haiku-wiki/server/internal/pkg"
)

// ---------- SSRF 四重防护（全标准库，见架构文档 §3.4） ----------

// titleRe 提取 <title>…</title>（忽略大小写，容忍属性）。
var titleRe = regexp.MustCompile(`(?is)<title[^>]*>(.*?)</title>`)

// isForbiddenIP 校验 IP 是否为私网/环回/链路本地/未指定地址（SSRF 黑名单）。
// 覆盖：10/8、172.16/12、192.168/16、127/8、169.254/16、0.0.0.0、::1、fc00::/7、fe80::/10。
func isForbiddenIP(ip net.IP) bool {
	if ip == nil {
		return true
	}
	return ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() ||
		ip.IsLinkLocalMulticast() || ip.IsUnspecified() || ip.IsMulticast()
}

// validateFetchTarget 解析并校验 URL：仅 http/https、必须有 host、解析后的 IP 均不得落在黑名单网段。
func validateFetchTarget(rawURL string) error {
	u, err := url.Parse(rawURL)
	if err != nil || u.Host == "" {
		return resp.New(40001, 400, "无法获取网页标题")
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return resp.New(40001, 400, "无法获取网页标题")
	}
	host := u.Hostname()
	if host == "" {
		return resp.New(40001, 400, "无法获取网页标题")
	}
	ips, err := net.LookupIP(host)
	if err != nil || len(ips) == 0 {
		return resp.New(40001, 400, "无法获取网页标题")
	}
	for _, ip := range ips {
		if isForbiddenIP(ip) {
			return resp.New(40001, 400, "无法获取网页标题")
		}
	}
	return nil
}

// fetchTitleClient 构造 5s 超时、跟随重定向且每跳重新校验目标 IP 的 HTTP 客户端。
func fetchTitleClient() *http.Client {
	return &http.Client{
		Timeout: 5 * time.Second,
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{MinVersion: tls.VersionTLS12},
		},
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 10 {
				return resp.New(40001, 400, "无法获取网页标题")
			}
			if err := validateFetchTarget(req.URL.String()); err != nil {
				return err
			}
			return nil
		},
	}
}

// extractTitle 从 HTML 文本中提取 <title>（去空白、截断 256 字符）。
func extractTitle(body string) string {
	m := titleRe.FindStringSubmatch(body)
	if len(m) < 2 {
		return ""
	}
	t := strings.Join(strings.Fields(m[1]), " ")
	runes := []rune(t)
	if len(runes) > 256 {
		runes = runes[:256]
	}
	return string(runes)
}

// FetchTitle GET /api/fetch-title?url= —— 后端代理拉取网页标题（JWT）。
func FetchTitle(c *gin.Context) {
	rawURL := strings.TrimSpace(c.Query("url"))
	if rawURL == "" {
		resp.Error(c, resp.New(40001, 400, "无法获取网页标题"))
		return
	}
	if err := validateFetchTarget(rawURL); err != nil {
		resp.Error(c, err)
		return
	}
	client := fetchTitleClient()
	req, err := http.NewRequest(http.MethodGet, rawURL, nil)
	if err != nil {
		resp.Error(c, resp.New(40001, 400, "无法获取网页标题"))
		return
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (compatible; haiku-wiki-fetch-title/1.0)")
	httpResp, err := client.Do(req)
	if err != nil {
		resp.Error(c, resp.New(40001, 400, "无法获取网页标题"))
		return
	}
	defer httpResp.Body.Close()
	// 响应体限 1MB，防大响应拖垮内存
	body, err := io.ReadAll(io.LimitReader(httpResp.Body, 1<<20))
	if err != nil && len(body) == 0 {
		resp.Error(c, resp.New(40001, 400, "无法获取网页标题"))
		return
	}
	title := extractTitle(string(body))
	if title == "" {
		resp.Error(c, resp.New(40001, 400, "无法获取网页标题"))
		return
	}
	resp.OK(c, gin.H{"title": title})
}
