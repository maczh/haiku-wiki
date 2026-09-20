package service

import (
	"encoding/json"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"

	"haiku-wiki/server/internal/model"
	hkerr "haiku-wiki/server/internal/pkg"
	"haiku-wiki/server/internal/repository"
)

// CommentService 文档点评 / 讨论业务。
type CommentService struct{}

// 点评权限档位（从窄到宽）。
const (
	CommentScopeOwner = "owner"
	CommentScopeTeam  = "team"
	CommentScopeLogin = "login"
	CommentScopeAll   = "all"
)

const maxCommentBody = 20000

// IsDocModerator 文档点评管理权（删帖 / 禁言 / 清区 / 改配置）
// = 文档所有者 || 全局管理员 || 团队管理员。
func (s *CommentService) IsDocModerator(doc *model.Doc, book *model.Book, uid uint64) bool {
	if uid == 0 {
		return false
	}
	if book.OwnerID == uid || repository.IsAdmin(uid) {
		return true
	}
	if book.TeamID != nil && *book.TeamID != 0 {
		if t, err := repository.FindTeamByID(*book.TeamID); err == nil && t.OwnerID == uid {
			return true
		}
		if m, err := repository.FindTeamMember(*book.TeamID, uid); err == nil && m.Role == "admin" {
			return true
		}
	}
	return false
}

func defaultCommentSetting(docID uint64) *model.CommentSetting {
	return &model.CommentSetting{DocID: docID, AllowView: CommentScopeAll, AllowPost: CommentScopeAll, Locked: false}
}

// loadSetting 取配置；未配置过则返回默认（不落库，直到有人首次修改）。
func (s *CommentService) loadSetting(docID uint64) (*model.CommentSetting, error) {
	set, err := repository.GetCommentSetting(docID)
	if err != nil {
		return defaultCommentSetting(docID), nil
	}
	return set, nil
}

func teamContains(teamID, uid uint64) bool {
	_, err := repository.FindTeamMember(teamID, uid)
	return err == nil
}

// canView 判断 caller 是否满足 allow_view（uid==0 表示匿名访客，仅 all 档放行）。
func (s *CommentService) canView(set *model.CommentSetting, doc *model.Doc, book *model.Book, uid uint64) bool {
	switch set.AllowView {
	case CommentScopeAll:
		return true
	case CommentScopeLogin:
		return uid > 0
	case CommentScopeTeam:
		if uid == 0 {
			return false
		}
		return s.IsDocModerator(doc, book, uid) || (book.TeamID != nil && teamContains(*book.TeamID, uid))
	case CommentScopeOwner:
		if uid == 0 {
			return false
		}
		return s.IsDocModerator(doc, book, uid)
	}
	return true
}

// canPost 判断 caller 是否满足 allow_post（不含 locked / banned，调用方另行判断）。
func (s *CommentService) canPost(set *model.CommentSetting, doc *model.Doc, book *model.Book, uid uint64) bool {
	switch set.AllowPost {
	case CommentScopeAll:
		return true
	case CommentScopeLogin:
		return uid > 0
	case CommentScopeTeam:
		if uid == 0 {
			return false
		}
		return s.IsDocModerator(doc, book, uid) || (book.TeamID != nil && teamContains(*book.TeamID, uid))
	case CommentScopeOwner:
		if uid == 0 {
			return false
		}
		return s.IsDocModerator(doc, book, uid)
	}
	return true
}

// isBanned 登录用户是否被禁言。
func (s *CommentService) isBanned(set *model.CommentSetting, uid uint64) bool {
	if uid == 0 || set.BannedUIDs == "" {
		return false
	}
	var ids []uint64
	if err := json.Unmarshal([]byte(set.BannedUIDs), &ids); err != nil {
		return false
	}
	for _, id := range ids {
		if id == uid {
			return true
		}
	}
	return false
}

func clampScope(v string) string {
	switch v {
	case CommentScopeOwner, CommentScopeTeam, CommentScopeLogin, CommentScopeAll:
		return v
	}
	return CommentScopeAll
}

// AddComment 发帖 / 跟帖。uid==0 表示匿名访客（需 guestName，且仅 allow_post=all 时允许）。
func (s *CommentService) AddComment(uid uint64, doc *model.Doc, book *model.Book, parentID uint64, body, guestName, ip string) (*model.Comment, error) {
	body = strings.TrimSpace(body)
	if len([]rune(body)) == 0 {
		return nil, hkerr.Param("评论内容不能为空")
	}
	if len([]rune(body)) > maxCommentBody {
		return nil, hkerr.Param("评论内容过长（上限 20000 字）")
	}
	set, err := s.loadSetting(doc.ID)
	if err != nil {
		return nil, err
	}
	if set.Locked {
		return nil, hkerr.Forbidden()
	}
	if s.isBanned(set, uid) {
		return nil, hkerr.Forbidden()
	}
	if !s.canPost(set, doc, book, uid) {
		if uid == 0 {
			return nil, hkerr.New(40301, 403, "该文档不允许匿名访客发帖")
		}
		return nil, hkerr.Forbidden()
	}
	// 跟帖：父帖必须存在、属于本文、未删除
	if parentID != 0 {
		parent, err := repository.GetComment(parentID)
		if err != nil || parent.DocID != doc.ID {
			return nil, hkerr.Param("回复的帖子不存在")
		}
		if parent.Status != "normal" {
			return nil, hkerr.Param("不能回复已删除的帖子")
		}
	}
	c := &model.Comment{
		DocID:     doc.ID,
		ParentID:  parentID,
		AuthorUID: uid,
		Body:      body,
		Status:    "normal",
		IP:        ip,
	}
	if uid == 0 {
		name := strings.TrimSpace(guestName)
		if name == "" {
			name = "匿名访客"
		}
		if len([]rune(name)) > 32 {
			name = string([]rune(name)[:32])
		}
		c.GuestName = name
	} else if u, err := repository.FindUserByID(uid); err == nil {
		c.AuthorName = u.Nickname
	}
	if err := repository.CreateComment(c); err != nil {
		return nil, hkerr.Internal("发表失败")
	}
	return c, nil
}

// CommentView 前端树渲染节点。
type CommentView struct {
	ID         uint64        `json:"id"`
	ParentID   uint64        `json:"parent_id"`
	AuthorUID  uint64        `json:"author_uid"`
	GuestName  string        `json:"guest_name,omitempty"`
	AuthorName string        `json:"author_name,omitempty"`
	Body       string        `json:"body"`
	Status     string        `json:"status"`
	CreatedAt  time.Time     `json:"created_at"`
	Children   []CommentView `json:"children,omitempty"`
}

// CommentListResp 列表响应。
type CommentListResp struct {
	Comments    []CommentView `json:"comments"`
	CanModerate bool          `json:"can_moderate"`
	AllowView   string        `json:"allow_view"`
	AllowPost   string        `json:"allow_post"`
	Locked      bool          `json:"locked"`
}

// ListComments 列出文档点评（树形）。管理者可见全部（含已删），普通读者仅可见正常帖。
func (s *CommentService) ListComments(uid uint64, doc *model.Doc, book *model.Book) (*CommentListResp, error) {
	set, err := s.loadSetting(doc.ID)
	if err != nil {
		return nil, err
	}
	if !s.canView(set, doc, book, uid) {
		return nil, hkerr.Forbidden()
	}
	mod := s.IsDocModerator(doc, book, uid)
	var rows []model.Comment
	if mod {
		rows, err = repository.ListCommentsByDocUnscoped(doc.ID)
	} else {
		rows, err = repository.ListCommentsByDoc(doc.ID)
	}
	if err != nil {
		return nil, hkerr.Internal("查询失败")
	}
	views := make([]CommentView, 0, len(rows))
	for _, r := range rows {
		views = append(views, toCommentView(r))
	}
	return &CommentListResp{
		Comments:    buildTree(views),
		CanModerate: mod,
		AllowView:   set.AllowView,
		AllowPost:   set.AllowPost,
		Locked:      set.Locked,
	}, nil
}

func toCommentView(c model.Comment) CommentView {
	return CommentView{
		ID: c.ID, ParentID: c.ParentID, AuthorUID: c.AuthorUID,
		GuestName: c.GuestName, AuthorName: c.AuthorName,
		Body: c.Body, Status: c.Status, CreatedAt: c.CreatedAt,
	}
}

type commentNode struct {
	CommentView
	children []*commentNode
}

// buildTree 将平铺列表按 parent_id 组装成树（顶层 parent_id=0）。
func buildTree(items []CommentView) []CommentView {
	m := make(map[uint64]*commentNode, len(items))
	for _, it := range items {
		n := it
		m[it.ID] = &commentNode{CommentView: n}
	}
	var roots []*commentNode
	for _, n := range m {
		if n.ParentID == 0 {
			roots = append(roots, n)
			continue
		}
		if p, ok := m[n.ParentID]; ok {
			p.children = append(p.children, n)
		} else {
			roots = append(roots, n) // 孤儿归顶
		}
	}
	var conv func(ns []*commentNode) []CommentView
	conv = func(ns []*commentNode) []CommentView {
		out := make([]CommentView, 0, len(ns))
		for _, n := range ns {
			v := n.CommentView
			v.Children = conv(n.children)
			out = append(out, v)
		}
		return out
	}
	return conv(roots)
}

// CommentSettingInput 更新配置请求体（指针语义：nil = 不修改）。
type CommentSettingInput struct {
	AllowView  *string  `json:"allow_view"`
	AllowPost  *string  `json:"allow_post"`
	Locked     *bool    `json:"locked"`
	BannedUIDs []uint64 `json:"banned_uids"` // 覆盖式设置禁言名单（前端始终带当前名单，空数组 = 清空）
}

// CommentSettingOutput 配置输出（含禁言名单，仅供管理者读取）。
type CommentSettingOutput struct {
	DocID      uint64   `json:"doc_id"`
	AllowView  string   `json:"allow_view"`
	AllowPost  string   `json:"allow_post"`
	Locked     bool     `json:"locked"`
	BannedUIDs []uint64 `json:"banned_uids"`
}

// settingToOutput 把持久化模型转成对外输出（反序列化禁言名单）。
func settingToOutput(set *model.CommentSetting) *CommentSettingOutput {
	out := &CommentSettingOutput{
		DocID:     set.DocID,
		AllowView: set.AllowView,
		AllowPost: set.AllowPost,
		Locked:    set.Locked,
	}
	if set.BannedUIDs != "" {
		_ = json.Unmarshal([]byte(set.BannedUIDs), &out.BannedUIDs)
	}
	return out
}

// GetSettings 取配置（仅管理者）。
func (s *CommentService) GetSettings(uid, docID uint64) (*CommentSettingOutput, error) {
	doc, err := repository.FindDocByID(docID)
	if err != nil {
		return nil, hkerr.NotFound("文档不存在")
	}
	book, err := repository.FindBookByID(doc.BookID)
	if err != nil {
		return nil, hkerr.NotFound("所属知识库不存在")
	}
	if !s.IsDocModerator(doc, book, uid) {
		return nil, hkerr.Forbidden()
	}
	set, err := s.loadSetting(docID)
	if err != nil {
		return nil, err
	}
	return settingToOutput(set), nil
}

// UpdateSettings 改配置（仅管理者）。
func (s *CommentService) UpdateSettings(uid, docID uint64, in CommentSettingInput) (*CommentSettingOutput, error) {
	doc, err := repository.FindDocByID(docID)
	if err != nil {
		return nil, hkerr.NotFound("文档不存在")
	}
	book, err := repository.FindBookByID(doc.BookID)
	if err != nil {
		return nil, hkerr.NotFound("所属知识库不存在")
	}
	if !s.IsDocModerator(doc, book, uid) {
		return nil, hkerr.Forbidden()
	}
	set, err := s.loadSetting(docID)
	if err != nil {
		return nil, err
	}
	if in.AllowView != nil {
		set.AllowView = clampScope(*in.AllowView)
	}
	if in.AllowPost != nil {
		set.AllowPost = clampScope(*in.AllowPost)
	}
	if in.Locked != nil {
		set.Locked = *in.Locked
	}
	if in.BannedUIDs != nil {
		b, _ := json.Marshal(in.BannedUIDs)
		set.BannedUIDs = string(b)
	}
	if err := repository.UpsertCommentSetting(set); err != nil {
		return nil, hkerr.Internal("保存失败")
	}
	return settingToOutput(set), nil
}

// DeleteComment 删帖（仅管理者，软删保留树结构）。
func (s *CommentService) DeleteComment(uid, docID, cid uint64) error {
	doc, err := repository.FindDocByID(docID)
	if err != nil {
		return hkerr.NotFound("文档不存在")
	}
	book, err := repository.FindBookByID(doc.BookID)
	if err != nil {
		return hkerr.NotFound("所属知识库不存在")
	}
	if !s.IsDocModerator(doc, book, uid) {
		return hkerr.Forbidden()
	}
	c, err := repository.GetComment(cid)
	if err != nil || c.DocID != docID {
		return hkerr.NotFound("帖子不存在")
	}
	return repository.SoftDeleteComment(cid, uid)
}

// ClearComments 清空本文所有发贴（仅管理者，硬删）。
func (s *CommentService) ClearComments(uid, docID uint64) error {
	doc, err := repository.FindDocByID(docID)
	if err != nil {
		return hkerr.NotFound("文档不存在")
	}
	book, err := repository.FindBookByID(doc.BookID)
	if err != nil {
		return hkerr.NotFound("所属知识库不存在")
	}
	if !s.IsDocModerator(doc, book, uid) {
		return hkerr.Forbidden()
	}
	return repository.HardDeleteCommentsByDoc(docID)
}

// BanAuthor 禁言某帖作者（仅管理者；匿名访客无法单独禁言）。
func (s *CommentService) BanAuthor(uid, docID, cid uint64) error {
	doc, err := repository.FindDocByID(docID)
	if err != nil {
		return hkerr.NotFound("文档不存在")
	}
	book, err := repository.FindBookByID(doc.BookID)
	if err != nil {
		return hkerr.NotFound("所属知识库不存在")
	}
	if !s.IsDocModerator(doc, book, uid) {
		return hkerr.Forbidden()
	}
	c, err := repository.GetComment(cid)
	if err != nil || c.DocID != docID {
		return hkerr.NotFound("帖子不存在")
	}
	if c.AuthorUID == 0 {
		return hkerr.Param("匿名访客无法单独禁言，可关闭匿名发帖权限")
	}
	set, err := s.loadSetting(docID)
	if err != nil {
		return err
	}
	var ids []uint64
	if set.BannedUIDs != "" {
		_ = json.Unmarshal([]byte(set.BannedUIDs), &ids)
	}
	for _, id := range ids {
		if id == c.AuthorUID {
			return nil // 已在名单
		}
	}
	ids = append(ids, c.AuthorUID)
	b, _ := json.Marshal(ids)
	set.BannedUIDs = string(b)
	return repository.UpsertCommentSetting(set)
}

// ResolveAnonDoc 匿名访客通过分享 slug 解析文档：文档级 doc-share 优先，其次书级 share_slug。
func (s *CommentService) ResolveAnonDoc(slug string, docID uint64, password, ip string) (*model.Doc, *model.Book, error) {
	if slug == "" || docID == 0 {
		return nil, nil, hkerr.NotFound("缺少分享标识")
	}
	// 文档级分享
	if ds, err := repository.FindDocShareBySlug(slug); err == nil && ds.Enabled {
		if ds.ExpiresAt != nil && ds.ExpiresAt.Before(time.Now()) {
			return nil, nil, hkerr.NotFound("分享已失效")
		}
		if ds.PasswordHash != "" {
			if !hkerr.AllowShareVerify(slug + "|" + ip) {
				return nil, nil, hkerr.TooManyRequests("操作频繁，请稍后再试")
			}
			if bcrypt.CompareHashAndPassword([]byte(ds.PasswordHash), []byte(password)) != nil {
				return nil, nil, hkerr.New(40301, 403, "密码错误")
			}
		}
		doc, err := repository.FindDocByID(ds.DocID)
		if err != nil || doc.ID != docID {
			return nil, nil, hkerr.NotFound("分享链接无效")
		}
		book, err := repository.FindBookByID(doc.BookID)
		if err != nil {
			return nil, nil, hkerr.NotFound("所属知识库不存在")
		}
		return doc, book, nil
	}
	// 书级分享（仅 public 文库，与 GetShare 一致）
	if book, err := repository.FindBookBySlug(slug); err == nil {
		doc, err := repository.FindDocByID(docID)
		if err != nil || doc.BookID != book.ID {
			return nil, nil, hkerr.NotFound("分享链接无效")
		}
		return doc, book, nil
	}
	return nil, nil, hkerr.NotFound("分享链接无效")
}

// AnonCanPost 匿名访客是否满足发帖前置条件（供发图通道复用）。
func (s *CommentService) AnonCanPost(doc *model.Doc, book *model.Book) (bool, error) {
	set, err := s.loadSetting(doc.ID)
	if err != nil {
		return false, err
	}
	if set.Locked || s.isBanned(set, 0) {
		return false, nil
	}
	return s.canPost(set, doc, book, 0), nil
}
