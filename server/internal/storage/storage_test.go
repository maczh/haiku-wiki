package storage

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLocalRoundTrip(t *testing.T) {
	s, err := NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if s.Kind() != "local" {
		t.Fatalf("kind=%s", s.Kind())
	}
	key := "uploads/2026/09/abc.png"
	if err := s.Put(key, []byte("hello"), "image/png"); err != nil {
		t.Fatal(err)
	}
	b, err := s.Read(key)
	if err != nil || string(b) != "hello" {
		t.Fatalf("read=%q err=%v", b, err)
	}
	if ok, err := s.Exists(key); !ok || err != nil {
		t.Fatalf("exists=%v err=%v", ok, err)
	}
	if s.URL(key) != "/uploads/2026/09/abc.png" {
		t.Fatalf("url=%s", s.URL(key))
	}
	if err := s.Delete(key); err != nil {
		t.Fatal(err)
	}
	if ok, _ := s.Exists(key); ok {
		t.Fatal("删除后仍存在")
	}
	// 重复删除应幂等（清理流程会无脑调用）
	if err := s.Delete(key); err != nil {
		t.Fatalf("重复删除应幂等: %v", err)
	}
}

func TestLocalPutCreatesNestedDirs(t *testing.T) {
	root := t.TempDir()
	s, _ := NewLocal(root)
	key := "uploads/2026/12/nested/deep/x.bin"
	if err := s.Put(key, []byte("x"), ""); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(root, filepath.FromSlash(key))); err != nil {
		t.Fatalf("多级目录未创建: %v", err)
	}
}

func TestLocalRejectsTraversal(t *testing.T) {
	s, _ := NewLocal(t.TempDir())
	for _, k := range []string{
		"../escape.txt",
		"uploads/../../escape.txt",
		"/etc/passwd",
		"uploads/./../../escape.txt",
	} {
		if err := s.Put(k, []byte("x"), ""); err == nil {
			t.Fatalf("目录穿越未被拦截: %s", k)
		}
		if _, err := s.Read(k); err == nil {
			t.Fatalf("读取穿越未被拦截: %s", k)
		}
	}
}

func TestLocalList(t *testing.T) {
	s, _ := NewLocal(t.TempDir())
	_ = s.Put("uploads/2026/09/a.png", []byte("a"), "")
	_ = s.Put("uploads/2026/09/b.png", []byte("bb"), "")
	_ = s.Put("other/c.txt", []byte("c"), "")

	all, err := s.List("")
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 3 {
		t.Fatalf("全量列举应 3 个，实际 %d", len(all))
	}
	sub, err := s.List("uploads")
	if err != nil {
		t.Fatal(err)
	}
	if len(sub) != 2 {
		t.Fatalf("uploads 下应 2 个，实际 %d", len(sub))
	}
	for _, it := range sub {
		if !strings.HasPrefix(it.Key, "uploads/") {
			t.Fatalf("列举结果越界: %s", it.Key)
		}
	}
	// 大小必须真实（迁移后要用来做完整性比对）
	for _, it := range sub {
		if it.Size != 1 && it.Size != 2 {
			t.Fatalf("size 异常: %s=%d", it.Key, it.Size)
		}
	}
}

func TestLocalPath(t *testing.T) {
	root := t.TempDir()
	s, _ := NewLocal(root)
	key := "uploads/2026/09/x.png"
	_ = s.Put(key, []byte("data"), "")
	p, cleanup, err := s.LocalPath(key)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(p, root) {
		t.Fatalf("路径不在 root 下: %s", p)
	}
	cleanup() // local 是空操作，文件必须还在（不能把业务文件删了）
	if ok, _ := s.Exists(key); !ok {
		t.Fatal("local 后端的 cleanup 不应删除业务文件")
	}
	if _, _, err := s.LocalPath("uploads/nope.png"); err == nil {
		t.Fatal("不存在的文件应报错")
	}
}

func TestKeyFromURL(t *testing.T) {
	cases := map[string]string{
		"/uploads/2026/09/x.png": "uploads/2026/09/x.png",
		"uploads/2026/09/x.png":  "uploads/2026/09/x.png",
		"  /uploads/x.png  ":     "uploads/x.png",
	}
	for in, want := range cases {
		if got := KeyFromURL(in); got != want {
			t.Fatalf("KeyFromURL(%q)=%q want %q", in, got, want)
		}
	}
}

func TestSafeKey(t *testing.T) {
	if _, err := safeKey(".."); err == nil {
		t.Fatal(".. 应被拒绝")
	}
	if _, err := safeKey(""); err == nil {
		t.Fatal("空键应被拒绝")
	}
	if k, err := safeKey("uploads/a/b.png"); err != nil || k != "uploads/a/b.png" {
		t.Fatalf("got %q err %v", k, err)
	}
	// 后端这道防线不接受绝对形态：业务侧必须先经 KeyFromURL 归一成相对键
	if _, err := safeKey("/uploads/a/b.png"); err == nil {
		t.Fatal("绝对路径形态的键应被拒绝")
	}
	if _, err := safeKey("../../etc/passwd"); err == nil {
		t.Fatal("多级穿越应被拒绝")
	}
}

func TestMimeByExt(t *testing.T) {
	if got := MimeByExt("a.PNG"); got != "image/png" {
		t.Fatalf("png=%s", got)
	}
	if got := MimeByExt("x.html"); !strings.HasPrefix(got, "text/html") {
		t.Fatalf("html=%s", got)
	}
	if got := MimeByExt("x.unknown"); got != "application/octet-stream" {
		t.Fatalf("unknown=%s", got)
	}
}
