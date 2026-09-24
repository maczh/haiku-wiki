package exportx

import (
	"encoding/json"
	"testing"

	"haiku-wiki/server/internal/service/apidoc"
)

// sampleAPIContent 含 body_fields / response_fields 与 base_host，用于三种 JSON 导出测试。
const sampleAPIContent = `{
  "version": 1,
  "base_host": "https://api.example.com/v1",
  "groups": [
    {
      "id": "g1",
      "name": "用户",
      "items": [
        {
          "id": "e1",
          "name": "获取菜品",
          "method": "POST",
          "uri": "/dishes",
          "content_type": "application/json",
          "headers": [{"key":"X-Token","value":"","enabled":true,"description":"鉴权token"}],
          "params": [],
          "body_type": "json",
          "body": "{\"data\":{\"list\":[{\"dishId\":1,\"name\":\"鱼香肉丝\"}]},\"code\":0}",
          "description": "返回菜品列表",
          "body_fields": [
            {"name":"data.list[].dishId","type":"int64","description":"菜品ID","required":true},
            {"name":"data.list[].name","type":"string","description":"菜名","required":false},
            {"name":"code","type":"int","description":"状态码","required":false}
          ],
          "response_fields": [
            {"name":"data.list[].dishId","type":"int64","description":"菜品ID","required":true},
            {"name":"code","type":"int","description":"状态码","required":false}
          ]
        }
      ]
    }
  ]
}`

// TestBuildSchemaFromFieldsNested 验证扁平字段表 data.list[].dishId 能重建为嵌套 schema。
func TestBuildSchemaFromFieldsNested(t *testing.T) {
	fields := []ApiField{
		{Name: "data.list[].dishId", Type: "int64", Description: "菜品ID", Required: true},
		{Name: "data.list[].name", Type: "string", Description: "菜名", Required: false},
		{Name: "code", Type: "int", Description: "状态码", Required: false},
	}
	example := `{"code":0,"data":{"list":[{"dishId":1,"name":"鱼香肉丝"}]}}`
	sch := buildSchemaFromFields(fields, example)

	root, ok := sch["type"].(string)
	if !ok || root != "object" {
		t.Fatalf("root type should be object, got %v", sch["type"])
	}
	props, ok := sch["properties"].(map[string]any)
	if !ok {
		t.Fatal("root missing properties")
	}
	// code 叶
	code, ok := props["code"].(map[string]any)
	if !ok || code["type"] != "integer" {
		t.Fatalf("code field wrong: %#v", props["code"])
	}
	if code["description"] != "状态码" {
		t.Fatalf("code description wrong: %v", code["description"])
	}
	// data.list[] → items.object.properties.dishId
	data, ok := props["data"].(map[string]any)
	if !ok || data["type"] != "object" {
		t.Fatal("data should be object")
	}
	list, ok := data["properties"].(map[string]any)["list"].(map[string]any)
	if !ok || list["type"] != "array" {
		t.Fatal("data.list should be array")
	}
	items, ok := list["items"].(map[string]any)
	if !ok || items["type"] != "object" {
		t.Fatal("list items should be object")
	}
	dishId, ok := items["properties"].(map[string]any)["dishId"].(map[string]any)
	if !ok {
		t.Fatal("dishId missing")
	}
	if dishId["type"] != "integer" {
		t.Fatalf("dishId type should be integer, got %v", dishId["type"])
	}
	if dishId["description"] != "菜品ID" {
		t.Fatalf("dishId description wrong: %v", dishId["description"])
	}
	// example 回填：dishId.example == 1
	if ex, _ := dishId["example"].(float64); ex != 1 {
		t.Fatalf("dishId example should be 1, got %v", dishId["example"])
	}
	// 必填：dishId 在 items 级 required 中
	req, ok := items["required"].([]any)
	if !ok {
		t.Fatal("items missing required")
	}
	found := false
	for _, r := range req {
		if r == "dishId" {
			found = true
		}
	}
	if !found {
		t.Fatalf("dishId should be in required, got %v", req)
	}
}

// TestBuildApiDocSwagger 验证 Swagger 2.0 输出是合法 JSON 且结构正确。
func TestBuildApiDocSwagger(t *testing.T) {
	data, err := BuildApiDocSwagger(sampleAPIContent, "菜品接口")
	if err != nil {
		t.Fatalf("BuildApiDocSwagger error: %v", err)
	}
	var doc map[string]any
	if err := json.Unmarshal(data, &doc); err != nil {
		t.Fatalf("swagger output not valid JSON: %v", err)
	}
	if doc["swagger"] != "2.0" {
		t.Fatalf("swagger version wrong: %v", doc["swagger"])
	}
	info, ok := doc["info"].(map[string]any)
	if !ok || info["title"] != "菜品接口" {
		t.Fatalf("info.title wrong: %v", doc["info"])
	}
	if doc["host"] != "api.example.com" {
		t.Fatalf("host wrong: %v", doc["host"])
	}
	if doc["basePath"] != "/v1" {
		t.Fatalf("basePath wrong: %v", doc["basePath"])
	}
	schemes, ok := doc["schemes"].([]any)
	if !ok || len(schemes) == 0 || schemes[0] != "https" {
		t.Fatalf("schemes wrong: %v", doc["schemes"])
	}
	paths, ok := doc["paths"].(map[string]any)
	if !ok {
		t.Fatal("paths missing")
	}
	post, ok := paths["/dishes"].(map[string]any)["post"].(map[string]any)
	if !ok {
		t.Fatal("paths./dishes.post missing")
	}
	params, ok := post["parameters"].([]any)
	if !ok {
		t.Fatal("parameters missing")
	}
	// 应含 header + body(in:body,schema)
	hasBody := false
	for _, p := range params {
		pm := p.(map[string]any)
		if pm["in"] == "body" {
			hasBody = true
			if _, ok := pm["schema"]; !ok {
				t.Fatal("body param missing schema")
			}
		}
	}
	if !hasBody {
		t.Fatal("expected in:body parameter")
	}
	// response schema 存在
	resp, ok := post["responses"].(map[string]any)["200"].(map[string]any)
	if !ok {
		t.Fatal("200 response missing")
	}
	if _, ok := resp["schema"]; !ok {
		t.Fatal("200 response missing schema")
	}
}

// TestBuildApiDocPostman 验证 Postman v2.1 输出是合法 JSON 且结构正确。
func TestBuildApiDocPostman(t *testing.T) {
	data, err := BuildApiDocPostman(sampleAPIContent, "菜品接口")
	if err != nil {
		t.Fatalf("BuildApiDocPostman error: %v", err)
	}
	var doc map[string]any
	if err := json.Unmarshal(data, &doc); err != nil {
		t.Fatalf("postman output not valid JSON: %v", err)
	}
	info, ok := doc["info"].(map[string]any)
	if !ok {
		t.Fatal("info missing")
	}
	if info["_postman_id"] == "" {
		t.Fatal("_postman_id missing")
	}
	if info["schema"] != "https://schema.getpostman.com/json/collection/v2.1.0/collection.json" {
		t.Fatalf("postman schema wrong: %v", info["schema"])
	}
	items, ok := doc["item"].([]any)
	if !ok || len(items) == 0 {
		t.Fatal("item missing")
	}
	grp := items[0].(map[string]any)
	ep := grp["item"].([]any)[0].(map[string]any)
	req := ep["request"].(map[string]any)
	if req["method"] != "POST" {
		t.Fatalf("method wrong: %v", req["method"])
	}
	body, ok := req["body"].(map[string]any)
	if !ok || body["mode"] != "raw" {
		t.Fatal("body mode should be raw")
	}
	// 说明承载在 request.description（Markdown 字段表）
	if _, ok := req["description"].(string); !ok {
		t.Fatal("request.description (字段说明) missing")
	}
	respArr, ok := ep["response"].([]any)
	if !ok || len(respArr) == 0 {
		t.Fatal("response missing")
	}
	if _, ok := respArr[0].(map[string]any)["description"]; !ok {
		t.Fatal("response description (字段说明) missing")
	}
}

// TestBuildApiDocApifox 验证 Apifox 项目 JSON 合法、可被 apidoc.Parse 回灌。
func TestBuildApiDocApifox(t *testing.T) {
	data, err := BuildApiDocApifox(sampleAPIContent, "菜品接口")
	if err != nil {
		t.Fatalf("BuildApiDocApifox error: %v", err)
	}
	var doc map[string]any
	if err := json.Unmarshal(data, &doc); err != nil {
		t.Fatalf("apifox output not valid JSON: %v", err)
	}
	if doc["apifoxProject"] != "haiku-wiki" {
		t.Fatalf("apifoxProject marker missing: %v", doc["apifoxProject"])
	}
	coll, ok := doc["apiCollection"].([]any)
	if !ok || len(coll) == 0 {
		t.Fatal("apiCollection missing")
	}
	api := coll[0].(map[string]any)["items"].([]any)[0].(map[string]any)["api"].(map[string]any)
	if api["method"] != "POST" || api["path"] != "/dishes" {
		t.Fatalf("api method/path wrong: %v %v", api["method"], api["path"])
	}
	rb, ok := api["requestBody"].(map[string]any)
	if !ok || rb["type"] != "json" {
		t.Fatalf("requestBody wrong: %v", api["requestBody"])
	}
	if _, ok := rb["jsonSchema"]; !ok {
		t.Fatal("requestBody.jsonSchema missing")
	}

	// 回灌：apidoc.Parse 应识别并解析出该接口（含经 bodyToFields 补算的 body_fields）。
	parsed, perr := apidoc.Parse(string(data))
	if perr != nil {
		t.Fatalf("apifox output not recognized by apidoc.Parse: %v", perr)
	}
	var found *apidoc.ApiEndpoint
	for _, g := range parsed.Groups {
		for i := range g.Items {
			if g.Items[i].Method == "POST" && g.Items[i].URI == "/dishes" {
				found = &g.Items[i]
			}
		}
	}
	if found == nil {
		t.Fatal("apifox round-trip: endpoint POST /dishes not found")
	}
	if found.BodyType != "json" {
		t.Fatalf("round-trip body_type wrong: %v", found.BodyType)
	}
	if len(found.BodyFields) == 0 {
		t.Fatal("round-trip body_fields should be computed by bodyToFields")
	}
}

// TestBuildApiDocMDFieldTables 验证 MD 导出含两张字段说明表。
func TestBuildApiDocMDFieldTables(t *testing.T) {
	data, err := BuildApiDocMD(sampleAPIContent, "菜品接口")
	if err != nil {
		t.Fatalf("BuildApiDocMD error: %v", err)
	}
	md := string(data)
	if !containsStr(md, "请求体字段说明") {
		t.Fatal("MD missing 请求体字段说明 table")
	}
	if !containsStr(md, "返回结果字段说明") {
		t.Fatal("MD missing 返回结果字段说明 table")
	}
	if !containsStr(md, "菜品ID") {
		t.Fatal("MD missing field description 菜品ID")
	}
}

func containsStr(s, sub string) bool {
	return len(s) >= len(sub) && (indexOf(s, sub) >= 0)
}

func indexOf(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}
