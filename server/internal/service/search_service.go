package service

import (
	"strings"
	"time"

	"haiku-wiki/server/internal/repository"
)

// SearchService 全文搜索业务（MVP：LIKE + 权限过滤 + 上下文片段）。
type SearchService struct{}

// Hit 搜索结果项。
type Hit struct {
	DocID     uint64    `json:"doc_id"`
	BookID    uint64    `json:"book_id"`
	BookName  string    `json:"book_name"`
	Title     string    `json:"title"`
	Snippet   string    `json:"snippet"`
	UpdatedAt time.Time `json:"updated_at"`
}

const (
	snippetRadius = 60 // 关键词上下文半径（字符）
	searchLimit   = 50
)

// Search 标题 + 正文搜索，返回带上下文片段的结果。
// 可见性过滤在 repository.SearchDocs 中完成（public 任何人 / members 登录 / private 仅 owner）。
func (s *SearchService) Search(userID uint64, keyword string) ([]Hit, error) {
	keyword = strings.TrimSpace(keyword)
	if keyword == "" {
		return []Hit{}, nil
	}
	rows, err := repository.SearchDocs(userID, keyword, searchLimit)
	if err != nil {
		return nil, err
	}
	lowerKw := strings.ToLower(keyword)
	kwRunes := len([]rune(keyword))
	hits := make([]Hit, 0, len(rows))
	for _, r := range rows {
		snippet := ""
		if r.DocType == "markdown" {
			// 非 markdown 类型（sheet/mindmap/flowchart/datatable）不提供正文摘要
			snippet = buildSnippet(r.Content, kwRunes, lowerKw)
		}
		hits = append(hits, Hit{
			DocID:     r.ID,
			BookID:    r.BookID,
			BookName:  r.BookName,
			Title:     r.Title,
			Snippet:   snippet,
			UpdatedAt: r.UpdatedAt,
		})
	}
	return hits, nil
}

// buildSnippet 截取关键词上下文片段（±60 字符），供前端高亮。
func buildSnippet(content string, kwRunes int, lowerKw string) string {
	flat := strings.ReplaceAll(strings.ReplaceAll(content, "\r\n", " "), "\n", " ")
	runes := []rune(flat)
	lower := strings.ToLower(string(runes)) // 保持 rune 数量一致
	idx := strings.Index(lower, lowerKw)
	if idx < 0 {
		// 正文未命中（仅标题命中）：取开头片段
		if len(runes) > snippetRadius {
			return string(runes[:snippetRadius]) + "…"
		}
		return flat
	}
	// lower 由 rune 串生成，idx 必落在 rune 边界，可安全换算
	runeIdx := len([]rune(lower[:idx]))
	start := runeIdx - snippetRadius
	prefix := ""
	if start < 0 {
		start = 0
	} else {
		prefix = "…"
	}
	end := runeIdx + kwRunes + snippetRadius
	suffix := ""
	if end > len(runes) {
		end = len(runes)
	} else {
		suffix = "…"
	}
	return prefix + string(runes[start:end]) + suffix
}
