package repository

import (
	"encoding/json"

	"gorm.io/gorm"

	"haiku-wiki/server/internal/model"
)

// ---- 内置模板正文构造助手（复用各 doc_type 现有正文契约） ----

type lsCell struct {
	V  interface{} `json:"v"`
	M  string      `json:"m"`
	Bl int         `json:"bl,omitempty"`
	Bg string      `json:"bg,omitempty"`
	Fc string      `json:"fc,omitempty"`
}

type lsCellRow struct {
	R int     `json:"r"`
	C int     `json:"c"`
	V lsCell  `json:"v"`
}

type lsSheet struct {
	Name     string      `json:"name"`
	Index    int         `json:"index"`
	Order    int         `json:"order"`
	Status   int         `json:"status"`
	Row      int         `json:"row"`
	Column   int         `json:"column"`
	Celldata []lsCellRow `json:"celldata"`
	Config   map[string]interface{} `json:"config"`
}

// sheetJSON 由「首行为表头」的二维字符串构造 v3 Luckysheet 正文。
// 表头行加粗 + 浅靛蓝底，符合现有前端渲染契约（web/src/lib/sheet.ts）。
func sheetJSON(name string, rows [][]string) string {
	w := 8
	for _, r := range rows {
		if len(r) > w {
			w = len(r)
		}
	}
	h := len(rows) + 6
	if h < 20 {
		h = 20
	}
	cells := make([]lsCellRow, 0, len(rows)*w)
	for i, row := range rows {
		for j, val := range row {
			cell := lsCell{V: val, M: val}
			if i == 0 {
				cell.Bl = 1
				cell.Bg = "#eef2ff"
				cell.Fc = "#1d4ed8"
			}
			cells = append(cells, lsCellRow{R: i, C: j, V: cell})
		}
	}
	sheet := lsSheet{
		Name: name, Index: 0, Order: 0, Status: 1, Row: h, Column: w,
		Celldata: cells, Config: map[string]interface{}{},
	}
	b, _ := json.Marshal(map[string]interface{}{"version": 3, "sheets": []interface{}{sheet}})
	return string(b)
}

type mmData struct {
	Text   string `json:"text"`
	Expand bool   `json:"expand"`
}
type mmNode struct {
	Data     mmData   `json:"data"`
	Children []mmNode `json:"children"`
}

// mindmapJSON 构造 simple-mind-map 正文（logicalStructure 布局）。
func mindmapJSON(root string, children []mmNode) string {
	b, _ := json.Marshal(map[string]interface{}{
		"version": 2,
		"layout":  "logicalStructure",
		"root":    mmNode{Data: mmData{Text: root, Expand: true}, Children: children},
	})
	return string(b)
}

type gtTask struct {
	ID       int      `json:"id"`
	Text     string   `json:"text"`
	Start    string   `json:"start"`
	Duration int      `json:"duration"`
	Progress int      `json:"progress"`
	Type     string   `json:"type"`
	Parent   int      `json:"parent"`
	Priority int      `json:"priority"`
	Assignees []string `json:"assignees"`
	Details  string   `json:"details,omitempty"`
	Open     bool     `json:"open"`
}
type gtLink struct {
	ID     int    `json:"id"`
	Source int    `json:"source"`
	Target int    `json:"target"`
	Type   string `json:"type"`
}

// ganttJSON 构造甘特图正文（version=1）。
func ganttJSON(tasks []gtTask, links []gtLink) string {
	b, _ := json.Marshal(map[string]interface{}{"version": 1, "tasks": tasks, "links": links})
	return string(b)
}

// builtinTemplates 系统预置文档模板（仿语雀/WPS 企业办公常用）。
// 内容直接复用各 doc_type 正文契约；新增/调整模板只改这里，SeedTemplates 仅在库内无
// builtin 模板时灌入（幂等），已有则跳过，不覆盖用户可能修改过的自定义模板。
var builtinTemplates = []model.DocTemplate{
	// ───────────────────────── 行政办公类文档 ─────────────────────────
	{Category: "行政办公类文档", DocType: "markdown", Name: "会议纪要", Title: "会议纪要", Sort: 1, Content: `# 会议纪要

**会议主题：**
**会议时间：** 年 月 日
**会议地点：**
**主持人：**　**记录人：**
**参会人员：**

## 一、会议背景与目的

## 二、议题讨论

### 议题一：
- 讨论要点：
- 各方意见：
- 结论：

### 议题二：
- 讨论要点：
- 结论：

## 三、决议事项

| 序号 | 决议内容 | 责任人 | 截止时间 |
| --- | --- | --- | --- |
| 1 |  |  |  |
| 2 |  |  |  |

## 四、待跟进事项

- [ ] 事项一（责任人 / 时间）
- [ ] 事项二（责任人 / 时间）

## 五、下次会议安排

`},

	{Category: "行政办公类文档", DocType: "markdown", Name: "公司公告", Title: "公司公告", Sort: 2, Content: `# 公司公告

**编号：**　**发布部门：**　**生效日期：**

各位同事：

正文……（说明公告事项、背景、具体要求与执行时间）

## 一、事项说明

## 二、执行要求

1.
2.

## 三、相关联系人

如有疑问，请联系 （部门 / 姓名 / 分机）。

特此通知。

（发布部门）
年 月 日
`},

	{Category: "行政办公类文档", DocType: "markdown", Name: "员工入职须知", Title: "员工入职须知", Sort: 3, Content: `# 员工入职须知

欢迎加入！请按以下清单完成入职办理。

## 一、报到材料

- [ ] 身份证原件及复印件
- [ ] 学历 / 学位证书
- [ ] 上家离职证明
- [ ] 一寸免冠照片 2 张
- [ ] 银行卡（用于工资发放）

## 二、入职流程

1. 到人力资源部报到并填写《员工登记表》
2. 领取工牌、办公用品与账号
3. 签订劳动合同
4. 参加入职培训

## 三、公司制度要点

- 工作时间与考勤规则
- 保密与信息安全要求
- 报销与请假流程

## 四、试用期目标

`},

	// ───────────────────────── 通知类文档 ─────────────────────────
	{Category: "通知类文档", DocType: "markdown", Name: "会议通知", Title: "会议通知", Sort: 1, Content: `# 会议通知

各相关部门 / 同事：

兹定于 **年 月 日（周 ） : ** 在  召开  会议，请准时参加。

## 一、会议内容

## 二、参会人员

- 主持：
- 出席：
- 列席：

## 三、准备事项

- [ ] 请提前准备  汇报材料
- [ ] 请携带  相关文档

## 四、其他

如需请假，请提前向  报备。

（通知部门）
年 月 日
`},

	{Category: "通知类文档", DocType: "markdown", Name: "放假通知", Title: "放假通知", Sort: 2, Content: `# 关于  放假的通知

各部门、全体同事：

根据  安排，现将  放假事宜通知如下：

## 一、放假时间

年 月 日（周 ）至 年 月 日（周 ），共  天。 月 日（周 ）正常上班。

## 二、值班安排

| 日期 | 值班人 | 联系电话 |
| --- | --- | --- |
|  |  |  |
|  |  |  |

## 三、安全提示

- 离岗前关闭电源、门窗，做好防火防盗
- 出行注意交通安全
- 保持通讯畅通，紧急情况及时报备

祝大家假期愉快！

（行政部）
年 月 日
`},

	// ───────────────────────── 总结汇报类文档 ─────────────────────────
	{Category: "总结汇报类文档", DocType: "markdown", Name: "工作周报", Title: "工作周报", Sort: 1, Content: `# 工作周报（ 年 月 第 周）

**姓名：**　**部门：**　**周期：** 月 日 — 月 日

## 一、本周完成

- 事项一（进展 / 产出）
- 事项二

## 二、进行中

| 工作项 | 进度 | 风险 / 阻塞 | 预计完成 |
| --- | --- | --- | --- |
|  |  % |  |  |

## 三、下周计划

- [ ] 计划一
- [ ] 计划二

## 四、需协调支持

`},

	{Category: "总结汇报类文档", DocType: "markdown", Name: "月度工作总结", Title: "月度工作总结", Sort: 2, Content: `# 月度工作总结（ 年 月）

**负责人：**　**部门：**

## 一、月度目标达成情况

| 目标 | 目标值 | 实际值 | 完成度 |
| --- | --- | --- | --- |
|  |  |  |  |
|  |  |  |  |

## 二、重点工作回顾

### 1.

### 2.

## 三、问题与不足

- 问题一及原因分析
- 问题二

## 四、下月工作计划

- [ ] 重点一
- [ ] 重点二

## 五、建议与资源需求

`},

	{Category: "总结汇报类文档", DocType: "markdown", Name: "年终述职报告", Title: "年终述职报告", Sort: 3, Content: `# 年终述职报告（ 年度）

**姓名：**　**岗位：**　**所属部门：**

## 一、年度工作概述

## 二、关键业绩与成果

### 1. 重点项目

- 项目背景、我的角色、关键产出与量化结果

### 2. 日常职责

## 三、能力成长与亮点

## 四、不足与反思

## 五、下一年规划

- 目标一
- 目标二
`},

	// ───────────────────────── 项目管理类文档 ─────────────────────────
	{Category: "项目管理类文档", DocType: "markdown", Name: "项目立项申请", Title: "项目立项申请", Sort: 1, Content: `# 项目立项申请

**项目名称：**　**申请部门：**　**申请人：**　**日期：**

## 一、项目背景与必要性

## 二、项目目标

- 可量化的目标（SMART）

## 三、范围与边界

- 范围内：
- 范围外（暂不做）：

## 四、预估投入

- 人力：
- 预算：
- 周期：约  周 / 月

## 五、预期收益

## 六、主要风险

| 风险 | 可能性 | 影响 | 应对 |
| --- | --- | --- | --- |
|  |  |  |  |

## 七、审批

- 部门负责人：
- 分管领导：
`},

	{Category: "项目管理类文档", DocType: "markdown", Name: "项目周报", Title: "项目周报", Sort: 2, Content: `# 项目周报（ 年 月 第 周）

**项目：**　**项目经理：**　**周期：** 月 日 — 月 日

## 一、本周进展

- 里程碑 / 完成项

## 二、进度跟踪

| 任务 | 计划完成 | 实际状态 | 偏差说明 |
| --- | --- | --- | --- |
|  |  |  |  |

## 三、风险与问题

- 风险一（等级 / 应对）

## 四、下周计划

- [ ] 计划一
- [ ] 计划二

## 五、需协调事项

`},

	{Category: "项目管理类文档", DocType: "gantt", Name: "项目进度计划", Title: "项目进度计划", Sort: 3, Content: ganttJSON([]gtTask{
		{ID: 1, Text: "项目整体计划", Start: "2026-03-01", Duration: 70, Progress: 0, Type: "summary", Parent: 0, Priority: 8, Assignees: []string{"项目经理"}, Details: "整体排期", Open: true},
		{ID: 2, Text: "启动与规划", Start: "2026-03-01", Duration: 14, Progress: 0, Type: "summary", Parent: 1, Priority: 7, Assignees: []string{"项目经理"}, Open: true},
		{ID: 3, Text: "需求调研与立项", Start: "2026-03-01", Duration: 7, Progress: 0, Type: "task", Parent: 2, Priority: 6, Assignees: []string{"产品"}, Details: "输出立项报告"},
		{ID: 4, Text: "方案设计与评审", Start: "2026-03-08", Duration: 7, Progress: 0, Type: "task", Parent: 2, Priority: 6, Assignees: []string{"技术"}, Details: "输出技术方案"},
		{ID: 5, Text: "研发实施", Start: "2026-03-15", Duration: 35, Progress: 0, Type: "summary", Parent: 1, Priority: 9, Assignees: []string{"研发"}, Open: true},
		{ID: 6, Text: "核心功能开发", Start: "2026-03-15", Duration: 20, Progress: 0, Type: "task", Parent: 5, Priority: 9, Assignees: []string{"研发一组"}, Details: "主流程实现"},
		{ID: 7, Text: "联调与测试", Start: "2026-04-04", Duration: 15, Progress: 0, Type: "task", Parent: 5, Priority: 7, Assignees: []string{"测试"}, Details: "全链路回归"},
		{ID: 8, Text: "验收与上线", Start: "2026-04-19", Duration: 14, Progress: 0, Type: "summary", Parent: 1, Priority: 7, Assignees: []string{"项目经理"}, Open: true},
		{ID: 9, Text: "用户验收", Start: "2026-04-19", Duration: 7, Progress: 0, Type: "task", Parent: 8, Priority: 6, Assignees: []string{"产品"}, Details: "验收签字"},
		{ID: 10, Text: "正式上线", Start: "2026-04-26", Duration: 7, Progress: 0, Type: "task", Parent: 8, Priority: 5, Assignees: []string{"运维"}, Details: "灰度发布"},
	}, []gtLink{{ID: 1, Source: 4, Target: 6, Type: "e2s"}})},

	// ───────────────────────── 软件项目类文档 ─────────────────────────
	{Category: "软件项目类文档", DocType: "markdown", Name: "软件需求规格说明", Title: "软件需求规格说明", Sort: 1, Content: `# 软件需求规格说明（SRS）

**产品 / 项目：**　**版本：**　**编写：**　**日期：**

## 一、产品概述

### 1.1 背景与目标
### 1.2 用户与角色

| 角色 | 职责 | 核心诉求 |
| --- | --- | --- |
|  |  |  |

## 二、功能需求

### 2.1 功能一（FR-01）

- 描述：
- 输入 / 输出：
- 业务规则：
- 优先级：高 / 中 / 低

### 2.2 功能二（FR-02）

## 三、非功能需求

- 性能：
- 安全：
- 兼容性：

## 四、接口与数据

## 五、验收标准

`},

	{Category: "软件项目类文档", DocType: "markdown", Name: "技术方案设计文档", Title: "技术方案设计文档", Sort: 2, Content: `# 技术方案设计文档

**系统 / 模块：**　**架构师：**　**日期：**

## 一、需求回顾与设计目标

## 二、总体架构

- 架构图（可插入思维导图 / 流程图）
- 分层与关键组件

## 三、核心设计

### 3.1 数据结构与存储

### 3.2 关键流程

### 3.3 接口设计

| 接口 | 方法 | 说明 |
| --- | --- | --- |
|  |  |  |

## 四、技术选型与理由

## 五、性能与安全设计

## 六、风险与应对

`},

	{Category: "软件项目类文档", DocType: "mindmap", Name: "系统架构设计", Title: "系统架构设计", Sort: 3, Content: mindmapJSON("系统架构", []mmNode{
		{Data: mmData{Text: "前端", Expand: true}, Children: []mmNode{
			{Data: mmData{Text: "展示层 / 路由"}, Children: nil},
			{Data: mmData{Text: "状态管理"}, Children: nil},
			{Data: mmData{Text: "接口请求层"}, Children: nil},
		}},
		{Data: mmData{Text: "后端", Expand: true}, Children: []mmNode{
			{Data: mmData{Text: "接入层 / 网关"}, Children: nil},
			{Data: mmData{Text: "业务服务"}, Children: nil},
			{Data: mmData{Text: "数据访问层"}, Children: nil},
		}},
		{Data: mmData{Text: "存储与中间件", Expand: true}, Children: []mmNode{
			{Data: mmData{Text: "主数据库"}, Children: nil},
			{Data: mmData{Text: "缓存"}, Children: nil},
			{Data: mmData{Text: "消息队列"}, Children: nil},
		}},
		{Data: mmData{Text: "运维与安全", Expand: true}, Children: []mmNode{
			{Data: mmData{Text: "监控告警"}, Children: nil},
			{Data: mmData{Text: "鉴权与审计"}, Children: nil},
		}},
	})},

	// ───────────────────────── 工程施工类文档 ─────────────────────────
	{Category: "工程施工类文档", DocType: "markdown", Name: "施工组织设计大纲", Title: "施工组织设计大纲", Sort: 1, Content: `# 施工组织设计

**工程名称：**　**编制单位：**　**编制日期：**

## 一、工程概况

- 建设地点、规模、结构形式、工期要求

## 二、施工部署

- 组织机构与人员分工
- 施工区段划分与流水段

## 三、施工进度计划

- 总工期与关键节点（可另附甘特图）

## 四、主要施工方法

## 五、质量与安全保障体系

## 六、资源配置

- 劳动力计划、主要机械、材料供应

## 七、环境保护与文明施工

`},

	{Category: "工程施工类文档", DocType: "gantt", Name: "工程进度计划", Title: "工程进度计划", Sort: 2, Content: ganttJSON([]gtTask{
		{ID: 1, Text: "工程项目总进度", Start: "2026-03-01", Duration: 120, Progress: 0, Type: "summary", Parent: 0, Priority: 9, Assignees: []string{"项目经理"}, Details: "总控计划", Open: true},
		{ID: 2, Text: "施工准备", Start: "2026-03-01", Duration: 14, Progress: 0, Type: "task", Parent: 1, Priority: 7, Assignees: []string{"施工员"}, Details: "场地、临设、交底"},
		{ID: 3, Text: "基础工程", Start: "2026-03-15", Duration: 30, Progress: 0, Type: "task", Parent: 1, Priority: 9, Assignees: []string{"土建"}, Details: "桩基与地下室"},
		{ID: 4, Text: "主体结构", Start: "2026-04-14", Duration: 45, Progress: 0, Type: "task", Parent: 1, Priority: 9, Assignees: []string{"土建"}, Details: "封顶"},
		{ID: 5, Text: "机电安装", Start: "2026-05-29", Duration: 35, Progress: 0, Type: "task", Parent: 1, Priority: 7, Assignees: []string{"安装"}, Details: "水暖电"},
		{ID: 6, Text: "装饰装修", Start: "2026-07-03", Duration: 30, Progress: 0, Type: "task", Parent: 1, Priority: 6, Assignees: []string{"装修"}, Details: "内外装"},
		{ID: 7, Text: "竣工验收", Start: "2026-08-02", Duration: 15, Progress: 0, Type: "task", Parent: 1, Priority: 6, Assignees: []string{"项目经理"}, Details: "整改与交付"},
	}, []gtLink{{ID: 1, Source: 3, Target: 4, Type: "e2s"}})},

	{Category: "工程施工类文档", DocType: "markdown", Name: "安全技术交底记录", Title: "安全技术交底记录", Sort: 3, Content: `# 安全技术交底记录

**工程名称：**　**分部分项：**　**交底日期：**
**交底人：**　**被交底人（班组）：**

## 一、交底内容

- 作业环境与安全要求
- 主要危险源：
- 操作规程与防护措施：

## 二、应急处置

- 突发事件处置流程
- 急救与上报电话：

## 三、签字确认

| 姓名 | 工种 | 签字 |
| --- | --- | --- |
|  |  |  |
|  |  |  |

> 本记录一式两份，交底人与班组各执一份。
`},

	// ───────────────────────── 营销报表类表格 ─────────────────────────
	{Category: "营销报表类表格", DocType: "sheet", Name: "销售业绩月报表", Title: "销售业绩月报表", Sort: 1, Content: sheetJSON("销售业绩月报", [][]string{
		{"区域", "销售员", "月度目标", "实际完成", "完成率", "回款", "环比"},
		{"华东", "张三", "100000", "115000", "115%", "110000", "+12%"},
		{"华南", "李四", "90000", "82000", "91%", "80000", "-5%"},
		{"华北", "王五", "120000", "130000", "108%", "125000", "+9%"},
		{"合计", "", "310000", "327000", "105%", "315000", "+5%"},
	})},

	{Category: "营销报表类表格", DocType: "sheet", Name: "市场推广费用明细", Title: "市场推广费用明细", Sort: 2, Content: sheetJSON("推广费用明细", [][]string{
		{"日期", "渠道", "活动 / 内容", "费用", "曝光量", "转化数", "单客成本"},
		{"2026-03-01", "信息流", "春季新品推广", "20000", "500000", "1200", "16.7"},
		{"2026-03-05", "搜索", "品牌词投放", "12000", "80000", "600", "20.0"},
		{"2026-03-10", "社群", "会员日活动", "5000", "30000", "300", "16.7"},
		{"合计", "", "", "37000", "610000", "2100", "17.6"},
	})},

	{Category: "营销报表类表格", DocType: "sheet", Name: "客户跟进台账", Title: "客户跟进台账", Sort: 3, Content: sheetJSON("客户跟进台账", [][]string{
		{"客户名称", "联系人", "阶段", "最近跟进", "下次计划", "负责人", "意向"},
		{"甲公司", "赵总", "方案确认", "2026-03-08", "2026-03-15 演示", "钱经理", "高"},
		{"乙公司", "孙经理", "初步接触", "2026-03-09", "2026-03-12 电话", "钱经理", "中"},
		{"丙公司", "周工", "商务谈判", "2026-03-07", "2026-03-14 报价", "吴经理", "高"},
	})},

	// ───────────────────────── 财务报表类表格 ─────────────────────────
	{Category: "财务报表类表格", DocType: "sheet", Name: "部门费用预算表", Title: "部门费用预算表", Sort: 1, Content: sheetJSON("部门费用预算", [][]string{
		{"科目", "年度预算", "已用", "剩余", "执行率", "备注"},
		{"差旅费", "80000", "21000", "59000", "26%", ""},
		{"招待费", "50000", "18000", "32000", "36%", ""},
		{"办公费", "30000", "9000", "21000", "30%", ""},
		{"培训费", "40000", "0", "40000", "0%", "计划 Q3"},
		{"合计", "200000", "48000", "152000", "24%", ""},
	})},

	{Category: "财务报表类表格", DocType: "sheet", Name: "利润测算表", Title: "利润测算表", Sort: 2, Content: sheetJSON("利润测算", [][]string{
		{"项目", "金额", "占比", "说明"},
		{"营业收入", "1000000", "100%", ""},
		{"营业成本", "600000", "60%", "原材料+人工"},
		{"毛利", "400000", "40%", ""},
		{"销售费用", "120000", "12%", ""},
		{"管理费用", "80000", "8%", ""},
		{"净利润", "200000", "20%", ""},
	})},

	// ───────────────────────── 工作计划类 ─────────────────────────
	{Category: "工作计划类", DocType: "markdown", Name: "周工作计划", Title: "周工作计划", Sort: 1, Content: `# 周工作计划（ 月 日 — 月 日）

**姓名：**　**部门：**

## 本周目标

- [ ] 目标一（优先级：高）
- [ ] 目标二（优先级：中）

## 日程安排

| 日期 | 重点工作 | 产出 |
| --- | --- | --- |
| 周一 |  |  |
| 周二 |  |  |
| 周三 |  |  |
| 周四 |  |  |
| 周五 |  |  |

## 需要支持

`},

	{Category: "工作计划类", DocType: "markdown", Name: "个人年度目标计划", Title: "个人年度目标计划", Sort: 2, Content: `# 个人年度目标计划（ 年度）

**姓名：**　**岗位：**

## 一、年度主题

## 二、目标分解

### 目标一：（量化）
- Q1：
- Q2：
- Q3：
- Q4：

### 目标二：（量化）
- 里程碑与衡量标准

## 三、能力提升计划

- 技能 / 认证 / 学习路径

## 四、资源与支持需求

`},

	// ───────────────────────── 报销类表格 ─────────────────────────
	{Category: "报销类表格", DocType: "sheet", Name: "差旅费报销单", Title: "差旅费报销单", Sort: 1, Content: sheetJSON("差旅费报销", [][]string{
		{"日期", "出发地→目的地", "交通方式", "金额", "住宿", "补贴", "票据数", "事由"},
		{"2026-03-02", "北京→上海", "高铁", "553", "600", "100", "3", "客户拜访"},
		{"2026-03-03", "上海→北京", "高铁", "553", "0", "100", "2", "返程"},
		{"合计", "", "", "1106", "600", "200", "5", ""},
	})},

	{Category: "报销类表格", DocType: "sheet", Name: "日常费用报销单", Title: "日常费用报销单", Sort: 2, Content: sheetJSON("日常费用报销", [][]string{
		{"日期", "费用类别", "摘要", "金额", "票据数", "审批人"},
		{"2026-03-01", "办公用品", "打印纸/墨盒", "320", "1", "部门主管"},
		{"2026-03-04", "业务招待", "客户午餐", "480", "1", "部门主管"},
		{"2026-03-08", "通讯补贴", "手机话费", "200", "1", "部门主管"},
		{"合计", "", "", "1000", "3", ""},
	})},

	// ───────────────────────── 需求分析类脑图 ─────────────────────────
	{Category: "需求分析类脑图", DocType: "mindmap", Name: "产品需求分析脑图", Title: "产品需求分析脑图", Sort: 1, Content: mindmapJSON("产品需求分析", []mmNode{
		{Data: mmData{Text: "用户与场景", Expand: true}, Children: []mmNode{
			{Data: mmData{Text: "目标用户画像"}, Children: nil},
			{Data: mmData{Text: "核心使用场景"}, Children: nil},
			{Data: mmData{Text: "痛点与诉求"}, Children: nil},
		}},
		{Data: mmData{Text: "功能需求", Expand: true}, Children: []mmNode{
			{Data: mmData{Text: "基础功能"}, Children: nil},
			{Data: mmData{Text: "核心功能"}, Children: nil},
			{Data: mmData{Text: "增值功能"}, Children: nil},
		}},
		{Data: mmData{Text: "非功能需求", Expand: true}, Children: []mmNode{
			{Data: mmData{Text: "性能"}, Children: nil},
			{Data: mmData{Text: "安全合规"}, Children: nil},
			{Data: mmData{Text: "易用性"}, Children: nil},
		}},
		{Data: mmData{Text: "竞品对比", Expand: true}, Children: []mmNode{
			{Data: mmData{Text: "优势"}, Children: nil},
			{Data: mmData{Text: "差距"}, Children: nil},
		}},
	})},

	{Category: "需求分析类脑图", DocType: "mindmap", Name: "用户故事地图", Title: "用户故事地图", Sort: 2, Content: mindmapJSON("用户故事地图", []mmNode{
		{Data: mmData{Text: "活动 / 主干", Expand: true}, Children: []mmNode{
			{Data: mmData{Text: "发现", Expand: true}, Children: nil},
			{Data: mmData{Text: "使用", Expand: true}, Children: nil},
			{Data: mmData{Text: "付费", Expand: true}, Children: nil},
			{Data: mmData{Text: "留存", Expand: true}, Children: nil},
		}},
		{Data: mmData{Text: "用户角色", Expand: true}, Children: []mmNode{
			{Data: mmData{Text: "新用户"}, Children: nil},
			{Data: mmData{Text: "活跃用户"}, Children: nil},
			{Data: mmData{Text: "管理员"}, Children: nil},
		}},
		{Data: mmData{Text: "支撑能力", Expand: true}, Children: []mmNode{
			{Data: mmData{Text: "后端服务"}, Children: nil},
			{Data: mmData{Text: "数据中台"}, Children: nil},
		}},
	})},

	// ───────────────────────── 营销方案类脑图 ─────────────────────────
	{Category: "营销方案类脑图", DocType: "mindmap", Name: "整合营销推广方案脑图", Title: "整合营销推广方案", Sort: 1, Content: mindmapJSON("整合营销方案", []mmNode{
		{Data: mmData{Text: "目标与定位", Expand: true}, Children: []mmNode{
			{Data: mmData{Text: "营销目标"}, Children: nil},
			{Data: mmData{Text: "人群定位"}, Children: nil},
			{Data: mmData{Text: "核心卖点"}, Children: nil},
		}},
		{Data: mmData{Text: "渠道组合", Expand: true}, Children: []mmNode{
			{Data: mmData{Text: "线上"}, Children: nil},
			{Data: mmData{Text: "线下"}, Children: nil},
			{Data: mmData{Text: "私域"}, Children: nil},
		}},
		{Data: mmData{Text: "内容创意", Expand: true}, Children: []mmNode{
			{Data: mmData{Text: "主题"}, Children: nil},
			{Data: mmData{Text: "素材"}, Children: nil},
		}},
		{Data: mmData{Text: "预算与排期", Expand: true}, Children: []mmNode{
			{Data: mmData{Text: "预算分配"}, Children: nil},
			{Data: mmData{Text: "节奏"}, Children: nil},
		}},
		{Data: mmData{Text: "效果评估", Expand: true}, Children: []mmNode{
			{Data: mmData{Text: "KPI"}, Children: nil},
			{Data: mmData{Text: "复盘"}, Children: nil},
		}},
	})},

	{Category: "营销方案类脑图", DocType: "mindmap", Name: "新品上市推广脑图", Title: "新品上市推广脑图", Sort: 2, Content: mindmapJSON("新品上市推广", []mmNode{
		{Data: mmData{Text: "上市目标", Expand: true}, Children: []mmNode{
			{Data: mmData{Text: "销量目标"}, Children: nil},
			{Data: mmData{Text: "声量目标"}, Children: nil},
		}},
		{Data: mmData{Text: "预热期", Expand: true}, Children: []mmNode{
			{Data: mmData{Text: "种草内容"}, Children: nil},
			{Data: mmData{Text: "KOL 合作"}, Children: nil},
		}},
		{Data: mmData{Text: "爆发期", Expand: true}, Children: []mmNode{
			{Data: mmData{Text: "首发活动"}, Children: nil},
			{Data: mmData{Text: "直播带货"}, Children: nil},
		}},
		{Data: mmData{Text: "持续期", Expand: true}, Children: []mmNode{
			{Data: mmData{Text: "口碑运营"}, Children: nil},
			{Data: mmData{Text: "复购激励"}, Children: nil},
		}},
	})},

	// ───────────────────────── 财务分析类脑图 ─────────────────────────
	{Category: "财务分析类脑图", DocType: "mindmap", Name: "财务报表分析脑图", Title: "财务报表分析脑图", Sort: 1, Content: mindmapJSON("财务报表分析", []mmNode{
		{Data: mmData{Text: "资产负债表", Expand: true}, Children: []mmNode{
			{Data: mmData{Text: "偿债能力"}, Children: nil},
			{Data: mmData{Text: "结构分析"}, Children: nil},
		}},
		{Data: mmData{Text: "利润表", Expand: true}, Children: []mmNode{
			{Data: mmData{Text: "盈利能力"}, Children: nil},
			{Data: mmData{Text: "成本费用"}, Children: nil},
		}},
		{Data: mmData{Text: "现金流量表", Expand: true}, Children: []mmNode{
			{Data: mmData{Text: "经营现金流"}, Children: nil},
			{Data: mmData{Text: "投资现金流"}, Children: nil},
			{Data: mmData{Text: "筹资现金流"}, Children: nil},
		}},
		{Data: mmData{Text: "综合指标", Expand: true}, Children: []mmNode{
			{Data: mmData{Text: "ROE / ROA"}, Children: nil},
			{Data: mmData{Text: "周转率"}, Children: nil},
		}},
	})},

	{Category: "财务分析类脑图", DocType: "mindmap", Name: "成本结构分析脑图", Title: "成本结构分析脑图", Sort: 2, Content: mindmapJSON("成本结构分析", []mmNode{
		{Data: mmData{Text: "固定成本", Expand: true}, Children: []mmNode{
			{Data: mmData{Text: "房租 / 折旧"}, Children: nil},
			{Data: mmData{Text: "人员固定"}, Children: nil},
		}},
		{Data: mmData{Text: "变动成本", Expand: true}, Children: []mmNode{
			{Data: mmData{Text: "原材料"}, Children: nil},
			{Data: mmData{Text: "销售提成"}, Children: nil},
		}},
		{Data: mmData{Text: "期间费用", Expand: true}, Children: []mmNode{
			{Data: mmData{Text: "管理费用"}, Children: nil},
			{Data: mmData{Text: "销售费用"}, Children: nil},
			{Data: mmData{Text: "财务费用"}, Children: nil},
		}},
		{Data: mmData{Text: "降本空间", Expand: true}, Children: []mmNode{
			{Data: mmData{Text: "采购优化"}, Children: nil},
			{Data: mmData{Text: "效率提升"}, Children: nil},
		}},
	})},

	// ───────────────────────── 投资分析类脑图 ─────────────────────────
	{Category: "投资分析类脑图", DocType: "mindmap", Name: "投资项目评估脑图", Title: "投资项目评估脑图", Sort: 1, Content: mindmapJSON("投资项目评估", []mmNode{
		{Data: mmData{Text: "项目概况", Expand: true}, Children: []mmNode{
			{Data: mmData{Text: "行业与赛道"}, Children: nil},
			{Data: mmData{Text: "团队"}, Children: nil},
		}},
		{Data: mmData{Text: "财务预测", Expand: true}, Children: []mmNode{
			{Data: mmData{Text: "收入模型"}, Children: nil},
			{Data: mmData{Text: "回报周期"}, Children: nil},
		}},
		{Data: mmData{Text: "估值与条款", Expand: true}, Children: []mmNode{
			{Data: mmData{Text: "估值方法"}, Children: nil},
			{Data: mmData{Text: "关键条款"}, Children: nil},
		}},
		{Data: mmData{Text: "退出机制", Expand: true}, Children: []mmNode{
			{Data: mmData{Text: "IPO / 并购"}, Children: nil},
			{Data: mmData{Text: "回购"}, Children: nil},
		}},
	})},

	{Category: "投资分析类脑图", DocType: "mindmap", Name: "投资风险评估脑图", Title: "投资风险评估脑图", Sort: 2, Content: mindmapJSON("投资风险评估", []mmNode{
		{Data: mmData{Text: "市场风险", Expand: true}, Children: []mmNode{
			{Data: mmData{Text: "需求波动"}, Children: nil},
			{Data: mmData{Text: "竞争加剧"}, Children: nil},
		}},
		{Data: mmData{Text: "运营风险", Expand: true}, Children: []mmNode{
			{Data: mmData{Text: "执行偏差"}, Children: nil},
			{Data: mmData{Text: "人才流失"}, Children: nil},
		}},
		{Data: mmData{Text: "财务风险", Expand: true}, Children: []mmNode{
			{Data: mmData{Text: "现金流断裂"}, Children: nil},
			{Data: mmData{Text: "估值过高"}, Children: nil},
		}},
		{Data: mmData{Text: "应对措施", Expand: true}, Children: []mmNode{
			{Data: mmData{Text: "分期投入"}, Children: nil},
			{Data: mmData{Text: "对赌保护"}, Children: nil},
		}},
	})},
}

// SeedTemplates 将内置模板灌入数据库（幂等）：仅当库内不存在 builtin 模板时才批量写入，
// 已存在则跳过，绝不覆盖用户后续可能新增的自定义模板。
func SeedTemplates(g *gorm.DB) error {
	var cnt int64
	if err := g.Model(&model.DocTemplate{}).Where("builtin = ?", true).Count(&cnt).Error; err != nil {
		return err
	}
	if cnt > 0 {
		return nil
	}
	templates := make([]model.DocTemplate, len(builtinTemplates))
	for i, t := range builtinTemplates {
		t.Builtin = true
		templates[i] = t
	}
	return g.Create(&templates).Error
}
