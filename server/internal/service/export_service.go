package service

import (
	"archive/zip"
	"bytes"
	"fmt"
	"net/url"
	"strings"
	"unicode/utf8"

	"haiku-wiki/server/internal/model"
	"haiku-wiki/server/internal/repository"
	hkerr "haiku-wiki/server/internal/pkg"
)

// ExportService Markdown 导出业务（P1）：单篇 .md / 知识库 .md.zip。
type ExportService struct{}

// sanitizeFilename 清理文件名中的路径分隔符等非法字符。
func sanitizeFilename(name string) string {
	name = strings.NewReplacer("/", "＿", "\\", "＿", ":", "：", "*", "＊",
		"?", "？", "\"", "＂", "<", "《", ">", "》", "|", "｜", "\n", " ").Replace(name)
	name = strings.TrimSpace(name)
	if name == "" {
		name = "untitled"
	}
	if utf8.RuneCountInString(name) > 80 {
		name = string([]rune(name)[:80])
	}
	return name
}

// ContentDisposition 构造 RFC 5987 编码的下载头（支持中文文件名）。
func ContentDisposition(filename string) string {
	return fmt.Sprintf("attachment; filename*=UTF-8''%s", url.PathEscape(filename))
}

// canReadBook 读权限：private 仅 owner；members 登录用户（uid>0）；public 任何人。
func canReadBook(book *model.Book, uid uint64) bool {
	switch book.Visibility {
	case "public":
		return true
	case "members":
		return uid > 0
	default: // private
		return book.OwnerID == uid
	}
}

// DocMarkdown 导出单篇文档：返回 (文件名, markdown 字节)。
func (s *ExportService) DocMarkdown(uid, docID uint64) (string, []byte, error) {
	doc, err := repository.FindDocByID(docID)
	if err != nil {
		return "", nil, hkerr.NotFound("文档不存在")
	}
	book, err := repository.FindBookByID(doc.BookID)
	if err != nil {
		return "", nil, hkerr.NotFound("知识库不存在")
	}
	if !canReadBook(book, uid) {
		return "", nil, hkerr.Forbidden()
	}
	name := sanitizeFilename(doc.Title) + ".md"
	return name, []byte(doc.Content), nil
}

// BookZip 导出知识库为 .md.zip：目录节点 → 文件夹，文档 → .md 文件。
func (s *ExportService) BookZip(uid, bookID uint64) (string, []byte, error) {
	book, err := repository.FindBookByID(bookID)
	if err != nil {
		return "", nil, hkerr.NotFound("知识库不存在")
	}
	if !canReadBook(book, uid) {
		return "", nil, hkerr.Forbidden()
	}
	docs, err := repository.ListTreeByBook(book.ID)
	if err != nil {
		return "", nil, hkerr.Internal("查询失败")
	}

	// id → doc 索引，用于拼目录路径
	byID := make(map[uint64]*model.Doc, len(docs))
	for i := range docs {
		byID[docs[i].ID] = &docs[i]
	}
	pathOf := func(d *model.Doc) string {
		parts := []string{sanitizeFilename(d.Title)}
		cur := d.ParentID
		for cur != 0 {
			p, ok := byID[cur]
			if !ok {
				break
			}
			parts = append([]string{sanitizeFilename(p.Title)}, parts...)
			cur = p.ParentID
		}
		return strings.Join(parts, "/")
	}

	buf := &bytes.Buffer{}
	zw := zip.NewWriter(buf)
	used := map[string]int{} // 同名文件去重
	for i := range docs {
		d := &docs[i]
		full, err := repository.FindDocByID(d.ID)
		if err != nil {
			continue
		}
		path := pathOf(d) + ".md"
		if n, dup := used[path]; dup {
			path = fmt.Sprintf("%s(%d).md", strings.TrimSuffix(path, ".md"), n)
		}
		used[path]++
		w, err := zw.Create(path)
		if err != nil {
			continue
		}
		_, _ = w.Write([]byte(full.Content))
	}
	if err := zw.Close(); err != nil {
		return "", nil, hkerr.Internal("打包失败")
	}
	return sanitizeFilename(book.Name) + ".md.zip", buf.Bytes(), nil
}
