package service

import (
	"sort"

	"haiku-wiki/server/internal/model"
	hkerr "haiku-wiki/server/internal/pkg"
	"haiku-wiki/server/internal/repository"
)

// WorkbenchDocView 工作台条目：文档基本信息 + 正文。
//
// 带 content 是刻意的 —— 待办完成率、甘特图进度、今日日程都必须解析正文才能算出来。
type WorkbenchDocView struct {
	ID        uint64 `json:"id"`
	Title     string `json:"title"`
	DocType   string `json:"doc_type"`
	BookID    uint64 `json:"book_id"`
	BookName  string `json:"book_name"`
	UpdatedAt string `json:"updated_at"`
	CanWrite  bool   `json:"can_write"`
	Content   string `json:"content"`
}

// WorkbenchView 工作台聚合结果。
//
// Items 是「按类型取最近更新的若干篇」，Counts 是「各类型文档总数」——
// 两者分开是因为卡片标题要显示「共 N 篇」，而列表只展示最近几篇。
type WorkbenchView struct {
	Items  []WorkbenchDocView `json:"items"`
	Counts map[string]int     `json:"counts"`
}

// workbenchDocTypes 工作台关注的三类「有结构化正文」的文档。
// 顺序即前端卡片的优先级顺序（待办 → 甘特 → 日历）。
var workbenchDocTypes = []string{"todo", "gantt", "calendar"}

const (
	// workbenchMaxPerType 单类型最多返回条数。
	workbenchMaxPerType = 20
	// workbenchDefaultPerType 单类型默认条数（首页只展示最近几篇）。
	workbenchDefaultPerType = 8
	// workbenchOverfetch 初筛窗口放大倍数：合并 + 权限过滤后仍要凑够 perType 条。
	workbenchOverfetch = 4
)

// Workbench 工作台聚合：一次请求拿到「待办 / 甘特图 / 工作日历」三类文档。
//
// bookID > 0 时限定在单个知识库内（文库工作台/知识库页空态用）：此时要求用户对该库可读，
// 不可读直接报错，而不是静默返回空——「无权限」与「没有这类文档」对用户是两件事。
//
// 为什么不复用 RecentDocs：最近更新只返回元数据，前端拿不到正文就算不出进度；
// 若让前端逐篇再调 GET /docs/:id 取正文，会变成 N+1 请求（10 篇就是 10 次往返）。
// 这里把「按类型筛选 + 带正文」合并成一次查询，单类型条数设上限控住返回体积。
//
// 权限口径与 RecentDocs 完全一致：先按 ListReadableBookIDs 初筛，再逐条 canReadBook
// 复核（协作文档额外放行），避免 SQL 条件与业务权限口径漂移导致越权。
func (s *DocService) Workbench(uid uint64, perType int, bookID uint64) (*WorkbenchView, error) {
	if uid == 0 {
		return nil, hkerr.Unauthorized()
	}
	if perType <= 0 {
		perType = workbenchDefaultPerType
	}
	if perType > workbenchMaxPerType {
		perType = workbenchMaxPerType
	}

	bookIDs, err := repository.ListReadableBookIDs(uid)
	if err != nil {
		return nil, hkerr.Internal("查询失败")
	}
	if bookID > 0 {
		// 单库模式：库必须存在且可读。协作者路径不参与——文库工作台挂在库页内，
		// 库本身读不到就整体不可见，不应再从协作者缝隙里漏出条目。
		book, e := repository.FindBookByID(bookID)
		if e != nil || book == nil || !canReadBook(book, uid) {
			return nil, hkerr.NotFound("知识库不存在或无权访问")
		}
		bookIDs = []uint64{bookID}
	}

	window := perType * len(workbenchDocTypes) * workbenchOverfetch
	inBooks, err := repository.ListWorkbenchDocsInBooks(bookIDs, workbenchDocTypes, window)
	if err != nil {
		return nil, hkerr.Internal("查询失败")
	}
	collab := []repository.WorkbenchDocItem(nil)
	if bookID == 0 {
		// 全局模式才需要协作者补漏（作为协作者可读到读不到的库里的文档）；
		// 单库模式库可读是前置门槛，补漏只会引入其他库的条目。
		collab, err = repository.ListWorkbenchCollaboratorDocs(uid, workbenchDocTypes, window)
		if err != nil {
			return nil, hkerr.Internal("查询失败")
		}
	}

	// 合并去重（同一文档可能同时来自两条路径）
	merged := make([]repository.WorkbenchDocItem, 0, len(inBooks)+len(collab))
	seen := make(map[uint64]bool, len(inBooks)+len(collab))
	for _, it := range append(append([]repository.WorkbenchDocItem{}, inBooks...), collab...) {
		if it.ID == 0 || seen[it.ID] {
			continue
		}
		seen[it.ID] = true
		merged = append(merged, it)
	}
	sort.SliceStable(merged, func(i, j int) bool {
		return merged[i].UpdatedAt.After(merged[j].UpdatedAt)
	})

	books := make(map[uint64]*model.Book, len(bookIDs))
	loadBook := func(id uint64) *model.Book {
		if b, ok := books[id]; ok {
			return b
		}
		b, e := repository.FindBookByID(id)
		if e != nil {
			books[id] = nil
			return nil
		}
		books[id] = b
		return b
	}

	// 按类型各取 perType 条（已按 updated_at 倒序，故取到的就是每类最新几篇）
	taken := make(map[string]int, len(workbenchDocTypes))
	out := make([]WorkbenchDocView, 0, perType*len(workbenchDocTypes))
	for _, it := range merged {
		if taken[it.DocType] >= perType {
			continue
		}
		book := loadBook(it.BookID)
		if book == nil {
			continue
		}
		if !canReadBook(book, uid) && !isDocCollaborator(it.ID, uid) {
			continue
		}
		taken[it.DocType]++
		out = append(out, WorkbenchDocView{
			ID:        it.ID,
			Title:     it.Title,
			DocType:   it.DocType,
			BookID:    it.BookID,
			BookName:  it.BookName,
			UpdatedAt: it.UpdatedAt.Format("2006-01-02T15:04:05Z07:00"),
			CanWrite:  canWriteDoc(book, uid),
			Content:   it.Content,
		})
	}

	counts, err := repository.CountWorkbenchDocsByType(bookIDs, workbenchDocTypes)
	if err != nil {
		// 计数失败不该让整页工作台挂掉：退回「按已取到的条数」展示
		counts = map[string]int{}
		for _, v := range out {
			counts[v.DocType]++
		}
	}
	return &WorkbenchView{Items: out, Counts: counts}, nil
}
