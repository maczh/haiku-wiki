package service

import (
	"crypto/rand"
	"math/big"

	"gorm.io/gorm"

	"haiku-wiki/server/internal/model"
	hkerr "haiku-wiki/server/internal/pkg"
	"haiku-wiki/server/internal/pkg/fracidx"
	"haiku-wiki/server/internal/repository"
)

// BookService 知识库业务。
type BookService struct{}

var slugCharset = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"

// genSlug 生成 8 位随机短链标识。
func genSlug() string {
	b := make([]byte, 8)
	for i := range b {
		n, _ := rand.Int(rand.Reader, big.NewInt(int64(len(slugCharset))))
		b[i] = slugCharset[n.Int64()]
	}
	return string(b)
}

// BookshelfOutput 书架页数据：我的库 + 可见库。
type BookshelfOutput struct {
	Mine    []model.BookWithCount `json:"mine"`
	Visible []model.BookWithCount `json:"visible"`
}

// List 书架列表（mine + visible）。
func (s *BookService) List(userID uint64) (*BookshelfOutput, error) {
	mine, err := repository.ListBooksByOwner(userID)
	if err != nil {
		return nil, hkerr.Internal("查询失败")
	}
	visible, err := repository.ListBooksVisible(userID)
	if err != nil {
		return nil, hkerr.Internal("查询失败")
	}
	return &BookshelfOutput{Mine: mine, Visible: visible}, nil
}

// Create 创建知识库（默认封面色与私有可见性）。
func (s *BookService) Create(userID uint64, name, description, coverColor, visibility string) (*model.Book, error) {
	if name == "" {
		return nil, hkerr.Param("知识库名称不能为空")
	}
	if len(name) > 128 {
		return nil, hkerr.Param("知识库名称过长")
	}
	if coverColor == "" {
		coverColor = "#2f54eb"
	}
	if visibility != "private" && visibility != "members" && visibility != "public" {
		visibility = "private"
	}
	b := &model.Book{
		OwnerID:     userID,
		Name:        name,
		Description: description,
		CoverColor:  coverColor,
		Visibility:  visibility,
	}
	if visibility == "public" {
		slug := genSlug()
		b.ShareSlug = &slug
	}
	if err := repository.CreateBook(b); err != nil {
		return nil, hkerr.Internal("创建失败")
	}
	return b, nil
}

// Update 更新名称/简介/封面（仅 owner，路由层已拦截）。
func (s *BookService) Update(book *model.Book, name, description, coverColor, coverImage string) (*model.Book, error) {
	if name != "" {
		book.Name = name
	}
	if description != "" {
		book.Description = description
	}
	if coverColor != "" {
		book.CoverColor = coverColor
	}
	if coverImage != "" {
		book.CoverImage = coverImage
	}
	if err := repository.UpdateBook(book); err != nil {
		return nil, hkerr.Internal("保存失败")
	}
	return book, nil
}

// Delete 删除知识库并级联软删其下文档（仅 owner）。
func (s *BookService) Delete(book *model.Book) error {
	if err := repository.SoftDeleteDocsByBook(book.ID); err != nil {
		return hkerr.Internal("删除文档失败")
	}
	if err := repository.DeleteBook(book); err != nil {
		return hkerr.Internal("删除失败")
	}
	return nil
}

// SetVisibility 设置可见性三档；public 时生成 share_slug，离开 public 时清空 slug。
func (s *BookService) SetVisibility(book *model.Book, visibility string) (*model.Book, error) {
	if visibility != "private" && visibility != "members" && visibility != "public" {
		return nil, hkerr.Param("visibility 仅支持 private/members/public")
	}
	book.Visibility = visibility
	if visibility == "public" && book.ShareSlug == nil {
		slug := genSlug()
		book.ShareSlug = &slug
	}
	if visibility != "public" {
		book.ShareSlug = nil
	}
	if err := repository.UpdateBook(book); err != nil {
		return nil, hkerr.Internal("保存失败")
	}
	return book, nil
}

// DocService 文档树业务。
type DocService struct{}

// canWriteDoc 判定用户是否可写某文档（编辑/移动/删除）。
// 规则：owner 恒可写；members 库所有登录用户可写；public/private 仅 owner。
func canWriteDoc(book *model.Book, uid uint64) bool {
	return book.OwnerID == uid || (book.Visibility == "members" && uid > 0)
}

// loadDocForAccess 载入文档并做读/写权限校验。
func (s *DocService) loadDocForAccess(docID, uid uint64, write bool) (*model.Doc, *model.Book, error) {
	doc, err := repository.FindDocByID(docID)
	if err != nil {
		return nil, nil, hkerr.NotFound("文档不存在")
	}
	book, err := repository.FindBookByID(doc.BookID)
	if err != nil {
		return nil, nil, hkerr.NotFound("所属知识库不存在")
	}
	if write {
		if !canWriteDoc(book, uid) {
			return nil, nil, hkerr.Forbidden()
		}
	} else {
		if !canReadBook(book, uid) {
			return nil, nil, hkerr.Forbidden()
		}
	}
	return doc, book, nil
}

// LoadForRead 载入文档并校验读取权限（handler 层入口）。
func (s *DocService) LoadForRead(uid, docID uint64) (*model.Doc, *model.Book, error) {
	return s.loadDocForAccess(docID, uid, false)
}

// Tree 知识库目录树平铺列表（按 pos 字典序，前端组树）。
func (s *DocService) Tree(book *model.Book) ([]model.Doc, error) {
	return repository.ListTreeByBook(book.ID)
}

// CreateDoc 新建文档：pos 追加到兄弟末尾。
func (s *DocService) CreateDoc(book *model.Book, uid uint64, parentID uint64, title string) (*model.Doc, error) {
	if !canWriteDoc(book, uid) {
		return nil, hkerr.Forbidden()
	}
	if parentID != 0 {
		// 父节点必须属于同一知识库
		var p model.Doc
		if err := repository.DB().Where("id = ? AND book_id = ?", parentID, book.ID).First(&p).Error; err != nil {
			return nil, hkerr.Param("父节点不存在")
		}
	}
	if title == "" {
		title = "无标题文档"
	}
	if len(title) > 256 {
		title = title[:256]
	}
	siblings, err := repository.ListSiblings(book.ID, parentID, 0)
	if err != nil {
		return nil, hkerr.Internal("查询失败")
	}
	pos := fracidx.Initial()
	if len(siblings) > 0 {
		pos = fracidx.Between(siblings[len(siblings)-1].Pos, "")
	}
	doc := &model.Doc{
		BookID:    book.ID,
		ParentID:  parentID,
		Title:     title,
		Pos:       pos,
		Content:   "",
		CreatedBy: uid,
	}
	if err := repository.CreateDoc(doc); err != nil {
		return nil, hkerr.Internal("创建失败")
	}
	return doc, nil
}

// UpdateDoc 更新标题/正文；内容有变化时写入版本快照（source=auto|manual）。
// 返回更新后的文档与"内容是否变化"。
func (s *DocService) UpdateDoc(uid uint64, docID uint64, title *string, content *string, source string) (*model.Doc, bool, error) {
	doc, book, err := s.loadDocForAccess(docID, uid, true)
	if err != nil {
		return nil, false, err
	}
	changed := false
	if title != nil && *title != doc.Title {
		t := *title
		if t == "" {
			t = "无标题文档"
		}
		if len(t) > 256 {
			t = t[:256]
		}
		doc.Title = t
		changed = true
	}
	if content != nil && *content != doc.Content {
		doc.Content = *content
		changed = true
	}
	if !changed {
		return doc, false, nil
	}
	if err := repository.UpdateDoc(doc); err != nil {
		return nil, false, hkerr.Internal("保存失败")
	}
	if content != nil {
		// 内容变化即快照（自动保存 source=auto，手动保存 source=manual）
		if source != "manual" {
			source = "auto"
		}
		if err := defaultVersionService.Snapshot(doc, source, uid); err != nil {
			return nil, true, err
		}
	}
	_ = book
	return doc, true, nil
}

// isDescendant 判断 target 是否为 ancestor 的子孙。
func (s *DocService) isDescendant(bookID, ancestorID, targetID uint64) bool {
	cur := targetID
	for i := 0; i < 64; i++ { // 深度上限保护
		var d model.Doc
		if err := repository.DB().Select("id", "parent_id").First(&d, cur).Error; err != nil {
			return false
		}
		if d.ParentID == ancestorID {
			return true
		}
		if d.ParentID == 0 {
			return false
		}
		cur = d.ParentID
	}
	return false
}

// MoveInput 移动/排序请求。
type MoveInput struct {
	ParentID uint64 `json:"parent_id"`
	PrevPos  string `json:"prev_pos"` // 前一个兄弟的 pos（可为空）
	NextPos  string `json:"next_pos"` // 后一个兄弟的 pos（可为空）
}

// Move 移动文档（改父节点 + 排序）。pos 用 fractional index 生成；
// 若区间无解则整批兄弟重排（a0,a1,a2...）。
func (s *DocService) Move(uid uint64, docID uint64, in MoveInput) (*model.Doc, error) {
	doc, book, err := s.loadDocForAccess(docID, uid, true)
	if err != nil {
		return nil, err
	}
	if in.ParentID != 0 {
		var p model.Doc
		if err := repository.DB().Where("id = ? AND book_id = ?", in.ParentID, book.ID).First(&p).Error; err != nil {
			return nil, hkerr.Param("目标父节点不存在")
		}
		// 不能移动到自身或自己的子孙下面
		if in.ParentID == doc.ID || s.isDescendant(book.ID, doc.ID, in.ParentID) {
			return nil, hkerr.Param("不能移动到自身或其子孙节点下")
		}
	}
	siblings, err := repository.ListSiblings(book.ID, in.ParentID, doc.ID)
	if err != nil {
		return nil, hkerr.Internal("查询失败")
	}

	// 定位插入点：按 prev_pos / next_pos 匹配兄弟位置
	insertAt := len(siblings)
	if in.NextPos != "" {
		for i, sib := range siblings {
			if sib.Pos == in.NextPos {
				insertAt = i
				break
			}
		}
	} else if in.PrevPos != "" {
		for i, sib := range siblings {
			if sib.Pos == in.PrevPos {
				insertAt = i + 1
				break
			}
		}
	}

	var prevPos, nextPos string
	if insertAt > 0 {
		prevPos = siblings[insertAt-1].Pos
	}
	if insertAt < len(siblings) {
		nextPos = siblings[insertAt].Pos
	}

	newPos := fracidx.Between(prevPos, nextPos)
	if newPos == "" || (prevPos != "" && newPos <= prevPos) || (nextPos != "" && newPos >= nextPos) {
		// 无间隙/病态区间：重排整批兄弟
		pos, updates := renumberSiblings(siblings, insertAt)
		newPos = pos
		if err := repository.UpdateDocsPos(updates); err != nil {
			return nil, hkerr.Internal("排序失败")
		}
	}

	doc.ParentID = in.ParentID
	doc.Pos = newPos
	if err := repository.UpdateDoc(doc); err != nil {
		return nil, hkerr.Internal("移动失败")
	}
	return doc, nil
}

// SoftDelete 软删文档（进回收站，级联软删子孙）。
func (s *DocService) SoftDelete(uid uint64, docID uint64) error {
	doc, _, err := s.loadDocForAccess(docID, uid, true)
	if err != nil {
		return err
	}
	ids, err := repository.ListDescendantIDs(doc.BookID, doc.ID)
	if err != nil {
		return hkerr.Internal("查询失败")
	}
	return repository.DB().Transaction(func(tx *gorm.DB) error {
		// 软删全部子孙 + 自身
		return tx.Where("id IN ?", ids).Delete(&model.Doc{}).Error
	})
}

// renumberSiblings 兄弟重排兜底：按插入点重新分配 a0,a1,a2...。
// siblings 为按原 pos 升序、不含被移动节点的兄弟列表；
// 槽位布局：[0,insertAt) 为原兄弟，insertAt 为被移动文档，其后为剩余兄弟。
func renumberSiblings(siblings []model.Doc, insertAt int) (string, map[uint64]string) {
	updates := map[uint64]string{}
	pos := fracidx.Initial()
	for i := 0; i < insertAt && i < len(siblings); i++ {
		updates[siblings[i].ID] = pos
		pos = fracidx.Between(pos, "") // 追加，恒有解
	}
	result := pos // 被移动文档的新 pos
	pos = fracidx.Between(pos, "")
	for i := insertAt; i < len(siblings); i++ {
		updates[siblings[i].ID] = pos
		pos = fracidx.Between(pos, "")
	}
	return result, updates
}
