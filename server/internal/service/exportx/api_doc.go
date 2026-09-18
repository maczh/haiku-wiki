package exportx

import (
	"encoding/json"
	"fmt"
	"strings"
)

// ApiKeyVal 接口文档中的「键-值」对（请求头 / 请求参数）。
type ApiKeyVal struct {
	Key         string `json:"key"`
	Value       string `json:"value"`
	Enabled     bool   `json:"enabled"`
	Description string `json:"description,omitempty"`
}

// ApiEndpoint 单个接口定义。
type ApiEndpoint struct {
	ID          string      `json:"id"`
	Name        string      `json:"name"`
	Method      string      `json:"method"`
	URI         string      `json:"uri"`
	BaseHost    string      `json:"base_host,omitempty"`
	ContentType string      `json:"content_type,omitempty"`
	Headers     []ApiKeyVal `json:"headers,omitempty"`
	Params      []ApiKeyVal `json:"params,omitempty"`
	BodyType    string      `json:"body_type,omitempty"` // none | json | form | raw
	Body        string      `json:"body,omitempty"`
	Description string      `json:"description,omitempty"`
}

// ApiGroup 接口分组。
type ApiGroup struct {
	ID    string       `json:"id"`
	Name  string       `json:"name"`
	Items []ApiEndpoint `json:"items"`
}

// ApiDoc 接口文档正文契约（doc_type=api，存于 docs.content）。
type ApiDoc struct {
	Version  int        `json:"version"`
	BaseHost string     `json:"base_host"`
	Groups   []ApiGroup `json:"groups"`
}

// parseApiDoc 解析接口文档正文；失败返回错误。
func parseApiDoc(content string) (*ApiDoc, error) {
	if strings.TrimSpace(content) == "" {
		return &ApiDoc{Version: 1, Groups: []ApiGroup{}}, nil
	}
	var d ApiDoc
	if err := json.Unmarshal([]byte(content), &d); err != nil {
		return nil, err
	}
	if d.Version == 0 {
		d.Version = 1
	}
	if d.Groups == nil {
		d.Groups = []ApiGroup{}
	}
	return &d, nil
}

// enabledPairs 取已启用的键值对，格式化为 "k: v"（附带描述）。
func enabledPairs(pairs []ApiKeyVal) []string {
	out := make([]string, 0, len(pairs))
	for _, p := range pairs {
		if !p.Enabled || p.Key == "" {
			continue
		}
		line := "- `" + p.Key + "`: " + p.Value
		if p.Description != "" {
			line += "  _" + p.Description + "_"
		}
		out = append(out, line)
	}
	return out
}

// BuildApiDocMD 把接口文档正文转换为可读的 Markdown 文档（导出用）。
func BuildApiDocMD(content, title string) ([]byte, error) {
	doc, err := parseApiDoc(content)
	if err != nil {
		return nil, fmt.Errorf("接口文档解析失败：%w", err)
	}
	var b strings.Builder
	b.WriteString("# " + title + "\n\n")
	if doc.BaseHost != "" {
		b.WriteString("> 基础地址（baseHost）：" + doc.BaseHost + "\n\n")
	}
	if len(doc.Groups) == 0 {
		b.WriteString("_（暂无接口）_\n")
		return []byte(b.String()), nil
	}
	for _, g := range doc.Groups {
		b.WriteString("## " + g.Name + "\n\n")
		if len(g.Items) == 0 {
			b.WriteString("_（该分组下暂无接口）_\n\n")
			continue
		}
		for _, e := range g.Items {
			method := strings.ToUpper(strings.TrimSpace(e.Method))
			if method == "" {
				method = "GET"
			}
			b.WriteString("### " + method + " " + e.Name + "\n\n")
			b.WriteString("- **路径**：`" + e.URI + "`\n")
			if e.BaseHost != "" {
				b.WriteString("- **基础地址**：`" + e.BaseHost + "`\n")
			}
			if e.ContentType != "" {
				b.WriteString("- **Content-Type**：`" + e.ContentType + "`\n")
			}
			if e.Description != "" {
				b.WriteString("\n" + e.Description + "\n")
			}
			if hs := enabledPairs(e.Headers); len(hs) > 0 {
				b.WriteString("\n**请求头**\n\n" + strings.Join(hs, "\n") + "\n")
			}
			if ps := enabledPairs(e.Params); len(ps) > 0 {
				b.WriteString("\n**请求参数**\n\n" + strings.Join(ps, "\n") + "\n")
			}
			if e.BodyType != "" && e.BodyType != "none" && strings.TrimSpace(e.Body) != "" {
				b.WriteString("\n**请求体（" + e.BodyType + "）**\n\n```\n" + e.Body + "\n```\n")
			}
			b.WriteString("\n")
		}
	}
	return []byte(b.String()), nil
}
