package service

import (
	"context"
	"io"
	"log"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"haiku-wiki/server/internal/config"
	"haiku-wiki/server/internal/model"
	"haiku-wiki/server/internal/netdisk"
	hkerr "haiku-wiki/server/internal/pkg"
	"haiku-wiki/server/internal/repository"
	"haiku-wiki/server/internal/storage"
)

// 网盘异步任务中心的时序常量。
const (
	// netdiskTaskTimeout 单个任务的最长执行时间（上传 / 导入都是长耗时操作，
	// 不能用 netdiskOpTimeout 的 15s）。超时后任务留在 running，靠 RequeueStale 自愈。
	netdiskTaskTimeout = 30 * time.Minute
	// netdiskTaskQueueSize 内存队列容量（超出时 Enqueue 降级为「等下一轮扫描」而不是丢弃）。
	netdiskTaskQueueSize = 1024
	// netdiskScanInterval 扫描 pending 任务的间隔。
	netdiskScanInterval = 5 * time.Second
	// netdiskStaleInterval 扫描「卡住的 running」的间隔。
	netdiskStaleInterval = 2 * time.Minute
	// netdiskStaleAfter running 超过这个时长未更新即判定为进程崩溃遗留。
	netdiskStaleAfter = 10 * time.Minute
	// netdiskProgressInterval 进度写库的最小间隔（另一个触发条件是进度跨过 1%）。
	netdiskProgressInterval = 500 * time.Millisecond
	// netdiskDefaultWorkers 未配置 netdisk.task_workers 时的默认并发。
	netdiskDefaultWorkers = 2
)

// ---------- DTO ----------

// TaskDTO 任务出参。与 model.NetdiskTask 逐字段对应，但**不含 LocalPath**
// （服务端临时路径属于内部实现，前端只需要 file_name 去渲染）。
type TaskDTO struct {
	ID         uint64    `json:"id"`
	ConnID     uint64    `json:"conn_id"`
	ConnName   string    `json:"conn_name,omitempty"`
	Type       string    `json:"type"`
	Status     string    `json:"status"`
	Progress   int       `json:"progress"`
	TotalBytes int64     `json:"total_bytes"`
	DoneBytes  int64     `json:"done_bytes"`
	FileName   string    `json:"file_name"`
	SrcPath    string    `json:"src_path,omitempty"`
	DstPath    string    `json:"dst_path,omitempty"`
	Error      string    `json:"error,omitempty"`
	Retries    int       `json:"retries"`
	CanRetry   bool      `json:"can_retry"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

// ToTaskDTO 模型 → 出参。
//
// 与 ToConnectionDTO 同理：这是任务侧**唯一的出参出口**，
// LocalPath（服务端绝对路径）刻意不透出。
func ToTaskDTO(t *model.NetdiskTask) TaskDTO {
	if t == nil {
		return TaskDTO{}
	}
	return TaskDTO{
		ID:         t.ID,
		ConnID:     t.ConnID,
		Type:       t.Type,
		Status:     t.Status,
		Progress:   clampProgress(t.Progress),
		TotalBytes: t.TotalBytes,
		DoneBytes:  t.DoneBytes,
		FileName:   t.FileName,
		SrcPath:    t.SrcPath,
		DstPath:    t.DstPath,
		Error:      t.Error,
		Retries:    t.Retries,
		CanRetry:   t.Status == model.NetdiskTaskFailed && t.Retries < model.NetdiskTaskMaxRetries,
		CreatedAt:  t.CreatedAt,
		UpdatedAt:  t.UpdatedAt,
	}
}

// clampProgress 兜底把进度收敛到 0–100（脏数据不至于让前端进度条溢出）。
func clampProgress(p int) int {
	if p < 0 {
		return 0
	}
	if p > 100 {
		return 100
	}
	return p
}

// ---------- 服务 ----------

// NetdiskTaskService 网盘异步任务中心：上传 / 导入的排队、执行、重试、取消与临时文件回收。
//
// 为什么是「库 + 内存队列」而不是纯内存 goroutine：任务状态必须跨请求存活
// （前端轮询要看进度），且进程重启后 pending 任务要能被重新捡起来。
// 内存队列只负责「尽快唤醒 worker」，DB 才是唯一事实来源 —— 队列满了或进程重启
// 都不会丢任务，最坏情况是等到下一轮 pump 扫描。
type NetdiskTaskService struct {
	queue chan uint64
}

// NetdiskTaskSvc 单例。
var NetdiskTaskSvc = &NetdiskTaskService{queue: make(chan uint64, netdiskTaskQueueSize)}

// ---------- 对外 API（handler 用） ----------

// Submit 落库一个 pending 任务并返回自增 id。
func (s *NetdiskTaskService) Submit(t *model.NetdiskTask) (uint64, error) {
	if t == nil {
		return 0, netdisk.TaskInvalid("任务为空")
	}
	if t.UserID == 0 || t.ConnID == 0 {
		return 0, netdisk.TaskInvalid("任务缺少用户或连接信息")
	}
	if t.Status == "" {
		t.Status = model.NetdiskTaskPending
	}
	t.Progress = 0
	t.DoneBytes = 0
	if err := repository.CreateNetdiskTask(t); err != nil {
		return 0, err
	}
	return t.ID, nil
}

// Enqueue 唤醒 worker。队列满时**不阻塞**（任务仍在库里，下一轮 pump 会捡到）。
func (s *NetdiskTaskService) Enqueue(id uint64) {
	if id == 0 {
		return
	}
	select {
	case s.queue <- id:
	default:
		// 队列满：任务状态仍是 pending，pump 会在 5s 内重新入队
	}
}

// Get 单条任务（跨用户 = 404）。
func (s *NetdiskTaskService) Get(id, uid uint64) (*TaskDTO, error) {
	t, err := repository.GetNetdiskTask(id, uid)
	if err != nil {
		return nil, hkerr.NotFound("任务不存在")
	}
	dto := ToTaskDTO(t)
	dto.ConnName = connNameOf(t.ConnID, uid)
	return &dto, nil
}

// List 任务列表。
func (s *NetdiskTaskService) List(uid, connID uint64, status string, limit int) ([]TaskDTO, error) {
	list, err := repository.ListNetdiskTasks(uid, connID, status, limit)
	if err != nil {
		return nil, err
	}
	out := make([]TaskDTO, 0, len(list))
	names := make(map[uint64]string, 4)
	for i := range list {
		dto := ToTaskDTO(&list[i])
		if n, ok := names[dto.ConnID]; ok {
			dto.ConnName = n
		} else {
			n := connNameOf(dto.ConnID, uid)
			names[dto.ConnID] = n
			dto.ConnName = n
		}
		out = append(out, dto)
	}
	return out, nil
}

// Retry 重试失败任务（仅 failed 且未达重试上限）。
func (s *NetdiskTaskService) Retry(id, uid uint64) (*TaskDTO, error) {
	if _, err := repository.GetNetdiskTask(id, uid); err != nil {
		return nil, hkerr.NotFound("任务不存在")
	}
	ok, err := repository.RetryNetdiskTask(id, uid, model.NetdiskTaskMaxRetries)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, netdisk.TaskInvalid("只有失败且未超过重试上限的任务可以重试")
	}
	s.Enqueue(id)
	return s.Get(id, uid)
}

// Cancel 取消任务（仅 pending / running）。
func (s *NetdiskTaskService) Cancel(id, uid uint64) (*TaskDTO, error) {
	if _, err := repository.GetNetdiskTask(id, uid); err != nil {
		return nil, hkerr.NotFound("任务不存在")
	}
	ok, err := repository.CancelNetdiskTask(id, uid)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, netdisk.TaskInvalid("任务已结束，无法取消")
	}
	return s.Get(id, uid)
}

// CountRunning 仍在跑的任务数（前端据此决定是否继续轮询）。
func (s *NetdiskTaskService) CountRunning(uid uint64) (int64, error) {
	return repository.CountRunningNetdiskTasks(uid)
}

// connNameOf 取连接名（任务列表里展示用；查不到就留空，不影响主流程）。
func connNameOf(connID, uid uint64) string {
	if connID == 0 {
		return ""
	}
	c, err := repository.GetNetdiskConnection(connID, uid)
	if err != nil || c == nil {
		return ""
	}
	return c.Name
}

// ---------- worker ----------

// StartNetdiskTaskWorkers 启动任务中心（main.go 调用一次）。
//
// 三组 goroutine：
//  1. N 个执行 worker：从内存队列取 id 执行；
//  2. 1 个扫描协程：定期把库里的 pending 任务塞进队列（队列满 / 重启后的兜底）；
//  3. 1 个清理协程：定期回收超时任务与过期临时文件。
//
// ctx 取消即全部退出。
func (s *NetdiskTaskService) StartNetdiskTaskWorkers(ctx context.Context) {
	n := netdiskDefaultWorkers
	if c := config.Current(); c != nil {
		n = c.NetdiskWorkersOr()
	}
	if n < 1 {
		n = 1
	}
	// 启动时先自愈一次：把上次进程崩掉时卡在 running 的任务放回 pending
	if m, err := s.RequeueStale(); err == nil && m > 0 {
		log.Printf("[netdisk] 启动时回收 %d 个中断任务", m)
	}
	for i := 0; i < n; i++ {
		go s.worker(ctx, i)
	}
	go s.pumpLoop(ctx)
	go s.cleanupLoop(ctx)
	log.Printf("[netdisk] 任务中心已启动，worker=%d", n)
}

// worker 单个执行协程。
func (s *NetdiskTaskService) worker(ctx context.Context, idx int) {
	for {
		select {
		case <-ctx.Done():
			return
		case id := <-s.queue:
			s.run(ctx, id)
		}
	}
}

// pumpLoop 定期把库里的 pending 任务推进队列（重启兜底 + 队列满兜底）。
func (s *NetdiskTaskService) pumpLoop(ctx context.Context) {
	ticker := time.NewTicker(netdiskScanInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.pump()
		}
	}
}

// cleanupLoop 定期回收卡住的任务与过期临时文件。
func (s *NetdiskTaskService) cleanupLoop(ctx context.Context) {
	stale := time.NewTicker(netdiskStaleInterval)
	defer stale.Stop()
	tmp := time.NewTicker(30 * time.Minute)
	defer tmp.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-stale.C:
			if m, err := s.RequeueStale(); err == nil && m > 0 {
				log.Printf("[netdisk] 回收 %d 个超时未更新的任务", m)
			}
		case <-tmp.C:
			s.ReapTempFiles()
		}
	}
}

// pump 取一批 pending 任务入队。
func (s *NetdiskTaskService) pump() {
	n := netdiskDefaultWorkers * 4
	if c := config.Current(); c != nil {
		n = c.NetdiskWorkersOr() * 4
	}
	list, err := repository.ClaimPendingNetdiskTasks(n)
	if err != nil {
		logNetdiskError("扫描待办任务失败", 0, err)
		return
	}
	for i := range list {
		s.Enqueue(list[i].ID)
	}
}

// RequeueStale 把「running 且长时间未更新」的任务改回 pending。
func (s *NetdiskTaskService) RequeueStale() (int64, error) {
	n, err := repository.RequeueStaleNetdiskTasks(netdiskStaleAfter)
	if err != nil {
		return 0, err
	}
	if n > 0 {
		s.pump()
	}
	return n, nil
}

// ReapTempFiles 清理过期的任务临时目录（storage.TempDir()/netdisk/<taskID>）。
//
// 清理依据：目录 mtime 早于 ttl。任务成功后前端会立刻取字节导入，
// 取完后目录不再被写入，因此按 mtime 清理是安全的。
func (s *NetdiskTaskService) ReapTempFiles() int {
	ttl := time.Duration(0)
	if c := config.Current(); c != nil {
		ttl = c.NetdiskTempTTL()
	}
	if ttl <= 0 {
		ttl = 60 * time.Minute
	}
	root := filepath.Join(storage.TempDir(), "netdisk")
	entries, err := os.ReadDir(root)
	if err != nil {
		return 0 // 目录还不存在，无需清理
	}
	removed := 0
	deadline := time.Now().Add(-ttl)
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		info, ierr := e.Info()
		if ierr != nil {
			continue
		}
		if info.ModTime().After(deadline) {
			continue
		}
		dir := filepath.Join(root, e.Name())
		if rerr := os.RemoveAll(dir); rerr == nil {
			removed++
		} else {
			log.Printf("[netdisk] 清理临时目录失败 %s: %v", dir, rerr)
		}
	}
	return removed
}

// run 执行一个任务：抢占 → 分派 → 收尾。
func (s *NetdiskTaskService) run(ctx context.Context, id uint64) {
	// 抢占式置 running：保证并发下只有一个 worker 真正执行
	ok, err := repository.MarkNetdiskTaskRunning(id)
	if err != nil || !ok {
		return
	}
	t, err := repository.GetNetdiskTaskByID(id)
	if err != nil || t == nil {
		return
	}
	opCtx, cancel := context.WithTimeout(ctx, netdiskTaskTimeout)
	defer cancel()
	switch t.Type {
	case model.NetdiskTaskTypeUpload:
		s.runUpload(opCtx, t)
	case model.NetdiskTaskTypeImport:
		s.runImport(opCtx, t)
	default:
		_ = repository.FinishNetdiskTask(id, model.NetdiskTaskFailed, "未知任务类型："+t.Type, "")
	}
}

// ---------- 上传任务 ----------

// runUpload 把服务端临时文件写到网盘目标路径。
func (s *NetdiskTaskService) runUpload(ctx context.Context, t *model.NetdiskTask) {
	if t.LocalPath == "" {
		_ = repository.FinishNetdiskTask(t.ID, model.NetdiskTaskFailed, "上传任务缺少本地文件", "")
		return
	}
	f, err := os.Open(t.LocalPath)
	if err != nil {
		_ = repository.FinishNetdiskTask(t.ID, model.NetdiskTaskFailed, "打开本地文件失败", "")
		return
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		_ = repository.FinishNetdiskTask(t.ID, model.NetdiskTaskFailed, "读取本地文件失败", "")
		return
	}

	_, _, drv, release, err := s.acquireForTask(ctx, t)
	if err != nil {
		_ = repository.FinishNetdiskTask(t.ID, model.NetdiskTaskFailed, humanMessage(err), "")
		return
	}
	defer release()

	total := info.Size()
	prog := newTaskProgress(t.ID, total)
	// 百度 / 阿里云盘的分片上传要求 io.ReadSeeker，*os.File 天然满足
	if werr := drv.Write(ctx, t.DstPath, &cancelReader{
		r:       prog.reader(f),
		cancel:  func() bool { return s.isCanceled(t.ID) },
		onAbort: netdisk.TaskInvalid("任务已取消"),
	}, total); werr != nil {
		_ = repository.FinishNetdiskTask(t.ID, model.NetdiskTaskFailed, humanMessage(werr), "")
		NetdiskSvc.saveStatus(t.ConnID, false, humanMessage(werr))
		return
	}
	prog.finish(t.ID, total)
	_ = repository.FinishNetdiskTask(t.ID, model.NetdiskTaskSuccess, "", "")
	NetdiskSvc.saveStatus(t.ConnID, true, "")
	// 上传完成后临时文件即可清理（失败时保留，便于重试）
	_ = os.RemoveAll(filepath.Dir(t.LocalPath))
}

// ---------- 导入任务 ----------

// runImport 把网盘文件取回服务端临时目录（前端随后取字节交给导入对话框）。
func (s *NetdiskTaskService) runImport(ctx context.Context, t *model.NetdiskTask) {
	if t.LocalPath == "" {
		_ = repository.FinishNetdiskTask(t.ID, model.NetdiskTaskFailed, "导入任务缺少本地目标路径", "")
		return
	}
	if err := os.MkdirAll(filepath.Dir(t.LocalPath), 0o755); err != nil {
		_ = repository.FinishNetdiskTask(t.ID, model.NetdiskTaskFailed, "创建临时目录失败", "")
		return
	}
	_, _, drv, release, err := s.acquireForTask(ctx, t)
	if err != nil {
		_ = repository.FinishNetdiskTask(t.ID, model.NetdiskTaskFailed, humanMessage(err), "")
		return
	}
	defer release()

	// 先 Stat 拿总长（进度条才有分母）；拿不到就退化为「未知总长」进度
	total := int64(0)
	if e, serr := drv.Stat(ctx, t.SrcPath); serr == nil && e != nil {
		total = e.Size
	}
	rc, err := drv.Open(ctx, t.SrcPath)
	if err != nil {
		_ = repository.FinishNetdiskTask(t.ID, model.NetdiskTaskFailed, humanMessage(err), "")
		NetdiskSvc.saveStatus(t.ConnID, false, humanMessage(err))
		return
	}
	defer rc.Close()

	out, err := os.Create(t.LocalPath)
	if err != nil {
		_ = repository.FinishNetdiskTask(t.ID, model.NetdiskTaskFailed, "写入临时文件失败", "")
		return
	}
	prog := newTaskProgress(t.ID, total)
	_, cerr := io.Copy(out, prog.reader(rc))
	_ = out.Close()
	if cerr != nil {
		_ = os.Remove(t.LocalPath)
		_ = repository.FinishNetdiskTask(t.ID, model.NetdiskTaskFailed, humanMessage(cerr), "")
		NetdiskSvc.saveStatus(t.ConnID, false, humanMessage(cerr))
		return
	}
	if s.isCanceled(t.ID) {
		_ = os.Remove(t.LocalPath)
		return
	}
	prog.finish(t.ID, total)
	_ = repository.FinishNetdiskTask(t.ID, model.NetdiskTaskSuccess, "",
		`{"file_name":`+strconv.Quote(t.FileName)+`}`)
	NetdiskSvc.saveStatus(t.ConnID, true, "")
}

// ---------- 内部工具 ----------

// acquireForTask 任务场景取会话：读连接 → 解密凭据 → 从池里取驱动 → 注入 token 回写钩子。
//
// 与 service 层的差别：这里按 user_id + conn_id 取连接（worker 是内部协程，
// 没有 gin.Context，uid 从任务记录里带出来），且必须注入 SetTokenRefresher，
// 否则 OAuth 网盘刷新出的新 token 会丢在内存里、下次重启又要重新授权。
func (s *NetdiskTaskService) acquireForTask(ctx context.Context,
	t *model.NetdiskTask) (*model.NetdiskConnection, *netdisk.Credentials, netdisk.Driver, func(), error) {
	if t == nil {
		return nil, nil, nil, func() {}, netdisk.TaskInvalid("任务为空")
	}
	conn, err := repository.GetNetdiskConnection(t.ConnID, t.UserID)
	if err != nil || conn == nil {
		return nil, nil, nil, func() {}, netdisk.PathNotFound("网盘连接不存在或已被删除")
	}
	creds, err := netdisk.DecryptCredentials(conn.CredEnc)
	if err != nil {
		return nil, nil, nil, func() {}, netdisk.ConfigInvalid("已保存的凭据无法解密（可能服务端密钥已变更）")
	}
	drv, release, err := netdisk.DefaultPool().Acquire(ctx, conn, creds)
	if err != nil {
		return conn, creds, nil, func() {}, err
	}
	if setter, ok := drv.(interface {
		SetTokenRefresher(func(*netdisk.Credentials) error)
	}); ok {
		setter.SetTokenRefresher(func(next *netdisk.Credentials) error {
			return s.persistToken(conn.ID, next)
		})
	}
	return conn, creds, drv, release, nil
}

// persistToken OAuth 刷新后把新 token 落库（驱动内部的 onRefresh 回调）。
func (s *NetdiskTaskService) persistToken(connID uint64, creds *netdisk.Credentials) error {
	if connID == 0 || creds == nil {
		return nil
	}
	enc, err := netdisk.EncryptCredentials(creds)
	if err != nil {
		return err
	}
	return repository.UpdateNetdiskColumns(connID, map[string]any{
		"cred_enc": enc,
		"status":   model.NetdiskStatusConnected,
	})
}

// isCanceled 任务是否已被用户取消（worker 在拷贝循环里定期检查）。
func (s *NetdiskTaskService) isCanceled(id uint64) bool {
	t, err := repository.GetNetdiskTaskByID(id)
	if err != nil || t == nil {
		return false
	}
	return t.Status == model.NetdiskTaskCanceled
}

// ---------- 进度上报 ----------

// taskProgress 进度上报器：按「跨过 1%」或「间隔 500ms」节流写库，
// 避免每个 io.Copy 的 32KB 块都打一次 DB（设计文档 §7-T03 明确要求）。
type taskProgress struct {
	id       uint64
	total    int64
	done     int64
	lastAt   time.Time
	lastPct  int
	reported bool
}

// newTaskProgress 构造进度上报器。
func newTaskProgress(id uint64, total int64) *taskProgress {
	return &taskProgress{id: id, total: total, lastAt: time.Now()}
}

// add 累加已完数字节并按节流条件写库。
func (p *taskProgress) add(n int) {
	if n <= 0 {
		return
	}
	p.done += int64(n)
	pct := 0
	if p.total > 0 {
		pct = int(p.done * 100 / p.total)
		if pct > 100 {
			pct = 100
		}
	}
	if pct > p.lastPct || time.Since(p.lastAt) >= netdiskProgressInterval {
		p.lastPct = pct
		p.lastAt = time.Now()
		p.reported = true
		if err := repository.UpdateNetdiskTaskProgress(p.id, p.done, p.total, pct); err != nil {
			logNetdiskError("更新任务进度失败", p.id, err)
		}
	}
}

// reader 把任意 io.Reader 包成带进度上报的 Reader。
func (p *taskProgress) reader(r io.Reader) io.Reader { return &progressReader{r: r, p: p} }

// finish 收尾：无论总长是否已知都补一次 100%。
func (p *taskProgress) finish(id uint64, total int64) {
	if err := repository.UpdateNetdiskTaskProgress(id, p.done, total, 100); err != nil {
		logNetdiskError("更新任务进度失败", id, err)
	}
}

// progressReader io.Reader 包装：读多少上报多少。
type progressReader struct {
	r io.Reader
	p *taskProgress
}

func (r *progressReader) Read(b []byte) (int, error) {
	n, err := r.r.Read(b)
	r.p.add(n)
	return n, err
}

// cancelReader 在拷贝过程中检查任务是否被取消。
//
// 取消是「协作式」的：HTTP 层改了库里的 status，worker 在下一个读块发现后
// 返回错误终止拷贝。这样不需要 kill goroutine，也不会留下半截文件。
type cancelReader struct {
	r       io.Reader
	cancel  func() bool
	onAbort error
}

func (r *cancelReader) Read(b []byte) (int, error) {
	if r.cancel != nil && r.cancel() {
		return 0, r.onAbort
	}
	return r.r.Read(b)
}

// 编译期断言：确保本文件用到的构造器确实存在（防止误删 netdisk 侧定义）。
var _ = netdisk.TaskInvalid
