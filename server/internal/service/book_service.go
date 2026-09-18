package service

import (
	"crypto/rand"
	"math/big"
	"time"

	"gorm.io/gorm"

	"haiku-wiki/server/internal/model"
	hkerr "haiku-wiki/server/internal/pkg"
	"haiku-wiki/server/internal/pkg/fracidx"
	"haiku-wiki/server/internal/repository"
	"haiku-wiki/server/internal/service/exportx"
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

// BookshelfOutput 书架页数据：我的库 + 可见库 + 参与的团队文库。
type BookshelfOutput struct {
	Mine    []model.BookWithCount `json:"mine"`
	Visible []model.BookWithCount `json:"visible"`
	Teams   []model.BookWithCount `json:"teams"`
}

// List 书架列表（mine + visible + teams）。
func (s *BookService) List(userID uint64) (*BookshelfOutput, error) {
	mine, err := repository.ListBooksByOwner(userID)
	if err != nil {
		return nil, hkerr.Internal("查询失败")
	}
	visible, err := repository.ListBooksVisible(userID)
	if err != nil {
		return nil, hkerr.Internal("查询失败")
	}
	teams, err := repository.ListTeamLibraries(userID)
	if err != nil {
		return nil, hkerr.Internal("查询失败")
	}
	// 实时计算当前用户对每本书的写权限（含公司知识库授权），随书架返回。
	attachCanWriteBooks(mine, userID)
	attachCanWriteBooks(visible, userID)
	attachCanWriteBooks(teams, userID)
	return &BookshelfOutput{Mine: mine, Visible: visible, Teams: teams}, nil
}

// attachCanWriteBooks 为书架列表项批量填充 CanWrite（book_writers 授权命中时）。
func attachCanWriteBooks(books []model.BookWithCount, uid uint64) {
	for i := range books {
		books[i].CanWrite = CanWriteBook(&books[i].Book, uid)
	}
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

// CreateTeamLibrary 创建团队文库：team_id 非空、name 为团队名+"文库"，默认私有。
// 团队文库对个人库而言仍私有可见性，但团队任意成员（team_members 任意角色）可读写（见 canReadBook/canWriteDoc）。
func (s *BookService) CreateTeamLibrary(teamID, ownerID uint64, name string) (*model.Book, error) {
	if name == "" {
		name = "文库"
	}
	if len(name) > 128 {
		name = name[:128]
	}
	b := &model.Book{
		OwnerID:    ownerID,
		Name:       name,
		Visibility: "private",
		TeamID:     &teamID,
	}
	if err := repository.CreateBook(b); err != nil {
		return nil, hkerr.Internal("创建团队文库失败")
	}
	return b, nil
}

// AutoCreateCompanyKB 系统启动种子：若不存在公司知识库则自动创建一个。
// 公司知识库 owner_id=0（系统持有，不对应真实用户），visibility=private 仅作占位，
// 实际读写权限由 canReadBook / canWriteDoc 的特殊分支控制（全员只读、管理员与授权用户可写）。
// 该函数幂等，可重复调用。
func (s *BookService) AutoCreateCompanyKB() error {
	n, err := repository.CountCompanyKBs()
	if err != nil {
		return hkerr.Internal("查询公司知识库失败")
	}
	if n > 0 {
		return nil
	}
	b := &model.Book{
		OwnerID:     0,
		Name:        "公司知识库",
		Description: "全员可读的公司公共知识库，管理员可授权成员协作编辑。",
		CoverColor:  "#722ed1",
		Visibility:  "private",
		IsCompanyKB: true,
	}
	if err := repository.CreateBook(b); err != nil {
		return hkerr.Internal("创建公司知识库失败")
	}
	return nil
}

// BookWriterService 公司知识库写权限授权业务（仅管理员操作）。
type BookWriterService struct{}

// Grant 授予用户某知识库的写权限（幂等）。
func (s *BookWriterService) Grant(bookID, userID uint64) (*model.BookWriter, error) {
	book, err := repository.FindBookByID(bookID)
	if err != nil {
		return nil, hkerr.NotFound("知识库不存在")
	}
	if !book.IsCompanyKB {
		return nil, hkerr.Param("仅公司知识库支持写权限授权")
	}
	if _, err := repository.FindUserByID(userID); err != nil {
		return nil, hkerr.NotFound("用户不存在")
	}
	bw := &model.BookWriter{BookID: bookID, UserID: userID}
	if err := repository.CreateBookWriter(bw); err != nil {
		return nil, hkerr.Internal("授权失败")
	}
	return bw, nil
}

// Revoke 撤销用户某知识库的写权限。
func (s *BookWriterService) Revoke(bookID, userID uint64) error {
	book, err := repository.FindBookByID(bookID)
	if err != nil {
		return hkerr.NotFound("知识库不存在")
	}
	if !book.IsCompanyKB {
		return hkerr.Param("仅公司知识库支持写权限授权")
	}
	if err := repository.DeleteBookWriter(bookID, userID); err != nil {
		return hkerr.Internal("撤销失败")
	}
	return nil
}

// ListWriters 列出某知识库的写授权用户（含用户展示信息）。
func (s *BookWriterService) ListWriters(bookID uint64) ([]model.BookWriterView, error) {
	book, err := repository.FindBookByID(bookID)
	if err != nil {
		return nil, hkerr.NotFound("知识库不存在")
	}
	if !book.IsCompanyKB {
		return nil, hkerr.Param("仅公司知识库支持写权限授权")
	}
	return repository.ListBookWriters(bookID)
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

// isTeamMember 判断用户是否为某团队成员（任意角色）。
func isTeamMember(teamID, uid uint64) bool {
	if teamID == 0 || uid == 0 {
		return false
	}
	_, err := repository.FindTeamMember(teamID, uid)
	return err == nil
}

// isTeamWriter 团队文库的写权限：团队 admin/read_write 可写（owner 恒写在 canWriteDoc 兜底）。
func isTeamWriter(book *model.Book, uid uint64) bool {
	if book.TeamID == nil || *book.TeamID == 0 {
		return false
	}
	m, err := repository.FindTeamMember(*book.TeamID, uid)
	if err != nil {
		return false
	}
	return m.Role == "admin" || m.Role == "read_write" || m.Role == "member"
}

// isTeamReader 团队文库的读权限：团队任意成员可读。
func isTeamReader(book *model.Book, uid uint64) bool {
	if book.TeamID == nil || *book.TeamID == 0 {
		return false
	}
	return isTeamMember(*book.TeamID, uid)
}

// isDocCollaborator 判断用户是否为某文档协作者。
func isDocCollaborator(docID, uid uint64) bool {
	if uid == 0 {
		return false
	}
	_, err := repository.FindDocCollaborator(docID, uid)
	return err == nil
}

// canWriteDoc 判定用户是否可写某文档（编辑/移动/删除）。
// 规则：owner 恒可写；members 库所有登录用户可写；团队文库（team_id 非空）团队任意成员可写；
// 文档协作者获得等价 owner 编辑权限；公司知识库（is_company_kb）仅管理员与经授权的写用户可写。
func canWriteDoc(book *model.Book, uid uint64) bool {
	if book.IsCompanyKB {
		// 公司知识库：所有登录用户只读，写权限限定为管理员与经授权的用户。
		return uid > 0 && (repository.IsBookWriter(book.ID, uid) || repository.IsAdmin(uid))
	}
	return book.OwnerID == uid || (book.Visibility == "members" && uid > 0) || isTeamWriter(book, uid)
}

// CanWriteBook 导出给 handler 等包外使用的写权限判定（团队文库权限已含）。
func CanWriteBook(book *model.Book, uid uint64) bool {
	return canWriteDoc(book, uid)
}

// CanReadBook 导出给 handler / middleware 等包外使用的读权限判定。
//
// 与 canReadBook 同源（public 任何人 / members 登录用户 / private 仅 owner，
// 团队文库团队任意成员可读），包外一律走这对 Can* 函数，避免权限语义二次漂移。
func CanReadBook(book *model.Book, uid uint64) bool {
	return canReadBook(book, uid)
}

// loadDocForAccess 载入文档并做读/写权限校验。
// 读：book 可见性（含团队文库成员可读）或文档协作者；写：canWriteDoc 或文档协作者。
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
		if !canWriteDoc(book, uid) && !isDocCollaborator(docID, uid) {
			return nil, nil, hkerr.Forbidden()
		}
	} else {
		if !canReadBook(book, uid) && !isDocCollaborator(docID, uid) {
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

// CreateDoc 新建文档：pos 追加到兄弟末尾；docType 由 handler 归一化（缺省 markdown）。
func (s *DocService) CreateDoc(book *model.Book, uid uint64, parentID uint64, title string, docType string) (*model.Doc, error) {
	return s.CreateDocWithContent(book, uid, parentID, title, docType, "")
}

// CreateDocWithContent 新建文档并写入初始正文。
// 附件型（doc_type=file）文档导入时借助它一次性落库 FileRef，此后正文不可再编辑。
func (s *DocService) CreateDocWithContent(book *model.Book, uid uint64, parentID uint64, title, docType, content string) (*model.Doc, error) {
	if !canWriteDoc(book, uid) {
		return nil, hkerr.Forbidden()
	}
	if docType == "" {
		docType = "markdown"
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
		DocType:   docType,
		Pos:       pos,
		Content:   content,
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
	if content != nil {
		// 附件型文档（导入的 docx/pdf）正文不可编辑：仅允许创建时一次性写入 FileRef
		if exportx.NormalizeDocType(doc.DocType) == "file" && doc.Content != "" && *content != doc.Content {
			return nil, false, hkerr.Param("附件型文档不支持编辑正文")
		}
		if *content != doc.Content {
			doc.Content = *content
			changed = true
		}
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

// Duplicate 复制文档（第四轮增量 R4）：新标题=原标题+" 副本"，同父级末尾，
// content/doc_type 原样复制，不复制版本快照。需编辑权限。
func (s *DocService) Duplicate(uid uint64, docID uint64) (*model.Doc, error) {
	doc, _, err := s.loadDocForAccess(docID, uid, true)
	if err != nil {
		return nil, err
	}
	// 含自身的兄弟列表 → 追加到末尾
	siblings, err := repository.ListSiblings(doc.BookID, doc.ParentID, 0)
	if err != nil {
		return nil, hkerr.Internal("查询失败")
	}
	pos := fracidx.Initial()
	if len(siblings) > 0 {
		pos = fracidx.Between(siblings[len(siblings)-1].Pos, "")
	}
	title := doc.Title + " 副本"
	if len(title) > 256 {
		title = title[:256]
	}
	cp := &model.Doc{
		BookID:    doc.BookID,
		ParentID:  doc.ParentID,
		Title:     title,
		DocType:   doc.DocType,
		Pos:       pos,
		Content:   doc.Content,
		CreatedBy: uid,
	}
	if err := repository.CreateDoc(cp); err != nil {
		return nil, hkerr.Internal("复制失败")
	}
	return cp, nil
}

// MoveToBookInput 跨知识库移动请求。
type MoveToBookInput struct {
	BookID uint64 `json:"book_id"`
}

// MoveToBook 移动文档到目标知识库根目录末尾（第四轮增量 R4）。
// 源库需编辑权限，目标库需编辑权限（owner 恒可写 / members 库登录用户可写 / 团队文库成员可写）；
// 跨库移动时整棵子树（含软删子孙）book_id 一并迁移，保证树结构完整。
func (s *DocService) MoveToBook(uid uint64, docID uint64, targetBookID uint64) (*model.Doc, error) {
	doc, _, err := s.loadDocForAccess(docID, uid, true)
	if err != nil {
		return nil, err
	}
	target, err := repository.FindBookByID(targetBookID)
	if err != nil {
		return nil, hkerr.NotFound("目标知识库不存在")
	}
	if !canWriteDoc(target, uid) {
		return nil, hkerr.Forbidden()
	}
	// 先取目标库根级兄弟（不含自身）确定追加 pos，再收集子树 ID（在事务外查询）
	siblings, err := repository.ListSiblings(target.ID, 0, doc.ID)
	if err != nil {
		return nil, hkerr.Internal("查询失败")
	}
	pos := fracidx.Initial()
	if len(siblings) > 0 {
		pos = fracidx.Between(siblings[len(siblings)-1].Pos, "")
	}
	subtreeIDs, err := repository.ListDescendantIDs(doc.BookID, doc.ID)
	if err != nil {
		return nil, hkerr.Internal("查询失败")
	}
	err = repository.DB().Transaction(func(tx *gorm.DB) error {
		// 子树整体迁移 book_id（同库移动时为幂等 no-op）
		if err := tx.Model(&model.Doc{}).Where("id IN ?", subtreeIDs).
			Update("book_id", target.ID).Error; err != nil {
			return err
		}
		doc.BookID = target.ID
		doc.ParentID = 0
		doc.Pos = pos
		return tx.Save(doc).Error
	})
	if err != nil {
		return nil, hkerr.Internal("移动失败")
	}
	return doc, nil
}

// SetPinned 置顶/取消置顶（第四轮增量 R4）：pinned=true 写入当前时间，false 置 NULL。
// 排序生效于同级（repository.ListTreeByBook ORDER BY CASE WHEN pinned_at IS NULL ...）。
func (s *DocService) SetPinned(uid uint64, docID uint64, pinned bool) (*model.Doc, error) {
	doc, _, err := s.loadDocForAccess(docID, uid, true)
	if err != nil {
		return nil, err
	}
	if pinned {
		now := time.Now()
		doc.PinnedAt = &now
	} else {
		doc.PinnedAt = nil
	}
	if err := repository.UpdateDoc(doc); err != nil {
		return nil, hkerr.Internal("保存失败")
	}
	return doc, nil
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
