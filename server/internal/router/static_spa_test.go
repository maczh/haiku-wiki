package router

import (
	"io/fs"
	"testing"
	"testing/fstest"
)

// 静态资源托管的路径归一化回归。
//
// 背景（真实缺陷，2026-09-18 生产形态复验抓到）：
// 托管层先用 fs.Stat 判断「是不是静态资源」，失败则回退到 SPA 的 index.html。
// 但 fs.ValidPath 不接受尾随斜杠，fs.Stat(fsys, "drawio/") 返回的是
// `invalid argument` 而不是「不存在」—— 于是 /drawio/ 这类**目录型请求**
// 被当成不存在的静态资源，回退成应用自身的 index.html。
// 表现：内嵌 draw.io 的 iframe 拿到的是寄海文库的 HTML，绘图组件整个失效。
// Vite dev server 由自己的静态中间件服务，不复现该问题，所以只能在
// embed 形态（或对 URL 与 FS 的交互做单测）下发现。

// TestStaticProbePathNormalization 覆盖 URL → embed FS 路径的转换。
func TestStaticProbePathNormalization(t *testing.T) {
	cases := []struct {
		urlPath string
		want    string
	}{
		{"/", "index.html"},
		{"", "index.html"},
		// 目录型请求必须补 index.html（本次修复的核心）
		{"/drawio/", "drawio/index.html"},
		{"/drawio/js/", "drawio/js/index.html"},
		{"/vditor/dist/", "vditor/dist/index.html"},
		// 普通文件与无斜杠目录保持原样
		{"/drawio", "drawio"},
		{"/drawio/index.html", "drawio/index.html"},
		{"/assets/index-abc123.js", "assets/index-abc123.js"},
		// SPA 路由：本来就不存在，交给兜底
		{"/books/1", "books/1"},
	}
	for _, c := range cases {
		if got := staticProbePath(c.urlPath); got != c.want {
			t.Errorf("staticProbePath(%q) = %q，期望 %q", c.urlPath, got, c.want)
		}
	}
}

// TestStaticProbePathKeepsStatUsable 是本缺陷的核心不变量：
// 归一化后的路径必须能被 fs.Stat 真正接受（而不是返回 invalid argument），
// 否则「存在性判断」本身就失效了 —— 加了这个断言，将来谁再把尾随斜杠漏掉都会红。
func TestStaticProbePathKeepsStatUsable(t *testing.T) {
	fsys := fstest.MapFS{
		"index.html":             {Data: []byte("<html>spa</html>")},
		"drawio/index.html":      {Data: []byte("<html>drawio</html>")},
		"assets/index-a.js":      {Data: []byte("//entry")},
		"vditor/dist/index.html": {Data: []byte("<html>vditor</html>")},
	}
	for _, urlPath := range []string{
		"/", "/drawio/", "/drawio", "/drawio/index.html", "/assets/index-a.js", "/vditor/dist/",
	} {
		p := staticProbePath(urlPath)
		if !fs.ValidPath(p) {
			t.Errorf("%q 归一化后为 %q，不是 io/fs 合法路径", urlPath, p)
			continue
		}
		if _, err := fs.Stat(fsys, p); err != nil {
			t.Errorf("fs.Stat(%q) 失败：%v（归一化未生效，会被 SPA 兜底吞掉）", p, err)
		}
	}
}

// TestStaticProbePathStillFallsBack 确认修复没有把兜底关掉：
// 真正的 SPA 路由（embed 里不存在）依然要能被识别为「不存在」。
func TestStaticProbePathStillFallsBack(t *testing.T) {
	fsys := fstest.MapFS{"index.html": {Data: []byte("spa")}}
	for _, urlPath := range []string{"/books/1", "/share/abc", "/login"} {
		if _, err := fs.Stat(fsys, staticProbePath(urlPath)); err == nil {
			t.Errorf("%q 被误判为已存在的静态资源，SPA 兜底会失效", urlPath)
		}
	}
}
