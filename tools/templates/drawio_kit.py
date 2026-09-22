#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""draw.io 绘图模板引擎：把声明式图表描述同时渲染成

    1) mxGraphModel XML（编辑态用，导入 draw.io 完全可编辑）
    2) 矢量 SVG（阅读态/分享态/模板预览用，不加载 37MB drawio 资源）

为什么两份都要
--------------
绘图文档正文契约是 JSON `{"version":1,"xml":...,"svg":...}`（见 web/src/lib/drawioDoc.ts）：
阅读页与分享页只渲染 SVG，编辑页才用 XML。因此模板必须两个都给，
否则从模板新建的绘图文档在阅读页会显示「尚未生成矢量预览」。

声明式描述（每个模板一个 JSON 源文件）
--------------------------------------
    {
      "name": "用户注册流程", "title": "用户注册流程图", "category": "绘图模板·业务流程",
      "w": 900, "h": 700,
      "groups": [{"t":"阶段一","x":40,"y":80,"w":820,"h":240,"palette":"gray"}],
      "nodes": [
        {"id":"s","t":"开始","x":380,"y":40,"w":140,"h":48,"shape":"pill","palette":"green"}
      ],
      "edges": [{"f":"s","t":"a","label":"提交","palette":"gray"}],
      "notes": [{"t":"说明：……","x":40,"y":640,"w":820,"h":44,"shape":"note"}]
    }

* palette 取 PALETTES 里的名字（blue/green/amber/red/purple/teal/orange/indigo/pink/gray），
  也可直接写 fill/stroke/color 三个十六进制色。
* shape 见 SHAPES 键：rect / round / pill / ellipse / diamond / para / hex /
  cylinder / doc / note / cloud / brace。
* 边默认正交折线，可写 "dir": "V"|"H" 强制纵向/横向出线，"dash": true 画虚线。
"""

import math
import os
import re
from xml.sax.saxutils import escape

# ── 配色 ────────────────────────────────────────────────────────────────────
# (fill, stroke, text)
PALETTES = {
    "blue": ("#dae8fc", "#6c8ebf", "#16365c"),
    "green": ("#d5e8d4", "#82b366", "#23502f"),
    "amber": ("#ffe6cc", "#d79b00", "#6d3b00"),
    "red": ("#f8cecc", "#b85450", "#6d1f1c"),
    "purple": ("#e1d5e7", "#9673a6", "#43275c"),
    "teal": ("#d0ecea", "#4d9c93", "#12403a"),
    "orange": ("#fde2cf", "#d76b2b", "#6d3308"),
    "indigo": ("#dcd6f7", "#5b57aa", "#221c52"),
    "pink": ("#fad9e6", "#c25b91", "#6d1f45"),
    "gray": ("#f1f3f5", "#868e96", "#343a40"),
    "slate": ("#e9ecef", "#495057", "#212529"),
    "cyan": ("#cceef5", "#1f8fa8", "#0b3d47"),
}

DEFAULT_PALETTE = "blue"
FONT = "Microsoft YaHei, PingFang SC, Hiragino Sans GB, Helvetica, Arial, sans-serif"
BG = "#ffffff"
GRID = "#f4f6f8"

# 形状 → draw.io style 片段
SHAPE_STYLE = {
    "rect": "rounded=0;whiteSpace=wrap;html=1;",
    "round": "rounded=1;arcSize=14;whiteSpace=wrap;html=1;",
    "pill": "rounded=1;arcSize=50;whiteSpace=wrap;html=1;",
    "ellipse": "ellipse;whiteSpace=wrap;html=1;",
    "diamond": "rhombus;whiteSpace=wrap;html=1;",
    "para": "shape=parallelogram;perimeter=parallelogramPerimeter;whiteSpace=wrap;html=1;",
    "hex": "shape=hexagon;perimeter=hexagonPerimeter;whiteSpace=wrap;html=1;",
    "cylinder": "shape=cylinder;whiteSpace=wrap;html=1;boundedLbl=1;backgroundOutline=1;size=14;",
    "doc": "shape=document;whiteSpace=wrap;html=1;boundedLbl=1;",
    "note": "shape=note;whiteSpace=wrap;html=1;size=14;align=left;verticalAlign=middle;spacingLeft=8;",
    "cloud": "shape=cloud;whiteSpace=wrap;html=1;",
    "brace": "shape=curlyBracket;whiteSpace=wrap;html=1;",
    "process": "shape=process;whiteSpace=wrap;html=1;",
    "card": "shape=card;whiteSpace=wrap;html=1;size=14;",
    "step": "shape=step;whiteSpace=wrap;html=1;",
    "trapezoid": "shape=trapezoid;perimeter=trapezoidPerimeter;whiteSpace=wrap;html=1;",
}


# ── 小工具 ──────────────────────────────────────────────────────────────────
def pal(n, default=DEFAULT_PALETTE):
    """取节点/边的 (fill, stroke, text)。"""
    if n.get("palette") in PALETTES:
        return PALETTES[n["palette"]]
    f = n.get("fill")
    s = n.get("stroke")
    c = n.get("color")
    base = PALETTES.get(n.get("palette", default), PALETTES[default])
    return (f or base[0], s or base[1], c or base[2])


def _is_wide(ch):
    o = ord(ch)
    return o > 0x2E80 or o in (0x2014, 0x2018, 0x2019, 0x201C, 0x201D)


def text_width(s, fs):
    w = 0.0
    for ch in s:
        w += fs * (1.0 if _is_wide(ch) else 0.56)
    return w


def wrap_text(text, fs, max_w):
    """按中英文混排宽度估算折行；尊重源文本里的 \\n。"""
    out = []
    for para in str(text).split("\n"):
        para = para.strip()
        if not para:
            continue
        line = ""
        for ch in para:
            if line and text_width(line + ch, fs) > max_w:
                out.append(line)
                line = ch
            else:
                line += ch
        if line:
            out.append(line)
    return out or [""]


def _f(v):
    return ("%.1f" % v).rstrip("0").rstrip(".")


# ── SVG 形状 ────────────────────────────────────────────────────────────────
def shape_body(n):
    """返回形状本体的 SVG 元素字符串（不含文本）。"""
    x, y, w, h = n["x"], n["y"], n["w"], n["h"]
    shape = n.get("shape", "rect")
    fill, stroke, _ = pal(n)
    sw = n.get("sw", 1.5)
    dash = ' stroke-dasharray="6 4"' if n.get("dash") else ""
    common = 'fill="%s" stroke="%s" stroke-width="%s"%s' % (fill, stroke, _f(sw), dash)

    if shape == "ellipse":
        return '<ellipse cx="%s" cy="%s" rx="%s" ry="%s" %s/>' % (
            _f(x + w / 2), _f(y + h / 2), _f(w / 2), _f(h / 2), common)
    if shape == "diamond":
        pts = "%s,%s %s,%s %s,%s %s,%s" % (
            _f(x + w / 2), _f(y), _f(x + w), _f(y + h / 2),
            _f(x + w / 2), _f(y + h), _f(x), _f(y + h / 2))
        return '<polygon points="%s" %s/>' % (pts, common)
    if shape == "hex":
        k = min(w * 0.22, 28)
        pts = "%s,%s %s,%s %s,%s %s,%s %s,%s %s,%s" % (
            _f(x + k), _f(y), _f(x + w - k), _f(y), _f(x + w), _f(y + h / 2),
            _f(x + w - k), _f(y + h), _f(x + k), _f(y + h), _f(x), _f(y + h / 2))
        return '<polygon points="%s" %s/>' % (pts, common)
    if shape == "para":
        k = min(w * 0.18, 26)
        pts = "%s,%s %s,%s %s,%s %s,%s" % (
            _f(x + k), _f(y), _f(x + w), _f(y), _f(x + w - k), _f(y + h), _f(x), _f(y + h))
        return '<polygon points="%s" %s/>' % (pts, common)
    if shape == "trapezoid":
        k = min(w * 0.16, 26)
        pts = "%s,%s %s,%s %s,%s %s,%s" % (
            _f(x + k), _f(y), _f(x + w - k), _f(y), _f(x + w), _f(y + h), _f(x), _f(y + h))
        return '<polygon points="%s" %s/>' % (pts, common)
    if shape == "step":
        k = min(h * 0.35, 22)
        pts = "%s,%s %s,%s %s,%s %s,%s %s,%s %s,%s %s,%s %s,%s" % (
            _f(x + w * 0.12), _f(y), _f(x + w), _f(y), _f(x + w), _f(y + (h - k) / 2),
            _f(x + w * 0.88), _f(y + (h - k) / 2), _f(x + w * 0.88), _f(y + h),
            _f(x + w * 0.12), _f(y + h), _f(x + w * 0.12), _f(y + (h + k) / 2),
            _f(x), _f(y + (h + k) / 2))
        return '<polygon points="%s" %s/>' % (pts, common)
    if shape == "cylinder":
        ry = min(h * 0.18, 16)
        d = ("M %s %s A %s %s 0 0 1 %s %s L %s %s A %s %s 0 0 0 %s %s "
             "L %s %s A %s %s 0 0 0 %s %s L %s %s A %s %s 0 0 1 %s %s Z") % (
            _f(x), _f(y + ry), _f(w / 2), _f(ry), _f(x + w), _f(y + ry),
            _f(x + w), _f(y + h - ry), _f(w / 2), _f(ry), _f(x), _f(y + h - ry),
            _f(x), _f(y + ry), _f(w / 2), _f(ry), _f(x + w), _f(y + ry),
            _f(x + w), _f(y + ry), _f(w / 2), _f(ry), _f(x), _f(y + ry))
        return '<path d="%s" %s/>' % (d, common)
    if shape == "doc":
        k = min(h * 0.16, 14)
        d = ("M %s %s L %s %s Q %s %s %s %s Q %s %s %s %s Q %s %s %s %s L %s %s Z") % (
            _f(x), _f(y), _f(x + w), _f(y), _f(x + w * 0.75), _f(y + h - k * 0.4),
            _f(x + w * 0.5), _f(y + h), _f(x + w * 0.25), _f(y + h - k * 0.4),
            _f(x), _f(y + h - k), _f(x + w * 0.25), _f(y + h - k * 1.4),
            _f(x + w * 0.5), _f(y + h - k * 1.8), _f(x + w * 0.75), _f(y + h - k * 1.4),
            _f(x + w), _f(y + h - k), _f(x + w), _f(y))
        return '<path d="%s" %s/>' % (d, common)
    if shape == "note":
        k = min(18, w * 0.2, h * 0.4)
        pts = "%s,%s %s,%s %s,%s %s,%s %s,%s" % (
            _f(x), _f(y), _f(x + w - k), _f(y), _f(x + w), _f(y + k),
            _f(x + w), _f(y + h), _f(x), _f(y + h))
        fold = '<path d="M %s %s L %s %s L %s %s" fill="%s" stroke="%s" stroke-width="%s"/>' % (
            _f(x + w - k), _f(y), _f(x + w - k), _f(y + k), _f(x + w), _f(y + k), fill, stroke, _f(sw))
        return '<polygon points="%s" %s/>%s' % (pts, common, fold)
    if shape == "cloud":
        cx, cy = x + w / 2, y + h / 2
        d = ("M %s %s C %s %s %s %s %s %s C %s %s %s %s %s %s "
             "C %s %s %s %s %s %s C %s %s %s %s %s %s Z") % (
            _f(x + w * 0.22), _f(y + h * 0.82),
            _f(x + w * 0.02), _f(y + h * 0.82), _f(x + w * 0.02), _f(y + h * 0.45), _f(x + w * 0.24), _f(y + h * 0.42),
            _f(x + w * 0.16), _f(y + h * 0.06), _f(x + w * 0.52), _f(y - h * 0.02), _f(x + w * 0.56), _f(y + h * 0.36),
            _f(x + w * 0.82), _f(y + h * 0.24), _f(x + w * 1.02), _f(y + h * 0.58), _f(x + w * 0.82), _f(y + h * 0.84),
            _f(x + w * 0.6), _f(y + h * 0.99), _f(x + w * 0.3), _f(y + h * 0.98), _f(x + w * 0.22), _f(y + h * 0.82))
        return '<path d="%s" %s/>' % (d, common)
    if shape == "brace":
        d = ("M %s %s C %s %s %s %s %s %s C %s %s %s %s %s %s "
             "C %s %s %s %s %s %s C %s %s %s %s %s %s") % (
            _f(x + w), _f(y), _f(x + w * 0.25), _f(y), _f(x + w * 0.25), _f(y + h / 2), _f(x + w * 0.35), _f(y + h / 2),
            _f(x + w * 0.25), _f(y + h / 2), _f(x + w * 0.25), _f(y + h), _f(x + w), _f(y + h),
            _f(x + w * 0.25), _f(y + h), _f(x + w * 0.25), _f(y + h / 2), _f(x + w * 0.35), _f(y + h / 2),
            _f(x + w * 0.25), _f(y + h / 2), _f(x + w * 0.25), _f(y), _f(x + w), _f(y))
        return '<path d="%s" fill="none" stroke="%s" stroke-width="%s"/>' % (d, stroke, _f(sw))
    if shape in ("pill", "card", "process"):
        rx = h / 2 if shape == "pill" else min(12, h / 4)
        return '<rect x="%s" y="%s" width="%s" height="%s" rx="%s" %s/>' % (
            _f(x), _f(y), _f(w), _f(h), _f(rx), common)
    rx = 6 if shape == "round" else 2
    return '<rect x="%s" y="%s" width="%s" height="%s" rx="%s" %s/>' % (
        _f(x), _f(y), _f(w), _f(h), _f(rx), common)


def text_svg(n):
    """节点文本（自动折行、垂直居中）。"""
    label = n.get("t", "")
    if not label:
        return ""
    fs = n.get("fs", 13)
    x, y, w, h = n["x"], n["y"], n["w"], n["h"]
    _, _, color = pal(n)
    if n.get("color"):
        color = n["color"]
    max_w = w - 16
    lines = wrap_text(label, fs, max_w)
    lh = fs * 1.4
    cx = x + w / 2
    if n.get("shape") == "note":
        cx = x + 10
        anchor = "start"
    else:
        anchor = "middle"
    cy = y + h / 2
    top = cy - (len(lines) - 1) * lh / 2
    opts = 'font-family="%s" font-size="%s" fill="%s" text-anchor="%s"' % (FONT, _f(fs), color, anchor)
    if n.get("bold"):
        opts += ' font-weight="700"'
    spans = []
    for i, ln in enumerate(lines):
        dy = "" if i == 0 else ' dy="%s"' % _f(lh)
        spans.append('<tspan x="%s"%s>%s</tspan>' % (_f(cx), dy, escape(ln)))
    return '<text y="%s" %s>%s</text>' % (_f(top + fs * 0.35), opts, "".join(spans))


# ── 连线 ────────────────────────────────────────────────────────────────────
def _clip(box, tx, ty):
    """从 box 中心朝 (tx, ty) 方向走，返回与 box 边框的交点。"""
    cx = box["x"] + box["w"] / 2
    cy = box["y"] + box["h"] / 2
    dx, dy = tx - cx, ty - cy
    if dx == 0 and dy == 0:
        return (cx, cy)
    sx = abs((box["w"] / 2) / dx) if dx else float("inf")
    sy = abs((box["h"] / 2) / dy) if dy else float("inf")
    s = min(sx, sy)
    return (cx + dx * s, cy + dy * s)


def route(a, b, dir_hint=None):
    """路由，返回 [(x, y), ...]。dir_hint: V/H 正交，L 直连（架构图扇出用）。"""
    acx, acy = a["x"] + a["w"] / 2, a["y"] + a["h"] / 2
    bcx, bcy = b["x"] + b["w"] / 2, b["y"] + b["h"] / 2
    if dir_hint == "L":
        return [_clip(a, bcx, bcy), _clip(b, acx, acy)]
    dx, dy = bcx - acx, bcy - acy
    vertical = abs(dy) >= abs(dx) if not dir_hint else (dir_hint == "V")

    def covers(box, v):
        return box["x"] - 1 <= v <= box["x"] + box["w"] + 1

    if vertical:
        if dy >= 0:
            s = (acx, a["y"] + a["h"])
            e = (bcx, b["y"])
        else:
            s = (acx, a["y"])
            e = (bcx, b["y"] + b["h"])
        # 宽块 ↔ 窄块：让连线垂直落在窄块中心上，避免多余的折角
        if covers(b, s[0]):
            e = (s[0], e[1])
        if covers(a, e[0]):
            s = (e[0], s[1])
        if abs(s[0] - e[0]) < 1.5:
            return [s, e]
        mid = (s[1] + e[1]) / 2
        return [s, (s[0], mid), (e[0], mid), e]
    if dx >= 0:
        s = (a["x"] + a["w"], acy)
        e = (b["x"], bcy)
    else:
        s = (a["x"], acy)
        e = (b["x"] + b["w"], bcy)
    if abs(s[1] - e[1]) < 1.5:
        return [s, e]
    # 同 V 分支：高块 ↔ 矮块时把折线拉平到矮块中心高度
    if covers(b, s[1]):
        e = (e[0], s[1])
    if covers(a, e[1]):
        s = (s[0], e[1])
    if abs(s[1] - e[1]) < 1.5:
        return [s, e]
    mid = (s[0] + e[0]) / 2
    return [s, (mid, s[1]), (mid, e[1]), e]


def rounded_polyline(pts, r=12):
    if len(pts) < 3:
        return "M %s %s L %s %s" % (_f(pts[0][0]), _f(pts[0][1]), _f(pts[-1][0]), _f(pts[-1][1]))
    d = ["M %s %s" % (_f(pts[0][0]), _f(pts[0][1]))]
    cur = pts[0]
    for i in range(1, len(pts) - 1):
        p, nxt = pts[i], pts[i + 1]
        v1 = (p[0] - cur[0], p[1] - cur[1])
        v2 = (nxt[0] - p[0], nxt[1] - p[1])
        l1 = math.hypot(*v1) or 1.0
        l2 = math.hypot(*v2) or 1.0
        rr = min(r, l1 / 2, l2 / 2)
        a = (p[0] - v1[0] / l1 * rr, p[1] - v1[1] / l1 * rr)
        bpt = (p[0] + v2[0] / l2 * rr, p[1] + v2[1] / l2 * rr)
        d.append("L %s %s Q %s %s %s %s" % (_f(a[0]), _f(a[1]), _f(p[0]), _f(p[1]), _f(bpt[0]), _f(bpt[1])))
        cur = bpt
    d.append("L %s %s" % (_f(pts[-1][0]), _f(pts[-1][1])))
    return " ".join(d)


def label_anchor(pts):
    """边标签落点：折线取中间那段的中心，直线取中点。"""
    n = len(pts)
    if n == 2:
        return (pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2
    if n == 4:
        return (pts[1][0] + pts[2][0]) / 2, (pts[1][1] + pts[2][1]) / 2
    i = n // 2
    return (pts[i][0] + pts[i - 1][0]) / 2, (pts[i][1] + pts[i - 1][1]) / 2


# ── 对外：渲染 ──────────────────────────────────────────────────────────────
def render_svg(spec):
    """声明式描述 → SVG 字符串。"""
    W, H = spec["w"], spec["h"]
    nodes = spec.get("nodes", []) + spec.get("notes", [])
    groups = spec.get("groups", [])
    edges = spec.get("edges", [])
    by_id = {n["id"]: n for n in nodes if n.get("id")}

    bg = spec.get("bg", BG)
    out = [
        '<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" viewBox="0 0 %d %d">' % (W, H, W, H),
    ]

    # 箭头 marker（按颜色分档）
    colors = []
    for e in edges:
        _, s, _ = pal(e, "slate")
        if s not in colors:
            colors.append(s)
    # 箭头 marker 与网格 pattern 合并进**同一个** <defs>：
    # 早先用 out.insert(2, "<defs>…") 单独插网格，会插进箭头 defs 内部形成
    # `<defs><defs>` 嵌套（XML 合法但脏，且部分 SVG 渲染器/校验器会报错）。
    defs_parts = []
    for i, c in enumerate(colors):
        defs_parts.append(
            '<marker id="ar%d" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" '
            'orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="%s"/></marker>' % (i, c))
    if spec.get("grid", True):
        defs_parts.append(
            '<pattern id="hkgrid" width="20" height="20" patternUnits="userSpaceOnUse">'
            '<path d="M 20 0 L 0 0 0 20" fill="none" stroke="%s" stroke-width="1"/></pattern>' % GRID)
    out.append("<defs>%s</defs>" % "".join(defs_parts))
    out.append('<rect width="%d" height="%d" fill="%s"/>' % (W, H, bg))
    if spec.get("grid", True):
        out.append(
            '<rect width="%d" height="%d" fill="url(#hkgrid)"/>' % (W, H))

    for g in groups:
        out.append(shape_body(dict(g, shape=g.get("shape", "round"), sw=g.get("sw", 1.2))))
        if g.get("t"):
            gg = dict(g, fs=g.get("fs", 13), bold=True, shape="round")
            gg["y"] = g["y"] + 4
            gg["h"] = 26
            out.append(text_svg(gg))

    for n in nodes:
        out.append(shape_body(n))
    for n in nodes:
        t = text_svg(n)
        if t:
            out.append(t)

    for e in edges:
        a, b = by_id.get(e["f"]), by_id.get(e["t"])
        if not a or not b:
            continue
        pts = route(a, b, e.get("dir"))
        _, stroke, _ = pal(e, "slate")
        mi = colors.index(stroke)
        dash = ' stroke-dasharray="7 5"' if e.get("dash") else ""
        out.append(
            '<path d="%s" fill="none" stroke="%s" stroke-width="%s"%s marker-end="url(#ar%d)"/>'
            % (rounded_polyline(pts), stroke, _f(e.get("sw", 1.6)), dash, mi))
        if e.get("label"):
            lx, ly = label_anchor(pts)
            fs = e.get("fs", 12)
            txt = str(e["label"])
            tw = text_width(txt, fs) + 10
            out.append(
                '<rect x="%s" y="%s" width="%s" height="%s" rx="3" fill="%s"/>' % (
                    _f(lx - tw / 2), _f(ly - fs * 0.85), _f(tw), _f(fs * 1.7), bg))
            out.append(
                '<text x="%s" y="%s" font-family="%s" font-size="%s" fill="%s" text-anchor="middle">%s</text>'
                % (_f(lx), _f(ly + fs * 0.35), FONT, _f(fs), stroke, escape(txt)))
    out.append("</svg>")
    return "".join(out)


def render_xml(spec):
    """声明式描述 → draw.io mxfile XML 字符串。"""
    W, H = spec["w"], spec["h"]
    nodes = spec.get("nodes", []) + spec.get("notes", [])
    groups = spec.get("groups", [])
    edges = spec.get("edges", [])
    name = spec.get("title") or spec.get("name") or "图表"

    lines = [
        '<mxfile host="haiku-wiki" type="device">',
        '<diagram id="hk-drawing-1" name="%s">' % escape(name),
        '<mxGraphModel dx="1200" dy="800" grid="1" gridSize="10" guides="1" tooltips="1" '
        'connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="%d" pageHeight="%d" '
        'math="0" shadow="0">' % (W, H),
        "<root>",
        '<mxCell id="0"/>',
        '<mxCell id="1" parent="0"/>',
    ]
    seq = [0]

    def nid(prefix):
        seq[0] += 1
        return "%s%d" % (prefix, seq[0])

    for g in groups:
        fill, stroke, color = pal(g, "gray")
        style = ("rounded=1;arcSize=8;whiteSpace=wrap;html=1;dashed=%d;fillColor=%s;strokeColor=%s;"
                 "fontColor=%s;fontSize=%d;fontStyle=1;align=left;verticalAlign=top;spacingLeft=12;spacingTop=6;"
                 % (1 if g.get("dash", True) else 0, fill, stroke, color, g.get("fs", 13)))
        lines.append(
            '<mxCell id="%s" value="%s" style="%s" vertex="1" parent="1">'
            '<mxGeometry x="%d" y="%d" width="%d" height="%d" as="geometry"/></mxCell>'
            % (nid("g"), escape(g.get("t", "")), style, g["x"], g["y"], g["w"], g["h"]))

    xml_id = {}
    for n in nodes:
        fill, stroke, color = pal(n)
        fs = n.get("fs", 13)
        style = SHAPE_STYLE.get(n.get("shape", "rect"), SHAPE_STYLE["rect"])
        style += "fillColor=%s;strokeColor=%s;fontColor=%s;fontSize=%d;" % (fill, stroke, color, fs)
        if n.get("bold"):
            style += "fontStyle=1;"
        if n.get("dash"):
            style += "dashed=1;"
        cid = nid("n")
        xml_id[n.get("id")] = cid
        lines.append(
            '<mxCell id="%s" value="%s" style="%s" vertex="1" parent="1">'
            '<mxGeometry x="%d" y="%d" width="%d" height="%d" as="geometry"/></mxCell>'
            % (cid, escape(n.get("t", "")), style, n["x"], n["y"], n["w"], n["h"]))

    for e in edges:
        a, b = xml_id.get(e["f"]), xml_id.get(e["t"])
        if not a or not b:
            continue
        _, stroke, _ = pal(e, "slate")
        style = ("edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;endArrow=block;endFill=1;"
                 "strokeColor=%s;strokeWidth=%s;fontSize=%d;fontColor=%s;"
                 % (stroke, e.get("sw", 1.6), e.get("fs", 12), stroke))
        if e.get("dash"):
            style += "dashed=1;"
        lines.append(
            '<mxCell id="%s" value="%s" style="%s" edge="1" parent="1" source="%s" target="%s">'
            '<mxGeometry relative="1" as="geometry"/></mxCell>'
            % (nid("e"), escape(str(e.get("label", ""))), style, a, b))

    lines += ["</root>", "</mxGraphModel>", "</diagram>", "</mxfile>"]
    return "".join(lines)


def build(spec):
    """返回绘图文档正文 JSON 字符串：{"version":1,"xml":...,"svg":...}"""
    import json
    return json.dumps({"version": 1, "xml": render_xml(spec), "svg": render_svg(spec)},
                      ensure_ascii=False)


# 需要配平的元素（其余如 rect/path/line 都是自闭合，无需计数）
_SVG_PAIRED = ("svg", "defs", "g", "marker", "pattern", "text", "tspan")


def check_svg(svg):
    """SVG 结构体检，返回问题列表（空列表=通过）。

    只做廉价但有效的检查，不做完整 XML 解析：
    * 必须以 `<svg` 开头、`</svg>` 结尾（阅读页只渲染这段文本）；
    * `<defs>` 不得嵌套 —— 曾经用 `out.insert(2, "<defs>…")` 单独插网格 pattern，
      结果插进箭头 defs 内部形成 `<defs><defs>`（XML 合法但脏，部分渲染器会告警）；
    * 成对标签数量配平，防漏闭合。
    """
    issues = []
    s = svg.strip()
    if not s.startswith("<svg"):
        issues.append("svg 未以 <svg 开头")
    if not s.endswith("</svg>"):
        issues.append("svg 未以 </svg> 结尾")
    depth = 0
    for m in re.finditer(r"<(/?)defs\b", s):
        if m.group(1):
            depth -= 1
            if depth < 0:
                issues.append("svg 出现多余的 </defs>")
                depth = 0
        else:
            depth += 1
            if depth > 1:
                issues.append("svg 出现嵌套 <defs>（<defs><defs>）")
                depth = 1
    if depth != 0:
        issues.append("svg 的 <defs> 未闭合")
    for tag in _SVG_PAIRED:
        open_n = len(re.findall(r"<%s[\s>]" % tag, s))
        close_n = len(re.findall(r"</%s>" % tag, s))
        if open_n != close_n:
            issues.append("svg 标签 <%s> 配平失败：开 %d / 闭 %d" % (tag, open_n, close_n))
    return issues


# ── 静态校验 ────────────────────────────────────────────────────────────────
def _text_box(n):
    """节点内可用文本区域（宽, 高）——按形状收窄，近似 SVG 实际排版。"""
    w, h, shape = n["w"], n["h"], n.get("shape", "rect")
    if shape == "diamond":
        return w * 0.62, h * 0.62
    if shape == "ellipse":
        return w * 0.76, h * 0.72
    if shape == "hex":
        return w - 2 * min(w * 0.22, 28) - 8, h - 8
    if shape == "para":
        return w - 2 * min(w * 0.18, 26) - 8, h - 8
    if shape == "cylinder":
        return w - 16, h - 2 * min(h * 0.18, 16) - 8
    if shape == "note":
        return w - 24, h - 8
    return w - 16, h - 8


def _seg_hits_rect(p, q, box, pad=2.0):
    """线段 p→q 是否真的与矩形 box 相交（Liang–Barsky 裁剪，斜线不做包围盒误判）。"""
    xmin, ymin = box["x"] + pad, box["y"] + pad
    xmax, ymax = box["x"] + box["w"] - pad, box["y"] + box["h"] - pad
    dx, dy = q[0] - p[0], q[1] - p[1]
    u1, u2 = 0.0, 1.0
    for pi, qi in ((-dx, p[0] - xmin), (dx, xmax - p[0]), (-dy, p[1] - ymin), (dy, ymax - p[1])):
        if pi == 0:
            if qi < 0:
                return False
            continue
        r = qi / pi
        if pi < 0:
            if r > u2:
                return False
            u1 = max(u1, r)
        else:
            if r < u1:
                return False
            u2 = min(u2, r)
    return u1 <= u2


def check(spec):
    """返回问题列表（空列表=通过）：
    越界 / 重叠 / 组标题被顶 / 重复 id / 边端点缺失 / 文本溢出 / 连线穿框。"""
    issues = []
    W, H = spec["w"], spec["h"]
    nodes = spec.get("nodes", []) + spec.get("notes", [])
    groups = spec.get("groups", [])
    ids = set()
    for n in nodes:
        if n.get("id") in ids:
            issues.append("重复 id: %s" % n.get("id"))
        ids.add(n.get("id"))
        if n["x"] < 0 or n["y"] < 0 or n["x"] + n["w"] > W or n["y"] + n["h"] > H:
            issues.append("节点越界: %s (%s)" % (n.get("id") or n.get("t"), n.get("t")))
        label = n.get("t") or ""
        if label.strip():
            fs = n.get("fs", 13)
            aw, ah = _text_box(n)
            lines = wrap_text(label, fs, aw)
            need = len(lines) * fs * 1.4
            if need > ah + 1:
                issues.append("文本溢出: 「%s」（需 %d 行共 %.0fpx，可用 %.0fpx；建议加宽/加高或精简文案）"
                              % (label.split("\n")[0][:16], len(lines), need, ah))
    for i in range(len(nodes)):
        for j in range(i + 1, len(nodes)):
            a, b = nodes[i], nodes[j]
            ox = min(a["x"] + a["w"], b["x"] + b["w"]) - max(a["x"], b["x"])
            oy = min(a["y"] + a["h"], b["y"] + b["h"]) - max(a["y"], b["y"])
            if ox > 2 and oy > 2:
                issues.append("节点重叠: %s ↔ %s" % (a.get("t"), b.get("t")))
    for e in spec.get("edges", []):
        if e["f"] not in ids:
            issues.append("边的起点不存在: %s" % e["f"])
        if e["t"] not in ids:
            issues.append("边的终点不存在: %s" % e["t"])
    # 连线穿框：除自身起终点外，折线不应压在别的节点上
    by_id = {n["id"]: n for n in nodes if n.get("id")}
    for e in spec.get("edges", []):
        a, b = by_id.get(e["f"]), by_id.get(e["t"])
        if not a or not b or a is b:
            continue
        pts = route(a, b, e.get("dir"))
        for k in range(len(pts) - 1):
            for n in nodes:
                if n is a or n is b or not n.get("id"):
                    continue
                if _seg_hits_rect(pts[k], pts[k + 1], n):
                    issues.append("连线穿框: %s→%s 压到「%s」" % (e["f"], e["t"], (n.get("t") or "")[:14]))
    for g in groups:
        if g["x"] < 0 or g["y"] < 0 or g["x"] + g["w"] > W or g["y"] + g["h"] > H:
            issues.append("分组越界: %s" % g.get("t"))
        # 分组标题占顶部 26px，组内节点必须留够位置，否则标题压在节点上
        for n in nodes:
            inside = (g["x"] <= n["x"] and n["x"] + n["w"] <= g["x"] + g["w"]
                      and n["y"] >= g["y"] and n["y"] + n["h"] <= g["y"] + g["h"])
            if inside and n["y"] - g["y"] < 32:
                issues.append("节点「%s」顶到分组「%s」标题（距组顶 %d px，需 ≥32）"
                              % (n.get("t"), g.get("t"), n["y"] - g["y"]))
    return issues
