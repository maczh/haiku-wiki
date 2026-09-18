package exportx

// 甘特图（gantt）文档类型的导出实现。
//
// 正文是版本化 JSON（与前端 web/src/lib/gantt.ts 的契约一致）：
//
//	{"version":1,
//	 "tasks":[{"id","text","start","duration","progress","type","parent","assignees","priority","details"}],
//	 "links":[{"id","source","target","type","lag"}]}
//
// 日期只存 start + duration（结束日期是开区间 end = start + duration，
// 直接存会让界面上多一天），因此这里导出时按「含首尾」的直觉把结束日期算成 start+duration-1 天。
//
// 任务状态（圆灯）规则与前端 lib/gantt.ts taskStatus 保持同一套，两边都要同步改：
//   已超期(红)：progress < 100 且今天已越过结束日（含首尾口径）；
//   进度拖延(黄)：进度落后于时间进度 15 个百分点以上，或 3 天内到期但进度 < 100；
//   已结束(灰)：progress >= 100；
//   未开始(蓝)：progress = 0 且尚未到开始日；
//   正常进行中(绿)：其余。

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"
)

const ganttDateLayout = "2006-01-02"

// ganttExportTask 甘特图任务（仅导出所需字段）。
// id / parent 可能是数字也可能是字符串（前端允许 SVAR 生成字符串型临时 id），
// 统一用 json.Number 解析后转成字符串比较，避免类型不同导致层级对不上。
type ganttExportTask struct {
	ID        json.RawMessage `json:"id"`
	Text      string          `json:"text"`
	Start     string          `json:"start"`
	Duration  float64         `json:"duration"`
	Progress  float64         `json:"progress"`
	Type      string          `json:"type"`
	Parent    json.RawMessage `json:"parent"`
	Assignees []string        `json:"assignees"`
	Priority  float64         `json:"priority"`
	Details   string          `json:"details"`
}

// ganttExportDoc 甘特图正文。
type ganttExportDoc struct {
	Version int               `json:"version"`
	Tasks   []ganttExportTask `json:"tasks"`
}

func parseGanttExportDoc(content string) ganttExportDoc {
	var doc ganttExportDoc
	_ = json.Unmarshal([]byte(content), &doc)
	return doc
}

// ganttRawID 把可能是数字/字符串的 id 归一化成字符串（去掉 JSON 字符串的引号）。
func ganttRawID(raw json.RawMessage) string {
	s := strings.TrimSpace(string(raw))
	if s == "" || s == "null" {
		return ""
	}
	s = strings.Trim(s, `"`)
	if s == "0" {
		return ""
	}
	return s
}

// ganttTaskTypeLabel 任务类型中文名。
func ganttTaskTypeLabel(t string) string {
	switch strings.ToLower(strings.TrimSpace(t)) {
	case "summary":
		return "汇总"
	case "milestone":
		return "里程碑"
	default:
		return "任务"
	}
}

// ganttEndDate 结束日期（含当天）= start + duration - 1 天；里程碑即当天。
func ganttEndDate(start string, duration float64) string {
	d, err := time.ParseInLocation(ganttDateLayout, strings.TrimSpace(start), time.Local)
	if err != nil {
		return ""
	}
	if duration < 1 {
		return d.Format(ganttDateLayout)
	}
	return d.AddDate(0, 0, int(duration)-1).Format(ganttDateLayout)
}

// ganttTaskStatus 任务状态推导（口径见文件头注释；与前端 taskStatus 一致）。
// start 解析失败时保守返回「正常进行中」。
func ganttTaskStatus(t ganttExportTask, today time.Time) string {
	progress := t.Progress
	if progress < 0 {
		progress = 0
	}
	if progress >= 100 {
		return "已结束"
	}
	start, err1 := time.ParseInLocation(ganttDateLayout, strings.TrimSpace(t.Start), time.Local)
	endStr := ganttEndDate(t.Start, t.Duration)
	end, err2 := time.ParseInLocation(ganttDateLayout, strings.TrimSpace(endStr), time.Local)
	if err1 != nil || err2 != nil {
		return "正常进行中"
	}
	today = time.Date(today.Year(), today.Month(), today.Day(), 0, 0, 0, 0, time.Local)
	if today.After(end) {
		return "已超期"
	}
	if today.Before(start) {
		if progress == 0 {
			return "未开始"
		}
		return "正常进行中"
	}
	// 时间进度期望：已过天数 / 总天数（含首尾，至少 1 天）
	total := int(end.Sub(start).Hours()/24) + 1
	if total < 1 {
		total = 1
	}
	elapsed := int(today.Sub(start).Hours()/24) + 1
	if elapsed < 0 {
		elapsed = 0
	}
	expected := float64(elapsed) / float64(total) * 100
	daysLeft := int(end.Sub(today).Hours() / 24)
	if progress+15 <= expected || (daysLeft <= 3 && progress < 100) {
		return "进度拖延"
	}
	return "正常进行中"
}

// ganttPriorityLabel 优先级展示：1~10，非法回落 5（与前端 clampPriority 一致）。
func ganttPriorityLabel(p float64) string {
	if p < 1 || p > 10 || p != p { // NaN 判定
		p = 5
	}
	if p < 1 {
		p = 1
	}
	if p > 10 {
		p = 10
	}
	return fmt.Sprintf("P%d", int(p+0.5))
}

// ganttOrderedTask 展开后的任务：附带层级深度（用于缩进展示）。
type ganttOrderedTask struct {
	task  ganttExportTask
	depth int
}

// ganttOrdered 按树的先序展开任务（parent 为空的视为顶层），并为每条任务附带层级深度。
func ganttOrdered(doc ganttExportDoc) []ganttOrderedTask {
	// 稳定排序：同层保持正文里的原始顺序
	index := make(map[string]int, len(doc.Tasks))
	for i, t := range doc.Tasks {
		index[ganttRawID(t.ID)] = i
	}
	childrenOf := map[string][]ganttExportTask{}
	var roots []ganttExportTask
	for _, t := range doc.Tasks {
		if p := ganttRawID(t.Parent); p == "" {
			roots = append(roots, t)
		} else {
			childrenOf[p] = append(childrenOf[p], t)
		}
	}
	// 父节点被删/成环时不会无限递归：visited 兜底
	var out []ganttOrderedTask
	visited := map[string]bool{}
	var walk func(list []ganttExportTask, depth int)
	walk = func(list []ganttExportTask, depth int) {
		if depth > 32 {
			return
		}
		sorted := make([]ganttExportTask, len(list))
		copy(sorted, list)
		sort.SliceStable(sorted, func(i, j int) bool {
			return index[ganttRawID(sorted[i].ID)] < index[ganttRawID(sorted[j].ID)]
		})
		for _, t := range sorted {
			id := ganttRawID(t.ID)
			if id != "" && visited[id] {
				continue
			}
			if id != "" {
				visited[id] = true
			}
			out = append(out, ganttOrderedTask{task: t, depth: depth})
			walk(childrenOf[id], depth+1)
		}
	}
	walk(roots, 0)
	return out
}

// BuildGanttXLSX 把甘特图导出为 Excel（层级缩进 / 任务 / 负责人 / 开始 / 结束 / 工期 / 进度 / 状态 / 类型 / 描述）。
func BuildGanttXLSX(content, title string) ([]byte, error) {
	doc := parseGanttExportDoc(content)
	rows := ganttOrdered(doc)
	now := time.Now()
	grid := [][]string{{"任务", "负责人", "优先级", "开始日期", "结束日期", "工期(天)", "进度", "状态", "类型", "描述"}}
	for _, r := range rows {
		t := r.task
		grid = append(grid, []string{
			strings.Repeat("    ", r.depth) + t.Text,
			strings.Join(t.Assignees, "、"),
			ganttPriorityLabel(t.Priority),
			strings.TrimSpace(t.Start),
			ganttEndDate(t.Start, t.Duration),
			fmt.Sprintf("%d", int(t.Duration)),
			fmt.Sprintf("%d%%", int(t.Progress+0.5)),
			ganttTaskStatus(t, now),
			ganttTaskTypeLabel(t.Type),
			t.Details,
		})
	}
	return buildXLSXFromGrid(grid, xlsxSheetName(title))
}

// BuildGanttMD 把甘特图导出为 Markdown（层级列表 + 负责人/工期/进度/状态/描述）。
func BuildGanttMD(content, title string) ([]byte, error) {
	doc := parseGanttExportDoc(content)
	rows := ganttOrdered(doc)
	now := time.Now()
	var sb strings.Builder
	if strings.TrimSpace(title) != "" {
		fmt.Fprintf(&sb, "# %s\n\n", strings.TrimSpace(title))
	}
	if len(rows) == 0 {
		sb.WriteString("（空甘特图）\n")
		return []byte(sb.String()), nil
	}
	for _, r := range rows {
		t := r.task
		var meta []string
		if len(t.Assignees) > 0 {
			meta = append(meta, "负责人 "+strings.Join(t.Assignees, "、"))
		}
		meta = append(meta, ganttPriorityLabel(t.Priority))
		if s := strings.TrimSpace(t.Start); s != "" {
			meta = append(meta, s)
		}
		if strings.EqualFold(strings.TrimSpace(t.Type), "milestone") {
			meta = append(meta, "里程碑")
		} else {
			meta = append(meta, fmt.Sprintf("工期 %d 天", int(t.Duration)))
		}
		meta = append(meta, fmt.Sprintf("进度 %d%%", int(t.Progress+0.5)))
		meta = append(meta, ganttTaskStatus(t, now))
		if s := strings.TrimSpace(t.Details); s != "" {
			meta = append(meta, s)
		}
		fmt.Fprintf(&sb, "%s- %s（%s）\n", strings.Repeat("    ", r.depth), t.Text, strings.Join(meta, "，"))
	}
	return []byte(sb.String()), nil
}
