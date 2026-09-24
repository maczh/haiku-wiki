package apidoc

import (
	"strings"
	"testing"
)

// swagger2Fixture: 3 distinct operations across one tag, header+query+body($ref) params,
// tags, responses with $ref schema.
const swagger2Fixture = `{
  "swagger": "2.0",
  "info": { "title": "Pet API" },
  "host": "api.example.com",
  "basePath": "/v1",
  "schemes": ["https"],
  "definitions": {
    "Pet": {
      "type": "object",
      "properties": {
        "id": { "type": "integer" },
        "name": { "type": "string", "description": "宠物名" }
      },
      "required": ["id"]
    }
  },
  "paths": {
    "/pets": {
      "get": {
        "tags": ["pets"],
        "summary": "list pets",
        "parameters": [
          { "name": "X-Token", "in": "header", "type": "string", "description": "token" },
          { "name": "page", "in": "query", "type": "integer", "default": "1" }
        ],
        "responses": {
          "200": {
            "description": "ok",
            "schema": { "type": "array", "items": { "$ref": "#/definitions/Pet" } }
          }
        }
      },
      "post": {
        "tags": ["pets"],
        "summary": "create pet",
        "parameters": [
          { "name": "body", "in": "body", "schema": { "$ref": "#/definitions/Pet" } }
        ],
        "responses": {
          "201": { "schema": { "$ref": "#/definitions/Pet" } }
        }
      }
    },
    "/pets/{id}": {
      "get": {
        "tags": ["pets", "detail"],
        "summary": "get pet",
        "parameters": [ { "name": "id", "in": "path", "type": "string", "required": true } ],
        "responses": { "200": { "schema": { "$ref": "#/definitions/Pet" } } }
      }
    }
  }
}`

func totalEndpoints(doc *ApiDoc) int {
	n := 0
	for _, g := range doc.Groups {
		n += len(g.Items)
	}
	return n
}

func findEndpoint(doc *ApiDoc, method, uri string) *ApiEndpoint {
	for _, g := range doc.Groups {
		for i := range g.Items {
			if g.Items[i].Method == method && g.Items[i].URI == uri {
				return &g.Items[i]
			}
		}
	}
	return nil
}

func TestParseSwagger2(t *testing.T) {
	doc, err := Parse(swagger2Fixture)
	if err != nil {
		t.Fatalf("Parse returned error: %v", err)
	}
	if len(doc.Groups) == 0 {
		t.Fatal("expected non-empty groups")
	}
	if totalEndpoints(doc) != 3 {
		t.Fatalf("expected 3 endpoints, got %d", totalEndpoints(doc))
	}
	for _, g := range doc.Groups {
		for _, ep := range g.Items {
			if ep.ID == "" || !strings.HasPrefix(ep.ID, "e_") {
				t.Fatalf("endpoint id must be non-empty and start with e_, got %q", ep.ID)
			}
			if ep.Method != strings.ToUpper(ep.Method) {
				t.Fatalf("method must be uppercase, got %q", ep.Method)
			}
			if ep.URI == "" {
				t.Fatal("uri must be non-empty")
			}
			// id must equal the deterministic formula.
			want := "e_" + shortHash(epKey(ep.Method, ep.URI))
			if ep.ID != want {
				t.Fatalf("endpoint id not deterministic: got %q want %q", ep.ID, want)
			}
		}
	}
	// Multi-tag operation must land in the FIRST tag's group only (not duplicated across groups).
	getPet := findEndpoint(doc, "GET", "/pets/{id}")
	if getPet == nil {
		t.Fatal("expected GET /pets/{id}")
	}
	if getPet.Name != "get pet" {
		t.Fatalf("expected name 'get pet', got %q", getPet.Name)
	}
	// Response example should be non-empty (array of $ref Pet).
	if findEndpoint(doc, "GET", "/pets").ResponseExample == "" {
		t.Fatal("expected non-empty response_example for GET /pets")
	}
	// Dedupe assertion: no two endpoints share the same method+uri.
	seen := map[string]bool{}
	for _, g := range doc.Groups {
		for _, ep := range g.Items {
			k := epKey(ep.Method, ep.URI)
			if seen[k] {
				t.Fatalf("duplicate endpoint after dedup: %s", k)
			}
			seen[k] = true
		}
	}
}

func TestParseOpenAPI3(t *testing.T) {
	const fixture = `{
  "openapi": "3.0.0",
  "info": { "title": "User API" },
  "servers": [ { "url": "https://user.example.com" } ],
  "components": {
    "schemas": {
      "User": {
        "type": "object",
        "properties": { "id": {"type":"integer"}, "email": {"type":"string"} },
        "required": ["id"]
      }
    }
  },
  "paths": {
    "/users": {
      "post": {
        "tags": ["users"],
        "summary": "create user",
        "requestBody": {
          "content": {
            "application/json": { "schema": { "$ref": "#/components/schemas/User" } }
          }
        },
        "responses": {
          "200": {
            "content": {
              "application/json": { "schema": { "$ref": "#/components/schemas/User" } }
            }
          }
        }
      }
    }
  }
}`
	doc, err := Parse(fixture)
	if err != nil {
		t.Fatalf("Parse returned error: %v", err)
	}
	if doc.BaseHost != "https://user.example.com" {
		t.Fatalf("expected base_host set, got %q", doc.BaseHost)
	}
	if totalEndpoints(doc) != 1 {
		t.Fatalf("expected 1 endpoint, got %d", totalEndpoints(doc))
	}
	ep := findEndpoint(doc, "POST", "/users")
	if ep == nil {
		t.Fatal("expected POST /users")
	}
	if ep.ResponseExample == "" {
		t.Fatal("expected non-empty response_example")
	}
	if ep.BodyType != "json" {
		t.Fatalf("expected body_type json, got %q", ep.BodyType)
	}
}

func TestParseInvalidJSON(t *testing.T) {
	_, err := Parse("{ this is not json ")
	if err == nil {
		t.Fatal("expected error for invalid JSON")
	}
}

func TestIDStability(t *testing.T) {
	doc1, err := Parse(swagger2Fixture)
	if err != nil {
		t.Fatalf("first parse error: %v", err)
	}
	doc2, err := Parse(swagger2Fixture)
	if err != nil {
		t.Fatalf("second parse error: %v", err)
	}
	if len(doc1.Groups) != len(doc2.Groups) {
		t.Fatal("group count differs between parses")
	}
	for gi := range doc1.Groups {
		if len(doc1.Groups[gi].Items) != len(doc2.Groups[gi].Items) {
			t.Fatalf("group %d item count differs", gi)
		}
		for ei := range doc1.Groups[gi].Items {
			a := doc1.Groups[gi].Items[ei]
			b := doc2.Groups[gi].Items[ei]
			if a.ID != b.ID {
				t.Fatalf("endpoint id not stable across parses: %q vs %q", a.ID, b.ID)
			}
			if epKey(a.Method, a.URI) != epKey(b.Method, b.URI) {
				t.Fatal("endpoint natural key differs (should not happen)")
			}
		}
	}
}

// TestBodyToFields verifies the Go port of jsonToFields produces correct nested paths
// and scalar types for a representative JSON body (mirrors web/src/lib/apiDoc.ts jsonToFields).
func TestBodyToFields(t *testing.T) {
	body := `{"data":{"list":[{"dishId":1,"name":"鱼香肉丝"}]},"code":0,"flag":true,"note":null}`
	fields := bodyToFields(body)
	got := map[string]ApiField{}
	for _, f := range fields {
		got[f.Name] = f
	}
	wantNames := []string{"data.list", "data.list[].dishId", "data.list[].name", "code", "flag", "note"}
	for _, n := range wantNames {
		if _, ok := got[n]; !ok {
			names := make([]string, 0, len(fields))
			for _, f := range fields {
				names = append(names, f.Name)
			}
			t.Fatalf("missing field %q; got %v", n, names)
		}
	}
	if got["data.list[].dishId"].Type != "number" {
		t.Fatalf("dishId type want number, got %q", got["data.list[].dishId"].Type)
	}
	if got["data.list[].name"].Type != "string" {
		t.Fatalf("name type want string, got %q", got["data.list[].name"].Type)
	}
	if got["code"].Type != "number" {
		t.Fatalf("code type want number, got %q", got["code"].Type)
	}
	if got["flag"].Type != "boolean" {
		t.Fatalf("flag type want boolean, got %q", got["flag"].Type)
	}
	if got["note"].Type != "null" {
		t.Fatalf("note type want null, got %q", got["note"].Type)
	}
	// empty / invalid JSON → nil (no rows)
	if bodyToFields("") != nil {
		t.Fatal("empty body should yield nil")
	}
	if bodyToFields("not json") != nil {
		t.Fatal("invalid body should yield nil")
	}
}

// TestParseSwagger2BodyFields verifies the JSON body branch computes BodyFields.
func TestParseSwagger2BodyFields(t *testing.T) {
	const fixture = `{
  "swagger": "2.0",
  "info": { "title": "Dish API" },
  "paths": {
    "/dishes": {
      "post": {
        "summary": "create",
        "parameters": [
          { "name": "body", "in": "body", "schema": { "type": "object", "properties": { "name": {"type":"string"}, "price": {"type":"number"} } } }
        ],
        "responses": { "200": { "schema": { "type": "object", "properties": { "id": {"type":"integer"} } } } }
      }
    }
  }
}`
	doc, err := Parse(fixture)
	if err != nil {
		t.Fatalf("Parse error: %v", err)
	}
	ep := findEndpoint(doc, "POST", "/dishes")
	if ep == nil {
		t.Fatal("expected POST /dishes")
	}
	if ep.BodyType != "json" {
		t.Fatalf("expected body_type json, got %q", ep.BodyType)
	}
	if len(ep.BodyFields) == 0 {
		t.Fatal("expected BodyFields computed for json body")
	}
	// body_fields should contain name / price derived from the body sample.
	has := map[string]bool{}
	for _, f := range ep.BodyFields {
		has[f.Name] = true
	}
	if !has["name"] || !has["price"] {
		t.Fatalf("BodyFields missing name/price: %v", ep.BodyFields)
	}
}


func TestDedupePostman(t *testing.T) {
	const fixture = `{
  "info": { "name": "My Collection", "_postman_id": "x", "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json" },
  "item": [
    {
      "name": "Folder A",
      "item": [
        { "name": "dup", "request": { "method": "GET", "url": "https://x.com/ping", "header": [] } }
      ]
    },
    {
      "name": "Folder B",
      "item": [
        { "name": "dup2", "request": { "method": "GET", "url": "https://x.com/ping", "header": [] } }
      ]
    }
  ]
}`
	doc, err := Parse(fixture)
	if err != nil {
		t.Fatalf("Parse returned error: %v", err)
	}
	if totalEndpoints(doc) != 1 {
		t.Fatalf("expected deduped to 1 endpoint, got %d", totalEndpoints(doc))
	}
	ep := findEndpoint(doc, "GET", "https://x.com/ping")
	if ep == nil {
		t.Fatal("expected GET https://x.com/ping")
	}
	want := "e_" + shortHash(epKey("GET", "https://x.com/ping"))
	if ep.ID != want {
		t.Fatalf("deduped endpoint id not deterministic: got %q want %q", ep.ID, want)
	}
}
