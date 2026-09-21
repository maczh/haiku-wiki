#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""内置模板「结构化类型」美化：表格 / 思维导图 / 甘特图。

markdown 模板的正文由 `_src/*.md` + `gen.py` 生成；而 sheet / mindmap / gantt
是结构化数据（JSON），继续手工维护，但需要统一的样式处理。本脚本就是那个处理入口：

    python3 tools/templates/polish.py sheet      # 表格：标题带 + 表头样式 + 边框 + 列宽 + 冻结 + 金额格式
    python3 tools/templates/polish.py mindmap    # 脑图：注入完整主题快照 + 修正占位文案
    python3 tools/templates/polish.py gantt      # 甘特：修正占位文案 + 重排日期 + 按进度口径回算 progress
    python3 tools/templates/polish.py all

全部子命令都是幂等的（重复执行结果一致）。

执行顺序约定：先 polish（结构化类型）后 gen（markdown 生成），因为 gen 会重排 sort 并
统一 JSON 缩进格式。
"""

import json
import os
import re
import sys
from datetime import date, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
TPL_DIR = os.path.join(REPO, "server", "internal", "repository", "templates")
THEMES_FILE = os.path.join(HERE, "mindmap-themes.json")

# Polish 只处理这几类，且只认「内置模板」的范围（就是这个目录下的 *.json）
STRUCTURED_TYPES = ("sheet", "mindmap", "gantt")

# 甘特模板的基准：整体排期起点 = 基准日 - 12 天（保证图表首屏能看到「已完成 + 进行中 + 未开始」的混合状态，
# 而不是一屏灰色或一屏红色）。基准日取生成当天。
GANTT_TODAY = date(2026, 9, 22)
GANTT_LEAD_DAYS = 12

# 金额类列（命中即按 #,##0.00 右对齐显示）
MONEY_WORDS = (
    "金额", "单价", "费用", "合计", "总计", "小计", "预算", "收入", "支出", "成本",
    "税额", "余额", "折旧", "摊销", "报销", "补贴", "住宿", "交通", "招待", "医疗",
    "借款", "付款", "租金", "营收", "利润", "目标值", "实际值",
)
# 合计行判定
TOTAL_WORDS = ("合计", "总计", "小计", "累计", "汇总")


# ────────────────────────────── 公共 ──────────────────────────────

def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def save(path, doc):
    with open(path, "w", encoding="utf-8") as f:
        f.write(json.dumps(doc, ensure_ascii=False, indent=2) + "\n")


def each_template(doc_type):
    """遍历所有内置模板文件，yield (文件名, json 文档, 模板条目)。"""
    for fn in sorted(os.listdir(TPL_DIR)):
        if not fn.endswith(".json"):
            continue
        path = os.path.join(TPL_DIR, fn)
        doc = load(path)
        for tpl in doc.get("templates", []):
            if tpl.get("doc_type") == doc_type:
                yield fn, path, doc, tpl


def norm_content(c):
    """content 可能是 JSON 字符串（存储态）或对象（模板文件里的可读态）。"""
    return json.loads(c) if isinstance(c, str) else c


def has_placeholder(obj) -> bool:
    return "【" in json.dumps(obj, ensure_ascii=False)


def text_width(s: str) -> int:
    """按显示宽度估算长度：CJK/全角算 2，其余算 1。"""
    w = 0
    for ch in str(s):
        w += 2 if ord(ch) > 0x2E80 else 1
    return w


# ────────────────────────────── 表格 ──────────────────────────────

# 表格样式版本：改动样式逻辑时+1（旧版本的表需要先 git checkout 回原始数据再重跑，
# 因为「插标题行 / 行下移」这类变换无法在已变换的数据上安全地重复施加）
SHEET_STYLE_VERSION = 1


def polish_sheet(tpl):
    """给表格模板加标题带、表头样式、边框、列宽、冻结与金额格式。

    改动点（写入基于「原始数据行」重新计算）：
      · 顶端插入 1 行合并标题（模板名），行高 34
      · 原表头行：浅底 + 深字 + 加粗 + 居中，底边强调线
      · 数据区：细边框 + 偶数行斑马底 + 金额列右对齐（#,##0.00）
      · 合计行：加粗 + 浅底 + 上边强调线
      · 列宽按内容宽度估算；冻结标题与表头两行；画布尺寸收紧到内容外一行一列
    """
    data = norm_content(tpl["content"])
    sheets = data.get("sheets") or []
    if not sheets:
        return False
    changed = False
    for sheet in sheets:
        cells = sheet.get("celldata") or []
        if not cells:
            continue
        cfg = sheet.get("config") or {}
        ver = cfg.get("hkStyle")
        if ver == SHEET_STYLE_VERSION:
            continue  # 已按当前版本美化过
        if ver is not None:
            raise SystemExit(
                f"[polish] {tpl['name']} 的表格样式版本为 {ver}，当前为 {SHEET_STYLE_VERSION}；"
                "请先 `git checkout -- server/internal/repository/templates/*.json` 回到原始数据再重跑"
            )

        max_r = max(int(c["r"]) for c in cells)
        max_c = max(int(c["c"]) for c in cells)
        n_cols = max_c + 1

        # 原始数据（行索引 0 = 表头）→ 下移 1 行
        grid = {}
        for c in cells:
            grid[(int(c["r"]), int(c["c"]))] = c.get("v")

        header = [grid.get((0, c)) for c in range(n_cols)]
        header_text = [(_text_of(v)) for v in header]
        money_cols = {
            i for i, h in enumerate(header_text) if any(w in h for w in MONEY_WORDS)
        }

        out = []
        # 标题带
        title = tpl.get("name") or sheet.get("name") or "表格"
        out.append({"r": 0, "c": 0, "v": {
            "v": title, "m": title, "bl": 1, "fs": 15, "fc": "#1f2329", "ht": 0, "vt": 0,
        }})

        # 表头（原 0 行 → 1 行）
        for c in range(n_cols):
            v = _style_cell(grid.get((0, c)), bg="#eef2fa", fc="#1f3a5f", bl=1, ht=0, fs=12)
            out.append({"r": 1, "c": c, "v": v})

        # 数据区
        total_rows = set()
        for r in range(1, max_r + 1):
            label = _text_of(grid.get((r, 0))).strip()
            if label and len(label) <= 8 and label.startswith(TOTAL_WORDS):
                total_rows.add(r)

        for r in range(1, max_r + 1):
            is_total = r in total_rows
            zebra = r % 2 == 1  # 数据第 1 行保持白底，第 2 行浅底
            for c in range(n_cols):
                raw = grid.get((r, c))
                if raw is None:
                    continue
                v = _style_cell(
                    raw,
                    bg=("#f1f5fc" if is_total else ("#fafbfd" if zebra else None)),
                    bl=1 if is_total else None,
                    ht=2 if (c in money_cols and _is_number(_text_of(raw))) else None,
                )
                if c in money_cols and _is_number(_text_of(raw)):
                    num = float(_text_of(raw))
                    v["v"] = num
                    v["m"] = f"{num:,.2f}"
                    v["ct"] = {"fa": "#,##0.00", "t": "n"}
                out.append({"r": r + 1, "c": c, "v": v})

        last_r = max_r + 1
        sheet["celldata"] = out
        # 画布收紧到「内容 + 一行一列」：模板打开时不该出现大片空白网格
        sheet["row"] = last_r + 5
        sheet["column"] = n_cols + 1

        col_len = {}
        for c in range(n_cols):
            longest = max(
                [text_width(header_text[c])]
                + [text_width(_text_of(grid.get((r, c)))) for r in range(1, max_r + 1)],
            )
            col_len[str(c)] = max(76, min(240, round(longest * 6.6) + 18))

        border = []
        border.append({
            "rangeType": "range",
            "range": [{"row": [1, last_r], "column": [0, n_cols - 1]}],
            "borderType": "border-all",
            "style": "1",
            "color": "#e4e9f2",
        })
        border.append({
            "rangeType": "range",
            "range": [{"row": [1, 1], "column": [0, n_cols - 1]}],
            "borderType": "border-bottom",
            "style": "2",
            "color": "#b9c8e6",
        })
        # 标题带下压一条细分隔线，把标题与表头分开
        border.append({
            "rangeType": "range",
            "range": [{"row": [0, 0], "column": [0, n_cols - 1]}],
            "borderType": "border-bottom",
            "style": "1",
            "color": "#dfe5f0",
        })
        for r in sorted(total_rows):
            border.append({
                "rangeType": "range",
                "range": [{"row": [r + 1, r + 1], "column": [0, n_cols - 1]}],
                "borderType": "border-top",
                "style": "2",
                "color": "#b9c8e6",
            })

        sheet["config"] = {
            **cfg,
            "hkStyle": SHEET_STYLE_VERSION,
            "merge": {"0_0": {"r": 0, "c": 0, "rs": 1, "cs": n_cols}},
            "borderInfo": border,
            "rowlen": {"0": 34, "1": 30, **{str(r): 26 for r in range(2, last_r + 1)}},
            "columnlen": col_len,
        }
        # 冻结标题带 + 表头（Luckysheet 的 frozen 是 sheet 顶层字段）
        sheet["frozen"] = {"type": "row", "range": {"row_focus": 1, "column_focus": 0}}
        changed = True
    if changed:
        # 必须写回：content 可能是 JSON 字符串（存储态），此时 data 是解析出的副本，
        # 只改副本而不回写等于没改。
        tpl["content"] = data
    return changed


def _text_of(v):
    if v is None:
        return ""
    if isinstance(v, dict):
        for k in ("m", "v"):
            if isinstance(v.get(k), str):
                return v[k]
        if isinstance(v.get("v"), (int, float)):
            return str(v["v"])
        return ""
    return str(v)


def _is_number(s):
    return bool(re.fullmatch(r"-?\d+(\.\d+)?", str(s).strip().replace(",", "")))


def _style_cell(raw, bg=None, fc=None, bl=None, ht=None, fs=None):
    """在原始单元格富值上叠加样式（保留 v/m/ct，避免丢内容）。"""
    if isinstance(raw, dict):
        v = dict(raw)
    else:
        v = {"v": raw, "m": _text_of(raw), "ct": {"fa": "General", "t": "s"}}
    if bg:
        v["bg"] = bg
    if fc:
        v["fc"] = fc
    if bl:
        v["bl"] = bl
    if ht is not None:
        v["ht"] = ht
    if fs:
        v["fs"] = fs
    v.setdefault("vt", 0)
    return v


# ────────────────────────────── 脑图 ──────────────────────────────

# 文件 → 色卡（按业务气质分配，同一领域保持同一色系）
MINDMAP_PALETTE = {
    "financial-analysis.json": "ink",
    "investment-analysis.json": "slate",
    "marketing-plan.json": "rose",
    "requirement-analysis.json": "jade",
    "work-plan.json": "slate",
    "summary-report.json": "slate",
    "project-management.json": "ink",
    "office-admin.json": "jade",
    "software-project.json": "ink",
}

# 两个「整篇都是空壳」的脑图重写为示例内容（其余脑图节点文案本身可用，只换主题）
MINDMAP_REWRITE = {
    "季度OKR目标计划": {
        "root": "2026 Q4 OKR 目标计划",
        "branches": [
            ("O1 业务增长（营收 3,200 万元）", [
                "KR1 合同签约额由 4,800 万提升至 6,200 万 · 财务确认口径",
                "KR2 新增签约客户 46 家 · 其中战略客户 6 家",
                "KR3 老客户续约率达 92% · 到期客户 128 家",
                "KR4 NPS 达 45 分 · 抽样 320 份",
            ]),
            ("O2 产品与交付", [
                "KR1 交付 3 个关键版本 · 云枢 CRM 一期 / 数据中台二期 / 远岚 3.0",
                "KR2 里程碑按期率 100% · 共 14 个里程碑",
                "KR3 线上 P1 缺陷下降 40% · 基线 25 个/季度",
                "KR4 沉淀 6 份规范 · 接口 / 测试 / 发布 / 评审 / 监控 / 数据治理",
            ]),
            ("O3 效率与成本", [
                "KR1 人均交付吞吐提升 18%",
                "KR2 核心流程线上化率达 85%",
                "KR3 单位交付成本下降 12% · 基线 4.6 万元/人月",
                "KR4 自动化替代 120 人天",
            ]),
            ("O4 组织与能力", [
                "KR1 关键岗位到岗 8 人 · 研发 5 / 测试 2 / 数据 1",
                "KR2 培训 12 场、覆盖 180 人次",
                "KR3 核心人才保留率达 95%",
                "KR4 完成 6 个关键岗位的备份梯队建设",
            ]),
        ],
    },
    "年度工作总结脑图": {
        "root": "2026 年度工作总结",
        "branches": [
            ("一、年度概况", [
                "经营主线：数据中台与 CRM 双轮驱动",
                "年度主题：稳增长、提效率、强交付",
                "整体达成：14 项年度重点完成 12 项（86%）",
            ]),
            ("二、关键指标", [
                "营业收入：21,600 万元（同比 +26%）",
                "净利润：3,180 万元（同比 +19%）",
                "人均效能：提升 15%（人月交付吞吐）",
                "客户满意度：4.6 分（5 分制，抽样 480 份）",
            ]),
            ("三、重点成果", [
                "云枢 CRM 一期上线 · 覆盖 42 条需求、9 个业务场景",
                "星河数据中台二期交付 · 实时指标 18 个、看板 11 张",
                "交付体系升级 · 里程碑按期率由 78% 提升至 94%",
                "沉淀方法论 · 《交付质量红线》《指标口径管理规范》",
            ]),
            ("四、团队建设", [
                "编制：由 168 人增至 196 人",
                "关键岗位储备：12 人",
                "人均培训学时：42 小时",
                "梯队建设：完成 6 个关键岗位备份",
            ]),
            ("五、问题与不足", [
                "问题一：需求澄清不充分，交付返工率 11%",
                "问题二：数据口径变更缺少统一审批，口径争议 5 起",
                "根因分析：流程缺少强制卡点，责任边界不清晰",
                "闭环情况：已上线澄清清单与口径审批流，2027 Q1 验证",
            ]),
            ("六、下一年度规划", [
                "总目标：营收 27,000 万元，里程碑按期率 97%",
                "重点举措一：建设统一交付平台，交付过程可视",
                "重点举措二：推行业务域数据责任人制",
                "重点举措三：AI 辅助研发提效，覆盖 60% 常规开发",
                "资源预算：3,600 万元",
            ]),
            ("七、需支持事项", [
                "事项一：增加数据治理专职编制 4 人",
                "事项二：立项交付平台建设预算 260 万元",
                "事项三：跨部门协同机制由总经办牵头固化",
            ]),
        ],
    },
}


def _rebuild(root_text, branches):
    return {
        "data": {"text": root_text, "expand": True},
        "children": [
            {
                "data": {"text": b, "expand": True},
                "children": [{"data": {"text": leaf, "expand": False}, "children": None} for leaf in leaves],
            }
            for b, leaves in branches
        ],
    }


def polish_mindmap(fn, tpl, themes):
    """注入完整主题快照（32+ 个主题键），并把空壳脑图重写为示例内容。"""
    changed = False
    data = norm_content(tpl["content"])
    if tpl["name"] in MINDMAP_REWRITE:
        spec = MINDMAP_REWRITE[tpl["name"]]
        data = {
            "version": 2,
            "layout": data.get("layout") or "logicalStructure",
            "root": _rebuild(spec["root"], spec["branches"]),
        }
        changed = True
    palette = MINDMAP_PALETTE.get(fn, "ink")
    if data.get("theme") != themes[palette]:
        data["theme"] = themes[palette]
        changed = True
    if changed:
        tpl["content"] = data
    return changed


# ────────────────────────────── 甘特图 ──────────────────────────────

# 甘特模板里的占位文案（逐条给出示例值，避免机械替换产生语义不通的句子）
GANTT_TEXT_FIX = {
    "【____】项目全周期总控": "云枢 CRM 一期全周期总控",
    "完成【__】个场景调研": "完成 9 个业务场景调研",
    "完成【__】个模块": "完成 7 个功能模块",
    "【__】个单位试点": "3 个业务单位试点",
    "培训【__】场次": "培训 4 场次",
    "迭代版本 V____ 整体计划": "迭代版本 V1.4 整体计划",
    "目标 ____ TPS": "目标 800 TPS",
}


def _fix_text(s):
    out = str(s)
    for k, v in GANTT_TEXT_FIX.items():
        out = out.replace(k, v)
    return out


def polish_gantt(tpl):
    """占位文案修正 + 整体排期重排 + progress 按「状态口径」回算。

    progress 回算规则（与前端 lib/gantt.ts taskStatus 对齐）：
      · 已结束（end < today）           → 100
      · 未开始（start > today）         → 0（蓝色「未开始」）
      · 跨越今天                        → 按时间进度 expected，并保证不落进「进度拖延」区间；
        距结束不足 3 天的收尾任务直接置 100
    """
    changed = False
    data = norm_content(tpl["content"])
    tasks = data.get("tasks") or []
    if not tasks:
        return False

    # 1) 文案修正
    for t in tasks:
        for key in ("text", "details"):
            if key in t and isinstance(t[key], str):
                fixed = _fix_text(t[key])
                if fixed != t[key]:
                    t[key] = fixed
                    changed = True

    # 2) 整体重排：把最早的开始日平移到「基准日 - LEAD 天」
    starts = [t.get("start") for t in tasks if t.get("start")]
    if starts:
        min_start = min(date.fromisoformat(s) for s in starts)
        target = GANTT_TODAY - timedelta(days=GANTT_LEAD_DAYS)
        delta = (target - min_start).days
        if delta != 0:
            for t in tasks:
                if t.get("start"):
                    t["start"] = (date.fromisoformat(t["start"]) + timedelta(days=delta)).isoformat()
            changed = True

    # 3) progress 回算
    today_iso = GANTT_TODAY.isoformat()
    for t in tasks:
        start = date.fromisoformat(t["start"])
        duration = max(1, int(round(t.get("duration") or 1)))
        end = start + timedelta(days=duration - 1)
        if today_iso > end.isoformat():
            progress = 100
        elif today_iso < start.isoformat():
            progress = 0
        else:
            total = (end - start).days + 1
            elapsed = (GANTT_TODAY - start).days + 1
            days_left = (end - GANTT_TODAY).days
            if days_left <= 3:
                progress = 100
            else:
                progress = min(95, max(10, round(elapsed / total * 100) + 5))
        if t.get("progress") != progress:
            t["progress"] = progress
            changed = True

    if changed:
        tpl["content"] = data
    return changed


# ────────────────────────────── 入口 ──────────────────────────────

def run_sheet():
    n = 0
    for fn, path, doc, tpl in each_template("sheet"):
        if polish_sheet(tpl):
            save(path, doc)
            n += 1
    print(f"[polish] 表格：已美化 {n} 个模板")


def run_mindmap():
    if not os.path.exists(THEMES_FILE):
        raise SystemExit(
            "[polish] 缺少 mindmap-themes.json，请先执行：cd web && node ../tools/templates/gen-mindmap-themes.mjs"
        )
    themes = load(THEMES_FILE)
    n = 0
    for fn, path, doc, tpl in each_template("mindmap"):
        if polish_mindmap(fn, tpl, themes):
            save(path, doc)
            n += 1
    print(f"[polish] 脑图：已注入主题/重写内容 {n} 个模板")


def run_gantt():
    n = 0
    for fn, path, doc, tpl in each_template("gantt"):
        if polish_gantt(tpl):
            save(path, doc)
            n += 1
    print(f"[polish] 甘特：已重排 {n} 个模板")


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else "all"
    if cmd in ("sheet", "all"):
        run_sheet()
    if cmd in ("mindmap", "all"):
        run_mindmap()
    if cmd in ("gantt", "all"):
        run_gantt()
    if cmd not in ("sheet", "mindmap", "gantt", "all"):
        raise SystemExit(__doc__)
    return 0


if __name__ == "__main__":
    sys.exit(main())
