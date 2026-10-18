package office

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRemoteAdapterSelection(t *testing.T) {
	previous := Default
	t.Cleanup(func() { Default = previous })
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer converter-secret" {
			t.Error("missing engine credential")
		}
		switch r.URL.Path {
		case "/capabilities":
			_ = json.NewEncoder(w).Encode(map[string]any{"code": 0, "data": (Native{}).Capabilities()})
		case "/import":
			_ = json.NewEncoder(w).Encode(map[string]any{"code": 0, "data": Document{Schema: "haiku.office/1", Kind: "doc", Engine: "test-remote", Snapshot: json.RawMessage(`{"body":{"dataStream":"remote\r\n"}}`)}})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	t.Setenv("OFFICE_ADAPTER_URL", server.URL)
	t.Setenv("OFFICE_ADAPTER_TOKEN", "converter-secret")
	if err := ConfigureFromEnv(); err != nil {
		t.Fatal(err)
	}
	doc, err := Default.Import(context.Background(), DOCX, []byte("opaque bytes"))
	if err != nil || doc.Engine != "test-remote" {
		t.Fatalf("adapter not replaced: %+v, %v", doc, err)
	}
}
