package netdisk

import "testing"

// TestCleanPath 路径规范化：根、尾斜杠、相对路径、多斜杠。
func TestCleanPath(t *testing.T) {
	cases := []struct {
		in   string
		want string
	}{
		{"", "/"},
		{"/", "/"},
		{".", "/"},
		{"a", "/a"},
		{"/a/b", "/a/b"},
		{"/a/b/", "/a/b"},
		{"a/b/", "/a/b"},
		{"//a//b//", "/a/b"},
		{"/a/./b", "/a/b"},
		{"/2026/设计稿/a.pdf", "/2026/设计稿/a.pdf"},
		{"\\a\\b", "/a/b"},
	}
	for _, c := range cases {
		got, err := CleanPath(c.in)
		if err != nil {
			t.Fatalf("CleanPath(%q) 报错: %v", c.in, err)
		}
		if got != c.want {
			t.Fatalf("CleanPath(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

// TestCleanPathRejectsTraversal 路径穿越必须被拒绝（不能静默清洗成合法路径）。
func TestCleanPathRejectsTraversal(t *testing.T) {
	bad := []string{
		"/a/../../etc",
		"/../etc/passwd",
		"/a/b/..",
		"../secret",
		"..",
		"/a/..",
	}
	for _, in := range bad {
		if _, err := CleanPath(in); err == nil {
			t.Fatalf("CleanPath(%q) 应拒绝路径穿越，却返回了成功", in)
		}
	}
	// 名字里含 ".." 但不是独立段，属于正常文件名，不能被误判
	if got, err := CleanPath("/a/..foo/b"); err != nil || got != "/a/..foo/b" {
		t.Fatalf("CleanPath(\"/a/..foo/b\") = %q, %v", got, err)
	}
	if got, err := CleanPath("/a/b..c"); err != nil || got != "/a/b..c" {
		t.Fatalf("CleanPath(\"/a/b..c\") = %q, %v", got, err)
	}
}

// TestJoin 目录 + 名称拼接（名称含分隔符必须被拒）。
func TestJoin(t *testing.T) {
	if got, err := Join("/", "a"); err != nil || got != "/a" {
		t.Fatalf("Join(\"/\", \"a\") = %q, %v", got, err)
	}
	if got, err := Join("/a/b", "c.pdf"); err != nil || got != "/a/b/c.pdf" {
		t.Fatalf("Join(\"/a/b\", \"c.pdf\") = %q, %v", got, err)
	}
	for _, name := range []string{"", "a/b", "a\\b", ".", "..", "  "} {
		if _, err := Join("/a", name); err == nil {
			t.Fatalf("Join(\"/a\", %q) 应被拒绝", name)
		}
	}
}

// TestBaseNameParent 末段与父目录。
func TestBaseNameParent(t *testing.T) {
	if got := BaseName("/a/b/c.pdf"); got != "c.pdf" {
		t.Fatalf("BaseName = %q", got)
	}
	if got := BaseName("/"); got != "" {
		t.Fatalf("根节点 BaseName = %q, want \"\"", got)
	}
	if got := BaseName("/a"); got != "a" {
		t.Fatalf("BaseName(/a) = %q", got)
	}
	if got := Parent("/a/b/c"); got != "/a/b" {
		t.Fatalf("Parent(/a/b/c) = %q", got)
	}
	if got := Parent("/a"); got != "/" {
		t.Fatalf("Parent(/a) = %q", got)
	}
	if got := Parent("/"); got != "/" {
		t.Fatalf("Parent(/) = %q", got)
	}
	if !IsRoot("/") || !IsRoot("") {
		t.Fatal("IsRoot(\"/\")/IsRoot(\"\") 应为 true")
	}
	if IsRoot("/a") {
		t.Fatal("IsRoot(\"/a\") 应为 false")
	}
}

// TestAncestors 祖先链（缓存失效用）：/a/b/c → ["/a/b/c","/a/b","/a","/"]。
func TestAncestors(t *testing.T) {
	got := Ancestors("/a/b/c")
	want := []string{"/a/b/c", "/a/b", "/a", "/"}
	if len(got) != len(want) {
		t.Fatalf("Ancestors = %v", got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("Ancestors[%d] = %q, want %q", i, got[i], want[i])
		}
	}
	if got := Ancestors("/"); len(got) != 1 || got[0] != "/" {
		t.Fatalf("Ancestors(\"/\") = %v", got)
	}
}
