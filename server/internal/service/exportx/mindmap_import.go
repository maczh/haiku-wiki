package exportx

// 思维导图导入：把外部多种格式统一解析成项目内置的 .smm（v2 契约）正文。
//
// 支持四种来源，覆盖主流工具：
//
//	.smm   simple-mind-map 原生 JSON（本项目的存储格式；同时兼容旧版 v1 结构）
//	.km    KityMinder / 百度脑图 JSON
//	.xmind XMind（zip 包：新版读 content.json，旧版回退 content.xml）
//	.mm    FreeMind / XMind 的 XML 大纲
//
// 设计要点：
//   - 统一先解析成中间树 *MindNode，再序列化为 v2 JSON，避免为每种格式各写一套输出逻辑；
//   - 解析失败一律返回错误，绝不写入半截内容（导入流程据此提示失败，不产生损坏文档）；
//   - .xmind 是压缩包，解压时限制总量与条目大小，避免被构造出来的 zip 炸弹撑爆内存。

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"io"
	"path/filepath"
	"strings"
)

// xmindMaxUncompressed .xmind 解压后的总字节上限（思维导图内容很小，超过即视为异常）。
const xmindMaxUncompressed = 64 << 20

// xmindMaxEntry 单个 zip 条目的解压上限。
const xmindMaxEntry = 32 << 20

// ImportMindmapFile 解析外部思维导图文件，返回可直接落库的 .smm 正文与建议标题。
func ImportMindmapFile(filename string, data []byte) (content, title string, err error) {
	if len(bytes.TrimSpace(data)) == 0 {
		return "", "", fmt.Errorf("文件内容为空")
	}
	ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(filename), "."))
	base := strings.TrimSuffix(filepath.Base(filename), filepath.Ext(filename))
	if base == "" {
		base = "导入的思维导图"
	}

	var root *MindNode
	switch ext {
	case "smm":
		root, err = parseSMMFile(data)
	case "km":
		root, err = parseKMFile(data)
	case "xmind":
		root, err = parseXMindFile(data)
	case "mm":
		root, err = parseFreeMindFile(data)
	default:
		// 扩展名不可信时按内容嗅探：zip → xmind；XML → mm；JSON → smm/km
		root, err = sniffMindmap(data)
	}
	if err != nil {
		return "", "", err
	}
	if root == nil || strings.TrimSpace(root.Text) == "" {
		return "", "", fmt.Errorf("未能从文件中解析出思维导图节点")
	}

	payload := map[string]interface{}{"version": 2, "root": toSMMNode(root)}
	out, merr := json.Marshal(payload)
	if merr != nil {
		return "", "", fmt.Errorf("生成内置思维导图数据失败：%v", merr)
	}
	title = strings.TrimSpace(root.Text)
	if title == "" {
		title = base
	}
	return string(out), title, nil
}

// sniffMindmap 扩展名未知时按内容判定格式。
func sniffMindmap(data []byte) (*MindNode, error) {
	head := data
	if len(head) > 4 {
		head = head[:4]
	}
	if bytes.HasPrefix(head, []byte("PK\x03\x04")) {
		return parseXMindFile(data)
	}
	trimmed := bytes.TrimLeft(data, " \t\r\n\ufeff")
	if bytes.HasPrefix(trimmed, []byte("<")) {
		return parseFreeMindFile(data)
	}
	if n, err := parseKMFile(data); err == nil {
		return n, nil
	}
	return parseSMMFile(data)
}

// ---------- .smm（本项目存储格式 / simple-mind-map 原生 JSON） ----------

func parseSMMFile(data []byte) (*MindNode, error) {
	var raw struct {
		Version int             `json:"version"`
		Root    json.RawMessage `json:"root"`
		Tree    json.RawMessage `json:"tree"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, fmt.Errorf("不是有效的 .smm 文件（应为 JSON）")
	}
	// 优先按 v2 解析；v1 与无版本号时依次回退。
	if n := parseV2Node(raw.Root); n != nil {
		return n, nil
	}
	if n := parseV1Node(raw.Tree); n != nil {
		return n, nil
	}
	// 有些 .smm 导出会把根节点直接放在顶层（没有 root 包装）。
	if n := parseV2Node(data); n != nil {
		return n, nil
	}
	return nil, fmt.Errorf("不是有效的 .smm 文件（未找到根节点）")
}

// ---------- .km（KityMinder / 百度脑图） ----------

// kmImportNode KityMinder 节点。
// 该格式的文本通常放在 data.text，但部分导出工具会退化为顶层 text，两种都要吃。
type kmImportNode struct {
	Text     string          `json:"text"`
	Data     json.RawMessage `json:"data"`
	Children []kmImportNode  `json:"children"`
}

func parseKMFile(data []byte) (*MindNode, error) {
	var root struct {
		Root json.RawMessage `json:"root"`
	}
	if err := json.Unmarshal(data, &root); err != nil {
		return nil, fmt.Errorf("不是有效的 .km 文件（应为 JSON）")
	}
	if len(root.Root) == 0 {
		return nil, fmt.Errorf("不是有效的 .km 文件（缺少 root 节点）")
	}
	n := convertKMNode(root.Root)
	if n == nil {
		return nil, fmt.Errorf("不是有效的 .km 文件（未解析到节点）")
	}
	return n, nil
}

func convertKMNode(raw json.RawMessage) *MindNode {
	var node kmImportNode
	if err := json.Unmarshal(raw, &node); err != nil {
		return nil
	}
	text := strings.TrimSpace(node.Text)
	expand := true
	if len(node.Data) > 0 {
		var d struct {
			Text        string `json:"text"`
			ExpandState string `json:"expandState"`
		}
		if err := json.Unmarshal(node.Data, &d); err == nil {
			if t := strings.TrimSpace(d.Text); t != "" {
				text = t
			}
			// KityMinder 用 expandState 表达展开态：collapse 表示收起。
			if strings.EqualFold(strings.TrimSpace(d.ExpandState), "collapse") {
				expand = false
			}
		}
	}
	if text == "" {
		return nil
	}
	out := &MindNode{Text: text, Expand: expand}
	for _, c := range node.Children {
		raw, err := json.Marshal(c)
		if err != nil {
			continue
		}
		if child := convertKMNode(raw); child != nil {
			out.Children = append(out.Children, child)
		}
	}
	return out
}

// ---------- .mm（FreeMind XML） ----------

type fmNode struct {
	Text     string   `xml:"TEXT,attr"`
	Folded   string   `xml:"FOLDED,attr"`
	Children []fmNode `xml:"node"`
}

func parseFreeMindFile(data []byte) (*MindNode, error) {
	// 先剥掉 UTF-8 BOM 与首尾空白：部分 Windows 工具导出的 .mm 会带 BOM，
	// 直接喂给 xml.Unmarshal 会在文档序言前就报 invalid character。
	clean := bytes.TrimSpace(bytes.TrimPrefix(bytes.TrimLeft(data, " \t\r\n"), []byte("\xef\xbb\xbf")))
	var m struct {
		XMLName xml.Name `xml:"map"`
		Node    *fmNode  `xml:"node"`
	}
	if err := xml.Unmarshal(clean, &m); err != nil {
		return nil, fmt.Errorf("不是有效的 .mm 文件（应为 FreeMind XML）：%v", err)
	}
	if m.Node == nil {
		return nil, fmt.Errorf("不是有效的 .mm 文件（未找到 <node>）")
	}
	n := convertFMNode(*m.Node)
	if n == nil {
		return nil, fmt.Errorf("不是有效的 .mm 文件（节点缺少 TEXT 属性）")
	}
	return n, nil
}

func convertFMNode(node fmNode) *MindNode {
	text := strings.TrimSpace(node.Text)
	if text == "" {
		return nil
	}
	expand := !strings.EqualFold(strings.TrimSpace(node.Folded), "true")
	out := &MindNode{Text: text, Expand: expand}
	for _, c := range node.Children {
		if child := convertFMNode(c); child != nil {
			out.Children = append(out.Children, child)
		}
	}
	return out
}

// ---------- .xmind（zip 包） ----------

func parseXMindFile(data []byte) (*MindNode, error) {
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, fmt.Errorf("不是有效的 .xmind 文件（应为 zip 压缩包）")
	}
	// 先找新版 content.json，找不到再找旧版 content.xml。
	var jsonEntry, xmlEntry *zip.File
	for _, f := range zr.File {
		name := strings.ToLower(filepath.ToSlash(f.Name))
		if strings.HasSuffix(name, "/") {
			continue
		}
		switch filepath.Base(name) {
		case "content.json":
			if jsonEntry == nil && !strings.Contains(name, "/") {
				jsonEntry = f
			}
			if jsonEntry == nil {
				jsonEntry = f
			}
		case "content.xml":
			if xmlEntry == nil && !strings.Contains(name, "/") {
				xmlEntry = f
			}
			if xmlEntry == nil {
				xmlEntry = f
			}
		}
	}
	if jsonEntry != nil {
		raw, err := readZipEntry(jsonEntry)
		if err == nil {
			if n, err := parseXMindContentJSON(raw); err == nil {
				return n, nil
			}
		}
	}
	if xmlEntry != nil {
		raw, err := readZipEntry(xmlEntry)
		if err == nil {
			if n, err := parseXMindContentXML(raw); err == nil {
				return n, nil
			}
		}
	}
	return nil, fmt.Errorf("不是有效的 .xmind 文件（未找到 content.json / content.xml）")
}

// readZipEntry 读取单个条目并做大小保护。
func readZipEntry(f *zip.File) ([]byte, error) {
	if f.UncompressedSize64 > xmindMaxEntry {
		return nil, fmt.Errorf("压缩包内 %s 过大", f.Name)
	}
	rc, err := f.Open()
	if err != nil {
		return nil, err
	}
	defer rc.Close()
	limited := io.LimitReader(rc, xmindMaxEntry)
	buf, err := io.ReadAll(limited)
	if err != nil {
		return nil, err
	}
	if len(buf) > xmindMaxEntry {
		return nil, fmt.Errorf("压缩包内 %s 过大", f.Name)
	}
	return buf, nil
}

// xmindTopicJSON XMind Zen / 2020+ 的 content.json 节点结构。
type xmindTopicJSON struct {
	Title    string `json:"title"`
	Children *struct {
		Attached []xmindTopicJSON `json:"attached"`
	} `json:"children"`
}

func parseXMindContentJSON(raw []byte) (*MindNode, error) {
	var sheets []struct {
		Title     string         `json:"title"`
		RootTopic xmindTopicJSON `json:"rootTopic"`
	}
	if err := json.Unmarshal(raw, &sheets); err != nil {
		// 有些版本 content.json 是单个对象而非数组
		var single struct {
			RootTopic xmindTopicJSON `json:"rootTopic"`
		}
		if err2 := json.Unmarshal(raw, &single); err2 != nil {
			return nil, err
		}
		sheets = append(sheets, struct {
			Title     string         `json:"title"`
			RootTopic xmindTopicJSON `json:"rootTopic"`
		}{RootTopic: single.RootTopic})
	}
	for _, s := range sheets {
		if n := convertXMindTopicJSON(s.RootTopic); n != nil {
			return n, nil
		}
	}
	return nil, fmt.Errorf("content.json 中没有可用的根主题")
}

func convertXMindTopicJSON(t xmindTopicJSON) *MindNode {
	text := strings.TrimSpace(t.Title)
	if text == "" {
		return nil
	}
	out := &MindNode{Text: text, Expand: true}
	if t.Children != nil {
		for _, c := range t.Children.Attached {
			if child := convertXMindTopicJSON(c); child != nil {
				out.Children = append(out.Children, child)
			}
		}
	}
	return out
}

// xmindTopicXML 旧版 XMind 8 的 content.xml 节点结构。
type xmindTopicXML struct {
	Title    string `xml:"title"`
	Children struct {
		Topics []struct {
			Type  string          `xml:"type,attr"`
			Topic []xmindTopicXML `xml:"topic"`
		} `xml:"topics"`
	} `xml:"children"`
}

func parseXMindContentXML(raw []byte) (*MindNode, error) {
	var doc struct {
		Sheets []struct {
			Topic xmindTopicXML `xml:"topic"`
		} `xml:"sheet"`
	}
	if err := xml.Unmarshal(raw, &doc); err != nil {
		return nil, err
	}
	for _, s := range doc.Sheets {
		if n := convertXMindTopicXML(s.Topic); n != nil {
			return n, nil
		}
	}
	return nil, fmt.Errorf("content.xml 中没有可用的根主题")
}

func convertXMindTopicXML(t xmindTopicXML) *MindNode {
	text := strings.TrimSpace(t.Title)
	if text == "" {
		return nil
	}
	out := &MindNode{Text: text, Expand: true}
	for _, group := range t.Children.Topics {
		for _, c := range group.Topic {
			if child := convertXMindTopicXML(c); child != nil {
				out.Children = append(out.Children, child)
			}
		}
	}
	return out
}
