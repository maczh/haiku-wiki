package netdisk

import (
	"context"
	"io"
	"sync"
	"testing"
	"time"

	"haiku-wiki/server/internal/model"
)

// 本文件证明 SessionPool 的「用户间隔离」语义（需求：SMB 协议必须解决用户间隔离）：
//
//	用例A 同一连接 ID、不同归属用户 → 必须得到不同驱动实例（不复用会话）；
//	用例B 同一连接 ID、同一用户 → 第二次复用同一实例（证明池化没被改坏）；
//	用例C Invalidate 之后再取 → 得到新实例（失效重建语义保持）。
//
// 全部走 driverFactory seam 注入 stub，不触网、不落库。

// stubDriver 完整实现 Driver 的最小驱动：所有方法返回零值，Close 返回 nil。
// 仅用于分辨「复用 / 重建」，不模拟任何协议行为。
type stubDriver struct {
	id   int    // 每次构造自增，用于分辨实例
	kind string // 协议类型（原样带回）
}

func (s *stubDriver) Kind() string { return s.kind }
func (s *stubDriver) Caps() Caps   { return Caps{RootPath: "/"} }

func (s *stubDriver) Test(ctx context.Context) error { return nil }

func (s *stubDriver) List(ctx context.Context, path string) ([]Entry, error) {
	return nil, nil
}

func (s *stubDriver) Stat(ctx context.Context, path string) (*Entry, error) {
	return nil, nil
}

func (s *stubDriver) Mkdir(ctx context.Context, path string) error { return nil }

func (s *stubDriver) Rename(ctx context.Context, path, newName string) error { return nil }

func (s *stubDriver) Move(ctx context.Context, path, targetDir string) error { return nil }

func (s *stubDriver) Remove(ctx context.Context, path string, recursive bool) error {
	return nil
}

func (s *stubDriver) Open(ctx context.Context, path string) (io.ReadCloser, error) {
	return nil, nil
}

func (s *stubDriver) OpenRange(ctx context.Context, path string, offset, size int64) (io.ReadCloser, int64, error) {
	return nil, 0, nil
}

func (s *stubDriver) Write(ctx context.Context, path string, r io.Reader, size int64) error {
	return nil
}

func (s *stubDriver) Close() error { return nil }

// stubFactory 计数工厂：每次调用返回带自增 id 的新 stub。
// 返回的 idOf 可从 Acquire 得到的驱动上读回当前实例号（0 = 不是 stub，测试直接失败）。
type stubFactory struct {
	mu  sync.Mutex
	seq int
}

// build 实现 driverFactory 签名（与 New 一致）。
func (f *stubFactory) build(kind string, cfg Config, creds *Credentials) (Driver, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.seq++
	return &stubDriver{id: f.seq, kind: kind}, nil
}

// useStubFactory 把包级 driverFactory 换成计数 stub 工厂，t.Cleanup 恢复默认值。
// 默认值就是 New（生产行为），因此本文件之外的测试完全不受影响。
func useStubFactory(t *testing.T) *stubFactory {
	t.Helper()
	orig := driverFactory
	f := &stubFactory{}
	driverFactory = f.build
	t.Cleanup(func() { driverFactory = orig })
	return f
}

// acquireStubID 走池子取一次会话，返回内层 stub 的实例 id。
// 入池路径返回 *pooledDriver（ stub 在 .inner）；ID=0 的一次性路径直接返回 stub。
// 实例 id 每次构造自增：相等 = 复用，不等 = 重建。
func acquireStubID(t *testing.T, p *SessionPool, conn *model.NetdiskConnection) (int, func()) {
	t.Helper()
	drv, release, err := p.Acquire(context.Background(), conn, &Credentials{})
	if err != nil {
		t.Fatalf("Acquire 失败: %v", err)
	}
	var sd *stubDriver
	switch d := drv.(type) {
	case *pooledDriver:
		s, ok := d.inner.(*stubDriver)
		if !ok {
			t.Fatalf("内层驱动应为 stubDriver，实际 %T", d.inner)
		}
		sd = s
	case *stubDriver:
		sd = d
	default:
		t.Fatalf("Acquire 返回了未知驱动类型 %T", drv)
	}
	return sd.id, release
}

// TestSessionPoolSameConnIDDifferentUserIsolated 用例A（核心）：
// conn{ID:5,UserID:1} 与 conn{ID:5,UserID:2} 依次 Acquire，
// 第二次必须得到不同的驱动实例——同 ID 不同用户绝不复用会话。
func TestSessionPoolSameConnIDDifferentUserIsolated(t *testing.T) {
	useStubFactory(t)
	p := NewSessionPool(time.Minute)
	connUser1 := &model.NetdiskConnection{ID: 5, UserID: 1, Kind: KindSMB, Host: "127.0.0.1", Port: 1, Share: "x"}
	connUser2 := &model.NetdiskConnection{ID: 5, UserID: 2, Kind: KindSMB, Host: "127.0.0.1", Port: 1, Share: "x"}

	id1, release1 := acquireStubID(t, p, connUser1)
	defer release1()
	id2, release2 := acquireStubID(t, p, connUser2)
	defer release2()

	if id1 == id2 {
		t.Fatalf("同连接 ID 不同用户复用了同一会话（id=%d），用户间隔离失效", id1)
	}
	if p.Size() != 1 {
		t.Fatalf("防御丢弃后池里只应保留新用户的会话，实际 Size=%d", p.Size())
	}
}

// TestSessionPoolReusesSameUserSession 用例B：
// 同 ID 同 UserID 连续两次 Acquire，第二次复用同一实例（池化没被改坏）。
func TestSessionPoolReusesSameUserSession(t *testing.T) {
	useStubFactory(t)
	p := NewSessionPool(time.Minute)
	conn := &model.NetdiskConnection{ID: 5, UserID: 1, Kind: KindSMB, Host: "127.0.0.1", Port: 1, Share: "x"}

	id1, release1 := acquireStubID(t, p, conn)
	release1() // 先归还，再取：这才是「复用」的典型路径
	id2, release2 := acquireStubID(t, p, conn)
	defer release2()

	if id1 != id2 {
		t.Fatalf("同用户同连接第二次应复用会话，实际重建 %d -> %d", id1, id2)
	}
}

// TestSessionPoolInvalidateForcesNewSession 用例C：
// Invalidate 后再次 Acquire 得到新实例（凭据变更 / 网络报错后的重建语义）。
func TestSessionPoolInvalidateForcesNewSession(t *testing.T) {
	useStubFactory(t)
	p := NewSessionPool(time.Minute)
	conn := &model.NetdiskConnection{ID: 5, UserID: 1, Kind: KindSMB, Host: "127.0.0.1", Port: 1, Share: "x"}

	id1, release1 := acquireStubID(t, p, conn)
	release1()
	p.Invalidate(conn.ID)
	id2, release2 := acquireStubID(t, p, conn)
	defer release2()

	if id1 == id2 {
		t.Fatalf("Invalidate 后应重建会话，实际复用 id=%d", id1)
	}
}

// TestSessionPoolUnsavedConnBypassesPool ID=0（保存前测试）不入池：
// 每次 Acquire 都是一次性会话，用完即关，池Size 保持 0。
func TestSessionPoolUnsavedConnBypassesPool(t *testing.T) {
	useStubFactory(t)
	p := NewSessionPool(time.Minute)
	conn := &model.NetdiskConnection{ID: 0, UserID: 1, Kind: KindSMB, Host: "127.0.0.1", Port: 1, Share: "x"}

	id1, release1 := acquireStubID(t, p, conn)
	release1()
	id2, release2 := acquireStubID(t, p, conn)
	defer release2()

	if id1 == id2 {
		t.Fatalf("未保存连接不应复用会话，实际复用 id=%d", id1)
	}
	if p.Size() != 0 {
		t.Fatalf("未保存连接不应入池，实际 Size=%d", p.Size())
	}
}
