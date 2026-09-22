package exportx

import (
	"encoding/json"
	"fmt"
	"strings"
)

// 白板文档（doc_type=whiteboard）的导出转换。
//
// 正文由前端写入（见 web/src/lib/whiteboardDoc.ts）：
//
//	{version, elements, appState, files, svg}
//
//   - elements/appState/files：Excalidraw 场景三件套；
//   - svg：浏览器侧 exportToSvg 生成的矢量预览，随每次保存一起落库 ——
//     这正是「保存入库的同时生成预览文件」的实现路径（与绘图文档同一套路）。
//
// 可服务端独立完成的导出：
//   - .excalidraw：重装官方壳（type:'excalidraw'）的场景 JSON；
//   - .svg：直接取正文里的预览（渲染器只在浏览器侧，服务端不做栅格化/重排版）。
//     .png / .pdf 需要 Excalidraw 渲染内核，同样只在浏览器侧存在，
//     由前端（编辑器工具条与导出对话框）生成，见 lib/whiteboardExport.ts。

// WhiteboardContent 白板正文结构（与前端 WhiteboardContent 对应）。
type WhiteboardContent struct {
	Version  int               `json:"version"`
	Elements []json.RawMessage `json:"elements"`
	AppState map[string]any    `json:"appState"`
	Files    map[string]any    `json:"files"`
	Svg      string            `json:"svg"`
}

// parseWhiteboard 解析白板正文；非法/空场景返回 nil。
func parseWhiteboard(content string) *WhiteboardContent {
	t := strings.TrimSpace(content)
	if t == "" {
		return nil
	}
	var wb WhiteboardContent
	if err := json.Unmarshal([]byte(t), &wb); err != nil {
		return nil
	}
	if len(wb.Elements) == 0 {
		return nil
	}
	return &wb
}

// BuildExcalidrawFile 白板正文 → .excalidraw 场景文件（官方壳：type:'excalidraw', version:2）。
func BuildExcalidrawFile(content string) ([]byte, error) {
	wb := parseWhiteboard(content)
	if wb == nil {
		return nil, fmt.Errorf("白板内容为空，请先在编辑器中绘制并保存")
	}
	appState := wb.AppState
	if appState == nil {
		appState = map[string]any{}
	}
	if wb.Files == nil {
		wb.Files = map[string]any{}
	}
	out := map[string]any{
		"type":     "excalidraw",
		"version":  2,
		"source":   "https://excalidraw.com",
		"elements": wb.Elements,
		"appState": appState,
		"files":    wb.Files,
	}
	return json.Marshal(out)
}

// BuildWhiteboardSVG 取正文里保存的矢量预览。
func BuildWhiteboardSVG(content string) ([]byte, error) {
	t := strings.TrimSpace(content)
	if t == "" {
		return nil, fmt.Errorf("白板内容为空")
	}
	var wb WhiteboardContent
	if err := json.Unmarshal([]byte(t), &wb); err != nil {
		return nil, fmt.Errorf("白板正文不是有效的 JSON")
	}
	svg := strings.TrimSpace(wb.Svg)
	if svg == "" {
		return nil, fmt.Errorf("该白板尚未生成矢量预览，请在编辑器中打开并保存一次")
	}
	if !strings.HasPrefix(svg, "<svg") && !strings.Contains(svg, "<svg") {
		return nil, fmt.Errorf("白板预览数据异常（不是 SVG）")
	}
	return []byte(svg), nil
}
