package netdisk

import (
	"errors"
	"testing"

	hkerr "haiku-wiki/server/internal/pkg"
)

// codeOf 取错误上的业务码；不是 AppError 时返回 -1。
func codeOf(err error) int {
	var ae *hkerr.AppError
	if errors.As(err, &ae) {
		return ae.Code
	}
	return -1
}

// TestErrorCodeConstants 错误码段 42xxx 与设计文档 §8.4 逐字对齐。
func TestErrorCodeConstants(t *testing.T) {
	want := map[string]int{
		"config":  42001,
		"connect": 42002,
		"auth":    42003,
		"path":    42004,
		"exists":  42005,
		"kind":    42006,
		"limit":   42007,
		"unsup":   42008,
		"reauth":  42009,
		"rate":    42010,
		"task":    42011,
		"token":   42012,
	}
	got := map[string]int{
		"config":  CodeConfigInvalid,
		"connect": CodeConnectFailed,
		"auth":    CodeAuthFailed,
		"path":    CodePathNotFound,
		"exists":  CodeAlreadyExists,
		"kind":    CodeKindDisabled,
		"limit":   CodeLimitExceeded,
		"unsup":   CodeUnsupported,
		"reauth":  CodeReauthRequired,
		"rate":    CodeRateLimited,
		"task":    CodeTaskInvalid,
		"token":   CodePreviewTokenBad,
	}
	for k, v := range want {
		if got[k] != v {
			t.Fatalf("错误码 %s = %d, want %d", k, got[k], v)
		}
	}
}

// TestMapBaiduError 百度网盘错误码 → 可读中文。
func TestMapBaiduError(t *testing.T) {
	cases := []struct {
		errno int
		code  int
		sub   string
	}{
		{20011, CodeRateLimited, "用户数"},
		{20012, CodeRateLimited, "频率"},
		{20013, CodeAuthFailed, "无权限"},
		{31066, CodePathNotFound, "不存在"},
		{111, CodeReauthRequired, "重新授权"},
	}
	for _, c := range cases {
		err := MapBaiduError(c.errno, "")
		if err == nil {
			t.Fatalf("errno=%d 应返回错误", c.errno)
		}
		if codeOf(err) != c.code {
			t.Fatalf("errno=%d 映射码 = %d, want %d（%v）", c.errno, codeOf(err), c.code, err)
		}
		var ae *hkerr.AppError
		if !errors.As(err, &ae) || !containsAny(ae.Message, c.sub) {
			t.Fatalf("errno=%d 文案应含 %q，实际 %q", c.errno, c.sub, ae.Message)
		}
	}
	if err := MapBaiduError(0, ""); err != nil {
		t.Fatal("errno=0 表示成功，不应返回错误")
	}
}

// TestMapAliyunError 阿里云盘 HTTP 状态 → 可读中文（403 = 下载并发超限）。
func TestMapAliyunError(t *testing.T) {
	err := MapAliyunError(403, "", "")
	if codeOf(err) != CodeRateLimited {
		t.Fatalf("阿里云盘 403 应映射为 42010，实际 %d", codeOf(err))
	}
	var ae *hkerr.AppError
	errors.As(err, &ae)
	if !containsAny(ae.Message, "并发") {
		t.Fatalf("阿里云盘 403 文案应含「并发」，实际 %q", ae.Message)
	}
	if codeOf(MapAliyunError(404, "", "")) != CodePathNotFound {
		t.Fatal("404 应映射为 42004")
	}
	if codeOf(MapAliyunError(401, "", "")) != CodeRateLimited {
		t.Fatal("401（token 失效）按 403 同路径处理为 42010")
	}
	if codeOf(MapAliyunError(403, "PermissionDenied", "")) != CodeAuthFailed {
		t.Fatal("403 + PermissionDenied 应映射为 42003")
	}
	if codeOf(MapAliyunError(500, "", "boom")) != CodeConnectFailed {
		t.Fatal("5xx 应映射为 42002")
	}
}

// TestMapErrorClassifies 原始错误的保守归类。
func TestMapErrorClassifies(t *testing.T) {
	cases := []struct {
		msg  string
		code int
	}{
		{"dial tcp 10.0.0.1:445: connect: connection refused", CodeConnectFailed},
		{"context deadline exceeded", CodeConnectFailed},
		{"530 Please login with USER and PASS", CodeAuthFailed},
		{"550 No such file or directory", CodePathNotFound},
		{"file already exists", CodeAlreadyExists},
		{"something weird", CodeConnectFailed}, // 兜底
	}
	for _, c := range cases {
		err := MapError(errors.New(c.msg))
		if codeOf(err) != c.code {
			t.Fatalf("MapError(%q) = %d, want %d", c.msg, codeOf(err), c.code)
		}
	}
	// 已带业务码的错误原样返回，不被二次包装
	orig := LimitExceeded("文件过大")
	if codeOf(MapError(orig)) != CodeLimitExceeded {
		t.Fatal("MapError 不应改写已有业务码")
	}
	if MapError(nil) != nil {
		t.Fatal("MapError(nil) 应为 nil")
	}
}

// TestUnsupportedAndFTPActive 不支持的操作：kind 分派与 FTP 主动模式。
func TestUnsupportedAndFTPActive(t *testing.T) {
	if _, err := New("nonexistent", Config{}, nil); codeOf(err) != CodeUnsupported {
		t.Fatalf("未知 kind 应返回 42008，实际 %v", err)
	}
	if _, ok := ProviderOf(KindQuark); !ok {
		t.Fatal("quark 应在 providers 清单里（置灰也要能被渲染）")
	}
	p, _ := ProviderOf(KindQuark)
	if p.Available {
		t.Fatal("quark 恒不可用")
	}
	if p.DisabledReason == "" {
		t.Fatal("quark 必须给出置灰原因")
	}
	e := ErrFTPActiveMode()
	if codeOf(e) != CodeUnsupported {
		t.Fatalf("FTP 主动模式应返回 42008，实际 %v", e)
	}
}

// TestIsKindCreatable 可创建的 kind（quark 永不入库）。
func TestIsKindCreatable(t *testing.T) {
	for _, k := range Kinds {
		if !IsKindCreatable(k) {
			t.Fatalf("%s 应可创建", k)
		}
	}
	for _, k := range []string{KindQuark, "", "unknown"} {
		if IsKindCreatable(k) {
			t.Fatalf("%q 不应可创建", k)
		}
	}
}
