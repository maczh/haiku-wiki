package netdisk

import (
	"context"
	"io"
	"log"
	"sync"
	"time"

	"haiku-wiki/server/internal/config"
	"haiku-wiki/server/internal/model"
)

// SessionPool 网盘会话池：按连接 ID 复用会话，空闲超时断开，出错即失效重建。
//
// 为什么需要它（设计文档 D2）：SMB/FTP 每次列目录都重新握手，既慢又容易耗尽
// 服务端连接数；而 SMB/FTP 会话**非并发安全**，所以池化必须同时解决复用与串行化。
//
// 复用粒度：一条 netdisk_connections 记录 = 池里一个会话。凭据或配置变更（PUT 编辑）
// 时调用方必须 Invalidate，否则会继续用旧凭据。
type SessionPool struct {
	mu      sync.Mutex
	conns   map[uint64]*poolEntry
	idleTTL time.Duration
}

// poolEntry 池里的一个会话。
type poolEntry struct {
	drv      Driver
	refs     int
	lastUsed time.Time
	build    func() (Driver, error)
	mu       sync.Mutex // 串行化同一会话上的操作（SMB/FTP/WebDAV 都要求）
	dead     bool       // 已失效，正在退场的会话不再被复用
	// userID 连接归属用户。池子以 connID 为单键索引，而「同 ID 不同用户」
	// 在自增主键下不可能出现——但池子必须自己防住（见 Acquire 的防御分支），
	// 否则一旦出现就是「两个用户复用同一条会话」的跨用户数据泄露。
	userID uint64
}

// driverFactory 驱动构造入口。包级变量是给单测留的 seam：
// 默认值就是 New（生产行为完全不变），测试可整体替换以验证池的复用 / 隔离 / 重建语义。
var driverFactory = New

// DefaultPool 进程级默认池（main.go 起 Reaper）。
var defaultPool = NewSessionPool(0)

// NewSessionPool 构造池；idle<=0 时取配置 netdisk.pool_idle_minutes（默认 10 分钟）。
func NewSessionPool(idle time.Duration) *SessionPool {
	if idle <= 0 {
		if c := config.Current(); c != nil {
			idle = c.NetdiskPoolIdle()
		} else {
			idle = 10 * time.Minute
		}
	}
	return &SessionPool{conns: make(map[uint64]*poolEntry), idleTTL: idle}
}

// DefaultPool 返回进程级默认池。
func DefaultPool() *SessionPool { return defaultPool }

// Acquire 取一个可用会话。返回 (驱动, release, error)。
//
// 调用方必须 `defer release()`：release 把引用计数减一并刷新 lastUsed。
// 首次取用时由 build 建连；已失效（dead）的条目会被丢弃后重建。
func (p *SessionPool) Acquire(ctx context.Context, conn *model.NetdiskConnection,
	creds *Credentials) (Driver, func(), error) {
	if conn == nil || conn.ID == 0 {
		// 未保存的连接（「保存前测试」场景）：不入池，直接建一个一次性会话
		cfg := ConfigFrom(conn)
		drv, err := driverFactory(cfg.Kind, cfg, creds)
		if err != nil {
			return nil, func() {}, err
		}
		return drv, func() { _ = drv.Close() }, nil
	}
	p.mu.Lock()
	e, ok := p.conns[conn.ID]
	if ok && e.dead {
		delete(p.conns, conn.ID)
		e = nil
		ok = false
	}
	// 防御性隔离：连接 ID 相同但归属用户不同。自增主键全局唯一、service 层又已按
	// user_id 过滤，正常链路里永远不会发生；但池子按 connID 单键索引，必须自己
	// 防住——按与 dead 条目相同的方式丢弃重建，绝不复用别人的会话。
	if ok && e.userID != conn.UserID {
		delete(p.conns, conn.ID)
		e = nil
		ok = false
	}
	if !ok {
		cfg := ConfigFrom(conn)
		c := creds
		e = &poolEntry{
			userID:   conn.UserID,
			lastUsed: time.Now(),
			build:    func() (Driver, error) { return driverFactory(cfg.Kind, cfg, c) },
		}
		p.conns[conn.ID] = e
	}
	p.mu.Unlock()

	e.mu.Lock()
	if e.drv == nil {
		drv, err := e.build()
		if err != nil {
			e.mu.Unlock()
			p.Invalidate(conn.ID)
			return nil, func() {}, err
		}
		e.drv = drv
	}
	e.refs++
	e.lastUsed = time.Now()
	drv := e.drv
	e.mu.Unlock()

	released := false
	release := func() {
		if released {
			return
		}
		released = true
		e.mu.Lock()
		if e.refs > 0 {
			e.refs--
		}
		e.lastUsed = time.Now()
		e.mu.Unlock()
	}
	return &pooledDriver{pool: p, connID: conn.ID, entry: e, inner: drv, release: release}, release, nil
}

// Invalidate 立即丢弃某连接的会话（凭据变更 / 网络报错后调用）。
// 正在使用该会话的调用方不受影响（refs>0 时 Reaper 不会关），下一次 Acquire 会重建。
func (p *SessionPool) Invalidate(connID uint64) {
	if connID == 0 {
		return
	}
	p.mu.Lock()
	e, ok := p.conns[connID]
	if ok {
		delete(p.conns, connID)
	}
	p.mu.Unlock()
	if !ok || e == nil {
		return
	}
	e.mu.Lock()
	e.dead = true
	drv := e.drv
	refs := e.refs
	e.drv = nil
	e.mu.Unlock()
	if drv != nil && refs == 0 {
		if err := drv.Close(); err != nil {
			log.Printf("[netdisk] 关闭失效会话失败 conn=%d: %v", connID, err)
		}
	}
}

// StartReaper 每 60s 扫一次：空闲超过 idleTTL 且无引用的会话直接关闭并移除。
// ctx 取消即退出（main.go 传入进程级 ctx）。
func (p *SessionPool) StartReaper(ctx context.Context) {
	ticker := time.NewTicker(60 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			p.Reap()
		}
	}
}

// Reap 扫一遍并关闭空闲超时的会话（StartReaper 的单次执行体，便于单测直接调用）。
func (p *SessionPool) Reap() int {
	p.mu.Lock()
	stale := make([]*poolEntry, 0)
	for id, e := range p.conns {
		e.mu.Lock()
		idle := time.Since(e.lastUsed)
		free := e.refs == 0
		e.mu.Unlock()
		if free && idle > p.idleTTL {
			stale = append(stale, e)
			delete(p.conns, id)
		}
	}
	p.mu.Unlock()
	for _, e := range stale {
		e.mu.Lock()
		drv := e.drv
		e.drv = nil
		e.dead = true
		e.mu.Unlock()
		if drv != nil {
			_ = drv.Close()
		}
	}
	return len(stale)
}

// Size 当前池里的会话数（监控 / 单测用）。
func (p *SessionPool) Size() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return len(p.conns)
}

// pooledDriver 包一层：任何方法返回错误时都让外层有机会 Invalidate，
// 同时保证 release 只被调一次（Acquire 返回的 release 与 defer 双保险）。
type pooledDriver struct {
	pool    *SessionPool
	connID  uint64
	entry   *poolEntry
	inner   Driver
	release func()
}

func (d *pooledDriver) Kind() string { return d.inner.Kind() }

func (d *pooledDriver) Caps() Caps { return d.inner.Caps() }

// withSession 串行化会话访问，并在出现错误时失效该会话。
func (d *pooledDriver) withSession(fn func(Driver) error) error {
	d.entry.mu.Lock()
	err := fn(d.inner)
	d.entry.mu.Unlock()
	if err != nil && !IsAppError(err) {
		// 网络类错误 → 会话不可信，立即丢弃（下次重建）
		d.pool.Invalidate(d.connID)
	}
	return err
}

func (d *pooledDriver) Test(ctx context.Context) error {
	return d.withSession(func(dr Driver) error { return dr.Test(ctx) })
}

func (d *pooledDriver) List(ctx context.Context, path string) ([]Entry, error) {
	var out []Entry
	err := d.withSession(func(dr Driver) (err error) {
		out, err = dr.List(ctx, path)
		return err
	})
	return out, err
}

func (d *pooledDriver) Stat(ctx context.Context, path string) (*Entry, error) {
	var out *Entry
	err := d.withSession(func(dr Driver) (err error) {
		out, err = dr.Stat(ctx, path)
		return err
	})
	return out, err
}

func (d *pooledDriver) Mkdir(ctx context.Context, path string) error {
	return d.withSession(func(dr Driver) error { return dr.Mkdir(ctx, path) })
}

func (d *pooledDriver) Rename(ctx context.Context, path, newName string) error {
	return d.withSession(func(dr Driver) error { return dr.Rename(ctx, path, newName) })
}

func (d *pooledDriver) Move(ctx context.Context, path, targetDir string) error {
	return d.withSession(func(dr Driver) error { return dr.Move(ctx, path, targetDir) })
}

func (d *pooledDriver) Remove(ctx context.Context, path string, recursive bool) error {
	return d.withSession(func(dr Driver) error { return dr.Remove(ctx, path, recursive) })
}

// Open 返回的流由调用方负责 Close；会话的引用由 release 管理，不随流释放。
func (d *pooledDriver) Open(ctx context.Context, path string) (io.ReadCloser, error) {
	var rc io.ReadCloser
	err := d.withSession(func(dr Driver) (err error) {
		rc, err = dr.Open(ctx, path)
		return err
	})
	return rc, err
}

func (d *pooledDriver) OpenRange(ctx context.Context, path string, offset, size int64) (io.ReadCloser, int64, error) {
	var rc io.ReadCloser
	var total int64
	err := d.withSession(func(dr Driver) (err error) {
		rc, total, err = dr.OpenRange(ctx, path, offset, size)
		return err
	})
	return rc, total, err
}

func (d *pooledDriver) Write(ctx context.Context, path string, r io.Reader, size int64) error {
	return d.withSession(func(dr Driver) error { return dr.Write(ctx, path, r, size) })
}

// Close 归还会话（网盘页的驱动由池托管，Close 只做 release，不真关连接）。
func (d *pooledDriver) Close() error {
	if d.release != nil {
		d.release()
	}
	return nil
}

// ConfigFrom 把数据库模型映射成驱动配置（**不含凭据**）。
func ConfigFrom(c *model.NetdiskConnection) Config {
	if c == nil {
		return Config{}
	}
	return Config{
		ID:       c.ID,
		UserID:   c.UserID,
		Name:     c.Name,
		Kind:     c.Kind,
		Host:     c.Host,
		Port:     c.Port,
		Share:    c.Share,
		RootPath: c.RootPath,
		Mode:     c.Mode,
		Encoding: c.Encoding,
		Extra:    c.Extra,
	}
}
