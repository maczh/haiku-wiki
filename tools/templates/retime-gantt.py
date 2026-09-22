#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 mermaid 甘特模板的排期整体平移到「基准日附近」，避免整张图落在过去、看不到今天。

为什么需要
----------
内置 mermaid 甘特模板的日期是静态文本。若排期整体早于当前日期，渲染出来的图
整片都是「已完成」区段，且 mermaid 不会画出 today 竖线 —— 作为模板观感差。

基准约定与 `tools/templates/polish.py` 的 SVAR 甘特保持一致：
    GANTT_BASE = 2026-09-22      图表起点 = 基准日 - 12 天（首屏能看到已开始/未开始的混合）
基准日是**固定常量**（不取"今天"），否则每次生成结果都不同、JSON 无法幂等 diff。

平移规则（幂等）
----------------
* 只处理正文首行为 `gantt` 的源文件；
* 取正文里所有 `YYYY-MM-DD`；若 `max(日期) >= 基准日` 说明排期已跨越/晚于基准日
  （如「双十一大促」锚定 11-11、「展会筹办」跨到 10-14），**原样保留语义**，不动；
* 否则整体平移 `delta = (基准日 - 12 天) - min(日期)`，只改显式日期；
  `after <id>` 这类相对依赖与各段持续时间天然保持不变；
* 再跑一次时 min 已等于基准日-12天、max 亦 ≥ 基准日 → 全部跳过，结果稳定。

用法
----
    python3 tools/templates/retime-gantt.py --check     # 只校验是否都已落在基准位（CI / 回归用）
    python3 tools/templates/retime-gantt.py --dry-run    # 只报告要改什么
    python3 tools/templates/retime-gantt.py              # 写回源文件
"""

import datetime
import importlib.util
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
SRC_DIR = os.path.join(REPO, "server", "internal", "repository", "templates", "_src", "flowchart")

# 与 polish.py 的 GANTT_TODAY / GANTT_LEAD_DAYS 对齐（固定基准日，保证幂等可 diff）
GANTT_BASE = datetime.date(2026, 9, 22)
GANTT_LEAD_DAYS = 12

DATE_RE = re.compile(r"\b(20\d\d)-(\d\d)-(\d\d)\b")

_spec = importlib.util.spec_from_file_location("gen_flowchart", os.path.join(HERE, "gen-flowchart.py"))
_gen = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_gen)
parse_front_matter = _gen.parse_front_matter


def dates_in(text):
    return [datetime.date(int(y), int(m), int(d)) for y, m, d in DATE_RE.findall(text)]


def shift_dates(text, delta):
    def sub(m):
        d = datetime.date(int(m.group(1)), int(m.group(2)), int(m.group(3))) + delta
        return d.isoformat()

    return DATE_RE.sub(sub, text)


def iter_gantt_files():
    """产出 (文件名, 源文本, 正文, 显式日期列表)——只含正文首行为 gantt 的源文件。"""
    for fn in sorted(os.listdir(SRC_DIR)):
        if not fn.endswith(".mmd"):
            continue
        path = os.path.join(SRC_DIR, fn)
        raw = open(path, encoding="utf-8").read()
        _meta, body = parse_front_matter(raw, path)
        head = body.strip().splitlines()[0].strip() if body.strip() else ""
        if head != "gantt":
            continue
        yield fn, path, raw, body, dates_in(body)


def main():
    check = "--check" in sys.argv
    dry = "--dry-run" in sys.argv
    chart_start = GANTT_BASE - datetime.timedelta(days=GANTT_LEAD_DAYS)
    changed, kept, failed, bad = 0, 0, 0, 0
    for fn, path, raw, body, ds in iter_gantt_files():
        if not ds:
            print("[retime-gantt] ⚠️  %s: 正文没有显式日期，跳过（无法定位排期）" % fn)
            failed += 1
            continue
        lo, hi = min(ds), max(ds)
        # 后置条件：要么已锚在基准位（起点 == 基准日-12天），要么排期跨越/晚于基准日。
        if check:
            if lo == chart_start or hi >= GANTT_BASE:
                kept += 1
            else:
                bad += 1
                print("[retime-gantt] ❌ %s：排期 %s…%s 既未锚定 %s，也未跨越基准日 %s —— "
                      "整张图会落在过去，请执行 python3 tools/templates/retime-gantt.py"
                      % (fn, lo, hi, chart_start, GANTT_BASE))
            continue
        if hi >= GANTT_BASE:
            kept += 1
            print("[retime-gantt] 跳过 %s（排期 %s…%s 已跨越/晚于基准日，保留原语义）" % (fn, lo, hi))
            continue
        delta = chart_start - lo
        if delta.days == 0:
            # 已经在基准位（上次跑过）——不动文件，保证幂等复跑零写入
            kept += 1
            print("[retime-gantt] 跳过 %s（排期起点已在 %s，无需平移）" % (fn, chart_start))
            continue
        new_body = shift_dates(body, delta)
        new_ds = dates_in(new_body)
        new_text = raw.replace(body, new_body, 1)
        changed += 1
        print("[retime-gantt] 平移 %s  %s…%s  →  %s…%s（%+d 天）"
              % (fn, lo, hi, min(new_ds), max(new_ds), delta.days))
        if not dry:
            with open(path, "w", encoding="utf-8") as f:
                f.write(new_text)
    if check:
        print("[retime-gantt] 校验：合规 %d 个、越期 %d 个、无日期 %d 个" % (kept, bad, failed))
        return 1 if (bad or failed) else 0
    print("[retime-gantt] %s：平移 %d 个、保留 %d 个、异常 %d 个"
          % ("试运行" if dry else "已写回", changed, kept, failed))
    return 0


if __name__ == "__main__":
    sys.exit(main())
