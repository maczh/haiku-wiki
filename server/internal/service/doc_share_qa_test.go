package service

// QA 独立测试（测试轮次 1）——文档级分享：以全新视角覆盖工程师用例之外的边界。
// 关注点：密码保留/清除语义、限频 key 隔离、软删文档分享、views 统计、有效期清除与重启用。

import (
	"strings"
	"testing"
	"time"

	"golang.org/x/crypto/bcrypt"

	"haiku-wiki/server/internal/repository"
)

// upsert 构造小工具（区别于工程师用例的书写路径）。
func qaUpsert(t *testing.T, ss *DocShareService, uid, docID uint64, in UpsertInput) *DocShareView {
	t.Helper()
	v, err := ss.Upsert(uid, docID, in)
	if err != nil {
		t.Fatalf("Upsert 失败: %v", err)
	}
	return v
}

// TestQADocSharePasswordRetentionOnUpdate 更新时未传 password 字段应保留旧密码（指针语义）。
func TestQADocSharePasswordRetentionOnUpdate(t *testing.T) {
	newEnv(t)
	resetShareVerify()
	owner := mkUser(t, "qa-ret@x.com", "pass123", "member")
	book := mkBook(t, owner.ID, "QA密码保留库", "private")
	doc := mkDoc(t, book, owner.ID, 0, "QA密码文档")
	setDocContent(t, owner.ID, doc.ID, "QA机密")
	ss := &DocShareService{}

	v1 := qaUpsert(t, ss, owner.ID, doc.ID, UpsertInput{Password: strPtr("oldpw123")})
	if !v1.HasPassword {
		t.Fatal("设置密码后 has_password 应为 true")
	}

	// 再次 upsert：只改有效期，不传 password → 旧密码应保留
	future := time.Now().Add(24 * time.Hour).UTC().Format(time.RFC3339)
	v2 := qaUpsert(t, ss, owner.ID, doc.ID, UpsertInput{ExpiresAt: &future})
	if !v2.HasPassword {
		t.Fatal("更新未传 password 时旧密码应保留（has_password 仍为 true）")
	}
	// 旧密码仍能通过校验
	if _, err := ss.Verify(v2.Slug, "oldpw123", "1.2.3.4"); err != nil {
		t.Fatalf("保留的旧密码应可校验通过: %v", err)
	}
	// 错误密码仍拒绝
	if _, err := ss.Verify(v2.Slug, "oldpw123-wrong", "1.2.3.4"); codeOf(t, err) != 40301 {
		t.Fatalf("错误密码应 40301, got %v", err)
	}

	// 传空串 = 清除密码
	resetShareVerify()
	v3 := qaUpsert(t, ss, owner.ID, doc.ID, UpsertInput{Password: strPtr("")})
	if v3.HasPassword {
		t.Fatal("传空串后 has_password 应为 false")
	}
	share, err := repository.FindDocShareByDocID(doc.ID)
	if err != nil {
		t.Fatal(err)
	}
	if share.PasswordHash != "" {
		t.Fatalf("清除后 PasswordHash 应为空串, got %q", share.PasswordHash)
	}
	if _, err := ss.Verify(v3.Slug, "", "1.2.3.5"); err != nil {
		t.Fatalf("清除密码后空密码应可读取: %v", err)
	}
}

// TestQADocShareRateLimitKeyIsolation 限频 key = slug+IP：同 IP 不同 slug 互不影响。
func TestQADocShareRateLimitKeyIsolation(t *testing.T) {
	newEnv(t)
	resetShareVerify()
	owner := mkUser(t, "qa-iso@x.com", "pass123", "member")
	book := mkBook(t, owner.ID, "QA隔离库", "private")
	docA := mkDoc(t, book, owner.ID, 0, "文档A")
	setDocContent(t, owner.ID, docA.ID, "内容A")
	docB := mkDoc(t, book, owner.ID, 0, "文档B")
	setDocContent(t, owner.ID, docB.ID, "内容B")
	ss := &DocShareService{}

	vA := qaUpsert(t, ss, owner.ID, docA.ID, UpsertInput{Password: strPtr("pwA12345")})
	vB := qaUpsert(t, ss, owner.ID, docB.ID, UpsertInput{Password: strPtr("pwB12345")})

	// slug A 同一 IP 连错 5 次
	for i := 0; i < 5; i++ {
		if _, err := ss.Verify(vA.Slug, "bad", "4.4.4.4"); codeOf(t, err) != 40301 {
			t.Fatalf("A 第 %d 次错误密码应 40301, got %v", i+1, err)
		}
	}
	if _, err := ss.Verify(vA.Slug, "pwA12345", "4.4.4.4"); codeOf(t, err) != 42901 {
		t.Fatalf("A 第 6 次应 42901, got %v", err)
	}
	// 同 IP、不同 slug B：正确密码应放行（key 含 slug，不因 A 的失败而连坐）
	if _, err := ss.Verify(vB.Slug, "pwB12345", "4.4.4.4"); err != nil {
		t.Fatalf("同 IP 不同 slug 不应被限频: %v", err)
	}
	// 反向：B 连错 5 次后，A（新窗口内已耗尽）仍 42901，C 正确放行
	for i := 0; i < 5; i++ {
		_, _ = ss.Verify(vB.Slug, "bad", "4.4.4.4")
	}
	if _, err := ss.Verify(vA.Slug, "pwA12345", "4.4.4.4"); codeOf(t, err) != 42901 {
		t.Fatalf("A 仍应处于限频窗口, got %v", err)
	}
}

// TestQADocSharePublicNotFoundAndSoftDelete 不存在 slug / 文档被软删后的公开访问。
func TestQADocSharePublicNotFoundAndSoftDelete(t *testing.T) {
	newEnv(t)
	resetShareVerify()
	owner := mkUser(t, "qa-gone@x.com", "pass123", "member")
	book := mkBook(t, owner.ID, "QA软删库", "private")
	doc := mkDoc(t, book, owner.ID, 0, "QA软删文档")
	setDocContent(t, owner.ID, doc.ID, "内容")
	ss := &DocShareService{}
	v := qaUpsert(t, ss, owner.ID, doc.ID, UpsertInput{})

	// 不存在的 slug：meta 与 verify 均 40401
	if _, err := ss.GetPublicMeta("no-such-slug"); codeOf(t, err) != 40401 {
		t.Fatalf("不存在 slug meta 应 40401, got %v", err)
	}
	if _, err := ss.Verify("no-such-slug", "", "5.5.5.5"); codeOf(t, err) != 40401 {
		t.Fatalf("不存在 slug verify 应 40401, got %v", err)
	}

	// 文档软删 → 分享必须立即失效（不泄露内容）
	if err := (&DocService{}).SoftDelete(owner.ID, doc.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := ss.Verify(v.Slug, "", "5.5.5.5"); codeOf(t, err) != 40401 {
		t.Fatalf("文档软删后 verify 应 40401, got %v", err)
	}
	if _, err := ss.GetPublicMeta(v.Slug); codeOf(t, err) != 40401 {
		t.Fatalf("文档软删后 meta 应 40401, got %v", err)
	}
}

// TestQADocShareViewsStatistics views 统计：成功自增、失败/过期/停用不自增、meta 按有无密码区分。
func TestQADocShareViewsStatistics(t *testing.T) {
	newEnv(t)
	resetShareVerify()
	owner := mkUser(t, "qa-views@x.com", "pass123", "member")
	book := mkBook(t, owner.ID, "QA统计库", "private")
	doc := mkDoc(t, book, owner.ID, 0, "QA统计文档")
	setDocContent(t, owner.ID, doc.ID, "统计正文")
	ss := &DocShareService{}

	// 无密码分享：meta.Views 应有值且随成功访问自增
	v := qaUpsert(t, ss, owner.ID, doc.ID, UpsertInput{})
	for i := 0; i < 3; i++ {
		if _, err := ss.Verify(v.Slug, "", "6.6.6.6"); err != nil {
			t.Fatal(err)
		}
	}
	meta, err := ss.GetPublicMeta(v.Slug)
	if err != nil {
		t.Fatal(err)
	}
	if meta.Views == nil || *meta.Views != 3 {
		t.Fatalf("无密码分享 meta.Views 应为 3, got %v", meta.Views)
	}
	// 管理端回显 views
	mv, err := ss.GetByDocID(owner.ID, doc.ID)
	if err != nil || mv.Views != 3 {
		t.Fatalf("管理端 views 应为 3: %+v err=%v", mv, err)
	}

	// 失败访问（错误密码）不自增
	resetShareVerify()
	v2 := qaUpsert(t, ss, owner.ID, doc.ID, UpsertInput{Password: strPtr("pw123456")})
	if _, err := ss.Verify(v2.Slug, "bad", "6.6.6.7"); codeOf(t, err) != 40301 {
		t.Fatalf("错误密码应 40301, got %v", err)
	}
	mv2, _ := ss.GetByDocID(owner.ID, doc.ID)
	if mv2.Views != 3 {
		t.Fatalf("失败访问不应自增 views, got %d", mv2.Views)
	}
	// 有密码分享的 meta.Views 不应下发（omitempty）
	meta2, err := ss.GetPublicMeta(v2.Slug)
	if err != nil {
		t.Fatal(err)
	}
	if meta2.Views != nil {
		t.Fatalf("有密码分享 meta.Views 应为 nil, got %v", *meta2.Views)
	}
}

// TestQADocShareExpiryClearAndReenable 有效期清除（恢复永久）与停用/重启用全链路。
func TestQADocShareExpiryClearAndReenable(t *testing.T) {
	newEnv(t)
	resetShareVerify()
	owner := mkUser(t, "qa-exp@x.com", "pass123", "member")
	book := mkBook(t, owner.ID, "QA有效期库", "private")
	doc := mkDoc(t, book, owner.ID, 0, "QA有效期文档")
	setDocContent(t, owner.ID, doc.ID, "内容")
	ss := &DocShareService{}

	// 过去时间 → 失效
	past := time.Now().Add(-time.Minute).UTC().Format(time.RFC3339)
	v := qaUpsert(t, ss, owner.ID, doc.ID, UpsertInput{ExpiresAt: &past})
	if _, err := ss.Verify(v.Slug, "", "7.7.7.7"); codeOf(t, err) != 40401 {
		t.Fatalf("过期 verify 应 40401, got %v", err)
	}
	// 传空串清除有效期 → 恢复永久可用
	v2 := qaUpsert(t, ss, owner.ID, doc.ID, UpsertInput{ExpiresAt: strPtr("")})
	if v2.ExpiresAt != nil {
		t.Fatalf("空串应清除有效期（nil=永久）, got %v", v2.ExpiresAt)
	}
	if _, err := ss.Verify(v2.Slug, "", "7.7.7.7"); err != nil {
		t.Fatalf("清除有效期后应可访问: %v", err)
	}

	// 停用 → meta/verify 40401；重启用 → 恢复
	disabled := false
	v3 := qaUpsert(t, ss, owner.ID, doc.ID, UpsertInput{Enabled: &disabled})
	if v3.Enabled {
		t.Fatal("停用后 enabled 应为 false")
	}
	if _, err := ss.GetPublicMeta(v3.Slug); codeOf(t, err) != 40401 {
		t.Fatalf("停用 meta 应 40401, got %v", err)
	}
	if _, err := ss.Verify(v3.Slug, "", "7.7.7.7"); codeOf(t, err) != 40401 {
		t.Fatalf("停用 verify 应 40401, got %v", err)
	}
	enabled := true
	v4 := qaUpsert(t, ss, owner.ID, doc.ID, UpsertInput{Enabled: &enabled})
	if !v4.Enabled {
		t.Fatal("重启用后 enabled 应为 true")
	}
	if _, err := ss.Verify(v4.Slug, "", "7.7.7.8"); err != nil {
		t.Fatalf("重启用后应可访问: %v", err)
	}
}

// TestQADocShareBcryptNotPlaintextInAnyPath bcrypt 哈希与明文差异（每次哈希不同）。
func TestQADocShareBcryptNotPlaintextInAnyPath(t *testing.T) {
	newEnv(t)
	resetShareVerify()
	owner := mkUser(t, "qa-bc@x.com", "pass123", "member")
	book := mkBook(t, owner.ID, "QA哈希库", "private")
	doc := mkDoc(t, book, owner.ID, 0, "QA哈希文档")
	ss := &DocShareService{}
	qaUpsert(t, ss, owner.ID, doc.ID, UpsertInput{Password: strPtr("same-password")})
	share1, err := repository.FindDocShareByDocID(doc.ID)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(share1.PasswordHash, "same-password") {
		t.Fatal("哈希中不应包含明文")
	}
	if bcrypt.CompareHashAndPassword([]byte(share1.PasswordHash), []byte("same-password")) != nil {
		t.Fatal("bcrypt 校验应通过")
	}
	// 重新 upsert 相同密码：新盐 → 哈希不同（盐值生效）
	qaUpsert(t, ss, owner.ID, doc.ID, UpsertInput{Password: strPtr("same-password")})
	share2, err := repository.FindDocShareByDocID(doc.ID)
	if err != nil {
		t.Fatal(err)
	}
	if share1.PasswordHash == share2.PasswordHash {
		t.Fatal("相同密码两次哈希应不同（盐值）")
	}
}
