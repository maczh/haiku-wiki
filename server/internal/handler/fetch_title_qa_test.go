package handler

// QA 独立测试（测试轮次 1）——fetch-title SSRF 防护：任务书指定黑名单逐项验证 +
// handler 层（gin context）行为验证 + extractTitle 边界。
// 说明：合法公网 URL 的放行路径依赖外部 DNS，沙箱环境不可控，
// 已由 validateFetchTarget 的 IP 字面量白名单路径 + 纯函数用例覆盖核心逻辑。

import (
	"encoding/json"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

// qaRespBody 统一响应体。
type qaRespBody struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

// callFetchTitle 构造 gin 测试上下文调用 handler，返回 (http 状态码, 业务 code)。
func callFetchTitle(t *testing.T, rawQuery string) (int, int) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	target := "/api/fetch-title"
	if rawQuery != "" {
		target += "?" + rawQuery
	}
	c.Request = httptest.NewRequest("GET", target, nil)
	FetchTitle(c)
	var body qaRespBody
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("响应非 JSON: %s", w.Body.String())
	}
	return w.Code, body.Code
}

// TestQAFetchTitleSSRFBlacklist 任务书指定的 SSRF 目标全部拒绝。
func TestQAFetchTitleSSRFBlacklist(t *testing.T) {
	rejected := []string{
		"http://127.0.0.1/",
		"http://127.0.0.1:8080/admin",
		"http://10.0.0.1/",
		"http://172.16.0.1/",
		"http://172.31.255.255/",
		"http://192.168.1.1/",
		"http://169.254.169.254/latest/meta-data/", // 云元数据
		"http://[::1]/",
		"http://[fe80::1]/",
		"http://[fc00::1234]/",
		"http://0.0.0.0/",
		"http://localhost/",
		"file:///etc/passwd",
		"ftp://example.com/file",
		"gopher://example.com:70/x",
		"javascript:alert(1)",
		"data:text/html,<h1>x</h1>",
		"http://",        // 无 host
		"not a url at all",
		"",               // 空
	}
	for _, raw := range rejected {
		if err := validateFetchTarget(raw); err == nil {
			t.Fatalf("%q 应被 SSRF 校验拒绝", raw)
		}
	}
}

// TestQAFetchTitleHandlerBehavior handler 层：非法/黑名单 URL 统一 40001，不发起请求。
func TestQAFetchTitleHandlerBehavior(t *testing.T) {
	cases := []struct {
		name     string
		rawQuery string
		wantCode int
	}{
		{"缺少 url 参数", "", 40001},
		{"空 url", "url=", 40001},
		{"file 协议", "url=" + url.QueryEscape("file:///etc/passwd"), 40001},
		{"环回 IP", "url=" + url.QueryEscape("http://127.0.0.1:9090/"), 40001},
		{"云元数据", "url=" + url.QueryEscape("http://169.254.169.254/latest/meta-data/"), 40001},
		{"ftp 协议", "url=" + url.QueryEscape("ftp://example.com/f"), 40001},
	}
	for _, tc := range cases {
		httpStatus, code := callFetchTitle(t, tc.rawQuery)
		if httpStatus != 400 || code != tc.wantCode {
			t.Fatalf("[%s] http=%d code=%d, 期望 400/%d", tc.name, httpStatus, code, tc.wantCode)
		}
	}
}

// TestQAIsForbiddenIPExtra 补充黑名单用例（IPv4-mapped IPv6、组播）。
func TestQAIsForbiddenIPExtra(t *testing.T) {
	forbidden := []string{
		"::ffff:127.0.0.1",  // IPv4-mapped 环回
		"::ffff:10.0.0.1",   // IPv4-mapped 私网
		"::ffff:192.168.1.1",
		"224.0.0.1",         // 组播
		"ff02::1",           // IPv6 组播
		"::",                // 未指定地址
	}
	for _, s := range forbidden {
		if !isForbiddenIP(parseIP(s)) {
			t.Fatalf("%s 应被拒绝", s)
		}
	}
}

// TestQAExtractTitleEdge extractTitle 边界：换行压平、属性、紧邻标签。
func TestQAExtractTitleEdge(t *testing.T) {
	cases := []struct{ in, want string }{
		{"<title>第一行\n第二行</title>", "第一行 第二行"},
		{"<title   >纯空白属性</title>", "纯空白属性"},
		{"<title>a</title><title>b</title>", "a"}, // 非贪婪取第一个
		{"<html><head><title>X &amp; Y</title></head></html>", "X &amp; Y"}, // 实体不解码（前端降级可接受）
	}
	for _, c := range cases {
		if got := extractTitle(c.in); got != c.want {
			t.Fatalf("extractTitle(%q) = %q, want %q", c.in, got, c.want)
		}
	}
	// 256 截断按 rune 计（中文不截半字符）
	long := strings.Repeat("标", 300)
	got := extractTitle("<title>" + long + "</title>")
	if got[len(got)-3:] != string([]rune("标")) {
		t.Fatalf("截断应按 rune 边界: %q", got[len(got)-10:])
	}
	if len([]rune(got)) != 256 {
		t.Fatalf("应截断到 256 rune, got %d", len([]rune(got)))
	}
}
