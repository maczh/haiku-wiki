package service

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"haiku-wiki/server/internal/model"
	"haiku-wiki/server/internal/netdisk"
)

// 本文件覆盖「我的网盘」服务层的三条硬要求（设计文档 §7-T03 验收项）：
//  1. 脱敏：任何出参都不得带出凭据；
//  2. 参数校验：非法类型 / FTP 主动模式 / 非法名称必须被挡在 service 层；
//  3. 上限拦截：同名、连接数超限时给出确定错误码。

// ---------- 脱敏 ----------

// TestNetdiskConnectionDTO_NoCredentialLeak 断言 DTO 序列化后不含任何凭据字段或明文。
//
// 为什么断言 `"password"`（带引号）而不是 `password`：DTO 里有 has_password 这个
// 布尔位（设计允许，它不泄露任何信息），不带引号会误伤。
func TestNetdiskConnectionDTO_NoCredentialLeak(t *testing.T) {
	const secret = "p@ssw0rd-SuperSecret"
	enc, err := netdisk.EncryptCredentials(&netdisk.Credentials{
		Username:     "alice",
		Password:     secret,
		Domain:       "CORP",
		AccessToken:  "at-1234567890",
		RefreshToken: "rt-0987654321",
	})
	if err != nil {
		t.Fatalf("加密凭据失败: %v", err)
	}
	c := &model.NetdiskConnection{
		ID:      7,
		UserID:  1,
		Name:    "公司 NAS",
		Kind:    netdisk.KindSMB,
		Host:    "192.168.1.10",
		Port:    445,
		Share:   "books",
		Status:  model.NetdiskStatusConnected,
		CredEnc: enc,
		Account: "alice",
	}
	dto := ToConnectionDTO(c)
	raw, err := json.Marshal(dto)
	if err != nil {
		t.Fatalf("序列化 DTO 失败: %v", err)
	}
	body := string(raw)
	for _, bad := range []string{`"password"`, `"access_token"`, `"refresh_token"`, `"cred_enc"`, `"domain"`, secret, "at-1234567890", "rt-0987654321"} {
		if strings.Contains(body, bad) {
			t.Fatalf("DTO 泄露了敏感信息 %q，响应体=%s", bad, body)
		}
	}
	// 脱敏不等于「什么都不给」：连接状态与「是否配了口令」必须照常给前端（UI 依赖它）
	if !dto.HasPassword || !dto.HasToken {
		t.Fatalf("DTO 应当给出 has_password / has_token 布尔位：%+v", dto)
	}
	if dto.Status != model.NetdiskStatusConnected || dto.Kind != netdisk.KindSMB {
		t.Fatalf("DTO 基础字段有误：%+v", dto)
	}
}

// TestNetdiskToTaskDTO_NoLocalPath 任务 DTO 不得带出服务端临时路径。
func TestNetdiskToTaskDTO_NoLocalPath(t *testing.T) {
	dto := ToTaskDTO(&model.NetdiskTask{
		ID:        3,
		UserID:    1,
		ConnID:    7,
		Type:      model.NetdiskTaskTypeImport,
		Status:    model.NetdiskTaskFailed,
		Progress:  120, // 脏数据：必须被收敛到 100
		FileName:  "a.pdf",
		LocalPath: "/var/lib/haiku/data/tmp/netdisk/3/a.pdf",
		Retries:   1,
	})
	raw, _ := json.Marshal(dto)
	if strings.Contains(string(raw), "/var/lib/haiku") || strings.Contains(string(raw), "local_path") {
		t.Fatalf("任务 DTO 泄露了本地路径：%s", raw)
	}
	if dto.Progress != 100 {
		t.Fatalf("进度应被收敛到 100，实际 %d", dto.Progress)
	}
	if !dto.CanRetry {
		t.Fatalf("failed 且 retries<3 的任务应可重试：%+v", dto)
	}
}

// ---------- 参数校验（不需要数据库） ----------

// TestNetdiskBuildConnRejectsFTPActiveMode FTP 主动模式必须被后端拒绝（设计文档 §1.5）。
func TestNetdiskBuildConnRejectsFTPActiveMode(t *testing.T) {
	_, err := NetdiskSvc.buildConn(1, 0, netdisk.KindFTP, CreateReq{
		Name: "ftp",
		Kind: "ftp",
		Host: "127.0.0.1",
		Mode: "active",
	})
	if codeOf(t, err) != netdisk.CodeUnsupported {
		t.Fatalf("期望 42008（不支持的操作），实际 %d: %v", codeOf(t, err), err)
	}
}

// TestNetdiskValidateKind 非法类型 / 未启用类型必须被挡住。
func TestNetdiskValidateKind(t *testing.T) {
	// quark 永不入库
	if err := NetdiskSvc.validateKind("quark"); codeOf(t, err) != netdisk.CodeConfigInvalid {
		t.Fatalf("quark 应被拒绝（42001），实际 %v", err)
	}
	// 三种本地协议默认可用（不依赖服务端配置）
	for _, kind := range []string{netdisk.KindSMB, netdisk.KindFTP, netdisk.KindWebDAV} {
		if err := NetdiskSvc.validateKind(kind); err != nil {
			t.Fatalf("%s 应当可用，实际被拒：%v", kind, err)
		}
	}
}

// TestNetdiskValidateName 名称长度 1–64 且不能为空。
func TestNetdiskValidateName(t *testing.T) {
	if _, err := NetdiskSvc.validateName("   "); err == nil {
		t.Fatal("空白名称应被拒绝")
	}
	if _, err := NetdiskSvc.validateName(strings.Repeat("名", 65)); err == nil {
		t.Fatal("超过 64 字的名称应被拒绝")
	}
	got, err := NetdiskSvc.validateName("  我的网盘  ")
	if err != nil || got != "我的网盘" {
		t.Fatalf("名称应被 trim，实际 %q err=%v", got, err)
	}
}

// TestNetdiskSanitizeFileName 文件名必须被剥离路径分隔符，防止写出临时目录之外。
func TestNetdiskSanitizeFileName(t *testing.T) {
	cases := map[string]string{
		"a.pdf":         "a.pdf",
		"../../etc/pwd": "pwd",
		"C:\\a\\b.txt":  "b.txt",
		"..":            "",
		".":             "",
	}
	for in, want := range cases {
		if got := sanitizeFileName(in); got != want {
			t.Fatalf("sanitizeFileName(%q)=%q，期望 %q", in, got, want)
		}
	}
}

// TestNetdiskParseRangeHeader Range 解析（不支持的形式一律降级为全量）。
func TestNetdiskParseRangeHeader(t *testing.T) {
	// bytes=0-99 → 100 字节
	r := ParseRangeHeader("bytes=0-99")
	if !r.Has || r.Offset != 0 || r.Length != 100 {
		t.Fatalf("bytes=0-99 解析有误：%+v", r)
	}
	// bytes=100- → 到末尾
	r = ParseRangeHeader("bytes=100-")
	if !r.Has || r.Offset != 100 || r.Length != -1 {
		t.Fatalf("bytes=100- 解析有误：%+v", r)
	}
	// 多段 / 非法 / 空 → 降级为全量（降级比报错更符合浏览器预期）
	for _, h := range []string{"", "bytes=0-9,20-29", "items=0-9", "bytes=abc-def", "bytes=-100"} {
		if r := ParseRangeHeader(h); r.Has {
			t.Fatalf("%q 应降级为全量，实际 %+v", h, r)
		}
	}
}

// TestNetdiskPreviewToken 短期 token 的签发 / 解析 / 越权拦截。
func TestNetdiskPreviewToken(t *testing.T) {
	const path = "/books/a.pdf"
	token := NetdiskFileSvc.MakePreviewToken(42, 7, path)
	uid, err := NetdiskFileSvc.ParsePreviewToken(7, path, token)
	if err != nil {
		t.Fatalf("自己签的 token 应当能通过校验：%v", err)
	}
	if uid != 42 {
		t.Fatalf("解出的 uid 应为 42，实际 %d", uid)
	}
	// 换一条连接 → 签名必然对不上（防横向越权）
	if _, err := NetdiskFileSvc.ParsePreviewToken(8, path, token); codeOf(t, err) != netdisk.CodePreviewTokenBad {
		t.Fatalf("换连接应校验失败（42012），实际 %v", err)
	}
	// 换一个路径 → 同理
	if _, err := NetdiskFileSvc.ParsePreviewToken(7, "/books/b.pdf", token); codeOf(t, err) != netdisk.CodePreviewTokenBad {
		t.Fatalf("换路径应校验失败（42012），实际 %v", err)
	}
	// 带登录态时必须与登录 uid 比对
	if err := NetdiskFileSvc.VerifyPreviewToken(42, 7, path, token); err != nil {
		t.Fatalf("同用户校验应通过：%v", err)
	}
	if err := NetdiskFileSvc.VerifyPreviewToken(43, 7, path, token); codeOf(t, err) != netdisk.CodePreviewTokenBad {
		t.Fatalf("异用户校验应失败（42012），实际 %v", err)
	}
	// 空 token / 乱字符串 → 42012
	for _, bad := range []string{"", "abc", "1.2"} {
		if _, err := NetdiskFileSvc.ParsePreviewToken(7, path, bad); codeOf(t, err) != netdisk.CodePreviewTokenBad {
			t.Fatalf("%q 应校验失败（42012），实际 %v", bad, err)
		}
	}
}

// ---------- 需要数据库的用例 ----------

// TestNetdiskCreateDuplicateName 同名连接必须 42005。
func TestNetdiskCreateDuplicateName(t *testing.T) {
	newEnv(t)
	req := CreateReq{Name: "公司 NAS", Kind: netdisk.KindSMB, Host: "192.168.1.10", Share: "books"}
	if _, err := NetdiskSvc.Create(1, req); err != nil {
		t.Fatalf("首次创建应成功：%v", err)
	}
	if _, err := NetdiskSvc.Create(1, req); codeOf(t, err) != netdisk.CodeAlreadyExists {
		t.Fatalf("同名应返回 42005，实际 %d: %v", codeOf(t, err), err)
	}
	// 跨用户同名不受影响（唯一索引是 (user_id, name)）
	if _, err := NetdiskSvc.Create(2, req); err != nil {
		t.Fatalf("不同用户同名应允许：%v", err)
	}
}

// TestNetdiskCreateLimit 连接数达到上限（默认 10）后必须 42007。
func TestNetdiskCreateLimit(t *testing.T) {
	newEnv(t)
	for i := 0; i < 10; i++ {
		_, err := NetdiskSvc.Create(1, CreateReq{
			Name: "nas-" + string(rune('a'+i)),
			Kind: netdisk.KindSMB, Host: "192.168.1.10", Share: "books",
		})
		if err != nil {
			t.Fatalf("第 %d 条应当创建成功：%v", i+1, err)
		}
	}
	_, err := NetdiskSvc.Create(1, CreateReq{
		Name: "nas-overflow", Kind: netdisk.KindSMB, Host: "192.168.1.10", Share: "books",
	})
	if codeOf(t, err) != netdisk.CodeLimitExceeded {
		t.Fatalf("第 11 条应返回 42007，实际 %d: %v", codeOf(t, err), err)
	}
}

// TestNetdiskOAuthKindCannotBeCreatedDirectly 百度 / 阿里云盘必须走 OAuth。
func TestNetdiskOAuthKindCannotBeCreatedDirectly(t *testing.T) {
	newEnv(t)
	for _, kind := range []string{netdisk.KindBaidu, netdisk.KindAliyun} {
		_, err := NetdiskSvc.Create(1, CreateReq{Name: "x", Kind: kind})
		if codeOf(t, err) != netdisk.CodeKindDisabled {
			t.Fatalf("%s 直接创建应返回 42006，实际 %d: %v", kind, codeOf(t, err), err)
		}
	}
}

// TestNetdiskOAuthStateIsOneShot state 只能被消费一次（防回调重放）。
func TestNetdiskOAuthStateIsOneShot(t *testing.T) {
	newEnv(t)
	// 未配置百度 → Authorize 直接拒绝，这里只验证「可用」分支之外的确定性行为
	if _, _, err := NetdiskOAuthSvc.Authorize(1, "quark", "x"); codeOf(t, err) != netdisk.CodeConfigInvalid {
		t.Fatalf("非 OAuth 类型应返回 42001，实际 %d: %v", codeOf(t, err), err)
	}
	// 手动塞一个 state，验证 take 的一次性语义
	NetdiskOAuthSvc.put("unit-state", &oauthState{
		UID: 1, Name: "n", Provider: netdisk.KindBaidu, CreatedAt: time.Now(),
	})
	if _, ok := NetdiskOAuthSvc.take("unit-state"); !ok {
		t.Fatal("首次 take 应成功")
	}
	if _, ok := NetdiskOAuthSvc.take("unit-state"); ok {
		t.Fatal("state 必须是一次性的，第二次 take 应失败")
	}
}
