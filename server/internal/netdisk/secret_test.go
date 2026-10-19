package netdisk

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

// TestCredentialsRoundTrip 加解密往返（含 OAuth token 与时间字段）。
func TestCredentialsRoundTrip(t *testing.T) {
	exp := time.Date(2026, 10, 19, 12, 0, 0, 0, time.UTC)
	in := &Credentials{
		Username:     "alice",
		Password:     "p@ss w0rd 中文",
		Domain:       "CORP",
		AccessToken:  "atk-123",
		RefreshToken: "rtk-456",
		TokenExpire:  exp,
	}
	enc, err := EncryptCredentials(in)
	if err != nil {
		t.Fatalf("加密失败: %v", err)
	}
	if !strings.HasPrefix(enc, secretVersion) {
		t.Fatalf("密文缺少版本前缀: %q", enc)
	}
	out, err := DecryptCredentials(enc)
	if err != nil {
		t.Fatalf("解密失败: %v", err)
	}
	if out.Username != in.Username || out.Password != in.Password || out.Domain != in.Domain {
		t.Fatalf("口令类字段往返不一致: %+v", out)
	}
	if out.AccessToken != in.AccessToken || out.RefreshToken != in.RefreshToken {
		t.Fatalf("token 往返不一致: %+v", out)
	}
	if !out.TokenExpire.Equal(exp) {
		t.Fatalf("TokenExpire 往返不一致: %v", out.TokenExpire)
	}
}

// TestDecryptEmpty 空密文返回空凭据而不是错误（匿名连接场景）。
func TestDecryptEmpty(t *testing.T) {
	c, err := DecryptCredentials("")
	if err != nil {
		t.Fatalf("空密文不应报错: %v", err)
	}
	if !c.IsEmpty() {
		t.Fatal("空密文应解出空凭据")
	}
}

// TestDecryptRejectsTampered 篡改密文必须失败（AES-GCM 认证标签校验）。
func TestDecryptRejectsTampered(t *testing.T) {
	enc, err := EncryptCredentials(&Credentials{Username: "bob", Password: "secret"})
	if err != nil {
		t.Fatalf("加密失败: %v", err)
	}
	body := strings.TrimPrefix(enc, secretVersion)
	// 翻转密文的第一个字符（base64 字母表内替换，保持可解码）
	mutated := "B" + body[1:]
	if _, err := DecryptCredentials(secretVersion + mutated); err == nil {
		t.Fatal("篡改后的密文应解密失败")
	}
	// 截断密文
	if _, err := DecryptCredentials(secretVersion + body[:4]); err == nil {
		t.Fatal("截断的密文应解密失败")
	}
	// 缺版本前缀
	if _, err := DecryptCredentials(body); err == nil {
		t.Fatal("缺少版本前缀应解密失败")
	}
	// 非法 base64
	if _, err := DecryptCredentials(secretVersion + "!!!not-base64!!!"); err == nil {
		t.Fatal("非法 base64 应解密失败")
	}
}

// TestDifferentCiphertextForSamePlain 同一明文两次加密结果不同（nonce 随机）。
func TestDifferentCiphertextForSamePlain(t *testing.T) {
	a, err := EncryptCredentials(&Credentials{Password: "same"})
	if err != nil {
		t.Fatal(err)
	}
	b, err := EncryptCredentials(&Credentials{Password: "same"})
	if err != nil {
		t.Fatal(err)
	}
	if a == b {
		t.Fatal("相同明文两次加密应产生不同密文（nonce 必须随机）")
	}
}

// TestSanitizeNoPlaintext 脱敏结果不得含任何明文口令 / token。
func TestSanitizeNoPlaintext(t *testing.T) {
	c := &Credentials{
		Username:     "alice",
		Password:     "super-secret-pw",
		AccessToken:  "atk-plain",
		RefreshToken: "rtk-plain",
	}
	sc := SanitizeCredentials(c)
	b, err := json.Marshal(sc)
	if err != nil {
		t.Fatal(err)
	}
	s := string(b)
	for _, leak := range []string{"super-secret-pw", "atk-plain", "rtk-plain"} {
		if strings.Contains(s, leak) {
			t.Fatalf("脱敏后仍含明文 %q: %s", leak, s)
		}
	}
	// 用户名不是敏感项，保留以便排查
	if !strings.Contains(s, "alice") {
		t.Fatalf("脱敏不应误删用户名: %s", s)
	}
	// 原对象不能被就地修改（返回的是副本）
	if c.Password != "super-secret-pw" {
		t.Fatal("SanitizeCredentials 不应修改入参")
	}
}

// TestSanitizeConfig 配置脱敏：Extra 含敏感关键字时打码。
func TestSanitizeConfig(t *testing.T) {
	cfg := Config{Kind: KindSMB, Host: "192.168.1.10", Extra: `{"drive_id":"d1","access_token":"tk"}`}
	out := Sanitize(cfg)
	if out.Extra == cfg.Extra {
		t.Fatal("含 access_token 的 Extra 应被脱敏")
	}
	if out.Host != cfg.Host {
		t.Fatal("非敏感字段应保留")
	}
	clean := Sanitize(Config{Extra: `{"drive_id":"d1"}`})
	if clean.Extra != `{"drive_id":"d1"}` {
		t.Fatal("不含敏感关键字的 Extra 不应被改")
	}
}
