// Package apidoc is a PURE-FUNCTION, self-contained port of the frontend API-doc
// import parser (web/src/lib/apiDoc.ts). It parses Swagger2 / OpenAPI3 / Postman /
// Apifox JSON into an ApiDoc structure that is byte-compatible with the frontend's
// ApiDoc / ApiGroup / ApiEndpoint / ApiKeyValue / ApiField contract, so the parsed
// result can be stored as docs.content and opened in the existing React editor.
//
// The backend needs this so it can auto-refresh imported API docs from their source
// URL without a browser. Endpoint IDs are deterministic (derived from method+uri) so
// the merge step in another package can reuse existing ids on every refresh.
package apidoc

import (
	"encoding/json"
	"errors"
	"fmt"
	"hash/fnv"
	"net/url"
	"strconv"
	"strings"
)

// ApiKeyValue is a key/value row (headers, params, etc.).
type ApiKeyValue struct {
	Key         string `json:"key"`
	Value       string `json:"value"`
	Enabled     bool   `json:"enabled"`
	Description string `json:"description"`
	Type        string `json:"type"`
}

// ApiField is one row of a request/response field description table.
type ApiField struct {
	Name        string `json:"name"`
	Type        string `json:"type"`
	Description string `json:"description"`
	Required    bool   `json:"required"`
}

// ApiEndpoint is a single API operation.
type ApiEndpoint struct {
	ID              string        `json:"id"`
	Name            string        `json:"name"`
	Method          string        `json:"method"`
	URI             string        `json:"uri"`
	BaseHost        string        `json:"base_host,omitempty"`
	ContentType     string        `json:"content_type"`
	Headers         []ApiKeyValue `json:"headers"`
	Params          []ApiKeyValue `json:"params"`
	BodyType        string        `json:"body_type"` // "none"|"json"|"form"|"raw"
	Body            string        `json:"body"`
	Description     string        `json:"description,omitempty"`
	ResponseExample string        `json:"response_example,omitempty"`
	ResponseFields  []ApiField    `json:"response_fields,omitempty"`
	BodyFields      []ApiField    `json:"body_fields,omitempty"`
}

// ApiGroup is a named group of endpoints (tag / folder).
type ApiGroup struct {
	ID           string        `json:"id"`
	Name         string        `json:"name"`
	ImportSource string        `json:"import_source,omitempty"`
	Items        []ApiEndpoint `json:"items"`
}

// ApiDoc is the top-level parsed document.
type ApiDoc struct {
	Version  int        `json:"version"`
	BaseHost string     `json:"base_host"`
	Groups   []ApiGroup `json:"groups"`
}

// knownMethods is the set of normalized HTTP methods (mirrors the TS METHODS array).
var knownMethods = map[string]bool{
	"GET": true, "POST": true, "PUT": true, "DELETE": true,
	"PATCH": true, "HEAD": true, "OPTIONS": true,
}

func knownMethod(m string) bool { return knownMethods[m] }

// normMethod uppercases and falls back to GET for unknown methods.
func normMethod(m string) string {
	u := strings.ToUpper(strings.TrimSpace(m))
	if knownMethod(u) {
		return u
	}
	return "GET"
}

// normURI defaults an empty URI to "/".
func normURI(u string) string {
	if strings.TrimSpace(u) == "" {
		return "/"
	}
	return u
}

// epKey is the natural key (method+":"+uri) used for dedupe and id stability.
// Method is lowercased so casing differences do not split groups across refreshes.
func epKey(method, uri string) string {
	return strings.ToLower(method) + ":" + uri
}

// shortHash returns an 8-char base36 of fnv32a of s (zero-padded for stability).
func shortHash(s string) string {
	h := fnv.New32a()
	_, _ = h.Write([]byte(s))
	return fmt.Sprintf("%08s", strconv.FormatUint(uint64(h.Sum32()), 36))
}

func contains(s []string, v string) bool {
	for _, x := range s {
		if x == v {
			return true
		}
	}
	return false
}

func infoTitle(o map[string]any) string {
	info, ok := o["info"].(map[string]any)
	if !ok {
		return ""
	}
	if t, ok := info["title"].(string); ok {
		return t
	}
	return ""
}

// Parse attempts to parse a spec text into an ApiDoc. Supports OpenAPI2/Swagger2,
// OpenAPI3, Postman, Apifox. Returns error if unrecognized, empty, or invalid JSON.
func Parse(text string) (*ApiDoc, error) {
	if strings.TrimSpace(text) == "" {
		return nil, errors.New("apidoc: empty input")
	}
	var o map[string]any
	if err := json.Unmarshal([]byte(text), &o); err != nil {
		return nil, fmt.Errorf("apidoc: invalid JSON: %w", err)
	}
	if o == nil {
		return nil, errors.New("apidoc: top-level JSON is not an object")
	}

	// Detection order mirrors the TS importApiSpec dispatch.
	if _, ok := o["apifoxProject"]; ok {
		if _, isStr := o["apifoxProject"].(string); isStr {
			return parseApifox(o), nil
		}
	}
	if sch, ok := o["$schema"].(map[string]any); ok {
		if app, ok := sch["app"].(string); ok && app == "apifox" {
			return parseApifox(o), nil
		}
	}
	if sw, ok := o["swagger"].(string); ok && strings.HasPrefix(sw, "2") {
		return parseSwagger2(o), nil
	}
	if _, ok := o["openapi"].(string); ok {
		return parseOpenAPI3(o), nil
	}
	if _, ok := o["info"].(map[string]any); ok {
		if _, has := o["paths"]; has {
			return parseSwagger2(o), nil
		}
		if _, has := o["basePath"]; has {
			return parseSwagger2(o), nil
		}
	}
	if _, ok := o["item"].([]any); ok {
		return parsePostman(o), nil
	}
	return nil, errors.New("apidoc: unrecognized spec format")
}

// ---------- shared grouping / dedup ----------

// addToBuckets dedupes by method+uri (keeping the first occurrence) and appends the
// endpoint to the bucket named name.
func addToBuckets(buckets map[string][]ApiEndpoint, seen map[string]bool, name string, ep ApiEndpoint) {
	key := epKey(ep.Method, ep.URI)
	if seen[key] {
		return
	}
	seen[key] = true
	buckets[name] = append(buckets[name], ep)
}

// bucketName returns the first non-empty tag, else the fallback name.
func bucketName(tags any, fallback string) string {
	if arr, ok := tags.([]any); ok {
		for _, t := range arr {
			if s, ok := t.(string); ok && strings.TrimSpace(s) != "" {
				return strings.TrimSpace(s)
			}
		}
	}
	return fallback
}

// groupsFromBuckets builds ApiGroup slices with deterministic group ids.
func groupsFromBuckets(buckets map[string][]ApiEndpoint, src string) []ApiGroup {
	groups := make([]ApiGroup, 0, len(buckets))
	for name, items := range buckets {
		groups = append(groups, ApiGroup{
			ID:           "g_" + shortHash(name),
			Name:         name,
			ImportSource: src,
			Items:        items,
		})
	}
	return groups
}

// ---------- Swagger 2 / OpenAPI 2 ----------

func swaggerBaseHost(o map[string]any) string {
	scheme := "https"
	if s, ok := o["schemes"].([]any); ok && len(s) > 0 {
		if str, ok := s[0].(string); ok && str != "" {
			scheme = str
		}
	}
	host, _ := o["host"].(string)
	basePath, _ := o["basePath"].(string)
	if host == "" {
		return ""
	}
	return scheme + "://" + host + basePath
}

func parseSwagger2(o map[string]any) *ApiDoc {
	paths, _ := o["paths"].(map[string]any)
	buckets := map[string][]ApiEndpoint{}
	seen := map[string]bool{}
	fallback := infoTitle(o)
	if fallback == "" {
		fallback = "未分组"
	}

	for path, opsRaw := range paths {
		ops, ok := opsRaw.(map[string]any)
		if !ok {
			continue
		}
		for m, opRaw := range ops {
			method := strings.ToUpper(m)
			if !knownMethod(method) {
				continue
			}
			op, ok := opRaw.(map[string]any)
			if !ok {
				op = map[string]any{}
			}
			uri := normURI(path)

			var params []any
			if p, ok := op["parameters"].([]any); ok {
				params = p
			}
			var headers, query []ApiKeyValue
			body := ""
			bodyType := "none"
			for _, pRaw := range params {
				p, ok := pRaw.(map[string]any)
				if !ok {
					continue
				}
				inWhere, _ := p["in"].(string)
				key, _ := p["name"].(string)
				value := ""
				if d, ok := p["default"].(string); ok {
					value = d
				} else if e, ok := p["example"].(string); ok {
					value = e
				}
				desc, _ := p["description"].(string)
				kv := ApiKeyValue{Key: key, Value: value, Enabled: true, Description: desc, Type: paramType(p, o)}
				switch inWhere {
				case "header":
					headers = append(headers, kv)
				case "query", "path":
					query = append(query, kv)
				case "body":
					if sch, ok := p["schema"].(map[string]any); ok {
						body = schemaToSample(sch, o)
					}
					bodyType = "json"
				}
			}

			var consumes []any
			if c, ok := op["consumes"].([]any); ok {
				consumes = c
			} else if c, ok := o["consumes"].([]any); ok {
				consumes = c
			}
			contentType := "application/json"
			if len(consumes) > 0 {
				if s, ok := consumes[0].(string); ok && s != "" {
					contentType = s
				}
			}

			ex, fields := extractResponse(op["responses"], o)

			name := ""
			if s, ok := op["summary"].(string); ok && s != "" {
				name = s
			} else if s, ok := op["operationId"].(string); ok && s != "" {
				name = s
			} else {
				name = method + " " + uri
			}
			desc, _ := op["description"].(string)

			bodyFields := []ApiField{}
			if bodyType == "json" && strings.TrimSpace(body) != "" {
				bodyFields = bodyToFields(body)
			}

			ep := ApiEndpoint{
				ID:              "e_" + shortHash(epKey(method, uri)),
				Name:            name,
				Method:          method,
				URI:             uri,
				ContentType:     contentType,
				Headers:         headers,
				Params:          query,
				BodyType:        bodyType,
				Body:            body,
				Description:     desc,
				ResponseExample: ex,
				ResponseFields:  fields,
				BodyFields:      bodyFields,
			}
			addToBuckets(buckets, seen, bucketName(op["tags"], fallback), ep)
		}
	}

	src := swaggerBaseHost(o)
	if src == "" {
		src = infoTitle(o)
	}
	return &ApiDoc{Version: 1, BaseHost: swaggerBaseHost(o), Groups: groupsFromBuckets(buckets, src)}
}

// ---------- OpenAPI 3 ----------

func parseOpenAPI3(o map[string]any) *ApiDoc {
	paths, _ := o["paths"].(map[string]any)
	base := ""
	if servers, ok := o["servers"].([]any); ok && len(servers) > 0 {
		if sm, ok := servers[0].(map[string]any); ok {
			if s, ok := sm["url"].(string); ok {
				base = s
			}
		}
	}
	buckets := map[string][]ApiEndpoint{}
	seen := map[string]bool{}
	fallback := infoTitle(o)
	if fallback == "" {
		fallback = "未分组"
	}

	for path, opsRaw := range paths {
		ops, ok := opsRaw.(map[string]any)
		if !ok {
			continue
		}
		for m, opRaw := range ops {
			method := strings.ToUpper(m)
			if !knownMethod(method) {
				continue
			}
			op, ok := opRaw.(map[string]any)
			if !ok {
				op = map[string]any{}
			}
			uri := normURI(path)

			var params []any
			if p, ok := op["parameters"].([]any); ok {
				params = p
			}
			var headers, query []ApiKeyValue
			for _, pRaw := range params {
				p, ok := pRaw.(map[string]any)
				if !ok {
					continue
				}
				inWhere, _ := p["in"].(string)
				key, _ := p["name"].(string)
				value, _ := p["default"].(string)
				desc, _ := p["description"].(string)
				kv := ApiKeyValue{Key: key, Value: value, Enabled: true, Description: desc, Type: paramType(p, o)}
				switch inWhere {
				case "header":
					headers = append(headers, kv)
				case "query", "path":
					query = append(query, kv)
				}
			}

			body := ""
			bodyType := "none"
			contentType := "application/json"
			if rb, ok := op["requestBody"].(map[string]any); ok {
				if content, ok := rb["content"].(map[string]any); ok && len(content) > 0 {
					var ct string
					var schema any
					for k, v := range content {
						ct = k
						if cm, ok := v.(map[string]any); ok {
							schema = cm["schema"]
						}
						break
					}
					if ct != "" {
						contentType = ct
					}
					if schema != nil {
						body = schemaToSample(schema, o)
						bodyType = "json"
					}
				}
			}

			ex, fields := extractResponse(op["responses"], o)

			name := ""
			if s, ok := op["summary"].(string); ok && s != "" {
				name = s
			} else if s, ok := op["operationId"].(string); ok && s != "" {
				name = s
			} else {
				name = method + " " + uri
			}
			desc, _ := op["description"].(string)

			bodyFields := []ApiField{}
			if bodyType == "json" && strings.TrimSpace(body) != "" {
				bodyFields = bodyToFields(body)
			}

			ep := ApiEndpoint{
				ID:              "e_" + shortHash(epKey(method, uri)),
				Name:            name,
				Method:          method,
				URI:             uri,
				ContentType:     contentType,
				Headers:         headers,
				Params:          query,
				BodyType:        bodyType,
				Body:            body,
				Description:     desc,
				ResponseExample: ex,
				ResponseFields:  fields,
				BodyFields:      bodyFields,
			}
			addToBuckets(buckets, seen, bucketName(op["tags"], fallback), ep)
		}
	}

	src := base
	if src == "" {
		src = infoTitle(o)
	}
	return &ApiDoc{Version: 1, BaseHost: base, Groups: groupsFromBuckets(buckets, src)}
}

// paramType extracts a readable type string for a parameter; resolves $ref first.
func paramType(p map[string]any, root map[string]any) string {
	s := any(p)
	if sch, ok := p["schema"].(map[string]any); ok {
		s = sch
	}
	if m, ok := s.(map[string]any); ok {
		if ref, ok := m["$ref"].(string); ok {
			if d := resolveRef(root, ref); d != nil {
				if dm, ok := d.(map[string]any); ok {
					s = dm
				}
			}
		}
	}
	if m, ok := s.(map[string]any); ok {
		if t, ok := m["type"].(string); ok {
			return t
		}
	}
	if t, ok := p["type"].(string); ok {
		return t
	}
	return ""
}

// ---------- Postman ----------

func parsePostman(o map[string]any) *ApiDoc {
	src := ""
	if info, ok := o["info"].(map[string]any); ok {
		if n, ok := info["name"].(string); ok {
			src = n
		}
	}
	buckets := map[string][]ApiEndpoint{}
	seen := map[string]bool{}

	items, _ := o["item"].([]any)
	var walk func(items []any, parentName string)
	walk = func(items []any, parentName string) {
		for _, itRaw := range items {
			it, ok := itRaw.(map[string]any)
			if !ok {
				continue
			}
			if sub, ok := it["item"].([]any); ok {
				name := parentName
				if n, ok := it["name"].(string); ok && n != "" {
					name = n
				}
				leaves := collectPostmanItems(sub, seen)
				if len(leaves) > 0 {
					buckets[name] = append(buckets[name], leaves...)
				} else {
					walk(sub, name)
				}
			}
		}
	}
	walk(items, "Postman 导入")

	// If no folder groups were produced, collect everything at top level as one group.
	if len(buckets) == 0 {
		leaves := collectPostmanItems(items, seen)
		if len(leaves) > 0 {
			buckets["Postman 导入"] = leaves
		}
	}

	return &ApiDoc{Version: 1, BaseHost: "", Groups: groupsFromBuckets(buckets, src)}
}

func collectPostmanItems(items []any, seen map[string]bool) []ApiEndpoint {
	var out []ApiEndpoint
	for _, itRaw := range items {
		it, ok := itRaw.(map[string]any)
		if !ok {
			continue
		}
		if sub, ok := it["item"].([]any); ok {
			out = append(out, collectPostmanItems(sub, seen)...)
			continue
		}
		req, ok := it["request"].(map[string]any)
		if !ok || len(req) == 0 {
			continue
		}
		method := "GET"
		if mv, ok := req["method"].(string); ok && mv != "" {
			method = strings.ToUpper(mv)
		}
		uri := postmanURL(req["url"])
		key := epKey(method, uri)
		if seen[key] {
			continue
		}
		seen[key] = true

		var headers []ApiKeyValue
		if hs, ok := req["header"].([]any); ok {
			for _, hRaw := range hs {
				if h, ok := hRaw.(map[string]any); ok {
					k, _ := h["key"].(string)
					v, _ := h["value"].(string)
					d, _ := h["description"].(string)
					headers = append(headers, ApiKeyValue{Key: k, Value: v, Enabled: true, Description: d})
				}
			}
		}

		body := ""
		bodyType := "none"
		contentType := "application/json"
		if bh, ok := req["body"].(map[string]any); ok {
			mode, _ := bh["mode"].(string)
			switch mode {
			case "raw":
				body, _ = bh["raw"].(string)
				bodyType = "raw"
				if ct := postmanHeaderValue(headers, "Content-Type"); ct != "" {
					contentType = ct
				} else if strings.HasPrefix(strings.TrimSpace(body), "{") || strings.HasPrefix(strings.TrimSpace(body), "[") {
					bodyType = "json"
					contentType = "application/json"
				}
			case "urlencoded", "formdata":
				bodyType = "form"
				contentType = "application/x-www-form-urlencoded"
				var flds []any
				if f, ok := bh["urlencoded"].([]any); ok {
					flds = f
				} else if f, ok := bh["formdata"].([]any); ok {
					flds = f
				}
				parts := make([]string, 0, len(flds))
				for _, fRaw := range flds {
					if f, ok := fRaw.(map[string]any); ok {
						k, _ := f["key"].(string)
						v, _ := f["value"].(string)
						parts = append(parts, url.QueryEscape(k)+"="+url.QueryEscape(v))
					}
				}
				body = strings.Join(parts, "&")
			}
		}

		responseExample := ""
		if rs, ok := it["response"].([]any); ok {
			for _, rRaw := range rs {
				if r, ok := rRaw.(map[string]any); ok {
					code := 0
					if c, ok := r["code"].(float64); ok {
						code = int(c)
					}
					if code >= 200 && code < 300 {
						if b, ok := r["body"].(string); ok {
							responseExample = b
						}
						break
					}
				}
			}
		}

		name, _ := it["name"].(string)
		if name == "" {
			name = method + " " + uri
		}

		bodyFields := []ApiField{}
		if bodyType == "json" && strings.TrimSpace(body) != "" {
			bodyFields = bodyToFields(body)
		}

		out = append(out, ApiEndpoint{
			ID:              "e_" + shortHash(key),
			Name:            name,
			Method:          method,
			URI:             uri,
			ContentType:     contentType,
			Headers:         headers,
			Params:          []ApiKeyValue{},
			BodyType:        bodyType,
			Body:            body,
			ResponseExample: responseExample,
			BodyFields:      bodyFields,
		})
	}
	return out
}

func postmanURL(urlRaw any) string {
	if urlRaw == nil {
		return "/"
	}
	if s, ok := urlRaw.(string); ok {
		return s
	}
	u, ok := urlRaw.(map[string]any)
	if !ok {
		return "/"
	}
	if s, ok := u["raw"].(string); ok && s != "" {
		return s
	}
	host := ""
	if h, ok := u["host"].([]any); ok {
		for _, x := range h {
			if s, ok := x.(string); ok {
				host += s
			}
		}
	}
	path := ""
	if p, ok := u["path"].([]any); ok {
		for _, x := range p {
			if s, ok := x.(string); ok {
				path += "/" + s
			}
		}
	}
	if path == "" {
		path = "/"
	}
	if host != "" {
		return path + " (" + host + ")"
	}
	return path
}

func postmanHeaderValue(headers []ApiKeyValue, key string) string {
	for _, h := range headers {
		if strings.EqualFold(h.Key, key) {
			return h.Value
		}
	}
	return ""
}

// ---------- Apifox ----------

func buildApifoxDefinitions(o map[string]any) map[string]any {
	defs := map[string]any{}
	var scan func(node any)
	scan = func(node any) {
		switch n := node.(type) {
		case []any:
			for _, x := range n {
				scan(x)
			}
		case map[string]any:
			if id, ok := n["id"].(string); ok && strings.HasPrefix(id, "#/definitions/") {
				key := id[len("#/definitions/"):]
				var sch any
				if s, ok := n["schema"].(map[string]any); ok {
					if js, ok := s["jsonSchema"]; ok {
						sch = js
					}
				}
				if sch == nil {
					if js, ok := n["jsonSchema"]; ok {
						sch = js
					}
				}
				if sch == nil {
					sch = n["schema"]
				}
				if sch != nil {
					defs[key] = sch
				}
			}
			for _, v := range n {
				scan(v)
			}
		}
	}
	for _, ckey := range []string{"schemaCollection", "responseCollection", "requestCollection", "oasComponentCollection"} {
		scan(o[ckey])
	}
	return defs
}

func parseApifox(o map[string]any) *ApiDoc {
	infoName := "Apifox 导入"
	if info, ok := o["info"].(map[string]any); ok {
		if n, ok := info["name"].(string); ok && n != "" {
			infoName = n
		}
	}
	root := map[string]any{}
	for k, v := range o {
		root[k] = v
	}
	root["definitions"] = buildApifoxDefinitions(o)

	buckets := map[string][]ApiEndpoint{}
	seen := map[string]bool{}
	var walk func(items []any, folderName string)
	walk = func(items []any, folderName string) {
		for _, itRaw := range items {
			it, ok := itRaw.(map[string]any)
			if !ok {
				continue
			}
			if api, ok := it["api"].(map[string]any); ok {
				ep := parseApifoxApi(it, root)
				name := folderName
				if name == "" {
					name = infoName
				}
				if tag := bucketName(api["tags"], ""); tag != "" {
					name = tag
				}
				addToBuckets(buckets, seen, name, ep)
			} else if sub, ok := it["items"].([]any); ok {
				fn := folderName
				if n, ok := it["name"].(string); ok && n != "" {
					fn = n
				}
				walk(sub, fn)
			}
		}
	}
	if ac, ok := o["apiCollection"].([]any); ok {
		walk(ac, "")
	}

	src := infoName
	groups := groupsFromBuckets(buckets, src)
	if len(groups) == 0 {
		groups = append(groups, ApiGroup{ID: "g_" + shortHash(infoName), Name: infoName, ImportSource: src, Items: nil})
	}
	return &ApiDoc{Version: 1, BaseHost: "", Groups: groups}
}

func parseApifoxApi(it, root map[string]any) ApiEndpoint {
	api, _ := it["api"].(map[string]any)
	method := normMethod(fmt.Sprintf("%v", api["method"]))
	uri := "/"
	if p, ok := api["path"].(string); ok && p != "" {
		uri = p
	}
	key := epKey(method, uri)
	name := ""
	if n, ok := it["name"].(string); ok && n != "" {
		name = n
	} else {
		name = method + " " + uri
	}
	desc, _ := api["description"].(string)

	params, _ := api["parameters"].(map[string]any)
	var headers []ApiKeyValue
	if h, ok := params["header"].([]any); ok {
		for _, x := range h {
			if m, ok := x.(map[string]any); ok {
				headers = append(headers, apifoxParamKV(m))
			}
		}
	}
	var query []ApiKeyValue
	if q, ok := params["query"].([]any); ok {
		for _, x := range q {
			if m, ok := x.(map[string]any); ok {
				query = append(query, apifoxParamKV(m))
			}
		}
	}
	if p, ok := params["path"].([]any); ok {
		for _, x := range p {
			if m, ok := x.(map[string]any); ok {
				query = append(query, apifoxParamKV(m))
			}
		}
	}

	rb, _ := api["requestBody"].(map[string]any)
	rbType := "none"
	if t, ok := rb["type"].(string); ok && t != "" {
		rbType = t
	}
	body := ""
	bodyType := "none"
	contentType := "application/json"
	if rbType != "" && rbType != "none" {
		contentType = rbType
		switch {
		case strings.Contains(rbType, "json"):
			bodyType = "json"
			if sch, ok := rb["jsonSchema"].(map[string]any); ok {
				body = schemaToSample(sch, root)
			}
		case strings.Contains(rbType, "form"), strings.Contains(rbType, "x-www-form-urlencoded"):
			bodyType = "form"
			var fps []any
			if f, ok := rb["parameters"].([]any); ok {
				fps = f
			}
			parts := make([]string, 0, len(fps))
			for _, x := range fps {
				if m, ok := x.(map[string]any); ok {
					k, _ := m["name"].(string)
					v, _ := m["value"].(string)
					parts = append(parts, url.QueryEscape(k)+"="+url.QueryEscape(v))
				}
			}
			body = strings.Join(parts, "&")
		default:
			bodyType = "raw"
		}
	}

	var responses []any
	if r, ok := api["responses"].([]any); ok {
		responses = r
	}
	var okResp map[string]any
	for _, x := range responses {
		if m, ok := x.(map[string]any); ok {
			code := 0
			if c, ok := m["code"].(float64); ok {
				code = int(c)
			}
			if code == 200 || code == 201 {
				okResp = m
				break
			}
		}
	}
	if okResp == nil && len(responses) > 0 {
		if m, ok := responses[0].(map[string]any); ok {
			okResp = m
		}
	}
	respExample := ""
	var respFields []ApiField
	if okResp != nil {
		if sch, ok := okResp["jsonSchema"].(map[string]any); ok {
			respExample = schemaToSample(sch, root)
			respFields = schemaToFields(sch, "", nil, root)
		}
	}

	bodyFields := []ApiField{}
	if bodyType == "json" && strings.TrimSpace(body) != "" {
		bodyFields = bodyToFields(body)
	}

	return ApiEndpoint{
		ID:              "e_" + shortHash(key),
		Name:            name,
		Method:          method,
		URI:             uri,
		ContentType:     contentType,
		Headers:         headers,
		Params:          query,
		BodyType:        bodyType,
		Body:            body,
		Description:     desc,
		ResponseExample: respExample,
		ResponseFields:  respFields,
		BodyFields:      bodyFields,
	}
}

func apifoxParamKV(p map[string]any) ApiKeyValue {
	s := any(p)
	if sch, ok := p["schema"].(map[string]any); ok {
		s = sch
	}
	key, _ := p["name"].(string)
	value := ""
	if e, ok := p["example"].(string); ok {
		value = e
	} else if d, ok := p["default"].(string); ok {
		value = d
	}
	enabled := true
	if en, ok := p["enable"].(bool); ok {
		enabled = en
	}
	desc, _ := p["description"].(string)
	t := ""
	if tt, ok := p["type"].(string); ok {
		t = tt
	} else if tt, ok := s.(map[string]any)["type"].(string); ok {
		t = tt
	}
	return ApiKeyValue{Key: key, Value: value, Enabled: enabled, Description: desc, Type: t}
}

// ---------- $ref resolution ----------

// resolveRef resolves a local #/... reference against root.
func resolveRef(root map[string]any, ref string) any {
	if !strings.HasPrefix(ref, "#/") {
		return nil
	}
	parts := strings.Split(ref[2:], "/")
	var cur any = root
	for _, p := range parts {
		m, ok := cur.(map[string]any)
		if !ok {
			return nil
		}
		cur = m[p]
	}
	return cur
}

// derefSchema recursively replaces $ref nodes with their definitions, guarding against
// circular refs (returns {} on cycle).
func derefSchema(schema any, root map[string]any, seen map[string]bool) any {
	switch s := schema.(type) {
	case []any:
		out := make([]any, len(s))
		for i, x := range s {
			out[i] = derefSchema(x, root, seen)
		}
		return out
	case map[string]any:
		if ref, ok := s["$ref"].(string); ok {
			if seen[ref] {
				return map[string]any{}
			}
			seen[ref] = true
			d := derefSchema(resolveRef(root, ref), root, seen)
			delete(seen, ref)
			return d
		}
		out := make(map[string]any, len(s))
		for k, v := range s {
			out[k] = derefSchema(v, root, seen)
		}
		return out
	default:
		return schema
	}
}

// ---------- schema sampling ----------

// schemaToSample produces a pretty-printed (indent 2) JSON sample of a schema.
// Returns "" on failure.
func schemaToSample(schema any, root map[string]any) string {
	if schema == nil {
		return ""
	}
	if _, ok := schema.(map[string]any); !ok {
		return ""
	}
	defer func() { _ = recover() }()
	derefed := derefSchema(schema, root, map[string]bool{})
	m, ok := derefed.(map[string]any)
	if !ok {
		return ""
	}
	sample := sampleFromSchema(m, root)
	b, err := json.MarshalIndent(sample, "", "  ")
	if err != nil {
		return ""
	}
	return string(b)
}

func sampleFromSchema(s map[string]any, root map[string]any) any {
	node := derefSchema(s, root, map[string]bool{})
	n, ok := node.(map[string]any)
	if !ok {
		return nil
	}
	// An object is present if it has properties (Apifox sometimes omits type:object).
	if props, ok := n["properties"].(map[string]any); ok {
		out := map[string]any{}
		for k, v := range props {
			if vm, ok := v.(map[string]any); ok {
				out[k] = sampleFromSchema(vm, root)
			} else {
				out[k] = nil
			}
		}
		return out
	}
	switch n["type"] {
	case "object":
		out := map[string]any{}
		if props, ok := n["properties"].(map[string]any); ok {
			for k, v := range props {
				if vm, ok := v.(map[string]any); ok {
					out[k] = sampleFromSchema(vm, root)
				} else {
					out[k] = nil
				}
			}
		}
		return out
	case "array":
		items, _ := n["items"].(map[string]any)
		return []any{sampleFromSchema(items, root)}
	case "string":
		if e, ok := n["example"].(string); ok {
			return e
		}
		if d, ok := n["default"].(string); ok {
			return d
		}
		return "string"
	case "integer", "number":
		if e, ok := n["example"].(float64); ok {
			return e
		}
		if d, ok := n["default"].(float64); ok {
			return d
		}
		return 0
	case "boolean":
		if e, ok := n["example"].(bool); ok {
			return e
		}
		return false
	default:
		if e, ok := n["example"]; ok {
			return e
		}
		return nil
	}
}

// schemaToFields produces field rows with nested paths (a.b / a[]) and required flags.
// Returns nil if the schema is not an object.
func schemaToFields(schema any, prefix string, topRequired []string, root map[string]any) []ApiField {
	s := derefSchema(schema, root, map[string]bool{})
	m, ok := s.(map[string]any)
	if !ok {
		return nil
	}
	t, _ := m["type"].(string)
	if t == "array" {
		items, _ := m["items"].(map[string]any)
		np := prefix
		if np != "" {
			np += "[]"
		} else {
			np = "items"
		}
		return schemaToFields(items, np, nil, root)
	}
	if t == "object" || m["properties"] != nil {
		props, _ := m["properties"].(map[string]any)
		if props == nil {
			props = map[string]any{}
		}
		req := topRequired
		if ra, ok := m["required"].([]any); ok {
			req = make([]string, 0, len(ra))
			for _, x := range ra {
				if s, ok := x.(string); ok {
					req = append(req, s)
				}
			}
		}
		var out []ApiField
		for k, v := range props {
			vv := derefSchema(v, root, map[string]bool{})
			vvm, _ := vv.(map[string]any)
			name := k
			if prefix != "" {
				name = prefix + "." + k
			}
			vt, _ := vvm["type"].(string)
			if vt == "" {
				switch {
				case vvm["$ref"] != nil:
					vt = "object"
				case vvm["properties"] != nil:
					vt = "object"
				case vvm["items"] != nil:
					vt = "array"
				default:
					vt = "any"
				}
			}
			vReq := req
			if vra, ok := vvm["required"].([]any); ok {
				vReq = make([]string, 0, len(vra))
				for _, x := range vra {
					if s, ok := x.(string); ok {
						vReq = append(vReq, s)
					}
				}
			}
			desc := ""
			if d, ok := vvm["description"].(string); ok {
				desc = d
			} else if d, ok := vvm["title"].(string); ok {
				desc = d
			}
			out = append(out, ApiField{
				Name:        name,
				Type:        vt,
				Description: desc,
				Required:    contains(vReq, k),
			})
			if vt == "object" || vt == "array" || vvm["properties"] != nil || vvm["items"] != nil {
				out = append(out, schemaToFields(vvm, name, vReq, root)...)
			}
		}
		return out
	}
	return nil
}

// bodyToFields 把请求体 JSON 示例字符串推导为扁平字段表（name 路径 / type / required=false）。
// 与前端 jsonToFields 同语义：对象不单独成行，数组成行且元素递归（前缀 + "[]"），叶节点取 Go 类型。
func bodyToFields(body string) []ApiField {
	if strings.TrimSpace(body) == "" {
		return nil
	}
	var obj any
	if err := json.Unmarshal([]byte(body), &obj); err != nil {
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
			out = append(out, ApiField{Name: prefix, Type: goScalarType(node)})
		}
	}
	walk(obj, "")
	if out == nil {
		return nil
	}
	return out
}

// goScalarType 返回 Go 值的 JSON Schema 标量类型名（与前端 jsonToFields 的 typeof 对齐）。
func goScalarType(v any) string {
	switch v.(type) {
	case string:
		return "string"
	case float64, int64:
		return "number"
	case bool:
		return "boolean"
	default:
		return "any"
	}
}

// extractResponse pulls the 200/201/2XX/first response and builds example + fields.
func extractResponse(responses any, root map[string]any) (string, []ApiField) {
	rs, ok := responses.(map[string]any)
	if !ok {
		return "", nil
	}
	var entry any
	if e, ok := rs["200"]; ok {
		entry = e
	} else if e, ok := rs["201"]; ok {
		entry = e
	} else if e, ok := rs["2XX"]; ok {
		entry = e
	} else if len(rs) > 0 {
		for _, v := range rs {
			entry = v
			break
		}
	}
	if entry == nil {
		return "", nil
	}
	em, ok := entry.(map[string]any)
	if !ok {
		return "", nil
	}
	content, _ := em["content"].(map[string]any)
	var schema any
	if len(content) > 0 {
		for _, v := range content {
			if cm, ok := v.(map[string]any); ok {
				schema = cm["schema"]
			}
			break
		}
	} else {
		schema = em["schema"]
	}
	if schema == nil {
		return "", nil
	}
	return schemaToSample(schema, root), schemaToFields(schema, "", nil, root)
}
