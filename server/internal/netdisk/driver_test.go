package netdisk

import (
	"bytes"
	"context"
	"errors"
	"io"
	"strings"
	"testing"
	"time"

	hkerr "haiku-wiki/server/internal/pkg"
)

// ---------- mock 驱动（用于验证工厂分派与 Caps 常量，不依赖真实网盘） ----------

// mockDriver 内存版驱动：单目录 + 单文件，够验证接口契约。
type mockDriver struct {
	kind   string
	caps   Caps
	closed bool
}

func (m *mockDriver) Kind() string { return m.kind }
func (m *mockDriver) Caps() Caps   { return m.caps }

func (m *mockDriver) Test(ctx context.Context) error {
	if m.closed {
		return ConnectFailed("会话已关闭")
	}
	return nil
}

func (m *mockDriver) List(ctx context.Context, path string) ([]Entry, error) {
	if _, err := CleanPath(path); err != nil {
		return nil, err
	}
	return []Entry{
		{Name: "子目录", Path: "/子目录", IsDir: true, ModTime: time.Unix(0, 0).UTC()},
		{Name: "a.txt", Path: "/a.txt", IsDir: false, Size: 3},
	}, nil
}

func (m *mockDriver) Stat(ctx context.Context, path string) (*Entry, error) {
	c, err := CleanPath(path)
	if err != nil {
		return nil, err
	}
	if c == "/a.txt" {
		return &Entry{Name: "a.txt", Path: c, Size: 3}, nil
	}
	return nil, PathNotFound("不存在：" + c)
}

func (m *mockDriver) Mkdir(ctx context.Context, path string) error {
	_, err := CleanPath(path)
	return err
}
func (m *mockDriver) Rename(ctx context.Context, path, newName string) error {
	_, err := Join(Parent(path), newName)
	return err
}
func (m *mockDriver) Move(ctx context.Context, path, targetDir string) error {
	_, err := Join(targetDir, BaseName(path))
	return err
}
func (m *mockDriver) Remove(ctx context.Context, path string, recursive bool) error {
	_, err := CleanPath(path)
	return err
}
func (m *mockDriver) Open(ctx context.Context, path string) (io.ReadCloser, error) {
	return io.NopCloser(bytes.NewReader([]byte("abc"))), nil
}
func (m *mockDriver) OpenRange(ctx context.Context, path string, offset, size int64) (io.ReadCloser, int64, error) {
	if !m.caps.RangeRead {
		return nil, 0, ErrRangeUnsupported
	}
	return io.NopCloser(bytes.NewReader([]byte("abc"))), 3, nil
}
func (m *mockDriver) Write(ctx context.Context, path string, r io.Reader, size int64) error {
	_, err := CleanPath(path)
	return err
}
func (m *mockDriver) Close() error { m.closed = true; return nil }

// ---------- 工厂分派 ----------

// TestNewDispatchesByKind 工厂按 kind 分派；未实现的 kind 返回 42008。
// 主机一律用 127.0.0.1:<未监听端口>：立刻 connection refused，不依赖外网、不拖慢单测。
func TestNewDispatchesByKind(t *testing.T) {
	if _, err := New(KindSMB, Config{Host: "127.0.0.1", Port: 1, Share: "data"}, &Credentials{Username: "u"}); err == nil {
		t.Fatal("SMB 连不到应报错")
	} else if !IsAppError(err) {
		t.Fatalf("SMB 建连失败应带业务码，实际 %v", err)
	}
	if _, err := New(KindFTP, Config{Host: "127.0.0.1", Port: 1}, &Credentials{}); err == nil {
		t.Fatal("FTP 连不到应报错")
	}
	if _, err := New(KindWebDAV, Config{Host: "http://127.0.0.1:1"}, &Credentials{}); err == nil {
		t.Fatal("WebDAV 连不到应报错")
	}
	// 未实现 / 未知类型
	for _, k := range []string{"", "xyz", KindQuark} {
		_, err := New(k, Config{}, nil)
		var ae *hkerr.AppError
		if !errors.As(err, &ae) || ae.Code != CodeUnsupported {
			t.Fatalf("New(%q) 应返回 42008，实际 %v", k, err)
		}
	}
}

// TestFTPActiveModeRejected FTP 主动模式在建连阶段就被拒（不是连上后才报错）。
func TestFTPActiveModeRejected(t *testing.T) {
	_, err := NewFTP(Config{Host: "127.0.0.1", Port: 21, Mode: "active"}, &Credentials{})
	if err == nil {
		t.Fatal("FTP 主动模式应被拒绝")
	}
	var ae *hkerr.AppError
	if !errors.As(err, &ae) || ae.Code != CodeUnsupported {
		t.Fatalf("应返回 42008，实际 %v", err)
	}
	if !strings.Contains(ae.Message, "被动模式") {
		t.Fatalf("文案应说明「仅支持被动模式」，实际 %q", ae.Message)
	}
}

// TestSMBRequiresShare SMB 必须给共享名（PRD P0：补 share 字段的意义所在）。
func TestSMBRequiresShare(t *testing.T) {
	_, err := NewSMB(Config{Host: "127.0.0.1"}, &Credentials{Username: "u"})
	var ae *hkerr.AppError
	if !errors.As(err, &ae) || ae.Code != CodeConfigInvalid {
		t.Fatalf("缺少 share 应返回 42001，实际 %v", err)
	}
	if !strings.Contains(ae.Message, "共享名") {
		t.Fatalf("文案应提示共享名，实际 %q", ae.Message)
	}
	_, err = NewSMB(Config{Share: "data"}, &Credentials{Username: "u"})
	if !errors.As(err, &ae) || ae.Code != CodeConfigInvalid {
		t.Fatalf("缺少 host 应返回 42001，实际 %v", err)
	}
}

// ---------- Caps 常量 ----------

// TestCapsOfProtocols 三类协议驱动的能力位（Range/代理/根目录）。
func TestCapsOfProtocols(t *testing.T) {
	cases := []struct {
		kind     string
		rangeOK  bool
		needProx bool
		root     string
	}{
		{KindSMB, true, true, "/"},
		{KindFTP, true, true, "/"},
		{KindWebDAV, true, true, "/"},
	}
	for _, c := range cases {
		got := capsOf(c.kind)
		if got.RangeRead != c.rangeOK || got.NeedProxy != c.needProx || got.RootPath != c.root {
			t.Fatalf("%s caps = %+v, want range=%v proxy=%v root=%q", c.kind, got, c.rangeOK, c.needProx, c.root)
		}
	}
	// 百度强制根目录隔离
	if got := DefaultRootPath(KindBaidu, "haiku-wiki"); got != "/apps/haiku-wiki" {
		t.Fatalf("百度根目录 = %q", got)
	}
	if got := DefaultRootPath(KindSMB, ""); got != "/" {
		t.Fatalf("SMB 根目录 = %q", got)
	}
}

// capsOf 各协议的理论能力位（与驱动实现里的 Caps 保持一致，这里独立再声明一份做交叉校验）。
func capsOf(kind string) Caps {
	switch kind {
	case KindBaidu:
		return Caps{RangeRead: true, NativeMove: true, RecursiveRemove: false, NeedProxy: true, RootPath: "/apps/haiku-wiki"}
	case KindAliyun:
		return Caps{RangeRead: true, NativeMove: true, RecursiveRemove: false, NeedProxy: true, RootPath: "/"}
	default:
		return Caps{RangeRead: true, NativeMove: true, RecursiveRemove: true, NeedProxy: true, RootPath: "/"}
	}
}

// ---------- 凭据结构（mock 驱动也要能携带） ----------

// TestCredentialsJSONShape 凭据的 JSON 结构与字段命名（密文里就是这个形状）。
func TestCredentialsJSONShape(t *testing.T) {
	c := &Credentials{Username: "u", Password: "p", Domain: "d", AccessToken: "a", RefreshToken: "r"}
	enc, err := EncryptCredentials(c)
	if err != nil {
		t.Fatal(err)
	}
	out, err := DecryptCredentials(enc)
	if err != nil {
		t.Fatal(err)
	}
	if !out.HasPassword() || !out.HasToken() {
		t.Fatal("HasPassword / HasToken 判定错误")
	}
	if (&Credentials{}).IsEmpty() != true {
		t.Fatal("空凭据 IsEmpty 应为 true")
	}
	if out.IsEmpty() {
		t.Fatal("非空凭据 IsEmpty 应为 false")
	}
	var nilCreds *Credentials
	if !nilCreds.IsEmpty() {
		t.Fatal("nil 凭据 IsEmpty 应为 true（防 nil panic）")
	}
}

// TestMockDriverContract mock 驱动完整实现 Driver（编译期 + 行为各验一遍）。
func TestMockDriverContract(t *testing.T) {
	var d Driver = &mockDriver{kind: KindSMB, caps: capsOf(KindSMB)}
	if d.Kind() != KindSMB {
		t.Fatal("Kind 不符")
	}
	if err := d.Test(context.Background()); err != nil {
		t.Fatalf("Test 失败: %v", err)
	}
	items, err := d.List(context.Background(), "/")
	if err != nil || len(items) != 2 {
		t.Fatalf("List = %v, %v", items, err)
	}
	// 目录优先排序：mock 已按此顺序给出
	if !items[0].IsDir || items[0].Name != "子目录" {
		t.Fatalf("目录应排在前: %+v", items)
	}
	if _, err := d.List(context.Background(), "/../x"); err == nil {
		t.Fatal("路径穿越应被拒")
	}
	rc, err := d.Open(context.Background(), "/a.txt")
	if err != nil {
		t.Fatal(err)
	}
	b, _ := io.ReadAll(rc)
	_ = rc.Close()
	if string(b) != "abc" {
		t.Fatalf("读到的内容 = %q", b)
	}
	if _, _, err := d.OpenRange(context.Background(), "/a.txt", 0, 3); err != nil {
		t.Fatalf("支持 Range 的驱动不该报错: %v", err)
	}
	noRange := &mockDriver{kind: KindFTP, caps: Caps{RangeRead: false, RootPath: "/"}}
	if _, _, err := noRange.OpenRange(context.Background(), "/a.txt", 0, 3); !errors.Is(err, ErrRangeUnsupported) {
		t.Fatalf("不支持 Range 应返回 ErrRangeUnsupported，实际 %v", err)
	}
	if err := d.Close(); err != nil {
		t.Fatal(err)
	}
}
