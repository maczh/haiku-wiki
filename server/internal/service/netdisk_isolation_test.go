package service

import (
	"errors"
	"mime/multipart"
	"strings"
	"testing"

	"haiku-wiki/server/internal/model"
	"haiku-wiki/server/internal/netdisk"
	hkerr "haiku-wiki/server/internal/pkg"
	"haiku-wiki/server/internal/repository"
)

// 本文件是「我的网盘」用户间隔离的**服务层证明体系**（需求：SMB 协议必须解决
// 用户间隔离问题）。全部用例跑在 sqlite 内存库上（复用 newEnv），**不触网**：
//
//	造数：userA=1001（smb 连接 + 导入任务）、userB=1002（smb 连接）；
//	连接 host 一律 127.0.0.1:1（必然拒连）——任何误触网都会以 42002 失败，
//	从而把「提前被归属校验挡下」与「放了过去才失败」区分开；
//	断言：跨用户一律 404 语义（40401 / 文案含「不存在」）且错误码不是连接失败；
//	收尾：正向对照（本人 + 本人连接）必须走到真实建连并以 42002 失败，
//	证明测试不是「一律拒绝」。
//
// 与 netdisk_service_test.go 的分工：那个文件证明脱敏 / 参数校验 / 上限，
// 本文件只证明「跨用户 404 且不触网」。

const (
	isoUserA = 1001
	isoUserB = 1002
)

// wantCode 断言 err 是业务错误且码为 want（带用例名，失败信息含实际码与文案）。
func wantCode(t *testing.T, name string, err error, want int) {
	t.Helper()
	if err == nil {
		t.Fatalf("%s：期望业务错误 %d，实际为 nil（越权被放行了？）", name, want)
	}
	var ae *hkerr.AppError
	if !errors.As(err, &ae) {
		t.Fatalf("%s：非业务错误: %v", name, err)
	}
	if ae.Code != want {
		t.Fatalf("%s：期望错误码 %d，实际 %d（%s）", name, want, ae.Code, ae.Message)
	}
}

// wantNotFound 在 wantCode 之上追加「不存在」文案断言（跨用户接口的对外语义）。
func wantNotFound(t *testing.T, name string, err error, want int) {
	t.Helper()
	wantCode(t, name, err, want)
	var ae *hkerr.AppError
	if errors.As(err, &ae) && !strings.Contains(ae.Message, "不存在") {
		t.Fatalf("%s：错误文案应含「不存在」，实际 %q", name, ae.Message)
	}
}

// isoEnv 搭好隔离测试环境：两个用户 + A 的一条 smb 连接 + A 的一个导入任务。
// 返回 (connA, connB, taskA)。连接 host=127.0.0.1 port=1：误触网必然 42002。
func isoEnv(t *testing.T) (connA, connB *model.NetdiskConnection, taskA *model.NetdiskTask) {
	t.Helper()
	newEnv(t)
	dtoA, err := NetdiskSvc.Create(isoUserA, CreateReq{
		Name: "A的NAS", Kind: netdisk.KindSMB, Host: "127.0.0.1", Port: 1, Share: "x",
		Username: "u", Password: "p",
	})
	if err != nil {
		t.Fatalf("userA 建连接失败: %v", err)
	}
	dtoB, err := NetdiskSvc.Create(isoUserB, CreateReq{
		Name: "A的NAS", Kind: netdisk.KindSMB, Host: "127.0.0.1", Port: 1, Share: "x",
		Username: "u", Password: "p",
	})
	if err != nil {
		t.Fatalf("userB 建同名连接失败（唯一索引应为 (user_id,name)，跨用户同名必须允许）: %v", err)
	}
	if dtoA.ID == dtoB.ID {
		t.Fatalf("两个用户的连接 ID 不应相同: %d", dtoA.ID)
	}
	connA = &model.NetdiskConnection{ID: dtoA.ID, UserID: isoUserA}
	connB = &model.NetdiskConnection{ID: dtoB.ID, UserID: isoUserB}

	taskID, err := NetdiskTaskSvc.Submit(&model.NetdiskTask{
		UserID:   isoUserA,
		ConnID:   connA.ID,
		Type:     model.NetdiskTaskTypeImport,
		Status:   model.NetdiskTaskPending,
		FileName: "x.txt",
		SrcPath:  "/x.txt",
		DstPath:  "1:0",
	})
	if err != nil {
		t.Fatalf("userA 建导入任务失败: %v", err)
	}
	taskA = &model.NetdiskTask{ID: taskID, UserID: isoUserA, ConnID: connA.ID}
	return connA, connB, taskA
}

// TestNetdiskIsolation_ConnMustBelongToUser mustConn 是全部网盘操作的归属咽喉：
// 跨用户取连接一律 40401（不暴露资源是否存在），且绝不继续往下触网。
func TestNetdiskIsolation_ConnMustBelongToUser(t *testing.T) {
	connA, _, _ := isoEnv(t)
	if _, err := NetdiskSvc.mustConn(connA.ID, isoUserB); err == nil {
		t.Fatal("mustConn：userB 取 userA 的连接应被拒")
	} else {
		wantNotFound(t, "mustConn 跨用户", err, 40401)
	}
	// Get（handler 详情接口的同一条路径）同样 404
	if _, err := NetdiskSvc.Get(connA.ID, isoUserB); err == nil {
		t.Fatal("Get：userB 取 userA 的连接应被拒")
	} else {
		wantNotFound(t, "Get 跨用户", err, 40401)
	}
	// id=0 同样按不存在处理（不触库、不触网）
	if _, err := NetdiskSvc.mustConn(0, isoUserA); err == nil {
		t.Fatal("mustConn：id=0 应被拒")
	} else {
		wantNotFound(t, "mustConn id=0", err, 40401)
	}
}

// TestNetdiskIsolation_ListOnlySelf List 只返回当前用户的连接（跨用户同名互不可见）。
func TestNetdiskIsolation_ListOnlySelf(t *testing.T) {
	connA, connB, _ := isoEnv(t)
	listB, err := NetdiskSvc.List(isoUserB)
	if err != nil {
		t.Fatalf("List(userB) 失败: %v", err)
	}
	if len(listB) != 1 || listB[0].ID != connB.ID {
		t.Fatalf("userB 的列表应只有自己的 1 条（id=%d），实际 %+v", connB.ID, listB)
	}
	listA, err := NetdiskSvc.List(isoUserA)
	if err != nil {
		t.Fatalf("List(userA) 失败: %v", err)
	}
	if len(listA) != 1 || listA[0].ID != connA.ID {
		t.Fatalf("userA 的列表应只有自己的 1 条（id=%d），实际 %+v", connA.ID, listA)
	}
}

// TestNetdiskIsolation_ListDirCrossUser 列目录：跨用户 404 且在 Acquire 之前返回。
func TestNetdiskIsolation_ListDirCrossUser(t *testing.T) {
	connA, _, _ := isoEnv(t)
	_, err := NetdiskSvc.ListDir(connA.ID, isoUserB, "/", false)
	wantNotFound(t, "ListDir 跨用户", err, 40401)
}

// TestNetdiskIsolation_DirWriteCrossUser 目录写操作（新建 / 改名 / 移动 / 删除）：
// 跨用户一律 404，全部在取会话之前返回。
func TestNetdiskIsolation_DirWriteCrossUser(t *testing.T) {
	connA, _, _ := isoEnv(t)
	wantNotFound(t, "Mkdir 跨用户",
		NetdiskFileSvc.Mkdir(connA.ID, isoUserB, "/", "d"), 40401)
	wantNotFound(t, "Rename 跨用户",
		NetdiskFileSvc.Rename(connA.ID, isoUserB, "/x.txt", "y.txt"), 40401)
	wantNotFound(t, "Move 跨用户",
		NetdiskFileSvc.Move(connA.ID, isoUserB, "/x.txt", "/d"), 40401)
	wantNotFound(t, "Remove 跨用户",
		NetdiskFileSvc.Remove(connA.ID, isoUserB, "/x.txt", false), 40401)
}

// TestNetdiskIsolation_SubmitUploadCrossUser 上传：跨用户 404，
// 且必须在建任务之前返回——userB 名下任务数必须为 0。
func TestNetdiskIsolation_SubmitUploadCrossUser(t *testing.T) {
	connA, _, _ := isoEnv(t)
	fh := &multipart.FileHeader{Filename: "x.txt", Size: 1}
	_, err := NetdiskFileSvc.SubmitUpload(connA.ID, isoUserB, "/", fh)
	wantNotFound(t, "SubmitUpload 跨用户", err, 40401)
	tasks, lerr := repository.ListNetdiskTasks(isoUserB, 0, "", 0)
	if lerr != nil {
		t.Fatalf("查 userB 任务列表失败: %v", lerr)
	}
	if len(tasks) != 0 {
		t.Fatalf("越权上传不应给 userB 留下任何任务，实际 %+v", tasks)
	}
}

// TestNetdiskIsolation_SubmitImportCrossUser 导入：跨用户 404（不建任务、不触网）。
func TestNetdiskIsolation_SubmitImportCrossUser(t *testing.T) {
	connA, _, _ := isoEnv(t)
	_, err := NetdiskFileSvc.SubmitImport(connA.ID, isoUserB, "/x.txt", 1, 0)
	wantNotFound(t, "SubmitImport 跨用户", err, 40401)
}

// TestNetdiskIsolation_OpenStreamCrossUser 下载 / 预览流：跨用户 404。
func TestNetdiskIsolation_OpenStreamCrossUser(t *testing.T) {
	connA, _, _ := isoEnv(t)
	_, err := NetdiskFileSvc.OpenStream(connA.ID, isoUserB, "/x.txt", RangeSpec{})
	wantNotFound(t, "OpenStream 跨用户", err, 40401)
}

// TestNetdiskIsolation_TaskOpsCrossUser 任务三操作（详情 / 重试 / 取消）：
// 跨用户一律 40401。
func TestNetdiskIsolation_TaskOpsCrossUser(t *testing.T) {
	_, _, taskA := isoEnv(t)
	_, err := NetdiskTaskSvc.Get(taskA.ID, isoUserB)
	wantNotFound(t, "TaskSvc.Get 跨用户", err, 40401)
	_, err = NetdiskTaskSvc.Retry(taskA.ID, isoUserB)
	wantNotFound(t, "TaskSvc.Retry 跨用户", err, 40401)
	_, err = NetdiskTaskSvc.Cancel(taskA.ID, isoUserB)
	wantNotFound(t, "TaskSvc.Cancel 跨用户", err, 40401)
}

// TestNetdiskIsolation_TaskBlobCrossUser 导入产物取字节：跨用户 42011（任务不存在语义）。
// 注意与上面的区别：TaskBlob 把「查不到」包成 TaskInvalid(42011) 而非 NotFound，
// 这里断言的就是这个已实现契约（文案仍含「不存在」）。
func TestNetdiskIsolation_TaskBlobCrossUser(t *testing.T) {
	_, _, taskA := isoEnv(t)
	_, _, err := NetdiskFileSvc.TaskBlob(taskA.ID, isoUserB)
	wantNotFound(t, "TaskBlob 跨用户", err, netdisk.CodeTaskInvalid)
}

// TestNetdiskIsolation_PreviewTokenBinding 预览 token 与「连接 + 路径 + 用户」三重绑定：
// 换连接 / 换路径 / 换登录用户，全部 42012。
func TestNetdiskIsolation_PreviewTokenBinding(t *testing.T) {
	connA, connB, _ := isoEnv(t)
	const path = "/x.txt"
	tokenA := NetdiskFileSvc.MakePreviewToken(isoUserA, connA.ID, path)

	// 同一 token 换一条连接（B 的）→ 签名对不上
	if _, err := NetdiskFileSvc.ParsePreviewToken(connB.ID, path, tokenA); err == nil {
		t.Fatal("换连接的预览 token 应校验失败")
	} else {
		wantCode(t, "PreviewToken 换连接", err, netdisk.CodePreviewTokenBad)
	}
	// 同一连接换一个路径 → 同理
	if _, err := NetdiskFileSvc.ParsePreviewToken(connA.ID, "/y.txt", tokenA); err == nil {
		t.Fatal("换路径的预览 token 应校验失败")
	} else {
		wantCode(t, "PreviewToken 换路径", err, netdisk.CodePreviewTokenBad)
	}
	// 带上自己的登录态 + 别人的 token → 也越不了权（uid 参与签名）
	if err := NetdiskFileSvc.VerifyPreviewToken(isoUserB, connA.ID, path, tokenA); err == nil {
		t.Fatal("他人登录态 + 别人 token 应校验失败")
	} else {
		wantCode(t, "PreviewToken 换用户", err, netdisk.CodePreviewTokenBad)
	}
	// 正向：本人 + 本人连接 + 原路径 → 通过（证明不是一律拒绝）
	if err := NetdiskFileSvc.VerifyPreviewToken(isoUserA, connA.ID, path, tokenA); err != nil {
		t.Fatalf("本人 token 应通过校验: %v", err)
	}
}

// TestNetdiskIsolation_OwnerPathReallyConnects 正向对照：本人对本人连接必须
// **走到真实建连**并以 42002（主机不可达）失败——证明跨用户用例确实是
// 「被归属校验挡下」，而不是「一律拒绝」的假绿。
func TestNetdiskIsolation_OwnerPathReallyConnects(t *testing.T) {
	connA, connB, _ := isoEnv(t)
	_, errA := NetdiskSvc.ListDir(connA.ID, isoUserA, "/", false)
	wantCode(t, "userA 对自己的连接（应走到建连）", errA, netdisk.CodeConnectFailed)
	_, errB := NetdiskSvc.ListDir(connB.ID, isoUserB, "/", false)
	wantCode(t, "userB 对自己的连接（应走到建连）", errB, netdisk.CodeConnectFailed)
}
