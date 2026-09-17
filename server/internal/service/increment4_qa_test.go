// QA 独立测试（第四轮增量）：
//   - R1 回归红线：markdown 内容（mermaid/LaTeX/HTML 块/脚注）保存后逐字节保真
//   - R4 后端：duplicate / move-to-book / pin 三接口 + 置顶排序
package service

import (
	"strings"
	"testing"

	"haiku-wiki/server/internal/model"
	"haiku-wiki/server/internal/repository"
)

// TestPatchDocPreservesMermaidMarkdown R1 回归：保存链路不得剥离任何 markdown 语法。
// 覆盖 mermaid 代码块、LaTeX 公式、HTML 块、脚注，PATCH 后读回逐字节相等。
func TestPatchDocPreservesMermaidMarkdown(t *testing.T) {
	newEnv(t)
	owner := mkUser(t, "r1-owner@x.com", "secret123", "member")
	book := mkBook(t, owner.ID, "R1保真库", "private")
	doc := mkDoc(t, book, owner.ID, 0, "语法保真")

	// 与前端 Vditor IR getValue 产物同构的真实 markdown（含反引号围栏/公式/HTML/脚注）
	const rich = "```mermaid\ngraph TD\nA[开始] --> B{判断}\nB -->|是| C[结束]\nB -->|否| A\n```\n\n" +
		"公式：$E = mc^2$ 与块级 $$\\int_0^1 x dx = \\frac{1}{2}$$\n\n" +
		"<div style=\"color:red\">HTML 块保留</div>\n\n" +
		"脚注引用[^1]\n\n[^1]: 脚注内容\n"
	setDocContent(t, owner.ID, doc.ID, rich)

	got, err := repository.FindDocByID(doc.ID)
	if err != nil {
		t.Fatalf("读回文档失败: %v", err)
	}
	if got.Content != rich {
		t.Fatalf("保存后内容被剥离/改写。\n期望 %q\n实际 %q", rich, got.Content)
	}
	if !strings.Contains(got.Content, "```mermaid") || !strings.Contains(got.Content, "graph TD") {
		t.Fatal("mermaid 代码块必须完整保留")
	}
}

// TestDuplicateDoc 复制：标题+副本、同父末尾、content/doc_type 原样、不复制版本快照。
func TestDuplicateDoc(t *testing.T) {
	newEnv(t)
	owner := mkUser(t, "dup-owner@x.com", "secret123", "member")
	book := mkBook(t, owner.ID, "复制库", "private")
	a := mkDoc(t, book, owner.ID, 0, "原文档")
	b := mkDoc(t, book, owner.ID, 0, "兄弟文档") // 保证"末尾"语义可验证
	setDocContent(t, owner.ID, a.ID, "```mermaid\ngraph TD\nA-->B\n```")

	ds := &DocService{}
	cp, err := ds.Duplicate(owner.ID, a.ID)
	if err != nil {
		t.Fatalf("复制失败: %v", err)
	}
	if cp.Title != "原文档 副本" {
		t.Fatalf("新标题 = %q, 期望 %q", cp.Title, "原文档 副本")
	}
	if cp.ID == a.ID || cp.ID == b.ID {
		t.Fatal("副本必须是新文档")
	}
	if cp.Content != "```mermaid\ngraph TD\nA-->B\n```" || cp.DocType != "markdown" {
		t.Fatalf("内容/类型未原样复制: %q %q", cp.Content, cp.DocType)
	}
	if !(cp.Pos > b.Pos) {
		t.Fatalf("副本应排在同父级末尾: cp=%q b=%q", cp.Pos, b.Pos)
	}
	// 不复制版本快照：原文档 1 版，副本 0 版
	if vs, _ := repository.ListVersionsByDoc(cp.ID); len(vs) != 0 {
		t.Fatalf("副本不应带版本快照, got %d", len(vs))
	}
	// 无写权限用户复制 → 403
	other := mkUser(t, "dup-other@x.com", "secret123", "member")
	if _, err := ds.Duplicate(other.ID, a.ID); err == nil {
		t.Fatal("private 库非 owner 复制应被拒绝")
	}
}

// TestMoveToBook 跨库移动：目标库根级末尾、子树整体迁移、权限校验。
func TestMoveToBook(t *testing.T) {
	newEnv(t)
	owner := mkUser(t, "mv-owner@x.com", "secret123", "member")
	src := mkBook(t, owner.ID, "源库", "private")
	dst := mkBook(t, owner.ID, "目标库", "private")

	parent := mkDoc(t, src, owner.ID, 0, "要移动的目录")
	child := mkDoc(t, src, owner.ID, parent.ID, "子文档")
	existing := mkDoc(t, dst, owner.ID, 0, "目标库已有文档")

	ds := &DocService{}
	moved, err := ds.MoveToBook(owner.ID, parent.ID, dst.ID)
	if err != nil {
		t.Fatalf("移动失败: %v", err)
	}
	if moved.BookID != dst.ID || moved.ParentID != 0 {
		t.Fatalf("应移动到目标库根级: book=%d parent=%d", moved.BookID, moved.ParentID)
	}
	if !(moved.Pos > existing.Pos) {
		t.Fatalf("应追加到目标库根级末尾: moved=%q existing=%q", moved.Pos, existing.Pos)
	}
	// 子树整体迁移：子文档 book_id 跟随
	c, err := repository.FindDocByID(child.ID)
	if err != nil || c.BookID != dst.ID {
		t.Fatalf("子文档应随父迁移到目标库: err=%v book=%d", err, c.BookID)
	}
	// 非法目标库 → 404
	if _, err := ds.MoveToBook(owner.ID, parent.ID, 99999); err == nil {
		t.Fatal("目标库不存在应报错")
	}
}

// TestSetPinned 置顶/取消置顶：pinned_at 写入与清除、写权限校验。
func TestSetPinned(t *testing.T) {
	newEnv(t)
	owner := mkUser(t, "pin-owner@x.com", "secret123", "member")
	book := mkBook(t, owner.ID, "置顶库", "private")
	a := mkDoc(t, book, owner.ID, 0, "甲")
	b := mkDoc(t, book, owner.ID, 0, "乙")

	ds := &DocService{}
	pinned, err := ds.SetPinned(owner.ID, b.ID, true)
	if err != nil {
		t.Fatalf("置顶失败: %v", err)
	}
	if pinned.PinnedAt == nil {
		t.Fatal("置顶后 pinned_at 应非空")
	}
	// 取消置顶
	unpinned, err := ds.SetPinned(owner.ID, b.ID, false)
	if err != nil {
		t.Fatalf("取消置顶失败: %v", err)
	}
	if unpinned.PinnedAt != nil {
		t.Fatal("取消置顶后 pinned_at 应为 NULL")
	}
	// 写权限：private 库非 owner → 403
	other := mkUser(t, "pin-other@x.com", "secret123", "member")
	if _, err := ds.SetPinned(other.ID, a.ID, true); err == nil {
		t.Fatal("private 库非 owner 置顶应被拒绝")
	}
}

// TestPinnedOrderingInTree 置顶排序：同级置顶在前、其余按 pos；前端组树依赖此序。
func TestPinnedOrderingInTree(t *testing.T) {
	newEnv(t)
	owner := mkUser(t, "order-owner@x.com", "secret123", "member")
	book := mkBook(t, owner.ID, "排序库", "private")
	a := mkDoc(t, book, owner.ID, 0, "甲")
	b := mkDoc(t, book, owner.ID, 0, "乙")
	c := mkDoc(t, book, owner.ID, 0, "丙")

	ds := &DocService{}
	if _, err := ds.SetPinned(owner.ID, c.ID, true); err != nil { // 最晚创建的丙置顶
		t.Fatal(err)
	}
	tree, err := repository.ListTreeByBook(book.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(tree) != 3 {
		t.Fatalf("应返回 3 个节点, got %d", len(tree))
	}
	if tree[0].ID != c.ID {
		t.Fatalf("置顶文档应排最前: first=%d 期望 %d", tree[0].ID, c.ID)
	}
	if tree[1].ID != a.ID || tree[2].ID != b.ID {
		t.Fatalf("未置顶文档应按 pos 排序: %d,%d 期望 %d,%d", tree[1].ID, tree[2].ID, a.ID, b.ID)
	}
	// 取消置顶后恢复纯 pos 序
	if _, err := ds.SetPinned(owner.ID, c.ID, false); err != nil {
		t.Fatal(err)
	}
	tree, _ = repository.ListTreeByBook(book.ID)
	if tree[0].ID != a.ID || tree[1].ID != b.ID || tree[2].ID != c.ID {
		t.Fatalf("取消置顶后应恢复 pos 序: got %d,%d,%d", tree[0].ID, tree[1].ID, tree[2].ID)
	}
}

// 编译期引用防悬空（保持与既有测试文件一致的包级变量习惯）。
var _ = model.Doc{}
