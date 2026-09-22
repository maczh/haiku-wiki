package exportx

import (
	"encoding/json"
	"strings"
	"testing"
)

// 白板文档导出转换的单元测试：场景装壳（.excalidraw）、SVG 预览取用、
// 空内容/脏数据的可读报错（绝不让前端拿到一个打不开的文件）。

const wbContent = `{"version":1,"elements":[{"id":"e1","type":"rectangle","x":0,"y":0,"width":120,"height":60}],
"appState":{"viewBackgroundColor":"#ffffff"},"files":{},"svg":"<svg xmlns='http://www.w3.org/2000/svg' width='120' height='60'></svg>"}`

func TestBuildExcalidrawFile(t *testing.T) {
	data, err := BuildExcalidrawFile(wbContent)
	if err != nil {
		t.Fatalf("BuildExcalidrawFile 失败: %v", err)
	}
	var out map[string]any
	if err := json.Unmarshal(data, &out); err != nil {
		t.Fatalf("产物不是合法 JSON: %v", err)
	}
	if out["type"] != "excalidraw" {
		t.Fatalf("type 应为 excalidraw，实际 %v", out["type"])
	}
	if out["version"] != float64(2) {
		t.Fatalf("version 应为 2，实际 %v", out["version"])
	}
	els, ok := out["elements"].([]any)
	if !ok || len(els) != 1 {
		t.Fatalf("elements 应为 1 个元素的数组，实际 %v", out["elements"])
	}
	if _, ok := out["appState"].(map[string]any); !ok {
		t.Fatal("appState 应为对象")
	}
	if _, ok := out["files"].(map[string]any); !ok {
		t.Fatal("files 应为对象")
	}
}

func TestBuildExcalidrawFileEmpty(t *testing.T) {
	for _, c := range []string{"", "   ", "not-json", `{"elements":[]}`} {
		if _, err := BuildExcalidrawFile(c); err == nil {
			t.Fatalf("空/非法正文应当报错（content=%q）", c)
		}
	}
}

func TestBuildWhiteboardSVG(t *testing.T) {
	data, err := BuildWhiteboardSVG(wbContent)
	if err != nil {
		t.Fatalf("BuildWhiteboardSVG 失败: %v", err)
	}
	if !strings.HasPrefix(string(data), "<svg") {
		t.Fatalf("SVG 预览应以 <svg 开头: %q", string(data)[:20])
	}
	// 未生成预览（svg 为空）→ 可读报错，指引去编辑器保存一次
	noSvg := `{"version":1,"elements":[{"id":"e1","type":"rectangle"}],"svg":""}`
	if _, err := BuildWhiteboardSVG(noSvg); err == nil {
		t.Fatal("无预览的正文应当报错")
	} else if !strings.Contains(err.Error(), "矢量预览") {
		t.Fatalf("报错信息应可读: %v", err)
	}
	// 正文为空 / 非 JSON
	if _, err := BuildWhiteboardSVG(""); err == nil {
		t.Fatal("空正文应当报错")
	}
	if _, err := BuildWhiteboardSVG("not-json"); err == nil {
		t.Fatal("非法正文应当报错")
	}
}

func TestWhiteboardConvert(t *testing.T) {
	// 走 Convert 主入口：格式清单与归一化都要能命中
	if _, spec, err := Convert("whiteboard", "excalidraw", wbContent, "白板"); err != nil || spec.Ext != "excalidraw" {
		t.Fatalf("whiteboard→excalidraw 导出失败: %v spec=%+v", err, spec)
	}
	if _, spec, err := Convert("whiteboard", "svg", wbContent, "白板"); err != nil || spec.Ext != "svg" {
		t.Fatalf("whiteboard→svg 导出失败: %v spec=%+v", err, spec)
	}
	// png/pdf 由浏览器侧生成：服务端拒绝并给出可读指引
	if _, _, err := Convert("whiteboard", "png", wbContent, "白板"); err == nil || !strings.Contains(err.Error(), "浏览器") {
		t.Fatalf("whiteboard→png 应拒绝并指引浏览器侧导出: %v", err)
	}
	if _, _, err := Convert("whiteboard", "pdf", wbContent, "白板"); err == nil || !strings.Contains(err.Error(), "浏览器") {
		t.Fatalf("whiteboard→pdf 应拒绝并指引浏览器侧导出: %v", err)
	}
}
