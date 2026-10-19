package netdisk

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"

	"haiku-wiki/server/internal/config"
)

// 密文格式："v1:" + base64.StdEncoding(nonce[12] || ciphertext)
// v1 前缀为未来密钥轮换 / 算法升级留口。
const secretVersion = "v1:"

// ErrBadCipher 密文格式非法或被篡改（AES-GCM 解密失败统一归为该错误，
// 不区分具体原因，避免给攻击者提供侧信道）。
var ErrBadCipher = errors.New("网盘凭据密文无效")

// secretKey 取凭据加密主密钥：netdisk.secret_key 配置 / NETDISK_SECRET_KEY 环境变量，
// 为空时回落到 JWTSecret（保证零配置也能跑）。
//
// ⚠️ 回落到 JWTSecret 意味着「换 JWT 密钥会导致已保存的网盘凭据失效」，
// 这个耦合是刻意接受的（设计文档 §9-A8），运维上需在改 JWT 密钥前先删网盘连接。
func secretKey() string {
	if v := strings.TrimSpace(os.Getenv("NETDISK_SECRET_KEY")); v != "" {
		return v
	}
	if c := config.Current(); c != nil {
		if v := strings.TrimSpace(c.NetdiskSecretKey); v != "" {
			return v
		}
		if v := strings.TrimSpace(c.JWTSecret); v != "" {
			return v
		}
	}
	// 兜底：任何环境都不至于因为拿不到密钥而 panic（此时凭据只能在本进程内往返）。
	return "haiku-wiki-netdisk-fallback-secret"
}

// aesKey 由主密钥派生 32 字节 AES-256 密钥。
func aesKey() []byte {
	sum := sha256.Sum256([]byte(secretKey()))
	return sum[:]
}

// EncryptCredentials 加密凭据 → 密文串。
func EncryptCredentials(c *Credentials) (string, error) {
	if c == nil {
		return "", nil
	}
	plain, err := json.Marshal(c)
	if err != nil {
		return "", fmt.Errorf("marshal credentials: %w", err)
	}
	block, err := aes.NewCipher(aesKey())
	if err != nil {
		return "", fmt.Errorf("aes new cipher: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("aes new gcm: %w", err)
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", fmt.Errorf("read nonce: %w", err)
	}
	ct := gcm.Seal(nonce, nonce, plain, nil)
	return secretVersion + base64.StdEncoding.EncodeToString(ct), nil
}

// DecryptCredentials 解密密文串 → 凭据。密文为空返回空凭据（不是错误）。
func DecryptCredentials(s string) (*Credentials, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return &Credentials{}, nil
	}
	if !strings.HasPrefix(s, secretVersion) {
		return nil, ErrBadCipher
	}
	raw, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(s, secretVersion))
	if err != nil {
		return nil, ErrBadCipher
	}
	block, err := aes.NewCipher(aesKey())
	if err != nil {
		return nil, fmt.Errorf("aes new cipher: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("aes new gcm: %w", err)
	}
	if len(raw) < gcm.NonceSize() {
		return nil, ErrBadCipher
	}
	nonce, ct := raw[:gcm.NonceSize()], raw[gcm.NonceSize():]
	plain, err := gcm.Open(nil, nonce, ct, nil)
	if err != nil {
		return nil, ErrBadCipher
	}
	var c Credentials
	if err := json.Unmarshal(plain, &c); err != nil {
		return nil, ErrBadCipher
	}
	return &c, nil
}

// HMACKey 供「预览 / 下载短期 token」签名的密钥。
//
// 与凭据加密同源（都是 SHA256(secretKey)）：共用一把主密钥不会降低安全性
// （GCM 与 HMAC 的用途不同、输入域也不同），但换来「零配置即可用」的一致性。
func HMACKey() []byte { return aesKey() }

// ---------- 日志脱敏 ----------

// redacted 脱敏占位符。
const redacted = "***"

// Sanitize 返回去掉所有凭据字段的配置副本，供日志输出使用。
//
// Config 与 Credentials 刻意分离（驱动构造时才把凭据传进去），所以这里只需保证：
// 将来万一往 Config 里新增了敏感字段，也只改这一处即可 —— 全仓的网盘日志都必须
// 先过 Sanitize / SanitizeCredentials 再输出。
func Sanitize(cfg Config) Config {
	out := cfg
	if looksSensitive(out.Extra) {
		out.Extra = redacted
	}
	return out
}

// SanitizeCredentials 返回脱敏后的凭据副本（口令与 token 一律替换为 ***）。
func SanitizeCredentials(c *Credentials) *Credentials {
	if c == nil {
		return nil
	}
	out := *c
	if out.Password != "" {
		out.Password = redacted
	}
	if out.AccessToken != "" {
		out.AccessToken = redacted
	}
	if out.RefreshToken != "" {
		out.RefreshToken = redacted
	}
	return &out
}

// looksSensitive 粗判 Extra 是否可能含凭据（含 token/secret/password 关键字即视为敏感）。
func looksSensitive(s string) bool {
	low := strings.ToLower(s)
	return strings.Contains(low, "token") ||
		strings.Contains(low, "secret") ||
		strings.Contains(low, "password")
}
