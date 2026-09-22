package exportx

import (
	"encoding/json"
	"fmt"
	"strings"
)

// FormatSpec 一种导出格式定义。
type FormatSpec struct {
	Value string `json:"value"`
	Label string `json:"label"`
	Ext   string `json:"ext"`
	MIME  string `json:"mime"`
}

// 各文档类型支持的导出格式（顺序即前端展示顺序）。
var formatsByDocType = map[string][]FormatSpec{
	"markdown": {
		{Value: "md", Label: "Markdown 文档（.md）", Ext: "md", MIME: "text/markdown; charset=utf-8"},
		{Value: "docx", Label: "Word 文档（.docx）", Ext: "docx", MIME: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"},
		{Value: "pdf", Label: "PDF 文档（.pdf）", Ext: "pdf", MIME: "application/pdf"},
	},
	"sheet": {
		{Value: "xlsx", Label: "Excel 工作簿（.xlsx）", Ext: "xlsx", MIME: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"},
		{Value: "csv", Label: "逗号分隔文本（.csv）", Ext: "csv", MIME: "text/csv; charset=utf-8"},
		{Value: "json", Label: "表格数据（.json）", Ext: "json", MIME: "application/json; charset=utf-8"},
	},
	"mindmap": {
		{Value: "km", Label: "百度脑图（.km）", Ext: "km", MIME: "application/json; charset=utf-8"},
		{Value: "smm", Label: "Simple Mind Map（.smm）", Ext: "smm", MIME: "application/json; charset=utf-8"},
		{Value: "xmind", Label: "XMind（.xmind）", Ext: "xmind", MIME: "application/vnd.xmind.workbook"},
		{Value: "mm", Label: "FreeMind（.mm）", Ext: "mm", MIME: "text/xml; charset=utf-8"},
		{Value: "md", Label: "Markdown 大纲（.md）", Ext: "md", MIME: "text/markdown; charset=utf-8"},
		{Value: "json", Label: "大纲数据（.json）", Ext: "json", MIME: "application/json; charset=utf-8"},
		{Value: "png", Label: "图片（.png）", Ext: "png", MIME: "image/png"},
	},
	// todo：待办清单。正文为 {version:1, items:[{text,done,due,priority,note}]}，
	// 导出到 xlsx 时映射成「序号/待办事项/状态/截止日期/优先级/备注」六列。
	"todo": {
		{Value: "xlsx", Label: "Excel 工作簿（.xlsx）", Ext: "xlsx", MIME: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"},
		{Value: "md", Label: "Markdown 清单（.md）", Ext: "md", MIME: "text/markdown; charset=utf-8"},
		{Value: "json", Label: "清单数据（.json）", Ext: "json", MIME: "application/json; charset=utf-8"},
	},
	// calendar：工作日历。正文为 {version:1, tasks:[{title,start,end,done,cancelled,note}]}，
	// 导出 xlsx 得到日程表，导出 ics 可被系统日历（含手机日历）直接订阅导入。
	"calendar": {
		{Value: "xlsx", Label: "Excel 工作簿（.xlsx）", Ext: "xlsx", MIME: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"},
		{Value: "ics", Label: "日历文件（.ics）", Ext: "ics", MIME: "text/calendar; charset=utf-8"},
		{Value: "json", Label: "日历数据（.json）", Ext: "json", MIME: "application/json; charset=utf-8"},
	},
	// gantt：甘特图。正文为 {version:1, tasks:[{id,text,start,duration,progress,type,parent,details}], links:[…]}，
	// 日期只存 start + duration（end 由二者推导），导出 xlsx 得到任务表、md 得到层级清单。
	"gantt": {
		{Value: "xlsx", Label: "Excel 工作簿（.xlsx）", Ext: "xlsx", MIME: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"},
		{Value: "md", Label: "Markdown 清单（.md）", Ext: "md", MIME: "text/markdown; charset=utf-8"},
		{Value: "json", Label: "甘特图数据（.json）", Ext: "json", MIME: "application/json; charset=utf-8"},
	},
	"flowchart": {
		{Value: "md", Label: "Markdown + Mermaid（.md）", Ext: "md", MIME: "text/markdown; charset=utf-8"},
		{Value: "svg", Label: "矢量图（.svg）", Ext: "svg", MIME: "image/svg+xml; charset=utf-8"},
		{Value: "png", Label: "图片（.png）", Ext: "png", MIME: "image/png"},
	},
	// api：接口文档（Apifox 风格）。正文为接口集合 JSON，可导出的纯数据（json）或可读文档（md）。
	"api": {
		{Value: "md", Label: "接口文档（.md）", Ext: "md", MIME: "text/markdown; charset=utf-8"},
		{Value: "json", Label: "接口数据（.json）", Ext: "json", MIME: "application/json; charset=utf-8"},
	},
	// drawing：内嵌 draw.io 编辑器，正文即 mxGraph XML。
	// 注意：svg/png/vsdx 由前端内嵌的 draw.io 渲染导出（mxGraph 渲染器只在浏览器侧），
	// 后端能独立完成的是 drawio(xml) 本身 —— 见 Convert 的分支说明。
	"drawing": {
		{Value: "drawio", Label: "draw.io 文件（.drawio）", Ext: "drawio", MIME: "application/vnd.jgraph.mxfile"},
		{Value: "vsdx", Label: "Visio 绘图（.vsdx）", Ext: "vsdx", MIME: "application/vnd.ms-visio.drawing"},
		{Value: "svg", Label: "矢量图（.svg）", Ext: "svg", MIME: "image/svg+xml; charset=utf-8"},
		{Value: "png", Label: "图片（.png）", Ext: "png", MIME: "image/png"},
	},
	// whiteboard：内嵌 Excalidraw 的白板文档。正文 = {version,elements,appState,files,svg}，
	// excalidraw/svg 由服务端从正文直接转换（保存时已同步生成 SVG 预览）；
	// png/pdf 需要 Excalidraw 渲染内核（仅浏览器侧存在），由前端生成 —— 见 Convert 分支说明。
	"whiteboard": {
		{Value: "excalidraw", Label: "Excalidraw 白板文件（.excalidraw）", Ext: "excalidraw", MIME: "application/json; charset=utf-8"},
		{Value: "svg", Label: "矢量图（.svg）", Ext: "svg", MIME: "image/svg+xml; charset=utf-8"},
		{Value: "png", Label: "图片（.png）", Ext: "png", MIME: "image/png"},
		{Value: "pdf", Label: "PDF 文档（.pdf）", Ext: "pdf", MIME: "application/pdf"},
	},
}

// attachmentFormatsByExt 附件型文档（doc_type=file）按扩展名可额外导出的派生格式。
// 首项固定为"原文件"本身；返回空切片表示仅能下载原文件。
// 派生资源由后端在导入时生成（见 export_service.go 的 prepareAttachment）。
var attachmentFormatsByExt = map[string][]FormatSpec{
	"dwg": {
		{Value: "dwg", Label: "AutoCAD 原文件（.dwg）", Ext: "dwg", MIME: "application/acad"},
		{Value: "svg", Label: "矢量图（.svg）", Ext: "svg", MIME: "image/svg+xml; charset=utf-8"},
		{Value: "png", Label: "图片（.png）", Ext: "png", MIME: "image/png"},
	},
	"dxf": {
		{Value: "dxf", Label: "AutoCAD 交换格式（.dxf）", Ext: "dxf", MIME: "application/dxf"},
		{Value: "svg", Label: "矢量图（.svg）", Ext: "svg", MIME: "image/svg+xml; charset=utf-8"},
		{Value: "png", Label: "图片（.png）", Ext: "png", MIME: "image/png"},
	},
}

// IsCadExt 判断扩展名是否属于 CAD 图纸（导入时需要在后端做转换）。
func IsCadExt(ext string) bool {
	switch strings.ToLower(strings.TrimPrefix(strings.TrimSpace(ext), ".")) {
	case "dwg", "dxf":
		return true
	}
	return false
}

// AttachmentFormats 附件型文档按扩展名返回可导出格式；空表示仅原文件。
func AttachmentFormats(ext string) []FormatSpec {
	return attachmentFormatsByExt[strings.ToLower(strings.TrimPrefix(strings.TrimSpace(ext), "."))]
}

// NormalizeDocType 归一化文档类型（历史 datatable 视作 sheet；空值视作 markdown）。
func NormalizeDocType(docType string) string {
	switch strings.ToLower(strings.TrimSpace(docType)) {
	case "sheet", "datatable":
		return "sheet"
	case "mindmap":
		return "mindmap"
	case "flowchart":
		return "flowchart"
	case "drawing", "drawio":
		return "drawing"
	case "whiteboard", "excalidraw", "wb":
		return "whiteboard"
	case "todo", "todolist":
		return "todo"
	case "calendar", "workcalendar":
		return "calendar"
	case "gantt":
		return "gantt"
	case "api":
		return "api"
	case "file":
		return "file"
	case "folder":
		return "folder"
	default:
		return "markdown"
	}
}

// FormatsForDocType 返回文档类型支持的导出格式列表。
// folder（目录）不承载正文，与 file 一样返回 nil 表示「无可导出格式」。
func FormatsForDocType(docType string) []FormatSpec {
	t := NormalizeDocType(docType)
	if t == "file" || t == "folder" {
		return nil
	}
	out := formatsByDocType[t]
	if out == nil {
		return formatsByDocType["markdown"]
	}
	return out
}

// LookupFormat 查找指定文档类型的某种格式定义。
func LookupFormat(docType, format string) (FormatSpec, bool) {
	want := strings.ToLower(strings.TrimSpace(format))
	for _, f := range FormatsForDocType(docType) {
		if f.Value == want {
			return f, true
		}
	}
	return FormatSpec{}, false
}

// DefaultFormat 返回文档类型的默认导出格式。
func DefaultFormat(docType string) FormatSpec {
	fs := FormatsForDocType(docType)
	if len(fs) == 0 {
		return FormatSpec{Value: "md", Ext: "md", MIME: "text/markdown; charset=utf-8"}
	}
	return fs[0]
}

// Convert 把文档内容转换为目标格式（所有转换在服务端完成）。
//
// content 为文档正文原文（markdown 源码 / 表格 JSON / 思维导图 JSON / mermaid 源码）。
// title 为文档标题（用于文件名、PDF 元信息与图片文件名）。
func Convert(docType, format, content, title string) ([]byte, FormatSpec, error) {
	t := NormalizeDocType(docType)
	// file / folder 没有可导出格式，LookupFormat 会因「无格式列表」而报含糊的错，
	// 这里先给出可读的原因（folder 落到此处说明有人在 UI 上漏禁了导出入口）。
	if t == "folder" {
		return nil, FormatSpec{}, fmt.Errorf("目录不承载正文，无法导出，请导出目录下的文档")
	}
	if t == "file" {
		return nil, FormatSpec{}, fmt.Errorf("附件型文档请直接下载原文件")
	}
	spec, ok := LookupFormat(t, format)
	if !ok {
		return nil, FormatSpec{}, fmt.Errorf("不支持的导出格式：%s（%s 类型支持 %s）",
			format, t, strings.Join(formatValues(t), "、"))
	}

	switch t {
	case "markdown":
		switch spec.Value {
		case "md":
			return []byte(content), spec, nil
		case "docx":
			data, err := BuildDocx(content, title)
			return data, spec, err
		case "pdf":
			data, err := BuildPDF(content, title)
			return data, spec, err
		}
	case "sheet":
		switch spec.Value {
		case "xlsx":
			data, err := BuildXLSX(content, title)
			return data, spec, err
		case "csv":
			data, err := BuildCSV(content)
			return data, spec, err
		case "json":
			data, err := BuildSheetJSONFile(content)
			return data, spec, err
		}
	case "mindmap":
		switch spec.Value {
		case "smm":
			data, err := BuildSMM(content)
			return data, spec, err
		case "km":
			data, err := BuildKM(content)
			return data, spec, err
		case "xmind":
			data, err := BuildXMind(content)
			return data, spec, err
		case "mm":
			data, err := BuildFreeMind(content)
			return data, spec, err
		case "md":
			data, err := BuildMindmapMD(content)
			return data, spec, err
		case "json":
			data, err := BuildMindmapJSON(content)
			return data, spec, err
		case "png":
			data, err := BuildMindmapPNG(content)
			return data, spec, err
		}
	case "flowchart":
		switch spec.Value {
		case "md":
			data, err := BuildFlowchartMD(content, title)
			return data, spec, err
		case "svg":
			data, err := BuildFlowchartSVG(content)
			return data, spec, err
		case "png":
			data, err := BuildFlowchartPNG(content)
			return data, spec, err
		}
	case "drawing":
		// 后端只负责 drawio(xml)：mxGraph XML 就是 .drawio 文件的内容，
		// 属于等价转换。svg / png / vsdx 需要 mxGraph 渲染与 Visio 编码器，
		// 只在浏览器侧存在，因此由前端内嵌的 draw.io 编辑器导出
		//（前端拿到数据后同样走本项目的下载通道）。
		switch spec.Value {
		case "drawio":
			if strings.TrimSpace(content) == "" {
				return nil, spec, fmt.Errorf("绘图内容为空")
			}
			return []byte(content), spec, nil
		}
		return nil, spec, fmt.Errorf("%s 需要在绘图编辑器中导出（mxGraph 渲染器仅存在于浏览器侧）", spec.Value)
	case "todo":
		switch spec.Value {
		case "xlsx":
			data, err := BuildTodoXLSX(content, title)
			return data, spec, err
		case "md":
			data, err := BuildTodoMD(content, title)
			return data, spec, err
		case "json":
			return []byte(content), spec, nil
		}
	case "calendar":
		switch spec.Value {
		case "xlsx":
			data, err := BuildCalendarXLSX(content, title)
			return data, spec, err
		case "ics":
			data, err := BuildCalendarICS(content, title)
			return data, spec, err
		case "json":
			return []byte(content), spec, nil
		}
	case "gantt":
		switch spec.Value {
		case "xlsx":
			data, err := BuildGanttXLSX(content, title)
			return data, spec, err
		case "md":
			data, err := BuildGanttMD(content, title)
			return data, spec, err
		case "json":
			return []byte(content), spec, nil
		}
	case "api":
		switch spec.Value {
		case "md":
			data, err := BuildApiDocMD(content, title)
			return data, spec, err
		case "json":
			return []byte(content), spec, nil
		}
	case "whiteboard":
		// excalidraw：正文里的场景三件套重装官方壳即是 .excalidraw 文件；
		// svg：直接取保存时生成的预览。png/pdf 需要 Excalidraw 渲染内核，
		// 只在浏览器侧存在，由前端生成（编辑器工具条 / 导出对话框），这里给出可读指引。
		switch spec.Value {
		case "excalidraw":
			data, err := BuildExcalidrawFile(content)
			return data, spec, err
		case "svg":
			data, err := BuildWhiteboardSVG(content)
			return data, spec, err
		}
		return nil, spec, fmt.Errorf("%s 需要在白板编辑器或导出对话框中生成（Excalidraw 渲染器仅存在于浏览器侧）", spec.Value)
	}
	return nil, spec, fmt.Errorf("暂不支持导出为 %s", spec.Value)
}

func formatValues(docType string) []string {
	fs := FormatsForDocType(docType)
	out := make([]string, 0, len(fs))
	for _, f := range fs {
		out = append(out, f.Value)
	}
	return out
}

// FileRef 附件型文档（doc_type=file）的 content 结构。
// 导入的 .docx/.pdf/.pptx/.dwg 按原文件保存，正文不参与编辑，仅记录原文件位置。
type FileRef struct {
	URL      string `json:"url"`      // /uploads/YYYY/MM/xxx.ext
	Filename string `json:"filename"` // 原始文件名
	Size     int64  `json:"size"`
	Ext      string `json:"ext"` // docx | pdf | pptx | dwg | dxf | …
	// Derived 后端在导入时生成的派生资源，key 为格式名（svg / png）。
	Derived map[string]string `json:"derived,omitempty"`
	// Degraded 为真表示派生预览是降级结果（例如 DWG 用的是文件内嵌位图）。
	Degraded bool `json:"degraded,omitempty"`
	// Note 派生过程的说明，用于前端提示与排障。
	Note string `json:"note,omitempty"`
	// PptxScanned 表示这份 pptx 已经做过「外链图片本地化」扫描。
	//
	// 单独一个布尔量而不是复用 Derived/Note：扫描过但一张外链图片都没有也是正常结果，
	// 前端需要据此区分"处理过、无需再处理"和"历史导入、尚未处理"。
	PptxScanned bool `json:"pptx_scanned,omitempty"`
}

// ParseFileRef 解析附件型文档内容；失败返回 nil。
func ParseFileRef(content string) *FileRef {
	if strings.TrimSpace(content) == "" {
		return nil
	}
	var ref FileRef
	if err := json.Unmarshal([]byte(content), &ref); err != nil {
		return nil
	}
	if strings.TrimSpace(ref.URL) == "" {
		return nil
	}
	ref.URL = strings.TrimSpace(ref.URL)
	ref.Filename = strings.TrimSpace(ref.Filename)
	ref.Ext = strings.ToLower(strings.TrimPrefix(ref.Ext, "."))
	if ref.Ext == "" && strings.Contains(ref.Filename, ".") {
		ref.Ext = strings.ToLower(ref.Filename[strings.LastIndex(ref.Filename, ".")+1:])
	}
	return &ref
}
