package service

import (
	"strings"
	"testing"
	"time"

	"golang.org/x/crypto/bcrypt"

	pkg "haiku-wiki/server/internal/pkg"
	"haiku-wiki/server/internal/repository"
)

// resetShareVerify 重置分享密码限频计数（pkg 包名为 resp，避免导入别名）。
func resetShareVerify() {
	pkg.ResetShareVerify()
}

// ---------- 文档级分享（I01 / I10） ----------

func TestDocShareUpsertAndRevoke(t *testing.T) {
	newEnv(t)
	resetShareVerify()
	owner := mkUser(t, "share@x.com", "pass123", "member")
	book := mkBook(t, owner.ID, "分享库", "private")
	doc := mkDoc(t, book, owner.ID, 0, "分享文档")
	setDocContent(t, owner.ID, doc.ID, "分享正文")
	ss := &DocShareService{}

	// 创建：返回 slug，默认启用、无密码、永久
	v1, err := ss.Upsert(owner.ID, doc.ID, UpsertInput{})
	if err != nil {
		t.Fatalf("创建分享失败: %v", err)
	}
	if v1.Slug == "" || len(v1.Slug) != 12 {
		t.Fatalf("slug 应为 12 位 base62, got %q", v1.Slug)
	}
	if v1.HasPassword || !v1.Enabled || v1.ExpiresAt != nil {
		t.Fatalf("默认配置错误: %+v", v1)
	}
	// 回显
	got, err := ss.GetByDocID(owner.ID, doc.ID)
	if err != nil || got == nil || got.Slug != v1.Slug {
		t.Fatalf("回显失败: %+v err=%v", got, err)
	}
	// 未创建分享的文档回显为 nil
	other := mkDoc(t, book, owner.ID, 0, "未分享文档")
	got2, err := ss.GetByDocID(owner.ID, other.ID)
	if err != nil || got2 != nil {
		t.Fatalf("未分享文档应返回 nil: %+v err=%v", got2, err)
	}

	// 重复 upsert（更新）：刷新 slug，旧链接立即失效
	v2, err := ss.Upsert(owner.ID, doc.ID, UpsertInput{Enabled: boolPtr(false)})
	if err != nil {
		t.Fatalf("更新分享失败: %v", err)
	}
	if v2.Slug == v1.Slug {
		t.Fatal("更新分享应刷新 slug")
	}
	// 旧 slug 已不存在
	if _, err := repository.FindDocShareBySlug(v1.Slug); err == nil {
		t.Fatal("旧 slug 应立即失效")
	}
	// 一文档一条记录（doc_id 唯一）
	var n int64
	repository.DB().Table("doc_shares").Where("doc_id = ?", doc.ID).Count(&n)
	if n != 1 {
		t.Fatalf("doc_shares 应只有一条记录, got %d", n)
	}

	// 撤销：物理删除
	if err := ss.Revoke(owner.ID, doc.ID); err != nil {
		t.Fatalf("撤销失败: %v", err)
	}
	var n2 int64
	repository.DB().Table("doc_shares").Where("doc_id = ?", doc.ID).Count(&n2)
	if n2 != 0 {
		t.Fatalf("撤销后应物理删除, count=%d", n2)
	}
	// 撤销后凭 slug 不可访问
	if _, err := ss.GetPublicMeta(v2.Slug); codeOf(t, err) != 40401 {
		t.Fatalf("撤销后应 40401, got %v", err)
	}
}

func TestDocShareAuthz(t *testing.T) {
	newEnv(t)
	resetShareVerify()
	owner := mkUser(t, "sowner@x.com", "pass123", "member")
	member := mkUser(t, "smember@x.com", "pass123", "member")
	book := mkBook(t, owner.ID, "私有分享库", "private")
	doc := mkDoc(t, book, owner.ID, 0, "受限文档")
	ss := &DocShareService{}

	// 私有库他人不可创建/查看/撤销分享
	if _, err := ss.Upsert(member.ID, doc.ID, UpsertInput{}); codeOf(t, err) != 40301 {
		t.Fatalf("他人创建分享应 40301, got %v", err)
	}
	if _, err := ss.Upsert(owner.ID, doc.ID, UpsertInput{}); err != nil {
		t.Fatal(err)
	}
	if _, err := ss.GetByDocID(member.ID, doc.ID); codeOf(t, err) != 40301 {
		t.Fatalf("他人查看分享应 40301, got %v", err)
	}
	if err := ss.Revoke(member.ID, doc.ID); codeOf(t, err) != 40301 {
		t.Fatalf("他人撤销分享应 40301, got %v", err)
	}

	// members 库登录成员可管理分享
	mBook := mkBook(t, owner.ID, "成员分享库", "members")
	mDoc := mkDoc(t, mBook, owner.ID, 0, "成员文档")
	if _, err := ss.Upsert(member.ID, mDoc.ID, UpsertInput{}); err != nil {
		t.Fatalf("members 库成员应可管理分享: %v", err)
	}
}

func TestDocSharePasswordVerifyAndRateLimit(t *testing.T) {
	newEnv(t)
	resetShareVerify()
	owner := mkUser(t, "pshare@x.com", "pass123", "member")
	book := mkBook(t, owner.ID, "密码分享库", "private")
	doc := mkDoc(t, book, owner.ID, 0, "密码文档")
	setDocContent(t, owner.ID, doc.ID, "机密正文")
	ss := &DocShareService{}

	v, err := ss.Upsert(owner.ID, doc.ID, UpsertInput{Password: strPtr("secret99")})
	if err != nil {
		t.Fatal(err)
	}
	if !v.HasPassword {
		t.Fatal("设置密码后 has_password 应为 true")
	}

	// meta：有密码、未过期
	meta, err := ss.GetPublicMeta(v.Slug)
	if err != nil || !meta.HasPassword || meta.Expired || meta.Title != "密码文档" {
		t.Fatalf("meta 错误: %+v err=%v", meta, err)
	}

	// 错误密码 → 40301
	if _, err := ss.Verify(v.Slug, "wrong", "9.9.9.9"); codeOf(t, err) != 40301 {
		t.Fatalf("错误密码应 40301, got %v", err)
	}
	// 正确密码 → 返回内容
	out, err := ss.Verify(v.Slug, "secret99", "9.9.9.9")
	if err != nil || out.Content != "机密正文" || out.DocType != "markdown" {
		t.Fatalf("正确密码应返回内容: %+v err=%v", out, err)
	}
	// 访问次数自增
	v2, _ := ss.GetByDocID(owner.ID, doc.ID)
	if v2.Views != 1 {
		t.Fatalf("views 应为 1, got %d", v2.Views)
	}

	// 限频：同 slug+IP 5 次/分钟（第 6 次触发 42901，且不消耗比对机会）
	resetShareVerify()
	for i := 0; i < 5; i++ {
		_, _ = ss.Verify(v.Slug, "wrong-again", "8.8.8.8") // 全部 40301
	}
	if _, err := ss.Verify(v.Slug, "secret99", "8.8.8.8"); codeOf(t, err) != 42901 {
		t.Fatalf("第 6 次应 42901, got %v", err)
	}
	// 不同 IP 不受限
	if _, err := ss.Verify(v.Slug, "secret99", "8.8.8.9"); err != nil {
		t.Fatalf("不同 IP 不应被限频: %v", err)
	}
	// 无密码分享不走限频（访问次数多也放行）
	free, err := ss.Upsert(owner.ID, doc.ID, UpsertInput{Password: strPtr("")})
	if err != nil || free.HasPassword {
		t.Fatalf("清空密码失败: %+v err=%v", free, err)
	}
	resetShareVerify()
	for i := 0; i < 10; i++ {
		if _, err := ss.Verify(free.Slug, "", "7.7.7.7"); err != nil {
			t.Fatalf("无密码分享不应限频: %v", err)
		}
	}
}

func TestDocShareExpiryAndDisable(t *testing.T) {
	newEnv(t)
	resetShareVerify()
	owner := mkUser(t, "eshare@x.com", "pass123", "member")
	book := mkBook(t, owner.ID, "过期分享库", "private")
	doc := mkDoc(t, book, owner.ID, 0, "过期文档")
	setDocContent(t, owner.ID, doc.ID, "内容")
	ss := &DocShareService{}

	// 过去时间 → 已过期：meta 返回 expired=true（200），verify 返回 40401
	past := time.Now().Add(-time.Hour).UTC().Format(time.RFC3339)
	v, err := ss.Upsert(owner.ID, doc.ID, UpsertInput{ExpiresAt: &past})
	if err != nil {
		t.Fatal(err)
	}
	meta, err := ss.GetPublicMeta(v.Slug)
	if err != nil || !meta.Expired {
		t.Fatalf("过期分享 meta 应 expired=true: %+v err=%v", meta, err)
	}
	if _, err := ss.Verify(v.Slug, "", "6.6.6.6"); codeOf(t, err) != 40401 {
		t.Fatalf("过期分享 verify 应 40401, got %v", err)
	}

	// 未来时间 → 有效；传非法格式 → 40001
	future := time.Now().Add(24 * time.Hour).UTC().Format(time.RFC3339)
	if _, err := ss.Upsert(owner.ID, doc.ID, UpsertInput{ExpiresAt: &future}); err != nil {
		t.Fatalf("设置未来有效期失败: %v", err)
	}
	bad := "not-a-time"
	if _, err := ss.Upsert(owner.ID, doc.ID, UpsertInput{ExpiresAt: &bad}); codeOf(t, err) != 40001 {
		t.Fatalf("非法有效期应 40001, got %v", err)
	}

	// 停用 → meta/verify 均 40401
	disabled := false
	v2, err := ss.Upsert(owner.ID, doc.ID, UpsertInput{Enabled: &disabled, ExpiresAt: strPtr("")})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := ss.GetPublicMeta(v2.Slug); codeOf(t, err) != 40401 {
		t.Fatalf("停用分享 meta 应 40401, got %v", err)
	}
	if _, err := ss.Verify(v2.Slug, "", "6.6.6.6"); codeOf(t, err) != 40401 {
		t.Fatalf("停用分享 verify 应 40401, got %v", err)
	}

	// slug 随机性抽查（100 个不重复）
	seen := map[string]bool{}
	for i := 0; i < 100; i++ {
		s := genDocShareSlug()
		if len(s) != 12 || seen[s] || strings.ContainsAny(s, "!@#$") {
			t.Fatalf("slug 生成异常: %q", s)
		}
		seen[s] = true
	}
}

func TestDocShareBcryptStorage(t *testing.T) {
	newEnv(t)
	resetShareVerify()
	owner := mkUser(t, "bshare@x.com", "pass123", "member")
	book := mkBook(t, owner.ID, "哈希库", "private")
	doc := mkDoc(t, book, owner.ID, 0, "哈希文档")
	ss := &DocShareService{}
	if _, err := ss.Upsert(owner.ID, doc.ID, UpsertInput{Password: strPtr("plaintext9")}); err != nil {
		t.Fatal(err)
	}
	share, err := repository.FindDocShareByDocID(doc.ID)
	if err != nil {
		t.Fatal(err)
	}
	if share.PasswordHash == "plaintext9" || !strings.HasPrefix(share.PasswordHash, "$2") {
		t.Fatalf("密码应 bcrypt 存储: %q", share.PasswordHash)
	}
	if bcrypt.CompareHashAndPassword([]byte(share.PasswordHash), []byte("plaintext9")) != nil {
		t.Fatal("bcrypt 哈希与原密码不匹配")
	}
}

func boolPtr(b bool) *bool { return &b }
