package service

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"haiku-wiki/server/internal/config"
	"haiku-wiki/server/internal/model"
	"haiku-wiki/server/internal/netdisk"
	hkerr "haiku-wiki/server/internal/pkg"
	"haiku-wiki/server/internal/repository"
	"haiku-wiki/server/internal/storage"
)

// netdiskOpTimeout 单个同步网盘操作（列目录 / 新建 / 改名 / 移动 / 删除）的超时。
const netdiskOpTimeout = 15 * time.Second

// previewTokenTTL 预览 / 下载短期 token 的有效期（<video>/<img> 无法带 Header，只能走 query）。
const previewTokenTTL = 2 * time.Hour

// NetdiskFileService 网盘文件操作：目录写操作 + 上传 / 下载 / 预览 / 导入。
//
// 上传与导入**任务化**（落 netdisk_tasks + worker 异步执行），下载与预览是同步流式
// —— 理由见设计文档 §1.7：浏览器本身就是下载端，代理流天然带进度条，落任务反而更慢。
type NetdiskFileService struct{}

// NetdiskFileSvc 单例。
var NetdiskFileSvc = &NetdiskFileService{}

// ctxWithTimeout 统一的网盘操作超时上下文。
func ctxWithTimeout() (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), netdiskOpTimeout)
}

// humanMessage 取错误的人类可读文案（AppError 用自己的，其余给通用文案）。
func humanMessage(err error) string {
	if err == nil {
		return ""
	}
	var ae *hkerr.AppError
	if errors.As(err, &ae) {
		return ae.Message
	}
	return err.Error()
}

// logNetdiskError 网盘侧的日志统一入口（**只输出非敏感信息**）。
func logNetdiskError(prefix string, connID uint64, err error) {
	log.Printf("[netdisk] %s conn=%d: %s", prefix, connID, humanMessage(err))
}

// ---------- 目录写操作（同步） ----------

// Mkdir 新建目录。
func (s *NetdiskFileService) Mkdir(id, uid uint64, path, name string) error {
	return s.write(id, uid, path, func(drv netdisk.Driver, ctx context.Context) error {
		target, err := netdisk.Join(path, name)
		if err != nil {
			return err
		}
		return drv.Mkdir(ctx, target)
	})
}

// Rename 改名 / 移动。targetDir 为空表示仅改名，否则移动到该目录下。
func (s *NetdiskFileService) Rename(id, uid uint64, path, name string) error {
	return s.write(id, uid, path, func(drv netdisk.Driver, ctx context.Context) error {
		return drv.Rename(ctx, path, name)
	})
}

// Move 移动到 targetDir 下。
func (s *NetdiskFileService) Move(id, uid uint64, path, targetDir string) error {
	return s.write(id, uid, path, func(drv netdisk.Driver, ctx context.Context) error {
		return drv.Move(ctx, path, targetDir)
	})
}

// Remove 删除。
func (s *NetdiskFileService) Remove(id, uid uint64, path string, recursive bool) error {
	return s.write(id, uid, path, func(drv netdisk.Driver, ctx context.Context) error {
		if recursive && !drv.Caps().RecursiveRemove {
			return netdisk.ErrRecursiveRemoveUnsupported
		}
		return drv.Remove(ctx, path, recursive)
	})
}

// write 统一的「取连接 → 取会话 → 执行一次写操作 → 出错回写状态」。
func (s *NetdiskFileService) write(id, uid uint64, path string, fn func(netdisk.Driver, context.Context) error) error {
	conn, err := NetdiskSvc.mustConn(id, uid)
	if err != nil {
		return err
	}
	if _, err := netdisk.CleanPath(path); err != nil {
		return err
	}
	creds, err := netdisk.DecryptCredentials(conn.CredEnc)
	if err != nil {
		return netdisk.ConfigInvalid("已保存的凭据无法解密（可能服务端密钥已变更）")
	}
	ctx, cancel := ctxWithTimeout()
	defer cancel()
	drv, release, err := netdisk.DefaultPool().Acquire(ctx, conn, creds)
	if err != nil {
		NetdiskSvc.saveStatus(conn.ID, false, humanMessage(err))
		return err
	}
	defer release()
	if err := fn(drv, ctx); err != nil {
		NetdiskSvc.saveStatus(conn.ID, false, humanMessage(err))
		return err
	}
	return nil
}

// ---------- 上传（任务化） ----------

// SubmitUpload 接收上传文件：落临时文件 → 建任务 → 入队 → 立即返回。
func (s *NetdiskFileService) SubmitUpload(id, uid uint64, dir string, fh *multipart.FileHeader) (*TaskDTO, error) {
	if fh == nil {
		return nil, hkerr.Param("缺少上传文件")
	}
	conn, err := NetdiskSvc.mustConn(id, uid)
	if err != nil {
		return nil, err
	}
	target, err := netdisk.CleanPath(dir)
	if err != nil {
		return nil, err
	}
	cfg := config.Current()
	if fh.Size > cfg.NetdiskMaxUploadBytes() {
		return nil, netdisk.LimitExceeded("文件超过上传上限（" +
			strconv.FormatInt(cfg.NetdiskMaxUploadBytes()>>20, 10) + "MB）")
	}
	name := sanitizeFileName(fh.Filename)
	if name == "" {
		return nil, hkerr.Param("文件名无效")
	}

	// 先建任务拿到 id，再用它隔离临时目录（多任务互不干扰，清理也以任务为单位）
	t := &model.NetdiskTask{
		UserID:     uid,
		ConnID:     conn.ID,
		Type:       model.NetdiskTaskTypeUpload,
		Status:     model.NetdiskTaskPending,
		FileName:   name,
		SrcPath:    target,
		DstPath:    "",
		TotalBytes: fh.Size,
	}
	taskID, err := NetdiskTaskSvc.Submit(t)
	if err != nil {
		return nil, err
	}
	localDir := netdiskTempDir(taskID)
	if err := os.MkdirAll(localDir, 0o755); err != nil {
		_ = repository.FinishNetdiskTask(taskID, model.NetdiskTaskFailed, "创建临时目录失败", "")
		return nil, hkerr.Internal("创建临时目录失败")
	}
	localPath := filepath.Join(localDir, name)
	src, err := fh.Open()
	if err != nil {
		_ = repository.FinishNetdiskTask(taskID, model.NetdiskTaskFailed, "读取上传文件失败", "")
		return nil, hkerr.Internal("读取上传文件失败")
	}
	defer src.Close()
	dst, err := os.Create(localPath)
	if err != nil {
		_ = repository.FinishNetdiskTask(taskID, model.NetdiskTaskFailed, "写入临时文件失败", "")
		return nil, hkerr.Internal("写入临时文件失败")
	}
	if _, err := io.Copy(dst, src); err != nil {
		_ = dst.Close()
		_ = repository.FinishNetdiskTask(taskID, model.NetdiskTaskFailed, "写入临时文件失败", "")
		return nil, hkerr.Internal("写入临时文件失败")
	}
	_ = dst.Close()

	finalPath, jerr := netdisk.Join(target, name)
	if jerr != nil {
		_ = repository.FinishNetdiskTask(taskID, model.NetdiskTaskFailed, "目标路径不合法", "")
		return nil, jerr
	}
	if err := updateTaskPaths(taskID, localPath, finalPath); err != nil {
		_ = repository.FinishNetdiskTask(taskID, model.NetdiskTaskFailed, "初始化任务失败", "")
		return nil, err
	}
	NetdiskTaskSvc.Enqueue(taskID)
	return NetdiskTaskSvc.Get(taskID, uid)
}

// updateTaskPaths 回填任务的本地路径与目标路径。
func updateTaskPaths(taskID uint64, localPath, dstPath string) error {
	t, err := repository.GetNetdiskTaskByID(taskID)
	if err != nil {
		return err
	}
	t.LocalPath = localPath
	t.DstPath = dstPath
	return repository.UpdateNetdiskTask(t)
}

// sanitizeFileName 去掉路径分隔符与控制字符，避免写出临时目录之外。
func sanitizeFileName(name string) string {
	n := strings.TrimSpace(filepath.Base(strings.ReplaceAll(name, "\\", "/")))
	n = strings.Map(func(r rune) rune {
		if r == '/' || r == '\\' || r == 0 {
			return -1
		}
		return r
	}, n)
	if n == "." || n == ".." || n == "" {
		return ""
	}
	return n
}

// ---------- 导入（任务化） ----------

// SubmitImport 建导入任务：worker 负责把网盘文件取回本地临时目录。
func (s *NetdiskFileService) SubmitImport(id, uid uint64, path string, bookID, parentID uint64) (*TaskDTO, error) {
	conn, err := NetdiskSvc.mustConn(id, uid)
	if err != nil {
		return nil, err
	}
	clean, err := netdisk.CleanPath(path)
	if err != nil {
		return nil, err
	}
	if netdisk.IsRoot(clean) {
		return nil, netdisk.ConfigInvalid("不能导入根目录")
	}
	name := netdisk.BaseName(clean)
	if name == "" {
		return nil, netdisk.ConfigInvalid("文件名无效")
	}
	t := &model.NetdiskTask{
		UserID:   uid,
		ConnID:   conn.ID,
		Type:     model.NetdiskTaskTypeImport,
		Status:   model.NetdiskTaskPending,
		FileName: name,
		SrcPath:  clean,
		DstPath:  strconv.FormatUint(bookID, 10) + ":" + strconv.FormatUint(parentID, 10),
	}
	taskID, err := NetdiskTaskSvc.Submit(t)
	if err != nil {
		return nil, err
	}
	localDir := netdiskTempDir(taskID)
	if err := os.MkdirAll(localDir, 0o755); err != nil {
		_ = repository.FinishNetdiskTask(taskID, model.NetdiskTaskFailed, "创建临时目录失败", "")
		return nil, hkerr.Internal("创建临时目录失败")
	}
	localPath := filepath.Join(localDir, sanitizeFileName(name))
	if localPath == "" || localPath == localDir {
		_ = repository.FinishNetdiskTask(taskID, model.NetdiskTaskFailed, "文件名无效", "")
		return nil, netdisk.ConfigInvalid("文件名无效")
	}
	if err := updateTaskPaths(taskID, localPath, clean); err != nil {
		_ = repository.FinishNetdiskTask(taskID, model.NetdiskTaskFailed, "初始化任务失败", "")
		return nil, err
	}
	NetdiskTaskSvc.Enqueue(taskID)
	return NetdiskTaskSvc.Get(taskID, uid)
}

// ---------- 下载 / 预览（同步流式，支持 Range） ----------

// RangeSpec 解析后的 Range 请求。
type RangeSpec struct {
	Has    bool
	Offset int64
	Length int64 // -1 = 到文件末尾
}

// ParseRangeHeader 解析 "bytes=a-b" / "bytes=a-" / "bytes=-n"。
// 不支持的形式（多段、非法）一律按「全量」处理（Has=false）——降级比报错更符合浏览器预期。
func ParseRangeHeader(h string) RangeSpec {
	h = strings.TrimSpace(h)
	if h == "" || !strings.HasPrefix(strings.ToLower(h), "bytes=") {
		return RangeSpec{}
	}
	body := strings.TrimSpace(h[len("bytes="):])
	if strings.Contains(body, ",") {
		return RangeSpec{} // 多段 Range 不支持
	}
	dash := strings.Index(body, "-")
	if dash < 0 {
		return RangeSpec{}
	}
	start := strings.TrimSpace(body[:dash])
	end := strings.TrimSpace(body[dash+1:])
	if start == "" {
		if end == "" {
			return RangeSpec{}
		}
		n, err := strconv.ParseInt(end, 10, 64)
		if err != nil || n <= 0 {
			return RangeSpec{}
		}
		// bytes=-n：最后 n 个字节，需要总长才能算起点 → 交给调用方按全量处理
		return RangeSpec{}
	}
	off, err := strconv.ParseInt(start, 10, 64)
	if err != nil || off < 0 {
		return RangeSpec{}
	}
	if end == "" {
		return RangeSpec{Has: true, Offset: off, Length: -1}
	}
	last, err := strconv.ParseInt(end, 10, 64)
	if err != nil || last < off {
		return RangeSpec{}
	}
	return RangeSpec{Has: true, Offset: off, Length: last - off + 1}
}

// NetdiskStream 流式读的结果（交给 handler 写响应头与拷贝）。
type NetdiskStream struct {
	Body        io.ReadCloser
	Total       int64  // 文件总长（未知为 0）
	Offset      int64  // 实际起始偏移（206 时为 Range 起点）
	Length      int64  // 本次要写的字节数（-1 = 到末尾）
	Partial     bool   // 是否为 206
	Name        string // 文件名（Content-Disposition 用）
	AcceptRange bool   // 是否支持 Range（用于回 Accept-Ranges 头）
}

// OpenStream 打开下载 / 预览流。disposition 只影响 handler 的响应头，这里统一取流。
func (s *NetdiskFileService) OpenStream(id, uid uint64, path string, rng RangeSpec) (*NetdiskStream, error) {
	conn, err := NetdiskSvc.mustConn(id, uid)
	if err != nil {
		return nil, err
	}
	clean, err := netdisk.CleanPath(path)
	if err != nil {
		return nil, err
	}
	creds, err := netdisk.DecryptCredentials(conn.CredEnc)
	if err != nil {
		return nil, netdisk.ConfigInvalid("已保存的凭据无法解密（可能服务端密钥已变更）")
	}
	ctx, cancel := ctxWithTimeout()
	drv, release, err := netdisk.DefaultPool().Acquire(ctx, conn, creds)
	if err != nil {
		cancel()
		NetdiskSvc.saveStatus(conn.ID, false, humanMessage(err))
		return nil, err
	}
	out := &NetdiskStream{Name: netdisk.BaseName(clean), AcceptRange: drv.Caps().RangeRead}
	if rng.Has && drv.Caps().RangeRead {
		rc, total, rerr := drv.OpenRange(ctx, clean, rng.Offset, rng.Length)
		if rerr == nil {
			out.Body = rc
			out.Total = total
			out.Offset = rng.Offset
			out.Length = rng.Length
			out.Partial = true
			cancel()
			return out, nil
		}
		if !errors.Is(rerr, netdisk.ErrRangeUnsupported) {
			release()
			cancel()
			NetdiskSvc.saveStatus(conn.ID, false, humanMessage(rerr))
			return nil, rerr
		}
		// 不支持 Range → 退化为全量
	}
	rc, err := drv.Open(ctx, clean)
	if err != nil {
		release()
		cancel()
		NetdiskSvc.saveStatus(conn.ID, false, humanMessage(err))
		return nil, err
	}
	if e, serr := drv.Stat(ctx, clean); serr == nil && e != nil {
		out.Total = e.Size
	}
	// 释放会话的时机交给调用方（流还在用），这里用一次性包装兜住 release 与 cancel
	out.Body = &streamGuard{rc: rc, release: release, cancel: cancel}
	out.Offset = 0
	out.Length = -1
	return out, nil
}

// streamGuard 在流关闭时归还会话并取消上下文。
type streamGuard struct {
	rc      io.ReadCloser
	release func()
	cancel  context.CancelFunc
}

func (g *streamGuard) Read(p []byte) (int, error) { return g.rc.Read(p) }

func (g *streamGuard) Close() error {
	err := g.rc.Close()
	if g.release != nil {
		g.release()
	}
	if g.cancel != nil {
		g.cancel()
	}
	return err
}

// ---------- 预览 / 下载短期 token ----------

// PreviewTokenTTLSeconds 预览 token 的有效期（秒），供前端配合展示「链接 2 小时内有效」。
func PreviewTokenTTLSeconds() int64 { return int64(previewTokenTTL / time.Second) }

// previewPayload 签名原文。uid / connID / path / exp **全部**参与签名：
// 换任何一个（哪怕是同用户的另一个连接）都会让签名对不上，杜绝横向越权。
func previewPayload(uid, connID uint64, path string, exp int64) string {
	return fmt.Sprintf("%d|%d|%s|%d", uid, connID, path, exp)
}

// previewSignature 计算签名（base64url，无填充，可直接放进 query）。
func previewSignature(uid, connID uint64, path string, exp int64) string {
	mac := hmac.New(sha256.New, netdisk.HMACKey())
	mac.Write([]byte(previewPayload(uid, connID, path, exp)))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

// MakePreviewToken 生成 2 小时有效的短期 token，格式 `exp.uid.sig`。
//
// 为什么需要它：`<video>` / `<img>` 的 src 无法带 Authorization 头，只能把身份签进 query。
// 为什么要把 uid 也放进明文段：回调时没有登录态可取 uid，
// 而签名必须绑定 uid（防止 A 用户拿自己的 token 去读 B 用户的文件）——
// uid 不是秘密（它同时也在签名里），放进明文段只是为了让服务端能还原出它。
func (s *NetdiskFileService) MakePreviewToken(uid, connID uint64, path string) string {
	exp := time.Now().Add(previewTokenTTL).Unix()
	return strconv.FormatInt(exp, 10) + "." + strconv.FormatUint(uid, 10) + "." +
		previewSignature(uid, connID, path, exp)
}

// ParsePreviewToken 解析并校验 token，返回签发时的 uid。失败返回 42012。
//
// connID 取 URL 里的 :id、path 取 query：它们不在 token 里，但**参与签名**，
// 因此「同一 token 换一条连接 / 换一个路径」必然校验失败。
func (s *NetdiskFileService) ParsePreviewToken(connID uint64, path, token string) (uint64, error) {
	if token == "" {
		return 0, netdisk.BadPreviewToken("缺少预览 token")
	}
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return 0, netdisk.BadPreviewToken("预览 token 格式错误")
	}
	exp, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil {
		return 0, netdisk.BadPreviewToken("预览 token 格式错误")
	}
	uid, err := strconv.ParseUint(parts[1], 10, 64)
	if err != nil || uid == 0 {
		return 0, netdisk.BadPreviewToken("预览 token 格式错误")
	}
	if time.Now().Unix() > exp {
		return 0, netdisk.BadPreviewToken("预览链接已过期，请重新打开")
	}
	if !hmac.Equal([]byte(previewSignature(uid, connID, path, exp)), []byte(parts[2])) {
		return 0, netdisk.BadPreviewToken("预览 token 无效")
	}
	clean, err := netdisk.CleanPath(path)
	if err != nil {
		return 0, err
	}
	_ = clean
	return uid, nil
}

// VerifyPreviewToken 校验 token 是否与「指定用户 + 连接 + 路径」匹配。
//
// 用于「请求本身已带登录态」的场景（fetch / XHR）：此时必须用登录态 uid 再比对一次，
// 否则拿到别人 token 的人只要带上自己的登录态就能越权。
func (s *NetdiskFileService) VerifyPreviewToken(uid, connID uint64, path, token string) error {
	got, err := s.ParsePreviewToken(connID, path, token)
	if err != nil {
		return err
	}
	if got != uid {
		return netdisk.BadPreviewToken("预览 token 无效")
	}
	return nil
}

// ---------- 任务临时文件 ----------

// netdiskTempDir 任务临时目录（storage.TempDir()/netdisk/<taskID>）。
func netdiskTempDir(taskID uint64) string {
	return filepath.Join(storage.TempDir(), "netdisk", strconv.FormatUint(taskID, 10))
}

// TaskBlob 取导入任务成功后的本地文件（供 handler 流式回给前端解析）。
func (s *NetdiskFileService) TaskBlob(id, uid uint64) (*model.NetdiskTask, string, error) {
	t, err := repository.GetNetdiskTask(id, uid)
	if err != nil {
		return nil, "", netdisk.TaskInvalid("任务不存在")
	}
	if t.Type != model.NetdiskTaskTypeImport {
		return nil, "", netdisk.TaskInvalid("只有导入任务可以取字节")
	}
	if t.Status != model.NetdiskTaskSuccess {
		return nil, "", netdisk.TaskInvalid("任务尚未完成，无法取字节")
	}
	if t.LocalPath == "" {
		return nil, "", netdisk.TaskInvalid("任务产物已清理，请重新导入")
	}
	if _, err := os.Stat(t.LocalPath); err != nil {
		return nil, "", netdisk.TaskInvalid("任务产物已清理，请重新导入")
	}
	return t, t.LocalPath, nil
}

// 编译期断言：确保 netdisk 的错误构造器在本文件被用到（避免误删 import）。
var _ = netdisk.PathNotFound

// HTTPStatus 供 handler 设置 Range 响应码（206 常量集中在这里，避免散落魔法数）。
const HTTPStatusPartialContent = http.StatusPartialContent
