package service

import (
	"testing"

	"haiku-wiki/server/internal/service/apidoc"
)

// TestReconcileFieldsBoundaries 覆盖 reconcileFields 三种边界：
//   - old 为 nil → 全部取 new 自带 description；
//   - new 为 nil/空 → 原样返回 new；
//   - 同名 description 都为空 → 保留 new 的空（不误填）；
//   - 以及常规：old[name] 非空 → 采用 old。
func TestReconcileFieldsBoundaries(t *testing.T) {
	newF := []apidoc.ApiField{
		{Name: "code", Type: "int", Description: "状态码"},
		{Name: "data.list[].id", Type: "int64", Description: ""},
	}

	// 1) old 为 nil：保留 new 自带的 description，空字符串不误填。
	got := reconcileFields(newF, nil)
	if len(got) != 2 {
		t.Fatalf("len mismatch: %d", len(got))
	}
	if got[0].Description != "状态码" {
		t.Fatalf("old=nil: code desc should be 状态码, got %q", got[0].Description)
	}
	if got[1].Description != "" {
		t.Fatalf("old=nil: empty desc should stay empty, got %q", got[1].Description)
	}

	// 2) new 为 nil：直接返回（避免误填）。
	if r := reconcileFields(nil, newF); r != nil {
		t.Fatalf("new=nil should return nil, got %#v", r)
	}
	if r := reconcileFields([]apidoc.ApiField{}, newF); len(r) != 0 {
		t.Fatalf("new empty should return empty, got %#v", r)
	}

	// 3) 同名 description 都为空：保留空（new 的空）。
	emptyOld := []apidoc.ApiField{{Name: "data.list[].id", Description: ""}}
	got = reconcileFields(newF, emptyOld)
	if got[1].Description != "" {
		t.Fatalf("both-empty: should stay empty, got %q", got[1].Description)
	}

	// 4) 常规：old[name] 非空 → 采用 old，字段行仍以 new 为准。
	old := []apidoc.ApiField{
		{Name: "code", Type: "string", Description: "返回码(旧说明)"},
		{Name: "data.list[].id", Type: "int64", Description: "主键ID"},
	}
	got = reconcileFields(newF, old)
	if got[0].Description != "返回码(旧说明)" {
		t.Fatalf("code should use old desc, got %q", got[0].Description)
	}
	if got[0].Type != "int" {
		t.Fatalf("code type must come from new, got %q", got[0].Type)
	}
	if got[1].Description != "主键ID" {
		t.Fatalf("id should use old desc, got %q", got[1].Description)
	}
	// old 中不在 new 的字段被丢弃（只遍历 new）。
	extraOld := append([]apidoc.ApiField{}, old...)
	extraOld = append(extraOld, apidoc.ApiField{Name: "stale", Description: "弃我"})
	got = reconcileFields(newF, extraOld)
	for _, f := range got {
		if f.Name == "stale" {
			t.Fatal("stale field from old must be discarded")
		}
	}
}
