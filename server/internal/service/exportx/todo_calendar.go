package exportx

// 待办清单（todo）与工作日历（calendar）两种文档类型的导出实现。
//
// 两者的正文都是版本化 JSON：
//
//	todo     {"version":1,"items":[{"text","done","due","priority","note"}]}
//	calendar {"version":1,"tasks":[{"title","start","end","done","cancelled","note"}]}
//
// 导出到 .xlsx 时先映射成项目已有的 SheetJSON，再复用 BuildXLSX —— OOXML 细节只保留一份实现。

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"
)

// priorityLabels 优先级内部值 → 中文展示。
var priorityLabels = map[string]string{
	"high":   "高",
	"medium": "中",
	"low":    "低",
}

func priorityLabel(v string) string {
	if s, ok := priorityLabels[strings.ToLower(strings.TrimSpace(v))]; ok {
		return s
	}
	return ""
}

// ---------- 待办清单 ----------

// todoExportDoc 待办清单正文（仅导出所需字段）。
type todoExportDoc struct {
	Version int `json:"version"`
	Items   []struct {
		Text     string `json:"text"`
		Done     bool   `json:"done"`
		Due      string `json:"due"`
		Priority string `json:"priority"`
		Note     string `json:"note"`
	} `json:"items"`
}

func parseTodoExportDoc(content string) todoExportDoc {
	var doc todoExportDoc
	_ = json.Unmarshal([]byte(content), &doc)
	return doc
}

// BuildTodoXLSX 把待办清单导出为 Excel（序号 / 待办事项 / 状态 / 截止时间 / 优先级 / 备注）。
func BuildTodoXLSX(content, title string) ([]byte, error) {
	doc := parseTodoExportDoc(content)
	grid := [][]string{{"序号", "待办事项", "状态", "截止时间", "优先级", "备注"}}
	for i, it := range doc.Items {
		status := "未完成"
		if it.Done {
			status = "已完成"
		}
		grid = append(grid, []string{
			fmt.Sprintf("%d", i+1),
			it.Text,
			status,
			it.Due,
			priorityLabel(it.Priority),
			it.Note,
		})
	}
	return buildXLSXFromGrid(grid, xlsxSheetName(title))
}

// BuildTodoMD 把待办清单导出为 Markdown 复选清单（GitHub/多数 Markdown 软件可交互勾选）。
func BuildTodoMD(content, title string) ([]byte, error) {
	doc := parseTodoExportDoc(content)
	var sb strings.Builder
	if strings.TrimSpace(title) != "" {
		fmt.Fprintf(&sb, "# %s\n\n", strings.TrimSpace(title))
	}
	done, total := 0, len(doc.Items)
	for _, it := range doc.Items {
		mark := " "
		if it.Done {
			mark = "x"
			done++
		}
		line := fmt.Sprintf("- [%s] %s", mark, it.Text)
		var extra []string
		if s := strings.TrimSpace(it.Due); s != "" {
			extra = append(extra, "截止 "+s)
		}
		if s := priorityLabel(it.Priority); s != "" {
			extra = append(extra, "优先级 "+s)
		}
		if s := strings.TrimSpace(it.Note); s != "" {
			extra = append(extra, s)
		}
		if len(extra) > 0 {
			line += "（" + strings.Join(extra, "；") + "）"
		}
		sb.WriteString(line + "\n")
	}
	fmt.Fprintf(&sb, "\n> 共 %d 项，已完成 %d 项。\n", total, done)
	return []byte(sb.String()), nil
}

// ---------- 工作日历 ----------

// calendarExportDoc 工作日历正文（仅导出所需字段）。
type calendarExportDoc struct {
	Version int `json:"version"`
	Tasks   []struct {
		Title     string `json:"title"`
		Start     string `json:"start"`
		End       string `json:"end"`
		Done      bool   `json:"done"`
		Cancelled bool   `json:"cancelled"`
		Note      string `json:"note"`
	} `json:"tasks"`
}

func parseCalendarExportDoc(content string) calendarExportDoc {
	var doc calendarExportDoc
	_ = json.Unmarshal([]byte(content), &doc)
	return doc
}

// BuildCalendarXLSX 把工作日历导出为 Excel（按开始时间升序）。
func BuildCalendarXLSX(content, title string) ([]byte, error) {
	doc := parseCalendarExportDoc(content)
	tasks := append([]struct {
		Title     string `json:"title"`
		Start     string `json:"start"`
		End       string `json:"end"`
		Done      bool   `json:"done"`
		Cancelled bool   `json:"cancelled"`
		Note      string `json:"note"`
	}(nil), doc.Tasks...)
	sort.SliceStable(tasks, func(i, j int) bool { return tasks[i].Start < tasks[j].Start })

	grid := [][]string{{"序号", "任务", "开始时间", "结束时间", "状态", "备注"}}
	for i, t := range tasks {
		status := "待办"
		switch {
		case t.Cancelled:
			status = "已取消"
		case t.Done:
			status = "已完成"
		}
		grid = append(grid, []string{
			fmt.Sprintf("%d", i+1),
			t.Title,
			t.Start,
			t.End,
			status,
			t.Note,
		})
	}
	return buildXLSXFromGrid(grid, xlsxSheetName(title))
}

// BuildCalendarICS 把工作日历导出为 iCalendar（.ics），可被手机/桌面日历直接导入订阅。
//
// 时间按「浮动本地时间」输出（不带 Z、不带 TZID）：日程本身记录的是用户本地的墙上时间，
// 加上时区反而容易在跨设备导入时被整体偏移。
func BuildCalendarICS(content, title string) ([]byte, error) {
	doc := parseCalendarExportDoc(content)
	now := time.Now().UTC().Format("20060102T150405Z")
	var sb strings.Builder
	sb.WriteString("BEGIN:VCALENDAR\r\n")
	sb.WriteString("VERSION:2.0\r\n")
	sb.WriteString("PRODID:-//haiku-wiki//calendar export//CN\r\n")
	sb.WriteString("CALSCALE:GREGORIAN\r\n")
	if name := strings.TrimSpace(title); name != "" {
		sb.WriteString("X-WR-CALNAME:" + icsEscape(name) + "\r\n")
	}
	seq := 0
	for _, t := range doc.Tasks {
		if strings.TrimSpace(t.Title) == "" {
			continue
		}
		start, ok := parseICSTime(t.Start)
		if !ok {
			continue // 没有可解析的开始时间就无法表达日程，跳过而非产出错数据
		}
		seq++
		end, okEnd := parseICSTime(t.End)
		if !okEnd {
			end = start.Add(time.Hour) // 默认一小时
		}
		if !end.After(start) {
			end = start.Add(time.Hour)
		}
		sb.WriteString("BEGIN:VEVENT\r\n")
		sb.WriteString(fmt.Sprintf("UID:%s-%d@haiku-wiki\r\n", now, seq))
		sb.WriteString("DTSTAMP:" + now + "\r\n")
		sb.WriteString("DTSTART:" + start.Format("20060102T150405") + "\r\n")
		sb.WriteString("DTEND:" + end.Format("20060102T150405") + "\r\n")
		sb.WriteString("SUMMARY:" + icsEscape(t.Title) + "\r\n")
		status := "NEEDS-ACTION"
		switch {
		case t.Cancelled:
			status = "CANCELLED"
		case t.Done:
			status = "COMPLETED"
		}
		sb.WriteString("STATUS:" + status + "\r\n")
		if t.Done {
			sb.WriteString("PERCENT-COMPLETE:100\r\n")
		}
		if note := strings.TrimSpace(t.Note); note != "" {
			sb.WriteString("DESCRIPTION:" + icsEscape(note) + "\r\n")
		}
		sb.WriteString("END:VEVENT\r\n")
	}
	sb.WriteString("END:VCALENDAR\r\n")
	return []byte(sb.String()), nil
}

// parseICSTime 解析前端常见的几种时间写法。
//
// 支持：RFC3339（2026-09-18T10:00:00+08:00）、
// "2026-09-18 10:00"、"2026-09-18T10:00"、"2026/09/18 10:00"、"2026-09-18"。
func parseICSTime(s string) (time.Time, bool) {
	s = strings.TrimSpace(s)
	if s == "" {
		return time.Time{}, false
	}
	for _, layout := range []string{
		time.RFC3339,
		"2006-01-02T15:04:05",
		"2006-01-02 15:04:05",
		"2006-01-02T15:04",
		"2006-01-02 15:04",
		"2006/01/02 15:04",
		"2006-01-02",
		"2006/01/02",
	} {
		if t, err := time.ParseInLocation(layout, s, time.Local); err == nil {
			return t, true
		}
	}
	return time.Time{}, false
}

// icsEscape 转义 iCalendar 文本值中的保留字符。
func icsEscape(s string) string {
	s = strings.ReplaceAll(s, "\\", "\\\\")
	s = strings.ReplaceAll(s, ";", "\\;")
	s = strings.ReplaceAll(s, ",", "\\,")
	s = strings.ReplaceAll(s, "\r\n", "\\n")
	s = strings.ReplaceAll(s, "\n", "\\n")
	return s
}

// ---------- 共用：字符串网格 → xlsx ----------

// buildXLSXFromGrid 把二维字符串网格转成 SheetJSON 再走统一的 BuildXLSX。
// 第一行作为表头；空单元格不写入（与其他表格导出的稀疏存储保持一致）。
func buildXLSXFromGrid(grid [][]string, sheetName string) ([]byte, error) {
	cells := map[string]SheetCell{}
	maxC := 0
	for r, row := range grid {
		if len(row) > maxC {
			maxC = len(row)
		}
		for c, v := range row {
			if strings.TrimSpace(v) == "" {
				continue
			}
			cells[fmt.Sprintf("%d-%d", r, c)] = SheetCell{Text: v}
		}
	}
	payload := SheetJSON{Version: 1, Cells: cells, ColLen: maxC, RowLen: len(grid)}
	raw, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("构建表格数据失败：%v", err)
	}
	return BuildXLSX(string(raw), sheetName)
}

// xlsxSheetName 工作表名：取文档标题，空则回退。
func xlsxSheetName(title string) string {
	if s := strings.TrimSpace(title); s != "" {
		return s
	}
	return "Sheet1"
}
