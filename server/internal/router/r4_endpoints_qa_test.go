// QA 独立测试（第四轮增量 R4，测试轮次 1）——HTTP 路由层集成测试：
//   - POST /api/docs/:id/duplicate   复制（内容/类型保真、副本标题、同父末尾、不复制版本、40401）
//   - POST /api/docs/:id/move-to-book 跨库移动（目标库写权限 40301、源树移除、目标库根末尾、置顶随移动保留）
//   - PATCH /api/docs/:id/pin        置顶/取消（翻转、置顶排序、缺参 40001）
//   - 写权限矩阵：members 库登录非 owner 三接口可达；public/private 仅 owner（40301）
//
// 工程师已有用例集中在 service 层，本文件验证路由装配 + JSON 契约 + 权限码全链路。
package router

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"

	"haiku-wiki/server/internal/config"
	"haiku-wiki/server/internal/model"
	"haiku-wiki/server/internal/pkg/jwtutil"
	"haiku-wiki/server/internal/repository"
)

// qaNewUser 直建第二个测试用户（绕过注册限频），返回 token。
func qaNewUser(t *testing.T, email string) (uint64, string) {
	t.Helper()
	hash, err := bcrypt.GenerateFromPassword([]byte("pass123"), bcrypt.MinCost)
	if err != nil {
		t.Fatal(err)
	}
	u := &model.User{Username: email, Email: email, PasswordHash: string(hash), Nickname: email, Role: "member"}
	if err := repository.CreateUser(u); err != nil {
		t.Fatal(err)
	}
	token, err := jwtutil.Create(u.ID, u.Role)
	if err != nil {
		t.Fatal(err)
	}
	return u.ID, token
}

type qaDoc struct {
	ID        uint64  `json:"id"`
	BookID    uint64  `json:"book_id"`
	ParentID  uint64  `json:"parent_id"`
	Title     string  `json:"title"`
	DocType   string  `json:"doc_type"`
	Pos       string  `json:"pos"`
	Content   string  `json:"content"`
	PinnedAt  *string `json:"pinned_at"`
	CreatedBy uint64  `json:"created_by"`
}

type qaTreeItem struct {
	ID       uint64  `json:"id"`
	ParentID uint64  `json:"parent_id"`
	Title    string  `json:"title"`
	Pos      string  `json:"pos"`
	PinnedAt *string `json:"pinned_at"`
}

// qaCreateBook 经 HTTP 创建书，返回书 ID。
func qaCreateBook(t *testing.T, r *gin.Engine, token, bookName, visibility string) uint64 {
	t.Helper()
	resp := qaDo(t, r, "POST", "/api/books", token, map[string]any{"name": bookName, "visibility": visibility})
	if resp.Code != 0 {
		t.Fatalf("建书失败: %+v", resp)
	}
	var book struct {
		ID uint64 `json:"id"`
	}
	_ = json.Unmarshal(resp.Data, &book)
	return book.ID
}

// qaCreateDoc 在指定书内建文档。
func qaCreateDoc(t *testing.T, r *gin.Engine, token string, bookID, parentID uint64, title string) uint64 {
	t.Helper()
	resp := qaDo(t, r, "POST", "/api/books/"+uitoa(bookID)+"/docs", token,
		map[string]any{"parent_id": parentID, "title": title, "doc_type": "markdown"})
	if resp.Code != 0 {
		t.Fatalf("建文档失败: %+v", resp)
	}
	var doc struct {
		ID uint64 `json:"id"`
	}
	_ = json.Unmarshal(resp.Data, &doc)
	return doc.ID
}

// qaCreateBookDoc 经 HTTP 创建书 + 文档，返回二者 ID。
func qaCreateBookDoc(t *testing.T, r *gin.Engine, token, bookName, visibility, docTitle string) (uint64, uint64) {
	t.Helper()
	bookID := qaCreateBook(t, r, token, bookName, visibility)
	return bookID, qaCreateDoc(t, r, token, bookID, 0, docTitle)
}

// qaTree 拉取目录树平铺列表。
func qaTree(t *testing.T, r *gin.Engine, token string, bookID uint64) []qaTreeItem {
	t.Helper()
	resp := qaDo(t, r, "GET", "/api/books/"+uitoa(bookID)+"/docs", token, nil)
	if resp.Code != 0 {
		t.Fatalf("拉取目录树失败: %+v", resp)
	}
	var items []qaTreeItem
	if err := json.Unmarshal(resp.Data, &items); err != nil {
		t.Fatalf("目录树解析失败: %s", resp.Data)
	}
	return items
}

// qaGetDoc 取文档详情（含 pinned_at）。
func qaGetDoc(t *testing.T, r *gin.Engine, token string, docID uint64) qaDoc {
	t.Helper()
	resp := qaDo(t, r, "GET", "/api/docs/"+uitoa(docID), token, nil)
	if resp.Code != 0 {
		t.Fatalf("GET /docs/:id 失败: %+v", resp)
	}
	var wrap struct {
		Doc qaDoc `json:"doc"`
	}
	if err := json.Unmarshal(resp.Data, &wrap); err != nil {
		t.Fatalf("文档详情解析失败: %s", resp.Data)
	}
	return wrap.Doc
}

// TestQADuplicateEndpoint 复制接口全链路：内容/类型/标题/末尾 pos/版本不复制/40401。
func TestQADuplicateEndpoint(t *testing.T) {
	r, uid, token := qaSetup(t)
	_ = uid
	bookID, aID := qaCreateBookDoc(t, r, token, "QA复制库", "private", "原文档")
	bID := qaCreateDoc(t, r, token, bookID, 0, "兄弟文档") // 保证"末尾"语义可验证

	// 先写入 mermaid 内容（产生 1 个版本快照）
	const mermaid = "```mermaid\ngraph TD\nA[开始] --> B[结束]\n```"
	if resp := qaDo(t, r, "PATCH", "/api/docs/"+uitoa(aID), token, map[string]any{"content": mermaid}); resp.Code != 0 {
		t.Fatalf("写入 mermaid 内容失败: %+v", resp)
	}

	// 复制
	resp := qaDo(t, r, "POST", "/api/docs/"+uitoa(aID)+"/duplicate", token, nil)
	if resp.Code != 0 {
		t.Fatalf("POST /docs/:id/duplicate 应成功: %+v", resp)
	}
	var cp qaDoc
	if err := json.Unmarshal(resp.Data, &cp); err != nil {
		t.Fatalf("复制响应解析失败: %s", resp.Data)
	}
	if cp.ID == aID {
		t.Fatal("副本必须是新文档")
	}
	if cp.Title != "原文档 副本" {
		t.Fatalf("副本标题 = %q, 期望 %q", cp.Title, "原文档 副本")
	}
	if cp.Content != mermaid || cp.DocType != "markdown" {
		t.Fatalf("内容/类型未原样复制: type=%q content=%q", cp.DocType, cp.Content)
	}
	if cp.ParentID != 0 || cp.BookID != bookID {
		t.Fatalf("副本应在同书同父级: book=%d parent=%d", cp.BookID, cp.ParentID)
	}

	// 同父末尾：树序 = 原文档, 兄弟, 副本（均未置顶，按 pos）
	tree := qaTree(t, r, token, bookID)
	if len(tree) != 3 || tree[0].ID != aID || tree[1].ID != bID || tree[2].ID != cp.ID {
		t.Fatalf("副本应排在同父级末尾: tree=%+v cp=%d", tree, cp.ID)
	}
	if !(tree[2].Pos > tree[1].Pos) {
		t.Fatalf("副本 pos 应大于原兄弟: %q vs %q", tree[2].Pos, tree[1].Pos)
	}

	// 不复制版本快照：原文档 1 版，副本 0 版
	vresp := qaDo(t, r, "GET", "/api/docs/"+uitoa(cp.ID)+"/versions", token, nil)
	if vresp.Code != 0 {
		t.Fatalf("拉取副本版本失败: %+v", vresp)
	}
	var versions []any
	_ = json.Unmarshal(vresp.Data, &versions)
	if len(versions) != 0 {
		t.Fatalf("副本不应带版本快照, got %d", len(versions))
	}
	oresp := qaDo(t, r, "GET", "/api/docs/"+uitoa(aID)+"/versions", token, nil)
	_ = json.Unmarshal(oresp.Data, &versions)
	if len(versions) != 1 {
		t.Fatalf("原文档应有 1 个版本快照, got %d", len(versions))
	}

	// 不存在的文档 → 40401
	if nf := qaDo(t, r, "POST", "/api/docs/999999/duplicate", token, nil); nf.Code != 40401 {
		t.Fatalf("复制不存在的文档应 40401, got %+v", nf)
	}
}

// TestQAMoveToBookEndpoint 跨库移动全链路：源树移除、目标库根末尾、子树跟随、置顶保留、错误码。
func TestQAMoveToBookEndpoint(t *testing.T) {
	r, uid, token := qaSetup(t)
	_ = uid
	srcID, docID := qaCreateBookDoc(t, r, token, "QA源库", "private", "要移动的目录")
	dstID, existingID := qaCreateBookDoc(t, r, token, "QA目标库", "private", "目标库已有文档")
	_ = existingID

	// 源库下建子文档（验证子树整体迁移）
	cresp := qaDo(t, r, "POST", "/api/books/"+uitoa(srcID)+"/docs", token,
		map[string]any{"parent_id": docID, "title": "子文档", "doc_type": "markdown"})
	if cresp.Code != 0 {
		t.Fatalf("建子文档失败: %+v", cresp)
	}
	var child struct {
		ID uint64 `json:"id"`
	}
	_ = json.Unmarshal(cresp.Data, &child)

	// 移动前置顶，验证置顶状态随移动保留
	if p := qaDo(t, r, "PATCH", "/api/docs/"+uitoa(docID)+"/pin", token, map[string]any{"pinned": true}); p.Code != 0 {
		t.Fatalf("置顶失败: %+v", p)
	}

	// 移动
	resp := qaDo(t, r, "POST", "/api/docs/"+uitoa(docID)+"/move-to-book", token, map[string]any{"book_id": dstID})
	if resp.Code != 0 {
		t.Fatalf("POST /docs/:id/move-to-book 应成功: %+v", resp)
	}
	var moved qaDoc
	if err := json.Unmarshal(resp.Data, &moved); err != nil {
		t.Fatalf("移动响应解析失败: %s", resp.Data)
	}
	if moved.BookID != dstID || moved.ParentID != 0 {
		t.Fatalf("应移动到目标库根级: book=%d parent=%d", moved.BookID, moved.ParentID)
	}
	if moved.PinnedAt == nil {
		t.Fatal("置顶状态应随移动保留")
	}

	// 源树无此文档（含子文档）
	srcTree := qaTree(t, r, token, srcID)
	for _, it := range srcTree {
		if it.ID == docID || it.ID == child.ID {
			t.Fatalf("移动后源书树不应再有该文档/子文档: %d", it.ID)
		}
	}
	// 目标树扁平列表：已有文档、被移动文档、子文档（共 3 条）
	dstTree := qaTree(t, r, token, dstID)
	if len(dstTree) != 3 {
		t.Fatalf("目标树应有 3 个节点: %+v", dstTree)
	}
	var existingItem, movedItem, childItem *qaTreeItem
	for i := range dstTree {
		switch dstTree[i].ID {
		case existingID:
			existingItem = &dstTree[i]
		case docID:
			movedItem = &dstTree[i]
		case child.ID:
			childItem = &dstTree[i]
		}
	}
	if existingItem == nil || movedItem == nil || childItem == nil {
		t.Fatalf("目标树节点缺失: %+v", dstTree)
	}
	if movedItem.ParentID != 0 {
		t.Fatalf("被移动文档应在目标库根级: parent=%d", movedItem.ParentID)
	}
	if !(movedItem.Pos > existingItem.Pos) {
		t.Fatalf("应追加到目标库根级末尾: moved=%q existing=%q", movedItem.Pos, existingItem.Pos)
	}
	if childItem.ParentID != docID {
		t.Fatalf("子文档父节点应保持不变: %+v", childItem)
	}
	// 子文档随父迁移
	cdoc := qaGetDoc(t, r, token, child.ID)
	if cdoc.BookID != dstID {
		t.Fatalf("子文档应随父迁移到目标库: book=%d", cdoc.BookID)
	}

	// 目标库不存在 → 40401
	if nf := qaDo(t, r, "POST", "/api/docs/"+uitoa(docID)+"/move-to-book", token, map[string]any{"book_id": 999999}); nf.Code != 40401 {
		t.Fatalf("目标库不存在应 40401, got %+v", nf)
	}
	// book_id 缺省 → 40001
	if bad := qaDo(t, r, "POST", "/api/docs/"+uitoa(docID)+"/move-to-book", token, map[string]any{}); bad.Code != 40001 {
		t.Fatalf("book_id 缺省应 40001, got %+v", bad)
	}
}

// TestQAPinEndpointAndOrdering 置顶翻转 + 树排序 + 缺参 40001。
func TestQAPinEndpointAndOrdering(t *testing.T) {
	r, uid, token := qaSetup(t)
	_ = uid
	bookID, aID := qaCreateBookDoc(t, r, token, "QA置顶库", "private", "甲")
	bID := qaCreateDoc(t, r, token, bookID, 0, "乙")
	cID := qaCreateDoc(t, r, token, bookID, 0, "丙")

	// 置顶最晚创建的丙
	resp := qaDo(t, r, "PATCH", "/api/docs/"+uitoa(cID)+"/pin", token, map[string]any{"pinned": true})
	if resp.Code != 0 {
		t.Fatalf("置顶应成功: %+v", resp)
	}
	var pinned qaDoc
	_ = json.Unmarshal(resp.Data, &pinned)
	if pinned.PinnedAt == nil {
		t.Fatal("置顶后响应 pinned_at 应非空")
	}
	tree := qaTree(t, r, token, bookID)
	if len(tree) != 3 || tree[0].ID != cID {
		t.Fatalf("置顶文档应排最前: %+v", tree)
	}
	if tree[1].ID != aID || tree[2].ID != bID {
		t.Fatalf("未置顶文档应按 pos 排序: %+v", tree)
	}

	// 取消置顶 → 恢复 pos 序
	resp = qaDo(t, r, "PATCH", "/api/docs/"+uitoa(cID)+"/pin", token, map[string]any{"pinned": false})
	if resp.Code != 0 {
		t.Fatalf("取消置顶应成功: %+v", resp)
	}
	var unpinned qaDoc
	_ = json.Unmarshal(resp.Data, &unpinned)
	if unpinned.PinnedAt != nil {
		t.Fatal("取消置顶后 pinned_at 应为 null")
	}
	tree = qaTree(t, r, token, bookID)
	if tree[0].ID != aID || tree[1].ID != bID || tree[2].ID != cID {
		t.Fatalf("取消置顶后应恢复 pos 序: %+v", tree)
	}

	// 置顶同级多个：置顶之间按 pos，均排未置顶前
	if p1 := qaDo(t, r, "PATCH", "/api/docs/"+uitoa(bID)+"/pin", token, map[string]any{"pinned": true}); p1.Code != 0 {
		t.Fatal(p1.Message)
	}
	if p2 := qaDo(t, r, "PATCH", "/api/docs/"+uitoa(aID)+"/pin", token, map[string]any{"pinned": true}); p2.Code != 0 {
		t.Fatal(p2.Message)
	}
	tree = qaTree(t, r, token, bookID)
	if tree[0].ID != aID || tree[1].ID != bID || tree[2].ID != cID {
		t.Fatalf("多置顶应置顶间按 pos（甲 a0 < 乙 a1）且先于未置顶: %+v", tree)
	}

	// 缺参 → 40001
	if bad := qaDo(t, r, "PATCH", "/api/docs/"+uitoa(aID)+"/pin", token, map[string]any{}); bad.Code != 40001 {
		t.Fatalf("pinned 缺省应 40001, got %+v", bad)
	}
	// 不存在的文档 → 40401
	if nf := qaDo(t, r, "PATCH", "/api/docs/999999/pin", token, map[string]any{"pinned": true}); nf.Code != 40401 {
		t.Fatalf("置顶不存在的文档应 40401, got %+v", nf)
	}
}

// TestQAWritePermMatrixR4 写权限矩阵：members 库登录非 owner 三接口可达；public/private 仅 owner（40301）。
func TestQAWritePermMatrixR4(t *testing.T) {
	r, ownerID, ownerToken := qaSetup(t)
	_ = ownerID
	otherID, otherToken := qaNewUser(t, "qa-r4-other@x.com")
	_ = otherID

	// members 库：非 owner 可复制/置顶/移入
	mID, mDocID := qaCreateBookDoc(t, r, ownerToken, "QA成员库", "members", "成员文档")
	if d := qaDo(t, r, "POST", "/api/docs/"+uitoa(mDocID)+"/duplicate", otherToken, nil); d.Code != 0 {
		t.Fatalf("members 库非 owner 复制应可达: %+v", d)
	}
	if p := qaDo(t, r, "PATCH", "/api/docs/"+uitoa(mDocID)+"/pin", otherToken, map[string]any{"pinned": true}); p.Code != 0 {
		t.Fatalf("members 库非 owner 置顶应可达: %+v", p)
	}
	// 非 owner 把自己的文档移入 members 目标库 → 应可达（目标库 members 可写）
	_, oDocID := qaCreateBookDoc(t, r, otherToken, "QA他人私库", "private", "他人文档")
	if mv := qaDo(t, r, "POST", "/api/docs/"+uitoa(oDocID)+"/move-to-book", otherToken, map[string]any{"book_id": mID}); mv.Code != 0 {
		t.Fatalf("目标库为 members 时非 owner 移入应可达: %+v", mv)
	}

	// public 库：非 owner 三接口均 40301
	_, pubDocID := qaCreateBookDoc(t, r, ownerToken, "QA公开库", "public", "公开文档")
	if d := qaDo(t, r, "POST", "/api/docs/"+uitoa(pubDocID)+"/duplicate", otherToken, nil); d.Code != 40301 {
		t.Fatalf("public 库非 owner 复制应 40301, got %+v", d)
	}
	if p := qaDo(t, r, "PATCH", "/api/docs/"+uitoa(pubDocID)+"/pin", otherToken, map[string]any{"pinned": true}); p.Code != 40301 {
		t.Fatalf("public 库非 owner 置顶应 40301, got %+v", p)
	}
	// private 源库：非 owner 移出应 40301
	if mv := qaDo(t, r, "POST", "/api/docs/"+uitoa(pubDocID)+"/move-to-book", otherToken, map[string]any{"book_id": mID}); mv.Code != 40301 {
		t.Fatalf("public 库非 owner 移出应 40301, got %+v", mv)
	}

	// private 库：非 owner 复制/置顶均 40301
	_, privDocID := qaCreateBookDoc(t, r, ownerToken, "QA私有库", "private", "私有文档")
	if d := qaDo(t, r, "POST", "/api/docs/"+uitoa(privDocID)+"/duplicate", otherToken, nil); d.Code != 40301 {
		t.Fatalf("private 库非 owner 复制应 40301, got %+v", d)
	}
	if p := qaDo(t, r, "PATCH", "/api/docs/"+uitoa(privDocID)+"/pin", otherToken, map[string]any{"pinned": true}); p.Code != 40301 {
		t.Fatalf("private 库非 owner 置顶应 40301, got %+v", p)
	}
}

// 编译期引用（保持包级变量习惯，防悬空导入告警）。
var (
	_ = sqlite.Open
	_ = gorm.Open
	_ = config.Config{}
	_ = strings.Contains
)
