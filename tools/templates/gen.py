#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 server/internal/repository/templates/_src/ 下的 Markdown 模板源文件生成到内置模板 JSON。

为什么需要它
------------
内置模板正文直接写在 JSON 里，改一次就要手工转义整篇 Markdown（换行 / 引号 / 反引号），
既容易出错也无法 review。因此 markdown 类型模板改为「源文件 + 生成」：

    server/internal/repository/templates/_src/<json 文件名去掉后缀>/<NN-名字>.md

    文件开头是 front matter：
        ---
        name: 周工作计划          # 模板名（必填，画廊里显示的名字）
        title: 周工作计划          # 默认文档标题，缺省与 name 相同
        category: 工作计划类        # 缺省沿用目标 JSON 的文件级 category
        ---
        正文 Markdown…

生成规则
--------
* 目标 JSON 里的 **所有 markdown 条目都视为由源文件生成**：源目录里没有的 markdown 条目会被删除；
* 同文件内的 sheet / mindmap / gantt 条目（仍是手工维护的 JSON）原样保留，只在末尾重排 sort；
* 条目顺序 = 源文件名排序（用 10-/20- 前缀控制），sort 从 10 起按 10 递增重排；
* 幂等：反复执行结果一致。

用法
----
    python3 tools/templates/gen.py            # 生成/更新 JSON
    python3 tools/templates/gen.py --check    # 只校验磁盘内容是否与源一致（CI/回归用）
"""

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
TPL_DIR = os.path.join(REPO, "server", "internal", "repository", "templates")
SRC_DIR = os.path.join(TPL_DIR, "_src")

# 由源文件生成的正文只允许 markdown（sheet/mindmap/gantt 是结构化数据，手工维护）
GENERATED_DOC_TYPE = "markdown"


def parse_front_matter(text, path):
    """解析 `---` 包裹的 front matter，返回 (meta, body)。"""
    if not text.startswith("---"):
        raise SystemExit(f"[gen] {path}: 缺少 front matter（文件需以 --- 开头）")
    parts = text.split("\n")
    end = None
    for i in range(1, len(parts)):
        if parts[i].strip() == "---":
            end = i
            break
    if end is None:
        raise SystemExit(f"[gen] {path}: front matter 未闭合")
    meta = {}
    for line in parts[1:end]:
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if ":" not in line:
            raise SystemExit(f"[gen] {path}: front matter 行无法解析: {line!r}")
        k, v = line.split(":", 1)
        meta[k.strip()] = v.strip()
    body = "\n".join(parts[end + 1:]).strip("\n")
    return meta, body


def load_sources():
    """扫描源目录 → {json 文件名: [entry, ...]}（entry 已按源文件名排序）。"""
    if not os.path.isdir(SRC_DIR):
        raise SystemExit(f"[gen] 源目录不存在: {SRC_DIR}")
    buckets = {}
    for stem in sorted(os.listdir(SRC_DIR)):
        d = os.path.join(SRC_DIR, stem)
        if not os.path.isdir(d):
            continue
        target = f"{stem}.json"
        entries = []
        for fn in sorted(os.listdir(d)):
            if not fn.endswith(".md"):
                continue
            path = os.path.join(d, fn)
            with open(path, encoding="utf-8") as f:
                meta, body = parse_front_matter(f.read(), path)
            name = meta.get("name", "").strip()
            if not name:
                raise SystemExit(f"[gen] {path}: front matter 缺少 name")
            if not body:
                raise SystemExit(f"[gen] {path}: 正文为空")
            if "【" in body and "】" in body:
                # 示例内容填充策略：正文不留填空占位符（含 【】 基本可判定为漏改的旧写法）
                raise SystemExit(f"[gen] {path}: 正文出现「【…】」占位符，请改为示例内容")
            entries.append(
                {
                    "name": name,
                    "title": meta.get("title", "").strip() or name,
                    "doc_type": meta.get("doc_type", GENERATED_DOC_TYPE).strip() or GENERATED_DOC_TYPE,
                    "category": meta.get("category", "").strip(),
                    "content": body,
                    "_src": os.path.relpath(path, REPO),
                }
            )
        buckets[target] = entries
    return buckets


def main():
    check = "--check" in sys.argv
    # 默认拒绝「删掉 JSON 里存在的 markdown 条目」——源文件分批补齐期间，一次误跑就会
    # 抹掉还没写完的模板。全部源文件到位后再显式 --prune 收口。
    prune = "--prune" in sys.argv
    sources = load_sources()
    changed, checked = [], 0
    for target in sorted(sources):
        path = os.path.join(TPL_DIR, target)
        if not os.path.exists(path):
            raise SystemExit(f"[gen] 目标模板文件不存在: {path}")
        with open(path, encoding="utf-8") as f:
            doc = json.load(f)
        file_category = doc.get("category", "")

        # 保留非 markdown 条目（sheet / mindmap / gantt，手工维护）
        kept_others = [t for t in doc.get("templates", []) if t.get("doc_type") != GENERATED_DOC_TYPE]
        kept_md = [t for t in doc.get("templates", []) if t.get("doc_type") == GENERATED_DOC_TYPE]

        src_names = {e["name"] for e in sources[target]}
        orphans = [t.get("name") for t in kept_md if t.get("name") not in src_names]
        if orphans and not prune:
            print(f"[gen] ⚠️  {target} 里有 {len(orphans)} 个 markdown 条目尚无源文件，已跳过该文件：")
            for o in orphans[:6]:
                print("      -", o)
            if len(orphans) > 6:
                print(f"      … 共 {len(orphans)} 个")
            continue

        out = []
        sort_no = 10
        for e in sources[target]:
            item = {"name": e["name"], "title": e["title"], "doc_type": e["doc_type"]}
            if e["category"] and e["category"] != file_category:
                item["category"] = e["category"]
            item["sort"] = sort_no
            item["content"] = e["content"]
            out.append(item)
            sort_no += 10
        for k in kept_others:
            item = dict(k)
            item["sort"] = sort_no
            sort_no += 10
            out.append(item)

        new_doc = {"category": file_category, "templates": out}
        text = json.dumps(new_doc, ensure_ascii=False, indent=2) + "\n"
        old_text = open(path, encoding="utf-8").read()
        checked += 1
        if old_text != text:
            changed.append(os.path.basename(path))
            if not check:
                with open(path, "w", encoding="utf-8") as f:
                    f.write(text)

    # 是否还有 markdown 源目录之外的 target（源目录里没有的 JSON 文件不动，但提示一下）
    md_sources = sum(len(v) for v in sources.values())
    print(f"[gen] 源模板 {md_sources} 个，覆盖 {checked} 个 JSON 文件")
    if check:
        if changed:
            print("[gen] ❌ 以下 JSON 与源文件不一致，请执行 python3 tools/templates/gen.py：")
            for c in changed:
                print("      -", c)
            return 1
        print("[gen] ✅ 所有 JSON 与 Markdown 源文件一致")
        return 0
    if changed:
        print("[gen] 已更新：" + ", ".join(changed))
    else:
        print("[gen] 无变化")
    return 0


if __name__ == "__main__":
    sys.exit(main())
