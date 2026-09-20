package service

import (
	"encoding/json"
	"strings"
	"testing"

	"haiku-wiki/server/internal/repository"
)

// TestContentMD5Normalize 三种换行方言必须算出**同一个**摘要（P0-1 的可比较性前提）。
func TestContentMD5Normalize(t *testing.T) {
	body := "第一行\n第二行\n第三行"
	variants := []string{
		body,
		strings.ReplaceAll(body, "\n", "\r\n"),
		strings.ReplaceAll(body, "\n", "\r"),
	}
	want := contentMD5(variants[0])
	if want == "" {
		t.Fatal("非空内容不应得到空摘要")
	}
	for i, v := range variants[1:] {
		if got := contentMD5(v); got != want {
			t.Fatalf("换行方言 %d 摘要不一致: %q vs %q", i+1, got, want)
		}
	}
}

// TestContentMD5Empty 空内容 → 空串（不能是空字节的 md5，否则所有空文档互相误报）。
func TestContentMD5Empty(t *testing.T) {
	for _, s := range []string{"", "   ", "\n", "\r\n\r\n"} {
		if got := contentMD5(s); got != "" {
			t.Fatalf("空白内容 %q 应得到空摘要，实际 %q", s, got)
		}
	}
	if contentMD5("正文") == "" {
		t.Fatal("非空内容应得到摘要")
	}
}

// TestCreateDocSetsContentMD5 创建文档时就应写入摘要；复制件沿用同一摘要。
func TestCreateDocSetsContentMD5AndCopy(t *testing.T) {
	newEnv(t)
	owner := mkUser(t, "md5@x.com", "pass123", "member")
	book := mkBook(t, owner.ID, "摘要库", "private")
	svc := &DocService{}

	body := "# 标题\n\n正文内容"
	doc, err := svc.CreateDocWithContent(book, owner.ID, 0, "A", "markdown", body)
	if err != nil {
		t.Fatalf("创建失败: %v", err)
	}
	if doc.ContentMD5 == "" {
		t.Fatal("创建后 ContentMD5 不应为空")
	}
	if doc.ContentMD5 != contentMD5(body) {
		t.Fatalf("ContentMD5 应为规范化正文摘要: %q vs %q", doc.ContentMD5, contentMD5(body))
	}

	// 空正文 → 空摘要（不参与重复提示）
	empty, err := svc.CreateDocWithContent(book, owner.ID, 0, "空", "markdown", "")
	if err != nil {
		t.Fatalf("创建空文档失败: %v", err)
	}
	if empty.ContentMD5 != "" {
		t.Fatalf("空正文 ContentMD5 应为空串，实际 %q", empty.ContentMD5)
	}

	// 复制件：内容相同 → 摘要相同，且能互相检出重复
	cp, err := svc.Copy(owner.ID, doc.ID, CopyInput{})
	if err != nil {
		t.Fatalf("复制失败: %v", err)
	}
	if cp.ContentMD5 != doc.ContentMD5 {
		t.Fatalf("复制件摘要应与原件一致: %q vs %q", cp.ContentMD5, doc.ContentMD5)
	}
	dup := svc.FindContentDuplicate(doc.ID, doc.ContentMD5)
	if dup == nil || dup.DocID != cp.ID {
		t.Fatalf("应检出复制件为重复，实际 %+v", dup)
	}
	// 反向查也应命中原件
	if dup2 := svc.FindContentDuplicate(cp.ID, cp.ContentMD5); dup2 == nil || dup2.DocID != doc.ID {
		t.Fatalf("反向查重应命中原件，实际 %+v", dup2)
	}
}

// TestUpdateDocRecomputesContentMD5 内容变化时摘要要重算；改成唯一后不再互相报重复。
func TestUpdateDocRecomputesContentMD5(t *testing.T) {
	newEnv(t)
	owner := mkUser(t, "md5b@x.com", "pass123", "member")
	book := mkBook(t, owner.ID, "摘要库2", "private")
	svc := &DocService{}

	a, err := svc.CreateDocWithContent(book, owner.ID, 0, "A", "markdown", "同一段内容")
	if err != nil {
		t.Fatalf("创建 A 失败: %v", err)
	}
	b, err := svc.CreateDocWithContent(book, owner.ID, 0, "B", "markdown", "同一段内容")
	if err != nil {
		t.Fatalf("创建 B 失败: %v", err)
	}
	if a.ContentMD5 == "" || a.ContentMD5 != b.ContentMD5 {
		t.Fatalf("两篇同内容文档摘要应相同: %q vs %q", a.ContentMD5, b.ContentMD5)
	}

	// 把 B 改成不同内容 → 摘要变化，A 的重复提示消失
	newBody := "另一段完全不同的内容"
	updated, changed, err := svc.UpdateDoc(owner.ID, b.ID, nil, &newBody, "manual")
	if err != nil {
		t.Fatalf("更新 B 失败: %v", err)
	}
	if !changed {
		t.Fatal("内容变化应返回 changed=true")
	}
	if updated.ContentMD5 != contentMD5(newBody) {
		t.Fatalf("更新后摘要未重算: %q vs %q", updated.ContentMD5, contentMD5(newBody))
	}
	if dup := svc.FindContentDuplicate(a.ID, a.ContentMD5); dup != nil {
		t.Fatalf("内容改开之后不应再报重复，实际 %+v", dup)
	}

	// 再改回与 A 相同（含 \r\n 方言）→ 又能互相检出
	same := strings.ReplaceAll("同一段内容", "\n", "\r\n")
	if _, _, err := svc.UpdateDoc(owner.ID, b.ID, nil, &same, "manual"); err != nil {
		t.Fatalf("改回失败: %v", err)
	}
	if dup := svc.FindContentDuplicate(a.ID, a.ContentMD5); dup == nil || dup.DocID != b.ID {
		t.Fatalf("改回后应再次检出重复，实际 %+v", dup)
	}
}

// TestFileDocUsesOriginMD5 附件型文档的摘要 = 原件 md5（与秒传同源），不是正文 JSON 的 md5。
func TestFileDocUsesOriginMD5(t *testing.T) {
	newEnv(t)
	owner := mkUser(t, "md5c@x.com", "pass123", "member")
	book := mkBook(t, owner.ID, "附件库", "private")

	out, err := saveBytes(owner.ID, "说明.pdf", "application/pdf", []byte("%PDF-1.4 附件原件字节"))
	if err != nil {
		t.Fatalf("上传原件失败: %v", err)
	}
	if out.MD5 == "" {
		t.Fatal("上传后原件应有 md5")
	}
	ref := map[string]any{"url": out.URL, "filename": "说明.pdf", "size": len(out.MD5), "ext": "pdf"}
	refJSON, _ := json.Marshal(ref)

	doc, err := (&DocService{}).CreateDocWithContent(book, owner.ID, 0, "附件文档", "file", string(refJSON))
	if err != nil {
		t.Fatalf("创建附件文档失败: %v", err)
	}
	if doc.ContentMD5 != out.MD5 {
		t.Fatalf("附件文档摘要应取原件 md5: %q vs %q", doc.ContentMD5, out.MD5)
	}
	// 原件 md5 反查链路（originMD5ByURL）
	if got := originMD5ByURL(out.URL); got != out.MD5 {
		t.Fatalf("originMD5ByURL 应命中原件 md5: %q vs %q", got, out.MD5)
	}
	// 查不到的 URL → 空串（不参与重复提示）
	if got := originMD5ByURL("/uploads/2020/01/不存在.pdf"); got != "" {
		t.Fatalf("查不到原件应返回空串，实际 %q", got)
	}
}

// TestSetApiSource 来源登记：幂等 upsert + 空串清除（T07 定时刷新的依赖）。
func TestSetApiSource(t *testing.T) {
	newEnv(t)
	owner := mkUser(t, "md5d@x.com", "pass123", "member")
	book := mkBook(t, owner.ID, "接口库", "private")
	svc := &DocService{}

	doc, err := svc.CreateDocWithContent(book, owner.ID, 0, "接口文档", "markdown", "# api")
	if err != nil {
		t.Fatalf("创建失败: %v", err)
	}

	url := "https://petstore.example.com/openapi.json"
	if err := svc.SetApiSource(owner.ID, doc.ID, url); err != nil {
		t.Fatalf("登记来源失败: %v", err)
	}
	src, err := repository.FindDocApiSource(doc.ID)
	if err != nil || src == nil || src.SourceURL != url {
		t.Fatalf("来源未落库: %+v err=%v", src, err)
	}
	firstImportedAt := src.ImportedAt

	// 重复设置：URL 更新，首次导入时间**不应**被改写
	if err := svc.SetApiSource(owner.ID, doc.ID, "https://petstore.example.com/v2.json"); err != nil {
		t.Fatalf("重复登记失败: %v", err)
	}
	src, err = repository.FindDocApiSource(doc.ID)
	if err != nil || src == nil {
		t.Fatalf("来源读取失败: %+v err=%v", src, err)
	}
	if src.SourceURL != "https://petstore.example.com/v2.json" {
		t.Fatalf("URL 应已更新，实际 %q", src.SourceURL)
	}
	if !src.ImportedAt.Equal(firstImportedAt) {
		t.Fatalf("首次导入时间不应被改写: %v → %v", firstImportedAt, src.ImportedAt)
	}

	// 空串清除
	if err := svc.SetApiSource(owner.ID, doc.ID, ""); err != nil {
		t.Fatalf("清除来源失败: %v", err)
	}
	if src, _ := repository.FindDocApiSource(doc.ID); src != nil {
		t.Fatalf("清除后不应再有来源记录: %+v", src)
	}
}
