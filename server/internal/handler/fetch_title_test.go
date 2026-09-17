package handler

import (
	"net"
	"testing"
)

// parseIP 测试辅助：字符串转 net.IP（非法输入返回 nil，视为应被拒绝）。
func parseIP(s string) net.IP { return net.ParseIP(s) }

// ---------- fetch-title SSRF 防护（I08 / I10，纯函数用例不发网络请求） ----------

func TestIsForbiddenIP(t *testing.T) {
	forbidden := []string{
		"127.0.0.1", "127.8.8.8", // 环回
		"10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", // 私网
		"169.254.1.1",        // 链路本地
		"0.0.0.0",            // 未指定
		"::1",                // IPv6 环回
		"fc00::1", "fd12::5", // fc00::/7（IsPrivate）
		"fe80::1", // fe80::/10
	}
	for _, s := range forbidden {
		if !isForbiddenIP(parseIP(s)) {
			t.Fatalf("%s 应被拒绝", s)
		}
	}
	allowed := []string{
		"8.8.8.8", "1.1.1.1", "114.114.114.114",
		"2606:4700::1111",
	}
	for _, s := range allowed {
		if isForbiddenIP(parseIP(s)) {
			t.Fatalf("%s 不应被拒绝", s)
		}
	}
}

func TestValidateFetchTarget(t *testing.T) {
	// 非 http/https 协议拒绝
	for _, raw := range []string{
		"ftp://example.com/file",
		"file:///etc/passwd",
		"gopher://127.0.0.1:70",
		"javascript:alert(1)",
		"mailto:a@b.com",
		"",                       // 空
		"http://",                // 无 host
		"http://localhost/x",     // 环回域名
		"http://127.0.0.1/x",     // 环回 IP
		"http://[::1]/x",         // IPv6 环回
		"http://10.0.0.5/x",      // 私网
		"http://192.168.31.88/x", // 私网
		"http://172.20.1.1/x",    // 私网
		"http://169.254.169.254/latest/meta-data", // 云厂商元数据
	} {
		if err := validateFetchTarget(raw); err == nil {
			t.Fatalf("%q 应被 SSRF 校验拒绝", raw)
		}
	}
	// 公网域名（DNS 可用则通过；DNS 不可用时 err 属网络环境问题，跳过而非失败）
	if err := validateFetchTarget("https://example.com/"); err != nil {
		t.Skipf("公网域名解析不可用（离线环境）: %v", err)
	}
}

func TestExtractTitle(t *testing.T) {
	cases := []struct{ in, want string }{
		{"<html><head><title>Hello World</title></head></html>", "Hello World"},
		{"<title>  多   空格  标题 </title>", "多 空格 标题"},
		{"<TITLE id=\"t\">大小写</TITLE>", "大小写"},
		{"<title>前后<title>嵌套取第一个</title>", "前后<title>嵌套取第一个"}, // 正则贪婪边界可接受
	}
	for _, c := range cases {
		if got := extractTitle(c.in); got != c.want {
			t.Fatalf("extractTitle(%q) = %q, want %q", c.in, got, c.want)
		}
	}
	if got := extractTitle("<html><body>无标题</body></html>"); got != "" {
		t.Fatalf("无 title 应返回空串, got %q", got)
	}
	// 256 字符截断
	long := make([]rune, 300)
	for i := range long {
		long[i] = '长'
	}
	if got := len([]rune(extractTitle("<title>" + string(long) + "</title>"))); got != 256 {
		t.Fatalf("标题应截断到 256, got %d", got)
	}
}
