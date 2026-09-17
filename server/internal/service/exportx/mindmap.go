package exportx

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"fmt"
	"strings"
)

// MindNode 思维导图节点（与前端 lib/mindmap.ts 的 v2 契约对应，仅保留导出所需字段）。
type MindNode struct {
	Text     string
	Expand   bool
	Children []*MindNode
}

// ParseMindmap 解析思维导图文档内容（兼容 v2 与旧 v1 格式）。
//
// v2: {"version":2,"root":{"data":{"text":"中心主题","expand":true},"children":[…]}}
// v1: {"version":1,"tree":{"text":"…","children":[…]}}（旧格式，读取时升级）
func ParseMindmap(content string) *MindNode {
	fallback := &MindNode{Text: "中心主题", Expand: true}
	if strings.TrimSpace(content) == "" {
		return fallback
	}
	var raw struct {
		Version int             `json:"version"`
		Root    json.RawMessage `json:"root"`
		Tree    json.RawMessage `json:"tree"`
	}
	if err := json.Unmarshal([]byte(content), &raw); err != nil {
		return fallback
	}
	switch raw.Version {
	case 2:
		if n := parseV2Node(raw.Root); n != nil {
			return n
		}
	case 1:
		if n := parseV1Node(raw.Tree); n != nil {
			return n
		}
	default:
		// 无版本号：尝试按 v2 → v1 顺序宽容解析
		if n := parseV2Node(raw.Root); n != nil {
			return n
		}
		if n := parseV1Node(raw.Tree); n != nil {
			return n
		}
	}
	return fallback
}

func parseV2Node(raw json.RawMessage) *MindNode {
	if len(raw) == 0 {
		return nil
	}
	var node struct {
		Data struct {
			Text   string `json:"text"`
			Expand *bool  `json:"expand"`
		} `json:"data"`
		Children []json.RawMessage `json:"children"`
	}
	if err := json.Unmarshal(raw, &node); err != nil {
		return nil
	}
	text := strings.TrimSpace(node.Data.Text)
	if text == "" {
		return nil
	}
	out := &MindNode{Text: text, Expand: true}
	if node.Data.Expand != nil {
		out.Expand = *node.Data.Expand
	}
	for _, c := range node.Children {
		if child := parseV2Node(c); child != nil {
			out.Children = append(out.Children, child)
		}
	}
	return out
}

func parseV1Node(raw json.RawMessage) *MindNode {
	if len(raw) == 0 {
		return nil
	}
	var node struct {
		Text     string            `json:"text"`
		Children []json.RawMessage `json:"children"`
	}
	if err := json.Unmarshal(raw, &node); err != nil {
		return nil
	}
	text := strings.TrimSpace(node.Text)
	if text == "" {
		return nil
	}
	out := &MindNode{Text: text, Expand: true}
	for _, c := range node.Children {
		if child := parseV1Node(c); child != nil {
			out.Children = append(out.Children, child)
		}
	}
	return out
}

// countNodes 统计节点总量（用于导出体积保护）。
func countNodes(n *MindNode) int {
	if n == nil {
		return 0
	}
	total := 1
	for _, c := range n.Children {
		total += countNodes(c)
	}
	return total
}

// ---------- .smm（simple-mind-map 原生数据） ----------

func toSMMNode(n *MindNode) map[string]interface{} {
	children := make([]interface{}, 0, len(n.Children))
	for _, c := range n.Children {
		children = append(children, toSMMNode(c))
	}
	return map[string]interface{}{
		"data":     map[string]interface{}{"text": n.Text, "expand": n.Expand},
		"children": children,
	}
}

// BuildSMM 导出 .smm（simple-mind-map 数据结构，可被本系统/官方 Demo 直接打开）。
func BuildSMM(content string) ([]byte, error) {
	root := ParseMindmap(content)
	payload := map[string]interface{}{"version": 2, "root": toSMMNode(root)}
	data, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("生成 smm 失败：%v", err)
	}
	return data, nil
}

// ---------- .km（KityMinder / 百度脑图） ----------

type kmNode struct {
	Data     map[string]interface{} `json:"data"`
	Children []*kmNode              `json:"children,omitempty"`
}

func toKMNode(n *MindNode, seq *int) *kmNode {
	*seq++
	state := "collapse"
	if n.Expand {
		state = "expand"
	}
	out := &kmNode{
		Data: map[string]interface{}{
			"id":          fmt.Sprintf("node-%d", *seq),
			"text":        n.Text,
			"expandState": state,
			"created":     ifaceInt64(0),
		},
	}
	for _, c := range n.Children {
		out.Children = append(out.Children, toKMNode(c, seq))
	}
	return out
}

// BuildKM 导出 .km（KityMinder File Format，可导入百度脑图 / KityMinder Editor）。
func BuildKM(content string) ([]byte, error) {
	root := ParseMindmap(content)
	seq := 0
	payload := map[string]interface{}{
		"root":     toKMNode(root, &seq),
		"template": "default",
		"theme":    "fresh-blue",
		"version":  "1.4.43",
	}
	data, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("生成 km 失败：%v", err)
	}
	return data, nil
}

// ---------- .mm（FreeMind） ----------

// BuildFreeMind 导出 .mm（FreeMind / XMind 均可导入的 XML 大纲）。
func BuildFreeMind(content string) ([]byte, error) {
	root := ParseMindmap(content)
	var sb strings.Builder
	sb.WriteString(`<?xml version="1.0" encoding="UTF-8"?>` + "\n")
	sb.WriteString(`<map version="1.0.1">` + "\n")
	writeFreeMindNode(&sb, root, 1)
	sb.WriteString(`</map>` + "\n")
	return []byte(sb.String()), nil
}

func writeFreeMindNode(sb *strings.Builder, n *MindNode, depth int) {
	indent := strings.Repeat("  ", depth)
	fmt.Fprintf(sb, `%s<node TEXT="%s"`, indent, escapeXML(n.Text))
	if len(n.Children) == 0 {
		sb.WriteString(`/>` + "\n")
		return
	}
	if n.Expand {
		sb.WriteString(`><hook NAME="accessories/plugins/NodeNote"/` + ">")
	} else {
		sb.WriteString(` FOLDED="true">`)
	}
	sb.WriteString("\n")
	for _, c := range n.Children {
		writeFreeMindNode(sb, c, depth+1)
	}
	fmt.Fprintf(sb, "%s</node>\n", indent)
}

// ---------- .xmind（XMind Zen） ----------

type xmindTopic struct {
	ID             string         `json:"id"`
	Class          string         `json:"class"`
	Title          string         `json:"title"`
	StructureClass string         `json:"structureClass,omitempty"`
	Children       *xmindChildren `json:"children,omitempty"`
}

type xmindChildren struct {
	Attached []*xmindTopic `json:"attached,omitempty"`
}

func toXMindTopic(n *MindNode, seq *int, root bool) *xmindTopic {
	*seq++
	topic := &xmindTopic{
		ID:    fmt.Sprintf("topic-%d", *seq),
		Class: "topic",
		Title: n.Text,
	}
	if root {
		topic.StructureClass = "org.xmind.ui.logic.right"
	}
	if len(n.Children) > 0 {
		children := &xmindChildren{}
		for _, c := range n.Children {
			children.Attached = append(children.Attached, toXMindTopic(c, seq, false))
		}
		topic.Children = children
	}
	return topic
}

// BuildXMind 导出 .xmind（XMind Zen 格式：content.json + metadata.json + manifest.json）。
func BuildXMind(content string) ([]byte, error) {
	root := ParseMindmap(content)
	seq := 0
	sheets := []map[string]interface{}{
		{
			"id":        "sheet-1",
			"class":     "sheet",
			"title":     "画布 1",
			"rootTopic": toXMindTopic(root, &seq, true),
		},
	}
	contentJSON, err := json.Marshal(sheets)
	if err != nil {
		return nil, fmt.Errorf("生成 xmind 失败：%v", err)
	}
	metadata := `{"creator":{"name":"寄海文库","version":"1.0.0"}}`
	manifest := `{"file-entries":{"content.json":{},"metadata.json":{}}}`

	buf := &bytes.Buffer{}
	zw := zip.NewWriter(buf)
	for _, part := range []struct{ name, data string }{
		{"content.json", string(contentJSON)},
		{"metadata.json", metadata},
		{"manifest.json", manifest},
	} {
		w, err := zw.Create(part.name)
		if err != nil {
			return nil, fmt.Errorf("生成 xmind 失败：%v", err)
		}
		if _, err := w.Write([]byte(part.data)); err != nil {
			return nil, fmt.Errorf("生成 xmind 失败：%v", err)
		}
	}
	if err := zw.Close(); err != nil {
		return nil, fmt.Errorf("生成 xmind 失败：%v", err)
	}
	return buf.Bytes(), nil
}

func ifaceInt64(v int64) interface{} { return v }
