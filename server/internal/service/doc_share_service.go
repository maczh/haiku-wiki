package service

import (
	"crypto/rand"
	"math/big"
	"time"

	"golang.org/x/crypto/bcrypt"

	"haiku-wiki/server/internal/model"
	hkerr "haiku-wiki/server/internal/pkg"
	"haiku-wiki/server/internal/repository"
)

// DocShareService 文档级分享业务（与书级 ShareService 完全独立）。
type DocShareService struct{}

// shareSlugCharset 文档分享 slug 字符集（base62）。
const shareSlugCharset = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"

// genDocShareSlug 生成 12 位 base62 随机 slug（冲突由唯一索引兜底 + 重试）。
func genDocShareSlug() string {
	b := make([]byte, 12)
	for i := range b {
		n, _ := rand.Int(rand.Reader, big.NewInt(int64(len(shareSlugCharset))))
		b[i] = shareSlugCharset[n.Int64()]
	}
	return string(b)
}

// UpsertInput PUT /docs/:id/share 请求体（指针语义：nil = 不修改）。
type UpsertInput struct {
	Password  *string `json:"password"`   // 空串 = 清除密码
	ExpiresAt *string `json:"expires_at"` // RFC3339 UTC；null = 永久
	Enabled   *bool   `json:"enabled"`
}

// DocShareView 分享管理视图（抽屉回显 / upsert 响应）。
type DocShareView struct {
	Slug        string     `json:"slug"`
	HasPassword bool       `json:"has_password"`
	ExpiresAt   *time.Time `json:"expires_at"`
	Enabled     bool       `json:"enabled"`
	Views       uint64     `json:"views"`
	UpdatedAt   time.Time  `json:"updated_at"`
}

func toShareView(s *model.DocShare) *DocShareView {
	return &DocShareView{
		Slug:        s.Slug,
		HasPassword: s.PasswordHash != "",
		ExpiresAt:   s.ExpiresAt,
		Enabled:     s.Enabled,
		Views:       s.Views,
		UpdatedAt:   s.UpdatedAt,
	}
}

// Upsert 创建/更新二合一：存在则刷新 slug（旧链接立即失效）并覆盖密码/有效期/启停。
func (s *DocShareService) Upsert(userID, docID uint64, in UpsertInput) (*DocShareView, error) {
	// 权限判定与 PATCH docs 一致：owner 或 members 库可写
	ds := &DocService{}
	if _, _, err := ds.loadDocForAccess(docID, userID, true); err != nil {
		return nil, err
	}

	share, err := repository.FindDocShareByDocID(docID)
	if err != nil {
		share = &model.DocShare{DocID: docID, Slug: genDocShareSlug(), Enabled: true}
	} else {
		// 更新即刷新 slug：旧链接立即失效（主理人拍板语义）
		share.Slug = genDocShareSlug()
	}
	// slug 冲突重试（唯一索引兜底）
	for i := 0; repository.DocShareExistsBySlug(share.Slug) && i < 3; i++ {
		share.Slug = genDocShareSlug()
	}

	if in.Password != nil {
		pw := *in.Password
		if pw == "" {
			share.PasswordHash = ""
		} else {
			hash, e := bcrypt.GenerateFromPassword([]byte(pw), bcrypt.DefaultCost)
			if e != nil {
				return nil, hkerr.Internal("密码加密失败")
			}
			share.PasswordHash = string(hash)
		}
	}
	if in.ExpiresAt != nil {
		if *in.ExpiresAt == "" {
			share.ExpiresAt = nil
		} else {
			t, e := time.Parse(time.RFC3339, *in.ExpiresAt)
			if e != nil {
				return nil, hkerr.Param("有效期格式应为 RFC3339 UTC 时间")
			}
			share.ExpiresAt = &t
		}
	}
	if in.Enabled != nil {
		share.Enabled = *in.Enabled
	}
	if share.CreatedAt.IsZero() {
		share.CreatedAt = time.Now()
	}
	if err := repository.SaveDocShare(share); err != nil {
		return nil, hkerr.Internal("保存分享失败")
	}
	return toShareView(share), nil
}

// GetByDocID 分享抽屉回显；未创建过分享返回 nil（前端展示「未开启」）。
func (s *DocShareService) GetByDocID(userID, docID uint64) (*DocShareView, error) {
	ds := &DocService{}
	if _, _, err := ds.loadDocForAccess(docID, userID, false); err != nil {
		return nil, err
	}
	share, err := repository.FindDocShareByDocID(docID)
	if err != nil {
		return nil, nil
	}
	return toShareView(share), nil
}

// Revoke 撤销分享（物理删除，链接立即失效）。
func (s *DocShareService) Revoke(userID, docID uint64) error {
	ds := &DocService{}
	if _, _, err := ds.loadDocForAccess(docID, userID, true); err != nil {
		return err
	}
	if err := repository.DeleteDocShare(docID); err != nil {
		return hkerr.Internal("撤销失败")
	}
	return nil
}

// ShareMeta GET /api/public/doc-share/:slug 响应。
type ShareMeta struct {
	Title       string  `json:"title"`
	DocType     string  `json:"doc_type"`
	HasPassword bool    `json:"has_password"`
	Expired     bool    `json:"expired"`
	Views       *uint64 `json:"views,omitempty"` // 无密码分享顺带展示访问次数
}

// expired 判断分享是否已过有效期。
func shareExpired(s *model.DocShare) bool {
	return s.ExpiresAt != nil && s.ExpiresAt.Before(time.Now())
}

// GetPublicMeta 公开元信息：不存在或停用 → 40401；已过期 → 200 且 expired=true（前端渲染失效页）。
func (s *DocShareService) GetPublicMeta(slug string) (*ShareMeta, error) {
	share, err := repository.FindDocShareBySlug(slug)
	if err != nil || !share.Enabled {
		return nil, hkerr.NotFound("分享链接无效")
	}
	doc, err := repository.FindDocByID(share.DocID)
	if err != nil {
		return nil, hkerr.NotFound("分享链接无效")
	}
	meta := &ShareMeta{
		Title:       doc.Title,
		DocType:     doc.DocType,
		HasPassword: share.PasswordHash != "",
		Expired:     shareExpired(share),
	}
	if meta.Expired {
		return meta, nil
	}
	if share.PasswordHash == "" {
		v := share.Views
		meta.Views = &v
	}
	return meta, nil
}

// ShareContent POST /verify 成功响应：直接返回文档内容。
type ShareContent struct {
	Title   string `json:"title"`
	DocType string `json:"doc_type"`
	Content string `json:"content"`
}

// Verify 公开密码校验：限频（slug+IP 5 次/分钟，仅密码分享）→ 状态校验 → bcrypt 比对 → 返回内容。
func (s *DocShareService) Verify(slug, password, ip string) (*ShareContent, error) {
	share, err := repository.FindDocShareBySlug(slug)
	if err != nil || !share.Enabled {
		return nil, hkerr.NotFound("分享链接无效")
	}
	if shareExpired(share) {
		return nil, hkerr.NotFound("分享已失效")
	}
	if share.PasswordHash != "" {
		// 限频不消耗 bcrypt 比对机会
		if !hkerr.AllowShareVerify(slug + "|" + ip) {
			return nil, hkerr.TooManyRequests("密码错误次数过多，请 1 分钟后再试")
		}
		if bcrypt.CompareHashAndPassword([]byte(share.PasswordHash), []byte(password)) != nil {
			return nil, hkerr.New(40301, 403, "密码错误")
		}
	}
	doc, err := repository.FindDocByID(share.DocID)
	if err != nil {
		return nil, hkerr.NotFound("分享链接无效")
	}
	if e := repository.IncDocShareViews(share.ID); e != nil {
		// 统计失败不影响访问
		_ = e
	}
	return &ShareContent{Title: doc.Title, DocType: doc.DocType, Content: doc.Content}, nil
}
