package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"haiku-wiki/server/internal/service/office"
)

func TestOfficeConversionHTTP(t *testing.T) {
	r := gin.New()
	r.GET("/capabilities", OfficeCapabilities)
	r.POST("/import", OfficeImport)
	r.POST("/export", OfficeExport)
	input, err := (office.Native{}).Export(context.Background(), office.DOCX,
		json.RawMessage(`{"body":{"dataStream":"HTTP roundtrip\r\n"}}`))
	if err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/import?format=docx", bytes.NewReader(input)))
	var imported struct {
		Code int             `json:"code"`
		Data office.Document `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &imported); err != nil || imported.Code != 0 || imported.Data.Kind != "doc" {
		t.Fatalf("import failed: %s", w.Body.String())
	}
	payload, _ := json.Marshal(map[string]any{"format": "docx", "snapshot": imported.Data.Snapshot})
	w = httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/export", bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK || !bytes.HasPrefix(w.Body.Bytes(), []byte("PK")) {
		t.Fatalf("export failed: %s", w.Body.String())
	}
	if _, err := (office.Native{}).Import(context.Background(), office.DOCX, w.Body.Bytes()); err != nil {
		t.Fatal(err)
	}
	w = httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/import?format=docx", bytes.NewBufferString("bad zip")))
	var invalid struct {
		Code int `json:"code"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &invalid)
	if invalid.Code == 0 {
		t.Fatal("invalid archive not rejected by HTTP API")
	}
}
