#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成内置「白板」（Excalidraw）文档模板 → server/internal/repository/templates/whiteboard.json。

约定（对齐 tools/templates/gen.py / polish.py 的既有铁律）：
  · 产物 JSON 为 {category, templates:[{name,title,doc_type,sort,content}]}；
  · content 是 excalidraw 场景 JSON（{elements, appState}）的 **JSON 字符串**，
    与前端 lib/whiteboardDoc.ts 的正文契约一致（elements 数组是解析特征）；
  · 幂等：重复运行整体重写同一文件；`--check` 只校验不写；
  · 正文禁止出现【】/____ 之类占位符，一律用真实示例内容填充。

模板必须用**相对布局参数**组织（本脚本用小型布局框架），避免坐标漂移；
绑定文字（bound text）由容器+文字两条元素构成，渲染时由编辑器重新排版，
存储的 x/y/width/height 只需给合理初值。
"""
import json
import random
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
OUT = REPO / "server" / "internal" / "repository" / "templates" / "whiteboard.json"

random.seed(20260922)  # 固定种子：产物可复现，diff 稳定

INK = "#1e1e1e"
GRAY = "#8a919f"
# Excalidraw 官方低饱和色板（背景色 → 配套描边）
PALETTE = {
    "blue": ("#a5d8ff", "#1971c2"),
    "green": ("#b2f2bb", "#2f9e44"),
    "yellow": ("#ffec99", "#f08c00"),
    "red": ("#ffc9c9", "#e03131"),
    "purple": ("#d0bfff", "#6741d9"),
    "pink": ("#ffdeeb", "#d6336c"),
    "cyan": ("#99e9f2", "#0c8599"),
    "orange": ("#ffd8a8", "#e8590c"),
}


def _sid(n):
    return f"el{n:04d}"


def _seed():
    return random.randint(1, 2**31 - 1)


def text_w(label, font):
    """估算文本宽度（CJK ≈ 1.0em，其余 ≈ 0.55em）"""
    w = 0
    for ch in label:
        w += font if ord(ch) > 0x2E80 else font * 0.55
    return w


class Scene:
    """一个白板模板 = 一组 excalidraw 元素。"""

    def __init__(self, bg="#ffffff"):
        self.els = []
        self.bg = bg
        self._n = 0

    # ---- 元素工厂 ----
    def _base(self, t, x, y, w, h, bg="transparent", stroke=INK, **kw):
        self._n += 1
        el = {
            "id": _sid(self._n),
            "type": t,
            "x": x, "y": y, "width": w, "height": h,
            "angle": 0,
            "strokeColor": stroke,
            "backgroundColor": bg,
            "fillStyle": kw.pop("fillStyle", "solid"),
            "strokeWidth": kw.pop("strokeWidth", 1),
            "strokeStyle": kw.pop("strokeStyle", "solid"),
            "roughness": 1,
            "opacity": kw.pop("opacity", 100),
            "groupIds": [],
            "frameId": None,
            "roundness": kw.pop("roundness", None),
            "seed": _seed(),
            "version": 1,
            "versionNonce": _seed(),
            "isDeleted": False,
            "boundElements": None,
            "updated": 1,
            "link": None,
            "locked": False,
        }
        for k, v in kw.items():
            el[k] = v
        self.els.append(el)
        return el

    def box(self, t, x, y, w, h, label=None, font=16, bg="transparent", stroke=INK,
            text_color=INK, talign="center", tvalign="middle", roundness=None, opacity=100,
            strokeWidth=1):
        """矩形/菱形/椭圆等形状，可带绑定文字。"""
        el = self._base(t, x, y, w, h, bg=bg, stroke=stroke, roundness=roundness,
                        opacity=opacity, strokeWidth=strokeWidth)
        if roundness is None and t in ("rectangle",):
            el["roundness"] = {"type": 3}
        elif roundness is None and t in ("ellipse", "arrow", "line"):
            el["roundness"] = {"type": 2}
        if label is not None:
            tid = _sid(self._n + 1)
            el["boundElements"] = [{"id": tid, "type": "text"}]
            tw = min(text_w(label, font), w - 8)
            lines = label.count("\n") + 1
            th = lines * font * 1.25
            tx = x + w / 2 - tw / 2
            ty = y + h / 2 - th / 2
            if tvalign == "top":
                ty = y + 6
            self._text(label, tx, ty, tw, th, font, container=el["id"],
                       text_color=text_color, talign=talign)
        return el

    def note(self, x, y, w, h, label, color="yellow", font=16, rotate=0):
        bg, stroke = PALETTE[color]
        el = self.box("rectangle", x, y, w, h, bg=bg, stroke=stroke, roundness={"type": 3})
        el["angle"] = rotate * 3.14159265 / 180
        tw = min(text_w(label, font), w - 12)
        lines = label.count("\n") + 1
        th = lines * font * 1.25
        self._text(label, x + w / 2 - tw / 2, y + h / 2 - th / 2, tw, th, font,
                   container=el["id"], text_color=INK)
        return el

    def text(self, x, y, label, font=16, color=INK, align="left", bold=False):
        tw = text_w(label, font)
        lines = label.count("\n") + 1
        th = lines * font * 1.25
        return self._text(label, x, y, tw, th, font, container=None,
                          text_color=color, talign=align, bold=bold)

    def _text(self, label, x, y, w, h, font, container, text_color=INK, talign="center", bold=False):
        self._n += 1
        el = {
            "id": _sid(self._n),
            "type": "text",
            "x": x, "y": y, "width": w, "height": h,
            "angle": 0,
            "strokeColor": text_color,
            "backgroundColor": "transparent",
            "fillStyle": "solid",
            "strokeWidth": 2,
            "strokeStyle": "solid",
            "roughness": 1,
            "opacity": 100,
            "groupIds": [],
            "frameId": None,
            "roundness": None,
            "seed": _seed(),
            "version": 1,
            "versionNonce": _seed(),
            "isDeleted": False,
            "boundElements": None,
            "updated": 1,
            "link": None,
            "locked": False,
            "text": label,
            "fontSize": font,
            "fontFamily": 1,
            "textAlign": talign,
            "verticalAlign": "middle" if container else "top",
            "containerId": container,
            "originalText": label,
            "lineHeight": 1.25,
            "autoResize": True,
        }
        self.els.append(el)
        return el

    def arrow(self, x1, y1, x2, y2, color=INK, curve=0):
        pts = [[0, 0], [x2 - x1, y2 - y1]]
        if curve:
            pts.insert(1, [(x2 - x1) / 2, (y2 - y1) / 2 + curve])
        return self._base("arrow", x1, y1, abs(x2 - x1), abs(y2 - y1), stroke=color,
                          points=pts, lastCommittedPoint=None, startBinding=None,
                          endBinding=None, startArrowhead=None, endArrowhead="arrow",
                          roundness={"type": 2} if curve else None, elbowed=False)

    def line(self, x1, y1, x2, y2, color=INK):
        return self._base("line", x1, y1, abs(x2 - x1), abs(y2 - y1), stroke=color,
                          points=[[0, 0], [x2 - x1, y2 - y1]], lastCommittedPoint=None)

    def to_content(self):
        return json.dumps({
            "elements": self.els,
            "appState": {"viewBackgroundColor": self.bg, "gridSize": None},
            "files": {},
        }, ensure_ascii=False, separators=(",", ":"))


# ───────────────────────── 模板清单 ─────────────────────────

def t_flowchart():
    """基础流程图：开始 → 收集素材 → 草图评审 <是否通过> → 定稿 / 修改"""
    s = Scene()
    R = {"roundness": None}
    s.box("rectangle", 260, 20, 120, 44, "开始", bg=PALETTE["green"][0], stroke=PALETTE["green"][1])
    s.box("rectangle", 240, 110, 160, 44, "收集需求与素材", bg=PALETTE["blue"][0], stroke=PALETTE["blue"][1])
    s.box("rectangle", 240, 200, 160, 44, "绘制草图初稿", bg=PALETTE["blue"][0], stroke=PALETTE["blue"][1])
    d = s.box("diamond", 250, 290, 140, 80, "评审通过？", bg=PALETTE["yellow"][0], stroke=PALETTE["yellow"][1], font=14)
    s.box("rectangle", 470, 305, 140, 48, "修改细节", bg=PALETTE["red"][0], stroke=PALETTE["red"][1])
    s.box("rectangle", 250, 420, 160, 44, "定稿交付", bg=PALETTE["green"][0], stroke=PALETTE["green"][1])
    s.arrow(320, 64, 320, 110)
    s.arrow(320, 154, 320, 200)
    s.arrow(320, 244, 320, 290)
    s.arrow(390, 330, 470, 330)
    s.text(400, 306, "否", font=14, color=PALETTE["red"][1])
    s.arrow(540, 305, 405, 240, curve=-40)
    s.arrow(320, 370, 320, 420)
    s.text(330, 386, "是", font=14, color=PALETTE["green"][1])
    return ("基础流程图", "产品设计流程图", s)


def t_orgchart():
    """组织架构图"""
    s = Scene()
    s.box("rectangle", 240, 24, 160, 48, "总经理", bg=PALETTE["purple"][0], stroke=PALETTE["purple"][1])
    heads = [("研发部", 60, "blue"), ("产品部", 230, "cyan"), ("市场部", 400, "orange")]
    for name, x, c in heads:
        bg, st = PALETTE[c]
        s.box("rectangle", x, 140, 120, 44, name, bg=bg, stroke=st)
        s.arrow(320, 72, x + 60, 140)
    subs = [("前端组", 60), ("后端组", 60), ("测试组", 60)]
    y = 240
    for i, (name, dx) in enumerate(subs):
        s.box("rectangle", 40 + i * 62, y, 80, 38, name, font=13, bg="#eeeeee", stroke=GRAY)
        s.arrow(120, 184, 80 + i * 62, y)
    for name, x in [("企划", 250), ("增长", 330)]:
        s.box("rectangle", x, 240, 80, 38, name, font=13, bg="#eeeeee", stroke=GRAY)
        s.arrow(290, 184, x + 40, 240)
    for name, x in [("品牌", 420), ("渠道", 490)]:
        s.box("rectangle", x, 240, 80, 38, name, font=13, bg="#eeeeee", stroke=GRAY)
        s.arrow(460, 184, x + 40, 240)
    return ("组织架构图", "部门组织架构图", s)


def t_mindmap():
    """思维风暴图：中心主题 + 六个分支"""
    s = Scene()
    cx, cy = 300, 220
    s.box("ellipse", cx - 90, cy - 40, 180, 80, "新品发布\n规划", bg=PALETTE["purple"][0], stroke=PALETTE["purple"][1], font=18)
    branches = [
        ("目标人群", 60, 60, "blue"), ("定价策略", 420, 60, "green"),
        ("渠道投放", 520, 220, "orange"), ("内容传播", 420, 380, "red"),
        ("活动策划", 60, 380, "cyan"), ("预算分配", -40, 220, "yellow"),
    ]
    for name, x, y, c in branches:
        bg, st = PALETTE[c]
        s.box("rectangle", x, y, 120, 48, name, bg=bg, stroke=st, font=15)
        s.arrow(cx, cy, x + 60, y + 24, color=GRAY, curve=18)
    return ("头脑风暴思维图", "新品发布规划脑暴", s)


def t_kanban():
    """看板：待办 / 进行中 / 已完成"""
    s = Scene()
    cols = [("待办", 40, "yellow", ["梳理需求清单", "绘制页面线框", "准备评审材料"]),
            ("进行中", 240, "blue", ["登录页改版", "接口联调"]),
            ("已完成", 440, "green", ["项目立项", "技术选型", "域名备案"])]
    for name, x, c, cards in cols:
        bg, st = PALETTE[c]
        s.box("rectangle", x, 40, 160, 40, name, bg=bg, stroke=st)
        for i, card in enumerate(cards):
            s.box("rectangle", x + 10, 100 + i * 56, 140, 44, card, font=13, bg="#ffffff", stroke=GRAY)
    return ("看板任务板", "项目任务看板", s)


def t_swot():
    """SWOT 分析四象限"""
    s = Scene()
    quads = [("S 优势", "自研供应链\n成本更低", 40, 60, "blue"),
             ("W 劣势", "品牌知名度\n尚在起步", 280, 60, "red"),
             ("O 机会", "下沉市场\n需求增长", 40, 260, "green"),
             ("T 威胁", "头部品牌\n价格战", 280, 260, "orange")]
    for title, body, x, y, c in quads:
        bg, st = PALETTE[c]
        s.box("rectangle", x, y, 220, 180, None, bg=bg, stroke=st)
        s.text(x + 12, y + 12, title, font=20, color=st, bold=True)
        s.text(x + 12, y + 52, body, font=14, color=INK)
    s.text(40, 20, "SWOT 分析", font=24, bold=True)
    return ("SWOT 分析", "SWOT 态势分析", s)


def t_timeline():
    """项目时间线"""
    s = Scene()
    s.line(40, 200, 580, 200, color=GRAY)
    milestones = [("立项", 80, "blue", "9月第1周"), ("原型", 190, "cyan", "9月第3周"),
                  ("开发", 300, "orange", "10月"), ("测试", 410, "yellow", "11月"),
                  ("上线", 520, "green", "12月")]
    for name, x, c, when in milestones:
        bg, st = PALETTE[c]
        s.box("ellipse", x - 12, 188, 24, 24, None, bg=bg, stroke=st)
        s.box("rectangle", x - 45, 110, 90, 40, name, bg=bg, stroke=st, font=14)
        s.line(x, 150, x, 188, color=GRAY)
        s.text(x - 40, 230, when, font=13, color=GRAY)
    s.text(40, 50, "项目里程碑", font=24, bold=True)
    return ("项目时间线", "全年项目里程碑", s)


def t_journey():
    """用户旅程图"""
    s = Scene()
    stages = ["认知", "了解", "购买", "使用", "推荐"]
    x0 = 40
    for i, name in enumerate(stages):
        x = x0 + i * 108
        s.box("rectangle", x, 90, 90, 40, name, bg=PALETTE["blue"][0], stroke=PALETTE["blue"][1], font=15)
        if i:
            s.arrow(x - 18, 110, x, 110, color=GRAY)
    acts = ["刷到短视频", "进店比价", "下单支付", "开箱使用", "晒单分享"]
    for i, a in enumerate(acts):
        s.text(x0 + i * 108 + 6, 150, a, font=12, color=GRAY)
    # 情绪曲线（手绘折线）
    pts = [[0, 0], [100, -30], [210, 10], [320, -50], [430, -20]]
    s._base("line", x0, 280, 440, 60, stroke=PALETTE["pink"][1],
            points=pts, lastCommittedPoint=None, roundness=None)
    s.text(40, 240, "用户情绪曲线", font=16, color=GRAY)
    s.text(40, 40, "用户购买旅程", font=24, bold=True)
    return ("用户旅程图", "用户购买旅程地图", s)


def t_bmc():
    """商业模式画布（九宫格）"""
    s = Scene()
    x, y, w, h = 40, 60, 520, 320
    s.box("rectangle", x, y, w, h, None, bg="#ffffff", stroke=INK)
    col = w / 5
    s.box("rectangle", x + col, y, col, h / 2, None, bg=None, stroke=GRAY)
    s.box("rectangle", x + col, y + h / 2, col, h / 2, None, bg=None, stroke=GRAY)
    blocks = [("重要伙伴", 0, 0, 1, "purple"), ("关键业务", 1, 0, 1, "blue"),
              ("核心资源", 1, 1, 1, "cyan"), ("价值主张", 2, 0, 1, "green"),
              ("客户关系", 3, 0, 1, "orange"), ("渠道通路", 3, 1, 1, "yellow"),
              ("客户细分", 4, 0, 1, "red"), ("成本结构", 0, 2, 2.5, "pink"),
              ("收入来源", 2.5, 2, 2.5, "blue")]
    for name, cx, cy, cwid, c in blocks:
        bg, st = PALETTE[c]
        bx = x + cx * col
        by = y + cy * (h / 2)
        bwid = cwid * col
        bh = (h / 2 if cy < 2 else h / 2)
        s.box("rectangle", bx + 2, by + 2, bwid - 4, bh - 4, None, bg=bg, stroke=st)
        s.text(bx + 10, by + 10, name, font=15, color=st, bold=True)
    s.text(40, 24, "商业模式画布", font=22, bold=True)
    return ("商业模式画布", "商业模式画布九宫格", s)


def t_arch():
    """系统架构草图"""
    s = Scene()
    s.box("rectangle", 40, 60, 120, 48, "Web 前端", bg=PALETTE["blue"][0], stroke=PALETTE["blue"][1], font=14)
    s.box("rectangle", 40, 150, 120, 48, "小程序端", bg=PALETTE["blue"][0], stroke=PALETTE["blue"][1], font=14)
    s.box("rectangle", 250, 100, 130, 52, "API 网关", bg=PALETTE["purple"][0], stroke=PALETTE["purple"][1], font=14)
    s.box("rectangle", 450, 40, 130, 44, "订单服务", bg=PALETTE["green"][0], stroke=PALETTE["green"][1], font=14)
    s.box("rectangle", 450, 110, 130, 44, "库存服务", bg=PALETTE["green"][0], stroke=PALETTE["green"][1], font=14)
    s.box("rectangle", 450, 180, 130, 44, "用户服务", bg=PALETTE["green"][0], stroke=PALETTE["green"][1], font=14)
    s.box("rectangle", 250, 260, 130, 44, "MySQL", bg=PALETTE["yellow"][0], stroke=PALETTE["yellow"][1], font=14)
    s.box("rectangle", 450, 260, 130, 44, "Redis 缓存", bg=PALETTE["red"][0], stroke=PALETTE["red"][1], font=14)
    s.arrow(160, 84, 250, 118)
    s.arrow(160, 174, 250, 138)
    s.arrow(380, 120, 450, 62)
    s.arrow(380, 128, 450, 132)
    s.arrow(380, 136, 450, 202)
    s.line(315, 152, 315, 260, color=GRAY)
    s.arrow(380, 282, 450, 282, color=GRAY)
    s.text(40, 20, "系统架构草图", font=22, bold=True)
    return ("系统架构草图", "核心系统架构草图", s)


def t_er():
    """数据库 ER 草图"""
    s = Scene()
    def entity(x, y, name, fields, c):
        bg, st = PALETTE[c]
        s.box("rectangle", x, y, 150, 34 + 20 * len(fields), None, bg="#ffffff", stroke=st)
        s.box("rectangle", x, y, 150, 34, name, bg=bg, stroke=st, font=14)
        for i, f in enumerate(fields):
            s.text(x + 10, y + 40 + i * 20, f, font=12, color=INK)
    entity(40, 80, "用户 users", ["id: bigint", "name: varchar", "phone: varchar"], "blue")
    entity(380, 60, "订单 orders", ["id: bigint", "user_id: bigint", "amount: decimal", "status: tinyint"], "green")
    entity(210, 280, "订单明细 order_items", ["id: bigint", "order_id: bigint", "sku_id: bigint", "qty: int"], "orange")
    entity(40, 420, "商品 sku", ["id: bigint", "title: varchar", "price: decimal"], "purple")
    s.line(190, 130, 380, 130, color=GRAY)
    s.text(240, 108, "1 : N", font=13, color=GRAY)
    s.line(455, 148, 360, 280, color=GRAY)
    s.line(300, 360, 150, 420, color=GRAY)
    s.text(40, 40, "数据库 ER 草图", font=22, bold=True)
    return ("数据库 ER 草图", "电商核心库 ER 草图", s)


def t_network():
    """网络拓扑图"""
    s = Scene()
    s.box("ellipse", 260, 30, 120, 50, "互联网", bg=PALETTE["cyan"][0], stroke=PALETTE["cyan"][1], font=15)
    s.box("rectangle", 270, 140, 100, 40, "路由器", bg=PALETTE["blue"][0], stroke=PALETTE["blue"][1], font=14)
    s.box("rectangle", 270, 240, 100, 40, "核心交换机", bg=PALETTE["purple"][0], stroke=PALETTE["purple"][1], font=12)
    for i, (name, c) in enumerate([("Web 服务器", "green"), ("DB 服务器", "orange"), ("备份机", "red")]):
        bg, st = PALETTE[c]
        s.box("rectangle", 90 + i * 150, 350, 130, 44, name, bg=bg, stroke=st, font=13)
        s.arrow(320, 280, 155 + i * 150, 350, color=GRAY)
    s.arrow(320, 80, 320, 140)
    s.arrow(320, 180, 320, 240)
    return ("网络拓扑图", "机房网络拓扑", s)


def t_wireframe():
    """产品线框图"""
    s = Scene()
    s.box("rectangle", 60, 40, 480, 48, None, bg="#f5f5f5", stroke=GRAY)
    s.text(76, 54, "LOGO", font=16, color=GRAY, bold=True)
    for i in range(3):
        s.box("rectangle", 300 + i * 80, 52, 60, 24, None, bg="#e8e8e8", stroke=None)
    s.box("rectangle", 60, 110, 480, 120, None, bg=PALETTE["blue"][0], stroke=PALETTE["blue"][1])
    s.text(220, 155, "首页 Banner", font=18, color=PALETTE["blue"][1])
    for i in range(3):
        x = 60 + i * 168
        s.box("rectangle", x, 250, 144, 110, None, bg="#ffffff", stroke=GRAY)
        s.box("rectangle", x + 10, 260, 124, 60, None, bg="#e8e8e8", stroke=None)
        s.text(x + 34, 328, "商品卡片", font=13, color=GRAY)
    s.box("rectangle", 60, 390, 480, 40, None, bg="#f5f5f5", stroke=GRAY)
    s.text(240, 400, "页脚 · 关于我们 / 联系方式", font=12, color=GRAY)
    s.text(60, 12, "商城首页线框图", font=20, bold=True)
    return ("产品线框图", "商城首页线框图", s)


def t_sticky():
    """头脑风暴便利贴"""
    s = Scene()
    notes = [("降低门槛", "blue", 60, 60, -2), ("提升复购", "green", 220, 50, 3),
             ("裂变玩法", "pink", 390, 65, -3), ("会员体系", "yellow", 70, 190, 2),
             ("积分商城", "purple", 235, 200, -2), ("直播带货", "cyan", 395, 190, 2),
             ("异业合作", "orange", 150, 320, -3), ("私域运营", "red", 320, 330, 2)]
    for label, c, x, y, r in notes:
        s.note(x, y, 130, 90, label, color=c, font=16, rotate=r)
    s.text(60, 20, "增长头脑风暴（每人 3 张便利贴）", font=20, bold=True)
    return ("头脑风暴便利贴", "增长策略头脑风暴", s)


def t_okr():
    """OKR 目标规划"""
    s = Scene()
    s.box("rectangle", 60, 60, 480, 56, "O：本季度把门店复购率提升 30%", bg=PALETTE["purple"][0],
          stroke=PALETTE["purple"][1], font=16)
    krs = [("KR1：上线会员积分体系（11 月底）", "blue"), ("KR2：私域社群覆盖 5000 用户（12 月中）", "green"),
           ("KR3：复购率从 18% 提升到 24%（季度末）", "orange")]
    for i, (label, c) in enumerate(krs):
        bg, st = PALETTE[c]
        y = 170 + i * 90
        s.box("rectangle", 80, y, 440, 44, label, bg=bg, stroke=st, font=13, talign="left")
        s.box("rectangle", 90, y + 50, 300, 10, None, bg="#e8e8e8", stroke=None)
        s.box("rectangle", 90, y + 50, 120, 10, None, bg=bg, stroke=None)
        s.arrow(300, 104, 300, 170 + i * 90, color=GRAY)
    s.text(60, 24, "Q4 OKR", font=24, bold=True)
    return ("OKR 目标规划", "季度 OKR 规划板", s)


def t_meeting():
    """会议白板"""
    s = Scene()
    s.text(40, 30, "周例会白板 · 9 月第 4 周", font=22, bold=True)
    s.text(40, 80, "本周进展", font=16, color=PALETTE["blue"][1], bold=True)
    for i, t in enumerate(["预订系统灰度 20% 门店", "评价分自动汇总上线", "客服知识库扩容"]):
        s.box("rectangle", 40, 112 + i * 52, 240, 40, t, font=13, bg=PALETTE["blue"][0], stroke=PALETTE["blue"][1], talign="left")
    s.text(330, 80, " blockers", font=16, color=PALETTE["red"][1], bold=True)
    for i, t in enumerate(["支付回调偶发超时", "门店排班数据延迟"]):
        s.box("rectangle", 330, 112 + i * 52, 230, 40, t, font=13, bg=PALETTE["red"][0], stroke=PALETTE["red"][1], talign="left")
    s.text(40, 290, "行动项（负责人 / 截止）", font=16, color=PALETTE["green"][1], bold=True)
    s.box("rectangle", 40, 322, 520, 36, "排查支付超时 —— 老王 / 周三前", font=13, bg="#ffffff", stroke=GRAY, talign="left")
    s.box("rectangle", 40, 366, 520, 36, "排班同步优化 —— 小林 / 下周一", font=13, bg="#ffffff", stroke=GRAY, talign="left")
    return ("会议白板", "周例会白板", s)


def t_retro():
    """敏捷复盘四象限"""
    s = Scene()
    quads = [("做得好 ✌", "灰度方案平稳\n客服响应及时", 40, 60, "green"),
             ("需要改进", "跨部门同步慢\n需求变更频繁", 300, 60, "red"),
             ("继续保持", "每日站会\n代码评审", 40, 270, "blue"),
             ("开始尝试", "自动化回归\n用户访谈", 300, 270, "yellow")]
    for title, body, x, y, c in quads:
        bg, st = PALETTE[c]
        s.box("rectangle", x, y, 240, 180, None, bg=bg, stroke=st)
        s.text(x + 14, y + 14, title, font=20, color=st, bold=True)
        s.text(x + 14, y + 58, body, font=14, color=INK)
    s.text(40, 24, "迭代复盘", font=24, bold=True)
    return ("迭代复盘白板", "敏捷迭代复盘", s)


def t_5w2h():
    """5W2H 分析"""
    s = Scene()
    cx, cy = 290, 210
    s.box("ellipse", cx - 80, cy - 42, 160, 84, "新品上市\n方案", bg=PALETTE["purple"][0], stroke=PALETTE["purple"][1], font=16)
    items = [("Why 为何", 60, 50, "blue"), ("What 何事", 300, 30, "green"), ("Who 何人", 470, 110, "orange"),
             ("When 何时", 500, 300, "red"), ("Where 何地", 320, 380, "cyan"),
             ("How 如何做", 110, 380, "yellow"), ("How much 成本", 10, 120, "pink")]
    for label, x, y, c in items:
        bg, st = PALETTE[c]
        s.box("rectangle", x, y, 120, 44, label, bg=bg, stroke=st, font=14)
        s.arrow(cx, cy, x + 60, y + 22, color=GRAY, curve=16)
    return ("5W2H 分析", "新品上市 5W2H", s)


def t_venn():
    """Venn 交集图"""
    s = Scene()
    s.box("ellipse", 100, 80, 200, 200, None, bg=PALETTE["blue"][0], stroke=PALETTE["blue"][1], opacity=60)
    s.box("ellipse", 220, 80, 200, 200, None, bg=PALETTE["yellow"][0], stroke=PALETTE["yellow"][1], opacity=60)
    s.box("ellipse", 160, 170, 200, 200, None, bg=PALETTE["pink"][0], stroke=PALETTE["pink"][1], opacity=60)
    s.text(150, 150, "用户想要", font=15, color=PALETTE["blue"][1])
    s.text(330, 150, "技术可行", font=15, color=PALETTE["yellow"][1])
    s.text(230, 330, "商业可持续", font=15, color=PALETTE["pink"][1])
    s.text(240, 210, "最佳\n落点", font=16, bold=True)
    s.text(40, 30, "三环验证法", font=24, bold=True)
    return ("三环交集图", "产品三环验证", s)


def t_fishbone():
    """鱼骨图（因果分析）"""
    s = Scene()
    s.arrow(80, 240, 560, 240)
    s.box("rectangle", 560, 210, 90, 60, "交付延期", bg=PALETTE["red"][0], stroke=PALETTE["red"][1], font=14)
    bones = [("人员", 150, "blue", ["新人多", "排班紧"]), ("流程", 300, "green", ["评审冗长", "返工多"]),
             ("工具", 150, "orange", ["环境不稳", "缺自动化"]), ("需求", 300, "purple", ["变更频繁", "优先级乱"])]
    for name, x, c, subs in bones:
        bg, st = PALETTE[c]
        up = name in ("人员", "流程")
        y1 = 240 if up else 240
        y2 = 120 if up else 360
        s.arrow(x, y2, x + 60, y1, color=st)
        s.box("rectangle", x - 30, y2 - 44 if up else y2, 90, 40, name, bg=bg, stroke=st, font=14)
        for i, sub in enumerate(subs):
            sy = y2 - 76 - i * 30 if up else y2 + 46 + i * 30
            s.line(x + 15 + i * 18, sy + 26, x + 40 + i * 18, sy, color=GRAY)
            s.text(x - 10 + i * 18, sy - 18 if up else sy + 4, sub, font=12, color=GRAY)
    s.text(60, 40, "鱼骨图 · 为什么交付延期", font=22, bold=True)
    return ("鱼骨因果图", "交付延期归因分析", s)


def t_proscons():
    """优劣对比表"""
    s = Scene()
    s.box("rectangle", 60, 60, 220, 300, None, bg=PALETTE["green"][0], stroke=PALETTE["green"][1])
    s.text(70, 74, "方案 A：自建团队", font=16, color=PALETTE["green"][1], bold=True)
    s.text(70, 110, "+ 完全可控\n+ 数据安全\n+ 长期成本低\n− 前期投入大\n− 招人周期长", font=14)
    s.box("rectangle", 340, 60, 220, 300, None, bg=PALETTE["orange"][0], stroke=PALETTE["orange"][1])
    s.text(350, 74, "方案 B：外包交付", font=16, color=PALETTE["orange"][1], bold=True)
    s.text(350, 110, "+ 启动快\n+ 人力弹性\n− 沟通成本高\n− 知识难沉淀\n− 长期成本高", font=14)
    s.text(60, 24, "技术方案对比", font=24, bold=True)
    s.text(60, 390, "结论：先外包跑通 MVP，半年内组建自建团队接手。", font=15, color=INK)
    return ("方案对比白板", "自建 vs 外包对比", s)


def t_sprint():
    """敏捷冲刺板"""
    s = Scene()
    s.text(40, 24, "Sprint 12 · 9/22 - 10/05", font=22, bold=True)
    cols = [("本冲刺目标", 40, "purple", ["预订链路全量", "评价体系 v2"]),
            ("进行中", 220, "blue", ["包厢状态机", "开台消息推送"]),
            ("待办池", 400, "yellow", ["发票抬头", "多门店报表"])]
    for name, x, c, cards in cols:
        bg, st = PALETTE[c]
        s.box("rectangle", x, 70, 160, 40, name, bg=bg, stroke=st, font=15)
        for i, card in enumerate(cards):
            s.box("rectangle", x + 10, 126 + i * 56, 140, 44, card, font=13, bg="#ffffff", stroke=GRAY)
    return ("敏捷冲刺板", "双周冲刺看板", s)


def t_tree():
    """树状分类图"""
    s = Scene()
    s.box("rectangle", 260, 30, 140, 44, "门店运营", bg=PALETTE["purple"][0], stroke=PALETTE["purple"][1])
    children = [("预订", 60, "blue"), ("排队", 200, "cyan"), ("会员", 340, "green"), ("报表", 480, "orange")]
    for name, x, c in children:
        bg, st = PALETTE[c]
        s.box("rectangle", x, 150, 100, 40, name, bg=bg, stroke=st)
        s.arrow(330, 74, x + 50, 150)
    leafs = {"预订": 60, "排队": 200, "会员": 340, "报表": 480}
    leaves = [("包厢预订", 60), ("桌台预订", 60), ("取号", 200), ("叫号", 200),
              ("积分", 340), ("储值", 340), ("日报", 480), ("月报", 480)]
    for i, (name, x) in enumerate(leaves):
        y = 260 + (i % 2) * 54
        s.box("rectangle", x - 20, y, 100, 38, name, font=13, bg="#eeeeee", stroke=GRAY)
        s.arrow(x + 30, 190, x + 30, y, color=GRAY)
    return ("树状分类图", "门店运营功能树", s)


def t_floorplan():
    """门店平面草图"""
    s = Scene()
    s.box("rectangle", 60, 60, 500, 360, None, bg="#ffffff", stroke=INK, strokeWidth=2)
    s.text(70, 40, "门店平面草图（1F）", font=20, bold=True)
    zones = [("大堂散台 12 桌", 70, 70, 220, 150, "yellow"), ("包厢 A/B/C", 300, 70, 250, 150, "blue"),
             ("明档厨房", 70, 230, 220, 130, "orange"), ("收银 + 迎宾", 300, 230, 120, 60, "green"),
             ("等位区", 430, 230, 120, 60, "cyan"), ("洗手间", 430, 300, 120, 60, "gray")]
    for name, x, y, w, h, c in zones:
        if c == "gray":
            s.box("rectangle", x, y, w, h, name, font=13, bg="#e8e8e8", stroke=GRAY)
        else:
            bg, st = PALETTE[c]
            s.box("rectangle", x, y, w, h, name, font=14, bg=bg, stroke=st)
    s.text(66, 430, "↑ 入口在收银台一侧；动线：迎宾 → 等位 → 就座", font=13, color=GRAY)
    return ("门店平面草图", "海鲜火锅门店平面草图", s)


def t_competitor():
    """竞品对比矩阵"""
    s = Scene()
    headers = ["", "我们", "竞品 A", "竞品 B"]
    rows = [("价格", "¥¥", "¥¥¥", "¥"), ("口味", "★★★", "★★", "★★"), ("服务", "★★★", "★★★", "★"), ("选址", "核心商圈", "社区", "商场")]
    x0, y0, cw, rh = 120, 60, 120, 44
    for j, h in enumerate(headers):
        s.box("rectangle", x0 + j * cw, y0, cw, rh, h, font=14, bg=PALETTE["purple"][0] if j == 1 else "#f0f0f0",
              stroke=GRAY)
    for i, row in enumerate(rows):
        for j, cell in enumerate(row):
            s.box("rectangle", x0 + j * cw, y0 + (i + 1) * rh, cw, rh, cell, font=13,
                  bg="#fffbe6" if j == 1 else "#ffffff", stroke=GRAY)
    s.text(40, 24, "竞品对比矩阵", font=22, bold=True)
    return ("竞品对比矩阵", "核心商圈竞品对比", s)


def t_strategy():
    """增长漏斗"""
    s = Scene()
    widths = [400, 330, 260, 190, 120]
    labels = ["曝光 100 万", "进店 5 万", "下单 1.2 万", "复购 3000", "会员 1200"]
    colors = ["cyan", "blue", "green", "yellow", "orange"]
    y = 60
    for w, label, c in zip(widths, labels, colors):
        bg, st = PALETTE[c]
        x = 300 - w / 2
        s.box("rectangle", x, y, w, 52, label, bg=bg, stroke=st, font=15)
        y += 66
    s.text(40, 24, "月度增长漏斗", font=22, bold=True)
    s.text(40, 420, "关键假设：进店率 5%、下单率 24%、复购率 25%", font=13, color=GRAY)
    return ("增长漏斗", "月度增长漏斗", s)


TEMPLATES = [
    t_flowchart, t_orgchart, t_mindmap, t_kanban, t_swot, t_timeline,
    t_journey, t_bmc, t_arch, t_er, t_network, t_wireframe, t_sticky,
    t_okr, t_meeting, t_retro, t_5w2h, t_venn, t_fishbone, t_proscons,
    t_sprint, t_tree, t_floorplan, t_competitor, t_strategy,
]


def build():
    items = []
    for i, fn in enumerate(TEMPLATES):
        name, title, scene = fn()
        items.append({
            "name": name,
            "title": title,
            "doc_type": "whiteboard",
            "sort": (i + 1) * 10,
            "content": scene.to_content(),
        })
    return {"category": "白板模板", "templates": items}


def validate(data):
    names = set()
    for t in data["templates"]:
        key = (t["name"])
        if key in names:
            raise SystemExit(f"模板重名: {key}")
        names.add(key)
        c = json.loads(t["content"])
        if not c.get("elements"):
            raise SystemExit(f"模板 {key} 没有元素")
        text = json.dumps(c, ensure_ascii=False)
        for bad in ("【", "】", "____", "TODO", "XXX"):
            if bad in text:
                raise SystemExit(f"模板 {key} 含占位符 {bad}")
        n_types = {e["type"] for e in c["elements"]}
        if len(n_types) < 2:
            raise SystemExit(f"模板 {key} 元素种类过少: {n_types}")


def main():
    data = build()
    validate(data)
    payload = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    if "--check" in sys.argv:
        cur = OUT.read_text() if OUT.exists() else ""
        print(f"[gen-whiteboard] check: {len(data['templates'])} 模板；产物" + ("与现状一致" if cur == payload else "有变化（--check 不写入）"))
        sys.exit(0 if cur == payload else 1)
    OUT.write_text(payload)
    print(f"[gen-whiteboard] 写入 {OUT}（{len(data['templates'])} 个模板，{len(payload) // 1024} KB）")


if __name__ == "__main__":
    main()
