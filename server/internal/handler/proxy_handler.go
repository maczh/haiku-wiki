package handler

import (
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"haiku-wiki/server/internal/pkg"
)

// proxyClient 在线调试专用 HTTP 客户端：复用 fetch-title 的 SSRF 防护思路，
// 仅允许 http/https、目标 IP 不得为私网/环回/链路本地、跟随重定向时每跳重校验。
// 较 fetch-title 放宽：超时 20s、响应体上限 10MB（接口返回可能较大）。
func proxyClient() *http.Client {
	return &http.Client{
		Timeout: 20 * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 10 {
				return resp.New(40001, 400, "重定向次数过多")
			}
			if err := validateFetchTarget(req.URL.String()); err != nil {
				return err
			}
			return nil
		},
	}
}

// ProxyRequest POST /api/proxy —— 接口文档「在线调试」用服务端代理转发 HTTP 请求。
//
// 浏览器受 CORS 限制无法直接调用第三方接口，故由服务端转发；全程 SSRF 防护，
// 禁止访问私网/环回/链路本地地址（含云元数据 169.254.169.254）。
// 入参：{ method, url, headers(map), body }；返回 { status, status_text, duration_ms, headers, body }。
func ProxyRequest(c *gin.Context) {
	var in struct {
		Method  string            `json:"method"`
		URL     string            `json:"url"`
		Headers map[string]string `json:"headers"`
		Body    string            `json:"body"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		resp.Error(c, paramErr(err))
		return
	}
	raw := strings.TrimSpace(in.URL)
	if raw == "" {
		resp.Error(c, resp.Param("请求 URL 不能为空"))
		return
	}
	method := strings.ToUpper(strings.TrimSpace(in.Method))
	if method == "" {
		method = http.MethodGet
	}
	switch method {
	case http.MethodGet, http.MethodPost, http.MethodPut, http.MethodDelete, http.MethodPatch, http.MethodHead, http.MethodOptions:
	default:
		resp.Error(c, resp.Param("不支持的请求方法："+method))
		return
	}
	// SSRF 防护：解析并校验目标（协议/主机/解析 IP 黑名单）
	if err := validateFetchTarget(raw); err != nil {
		resp.Error(c, err)
		return
	}

	var bodyReader io.Reader
	if in.Body != "" && method != http.MethodGet && method != http.MethodHead {
		bodyReader = strings.NewReader(in.Body)
	}
	req, err := http.NewRequest(method, raw, bodyReader)
	if err != nil {
		resp.Error(c, resp.Param("请求 URL 无效"))
		return
	}
	req.Header.Set("User-Agent", "haiku-wiki-api-debug/1.0")
	// 透传用户自定义请求头（跳过非法键）
	for k, v := range in.Headers {
		if k == "" || strings.EqualFold(k, "Host") {
			continue
		}
		req.Header.Set(k, v)
	}

	start := time.Now()
	httpResp, err := proxyClient().Do(req)
	if err != nil {
		resp.Error(c, resp.Param("请求失败："+err.Error()))
		return
	}
	defer httpResp.Body.Close()
	respBody, err := io.ReadAll(io.LimitReader(httpResp.Body, 10<<20))
	if err != nil {
		resp.Error(c, resp.Param("读取响应失败"))
		return
	}
	duration := time.Since(start)

	headers := make(map[string]string, len(httpResp.Header))
	for k, vs := range httpResp.Header {
		headers[strings.ToLower(k)] = strings.Join(vs, ", ")
	}

	resp.OK(c, gin.H{
		"status":      httpResp.StatusCode,
		"status_text": http.StatusText(httpResp.StatusCode),
		"duration_ms": duration.Milliseconds(),
		"headers":     headers,
		"body":        string(respBody),
	})
}
