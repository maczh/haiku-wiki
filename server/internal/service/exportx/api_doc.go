package exportx

import (
	"encoding/json"
	"fmt"
	"net/url"
	"strings"

	"github.com/google/uuid"
)

// ApiKeyVal 接口文档中的「键-值」对（请求头 / 请求参数）。
type ApiKeyVal struct {
	Key         string `json:"key"`
	Value       string `json:"value"`
	Enabled     bool   `json:"enabled"`
	Description string `json:"description,omitempty"`
	Type        string `json:"type,omitempty"`
}

// ApiField 字段说明表的一行（请求体 / 返回结果通用）。
type ApiField struct {
	Name        string `json:"name"`
	Type        string `json:"type"`
	Description string `json:"description,omitempty"`
	Required    bool   `json:"required"`
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
	// ResponseExample 由 json.Unmarshal 自动映射正文里的 response_example。
	ResponseExample string `json:"response_example,omitempty"`
	// ResponseFields / BodyFields 由 json.Unmarshal 自动映射正文里的 response_fields / body_fields。
	ResponseFields []ApiField `json:"response_fields,omitempty"`
	BodyFields     []ApiField `json:"body_fields,omitempty"`
}

// ApiGroup 接口分组。
type ApiGroup struct {
	ID    string        `json:"id"`
	Name  string        `json:"name"`
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

// ---------- 扁平字段表 → 嵌套 JSON Schema ----------

// schemaNode 是构建期的树节点（object / array / leaf 三态）。
type schemaNode struct {
	IsLeaf      bool
	IsArray     bool
	Type        string
	Description string
	Required    bool
	Example     any
	Properties  map[string]*schemaNode
	Items       *schemaNode
}

type pathStep struct {
	Name    string
	IsArray bool
}

// splitFieldPath 把 "data.list[].dishId" 拆成 [{data},{list,array},{dishId}]。
func splitFieldPath(path string) []pathStep {
	var steps []pathStep
	for _, p := range strings.Split(path, ".") {
		if p == "" {
			continue
		}
		if strings.HasSuffix(p, "[]") {
			steps = append(steps, pathStep{Name: p[:len(p)-2], IsArray: true})
		} else {
			steps = append(steps, pathStep{Name: p})
		}
	}
	return steps
}

// lookupExample 沿 steps 在 example 中取叶值（数组步取下标 0）。
func lookupExample(example any, steps []pathStep) any {
	cur := example
	for _, s := range steps {
		m, ok := cur.(map[string]any)
		if !ok {
			return nil
		}
		if s.IsArray {
			arr, ok := m[s.Name].([]any)
			if !ok || len(arr) == 0 {
				return nil
			}
			cur = arr[0]
			continue
		}
		cur = m[s.Name]
	}
	return cur
}

// normalizeSchemaType JSON Schema 类型归一（int64/integer→integer 等）。
func normalizeSchemaType(t string) string {
	switch strings.ToLower(t) {
	case "int", "int64", "integer":
		return "integer"
	case "float", "double", "number":
		return "number"
	case "bool", "boolean":
		return "boolean"
	case "array":
		return "array"
	case "object":
		return "object"
	default:
		return "string"
	}
}

// buildSchemaFromFields 把扁平字段表重建为嵌套 JSON Schema。
// exampleJSON 用于回填叶节点的 example（取不到则省略）。
func buildSchemaFromFields(fields []ApiField, exampleJSON string) map[string]any {
	var example any
	if strings.TrimSpace(exampleJSON) != "" {
		_ = json.Unmarshal([]byte(exampleJSON), &example)
	}
	root := &schemaNode{Properties: map[string]*schemaNode{}}
	for _, f := range fields {
		steps := splitFieldPath(f.Name)
		if len(steps) == 0 {
			continue
		}
		cur := root
		for i, step := range steps {
			last := i == len(steps)-1
			if step.IsArray {
				child, ok := cur.Properties[step.Name]
				if !ok {
					child = &schemaNode{IsArray: true}
					cur.Properties[step.Name] = child
				}
				if last {
					// 数组且为末步：items 为叶（标量数组场景）
					child.Items = &schemaNode{IsLeaf: true, Type: f.Type, Description: f.Description, Required: f.Required, Example: lookupExample(example, steps)}
				} else {
					if child.Items == nil {
						child.Items = &schemaNode{Properties: map[string]*schemaNode{}}
					}
					cur = child.Items
				}
			} else {
				child, ok := cur.Properties[step.Name]
				if !ok {
					child = &schemaNode{Properties: map[string]*schemaNode{}}
					cur.Properties[step.Name] = child
				}
				if last {
					child.IsLeaf = true
					child.Type = f.Type
					child.Description = f.Description
					child.Required = f.Required
					child.Example = lookupExample(example, steps)
				} else {
					cur = child
				}
			}
		}
	}
	return nodeToSchema(root)
}

func nodeToSchema(n *schemaNode) map[string]any {
	if n == nil {
		return nil
	}
	if n.IsLeaf {
		m := map[string]any{"type": normalizeSchemaType(n.Type)}
		if n.Description != "" {
			m["description"] = n.Description
		}
		if n.Example != nil {
			m["example"] = n.Example
		}
		return m
	}
	if n.IsArray {
		m := map[string]any{"type": "array"}
		if n.Items != nil {
			m["items"] = nodeToSchema(n.Items)
		}
		if n.Description != "" {
			m["description"] = n.Description
		}
		return m
	}
	props := map[string]any{}
	req := []any{}
	// 按字段定义顺序输出更友好
	for name, child := range n.Properties {
		props[name] = nodeToSchema(child)
		if child.Required {
			req = append(req, name)
		}
	}
	m := map[string]any{"type": "object", "properties": props}
	if len(req) > 0 {
		m["required"] = req
	}
	if n.Description != "" {
		m["description"] = n.Description
	}
	return m
}

// ---------- 三种 JSON 导出构建器 ----------

// postmanID 生成 Postman 集合的 _postman_id（uuid v4）。
func postmanID() string {
	return uuid.NewString()
}

// buildApiKeyValRows 把键值对转为导出用的 {key,value,description} 数组（仅已启用且 key 非空）。
func buildApiKeyValRows(pairs []ApiKeyVal) []map[string]any {
	out := make([]map[string]any, 0, len(pairs))
	for _, p := range pairs {
		if !p.Enabled || p.Key == "" {
			continue
		}
		row := map[string]any{"key": p.Key, "value": p.Value}
		if p.Description != "" {
			row["description"] = p.Description
		}
		out = append(out, row)
	}
	return out
}

// parseBaseHost 把 doc.BaseHost（如 https://api.example.com/v1）解析为 host/path/scheme。
func parseBaseHost(base string) (host, basePath, scheme string) {
	base = strings.TrimSpace(base)
	if base == "" {
		return "", "", ""
	}
	if !strings.HasPrefix(base, "http://") && !strings.HasPrefix(base, "https://") {
		base = "https://" + base
	}
	u, err := url.Parse(base)
	if err != nil {
		return "", "", ""
	}
	scheme = u.Scheme
	host = u.Host
	basePath = strings.TrimRight(u.Path, "/")
	return host, basePath, scheme
}

// BuildApiDocSwagger 把接口文档正文转换为 Swagger 2.0 JSON 字节流（导出用）。
func BuildApiDocSwagger(content, title string) ([]byte, error) {
	doc, err := parseApiDoc(content)
	if err != nil {
		return nil, fmt.Errorf("接口文档解析失败：%w", err)
	}
	docTitle := title
	if docTitle == "" {
		docTitle = "接口文档"
	}
	out := map[string]any{
		"swagger": "2.0",
		"info": map[string]any{
			"title":       docTitle,
			"version":     "1.0",
			"description": "由 haiku-wiki 接口文档导出",
		},
	}
	host, basePath, scheme := parseBaseHost(doc.BaseHost)
	if host != "" {
		out["host"] = host
		out["basePath"] = basePath
		if scheme != "" {
			out["schemes"] = []any{scheme}
		} else {
			out["schemes"] = []any{"https"}
		}
	}
	paths := map[string]any{}
	for _, g := range doc.Groups {
		for _, e := range g.Items {
			method := strings.ToLower(strings.TrimSpace(e.Method))
			if method == "" {
				method = "get"
			}
			uri := e.URI
			if uri == "" {
				uri = "/"
			}
			if _, ok := paths[uri]; !ok {
				paths[uri] = map[string]any{}
			}
			params := buildApiKeyValRows(e.Headers)
			// 请求参数：form 类型时作为 formData，其余作为 query（前端不区分 in，统一处理）。
			for _, p := range e.Params {
				if !p.Enabled || p.Key == "" {
					continue
				}
				if e.BodyType == "form" {
					params = append(params, map[string]any{
						"in":          "formData",
						"name":        p.Key,
						"required":    false,
						"type":        p.Type,
						"description": p.Description,
					})
				} else {
					params = append(params, map[string]any{
						"in":          "query",
						"name":        p.Key,
						"required":    false,
						"type":        p.Type,
						"description": p.Description,
					})
				}
			}
			switch e.BodyType {
			case "json":
				params = append(params, map[string]any{
					"in":       "body",
					"name":     "body",
					"required": true,
					"schema":   buildSchemaFromFields(e.BodyFields, e.Body),
				})
			}
			op := map[string]any{
				"summary":     e.Name,
				"description": e.Description,
				"parameters":  params,
				"responses": map[string]any{
					"200": map[string]any{
						"description": "OK",
						"schema":      buildSchemaFromFields(e.ResponseFields, e.ResponseExample),
					},
				},
			}
			pm := paths[uri].(map[string]any)
			pm[method] = op
		}
	}
	out["paths"] = paths
	return json.MarshalIndent(out, "", "  ")
}

// fieldsToMarkdownTable 把字段表渲染成 Markdown 表格（| 字段名 | 类型 | 说明 | 必填 |）。
func fieldsToMarkdownTable(fields []ApiField) string {
	if len(fields) == 0 {
		return ""
	}
	var b strings.Builder
	b.WriteString("| 字段名 | 类型 | 说明 | 必填 |\n")
	b.WriteString("| --- | --- | --- | --- |\n")
	for _, f := range fields {
		desc := f.Description
		if desc == "" {
			desc = "—"
		}
		req := "否"
		if f.Required {
			req = "是"
		}
		b.WriteString(fmt.Sprintf("| `%s` | %s | %s | %s |\n", f.Name, f.Type, desc, req))
	}
	return b.String()
}

// resolveFields 导出时优先用回填后的字段表；为空则回退对示例 JSON 推导扁平字段表。
func resolveFields(saved []ApiField, exampleJSON string) []ApiField {
	if len(saved) > 0 {
		return saved
	}
	return schemaToFieldsFlat(exampleJSON)
}

// schemaToFieldsFlat 从示例 JSON 字符串推导扁平字段表（name/type/required=false）。
func schemaToFieldsFlat(exampleJSON string) []ApiField {
	if strings.TrimSpace(exampleJSON) == "" {
		return nil
	}
	var obj any
	if err := json.Unmarshal([]byte(exampleJSON), &obj); err != nil {
		return nil
	}
	var out []ApiField
	var walk func(node any, prefix string)
	walk = func(node any, prefix string) {
		switch n := node.(type) {
		case nil:
			out = append(out, ApiField{Name: prefix, Type: "null"})
		case []any:
			out = append(out, ApiField{Name: prefix, Type: "array"})
			if len(n) > 0 {
				walk(n[0], prefix+"[]")
			}
		case map[string]any:
			for k, v := range n {
				np := k
				if prefix != "" {
					np = prefix + "." + k
				}
				walk(v, np)
			}
		default:
			switch n.(type) {
			case string:
				out = append(out, ApiField{Name: prefix, Type: "string"})
			case float64, int64:
				out = append(out, ApiField{Name: prefix, Type: "number"})
			case bool:
				out = append(out, ApiField{Name: prefix, Type: "boolean"})
			default:
				out = append(out, ApiField{Name: prefix, Type: "any"})
			}
		}
	}
	walk(obj, "")
	return out
}

// BuildApiDocPostman 把接口文档正文转换为 Postman Collection v2.1 JSON 字节流（导出用）。
func BuildApiDocPostman(content, title string) ([]byte, error) {
	doc, err := parseApiDoc(content)
	if err != nil {
		return nil, fmt.Errorf("接口文档解析失败：%w", err)
	}
	docTitle := title
	if docTitle == "" {
		docTitle = "接口文档"
	}
	root := map[string]any{
		"info": map[string]any{
			"name":        docTitle,
			"_postman_id": postmanID(),
			"schema":      "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
		},
	}
	items := make([]map[string]any, 0, len(doc.Groups))
	for _, g := range doc.Groups {
		groupItem := map[string]any{
			"name": g.Name,
			"item": make([]map[string]any, 0, len(g.Items)),
		}
		for _, e := range g.Items {
			// 请求体字段说明表（Markdown 承载人工说明，Postman 无原生嵌套 schema 槽）
			bodyMd := ""
			bodyFields := resolveFields(e.BodyFields, e.Body)
			if len(bodyFields) > 0 {
				bodyMd = "## 请求体字段说明\n\n" + fieldsToMarkdownTable(bodyFields)
			}
			respMd := ""
			respFields := resolveFields(e.ResponseFields, e.ResponseExample)
			if len(respFields) > 0 {
				respMd = "## 返回结果字段说明\n\n" + fieldsToMarkdownTable(respFields)
			}
			req := map[string]any{
				"method": e.Method,
				"url":    e.URI,
				"header": buildApiKeyValRows(e.Headers),
			}
			if e.BodyType != "" && e.BodyType != "none" && strings.TrimSpace(e.Body) != "" {
				req["body"] = map[string]any{
					"mode":    "raw",
					"raw":     e.Body,
					"options": map[string]any{"raw": map[string]any{"language": "json"}},
				}
			}
			reqDesc := e.Description
			if bodyMd != "" {
				reqDesc = reqDesc + "\n\n" + bodyMd
			}
			if reqDesc != "" {
				req["description"] = reqDesc
			}
			item := map[string]any{
				"name":    e.Name,
				"request": req,
				"response": []map[string]any{
					{
						"name":                     "200",
						"code":                     200,
						"status":                   "OK",
						"body":                     e.ResponseExample,
						"_postman_previewlanguage": "json",
						"description":              respMd,
					},
				},
			}
			groupItem["item"] = append(groupItem["item"].([]map[string]any), item)
		}
		items = append(items, groupItem)
	}
	root["item"] = items
	return json.MarshalIndent(root, "", "  ")
}

// BuildApiDocApifox 把接口文档正文转换为 Apifox 项目 JSON 字节流（可被 Apifox 导入 + 回灌本系统）。
func BuildApiDocApifox(content, title string) ([]byte, error) {
	doc, err := parseApiDoc(content)
	if err != nil {
		return nil, fmt.Errorf("接口文档解析失败：%w", err)
	}
	docTitle := title
	if docTitle == "" {
		docTitle = "接口文档"
	}
	collections := make([]map[string]any, 0, len(doc.Groups))
	for _, g := range doc.Groups {
		items := make([]map[string]any, 0, len(g.Items))
		for _, e := range g.Items {
			api := map[string]any{
				"method":      e.Method,
				"path":        e.URI,
				"description": e.Description,
				"parameters": map[string]any{
					"header": buildApiKeyValRows(e.Headers),
					"query":  buildApiKeyValRows(e.Params),
					"path":   []any{},
				},
			}
			if e.BodyType != "" && e.BodyType != "none" {
				api["requestBody"] = map[string]any{
					"type":       e.BodyType,
					"jsonSchema": buildSchemaFromFields(e.BodyFields, e.Body),
				}
			} else {
				api["requestBody"] = map[string]any{"type": "none"}
			}
			responses := []map[string]any{
				{
					"code":        200,
					"description": "OK",
					"jsonSchema":  buildSchemaFromFields(e.ResponseFields, e.ResponseExample),
				},
			}
			api["responses"] = responses
			items = append(items, map[string]any{
				"name": e.Name,
				"api":  api,
			})
		}
		collections = append(collections, map[string]any{
			"name":  g.Name,
			"items": items,
		})
	}
	out := map[string]any{
		"apifoxProject": "haiku-wiki",
		"info":          map[string]any{"name": docTitle},
		"apiCollection": collections,
	}
	return json.MarshalIndent(out, "", "  ")
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
				if bf := resolveFields(e.BodyFields, e.Body); len(bf) > 0 {
					b.WriteString("\n**请求体字段说明**\n\n" + fieldsToMarkdownTable(bf) + "\n")
				}
			}
			if e.ResponseExample != "" || len(e.ResponseFields) > 0 {
				b.WriteString("\n**返回结果**\n\n")
				if e.ResponseExample != "" {
					b.WriteString("```\n" + e.ResponseExample + "\n```\n")
				}
				if rf := resolveFields(e.ResponseFields, e.ResponseExample); len(rf) > 0 {
					b.WriteString("\n**返回结果字段说明**\n\n" + fieldsToMarkdownTable(rf) + "\n")
				}
			}
			b.WriteString("\n")
		}
	}
	return []byte(b.String()), nil
}
