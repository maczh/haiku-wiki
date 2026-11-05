package handler

import (
	"encoding/json"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"

	"haiku-wiki/server/internal/middleware"
	"haiku-wiki/server/internal/model"
	"haiku-wiki/server/internal/repository"
)

func TestTodoOptionsIsolationAndDeduplication(t *testing.T) {
	g, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "todo.db")), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := g.AutoMigrate(&model.TodoOption{}); err != nil {
		t.Fatal(err)
	}
	sqlDB, err := g.DB()
	if err != nil {
		t.Fatal(err)
	}
	defer sqlDB.Close()
	previous := repository.DB()
	repository.SetDB(g)
	defer repository.SetDB(previous)
	call := func(uid uint64, method, body string) []byte {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Set(middleware.CtxUID, uid)
		c.Request = httptest.NewRequest(method, "/api/todo-options", strings.NewReader(body))
		c.Request.Header.Set("Content-Type", "application/json")
		if method == "GET" {
			ListTodoOptions(c)
		} else {
			SaveTodoOptions(c)
		}
		return w.Body.Bytes()
	}
	body := `{"options":[{"kind":"assignee","name":" 斌辉 "},{"kind":"assignee","name":"斌辉"},{"kind":"project","name":"项目一"}]}`
	for range 2 {
		var result struct {
			Code int `json:"code"`
		}
		if err := json.Unmarshal(call(1, "POST", body), &result); err != nil || result.Code != 0 {
			t.Fatalf("save failed: %v %+v", err, result)
		}
	}
	var result struct {
		Data []model.TodoOption `json:"data"`
	}
	if err := json.Unmarshal(call(1, "GET", ""), &result); err != nil {
		t.Fatal(err)
	}
	if len(result.Data) != 2 {
		t.Fatalf("expected 2 unique options, got %+v", result.Data)
	}
	if err := json.Unmarshal(call(2, "GET", ""), &result); err != nil {
		t.Fatal(err)
	}
	if len(result.Data) != 0 {
		t.Fatal("options leaked to another user")
	}
	var invalid struct {
		Code int `json:"code"`
	}
	if err := json.Unmarshal(call(1, "POST", `{"options":[{"kind":"invalid","name":"x"}]}`), &invalid); err != nil {
		t.Fatal(err)
	}
	if invalid.Code == 0 {
		t.Fatal("invalid option accepted")
	}
}
