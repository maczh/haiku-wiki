#!/usr/bin/env python3
"""为演示视频准备真实的演示数据（全部走公开 API，不直接写库）。

产出：把新建的 book / doc id 写入 ids.json，供采集脚本定位页面。
"""
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, timedelta

BASE = os.environ["BASE"]
OUT = os.environ["OUT"]

opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def api(method, path, body=None, token=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    try:
        with opener.open(req, timeout=30) as r:
            payload = json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        detail = e.read().decode()
        # 注册限频：同 IP 60 秒一次。等到窗口过去再试一次。
        if e.code == 429 and "/api/auth/register" in path:
            print("  ⏳ 命中注册限频，等待 62 秒…", flush=True)
            time.sleep(62)
            return api(method, path, body, token)
        raise SystemExit(f"{method} {path} -> {e.code} {detail[:300]}")
    if payload.get("code") != 0:
        raise SystemExit(f"{method} {path} -> {payload}")
    return payload.get("data")



# ---------- 账号 ----------
user = api("POST", "/api/auth/register", {
    "username": "lihai", "name": "李海", "email": "lihai@jihai.local",
    "phone": "13800001234", "department": "研发中心", "password": "jihai2026",
})
TOKEN = user["token"]
ME = user["user"]

# ---------- 第二位成员（用于团队 / 协作场景） ----------
mate = api("POST", "/api/auth/register", {
    "username": "wangong", "name": "王工", "email": "wangong@jihai.local",
    "phone": "13800005678", "department": "研发中心", "password": "jihai2026",
})
MATE_TOKEN = mate["token"]
MATE_ME = mate["user"]

# ---------- 团队（创建后自动建团队文库） ----------
team = api("POST", "/api/teams", {"name": "寄海产品组", "description": "三期研发与设计协同"}, TOKEN)
api("POST", f"/api/teams/{team['id']}/members", {"identifier": MATE_ME["email"], "role": "member"}, TOKEN)

# ---------- 知识库 ----------
kb = api("POST", "/api/books", {
    "name": "产品研发中心", "description": "产品需求、架构设计与迭代计划",
    "cover_color": "#2f54eb", "visibility": "members",
}, TOKEN)
kb2 = api("POST", "/api/books", {
    "name": "市场运营资料", "description": "对外宣传与活动素材",
    "cover_color": "#13c2c2", "visibility": "public",
}, TOKEN)

TODAY = date.today()
d = lambda n: (TODAY + timedelta(days=n)).isoformat()

MARKDOWN = """# 寄海文库 · 产品需求文档

> 第三期核心需求：把团队的文档从「散落的附件」变成「可检索、可协作、可追溯」的企业知识资产。

## 一、建设目标

1. 统一收纳：所有资料进同一个书架，按知识库与目录树组织；
2. 多形态表达：需求用文档、排期用甘特图、流程用流程图、架构用思维导图；
3. 快速定位：标题与正文全文检索，按权限自动过滤；
4. 安全流转：对外分享用免登录链接，可设置阅读密码与有效期。

## 二、核心需求清单

| 需求 | 优先级 | 说明 |
| --- | --- | --- |
| 多级目录树 | P0 | 支持拖拽排序、置顶与跨知识库移动 |
| 九种文档类型 | P0 | 文档 / 表格 / 思维导图 / 流程图 / 绘图 / 待办 / 日历 / 甘特图 / 接口 |
| 版本快照 | P0 | 内容变化自动留档，保留最近 20 版可回滚 |
| 全文搜索 | P1 | 标题 + 正文，关键词高亮与上下文片段 |
| 对外分享 | P1 | 免登录链接，可设密码与过期时间 |
| 多格式导出 | P1 | 文档转 Word/PDF，表格转 Excel，整库打包下载 |

## 三、关键流程

用户在书架创建知识库 → 在知识库内新建文档并编辑，系统每 3 秒自动保存 → 通过搜索或首页「最近更新」快速回到文档 →
需要对外时右键生成分享链接，或导出为 Word / PDF 交付。

## 四、验收标准

- 新建文档到内容落库不超过 3 秒；
- 分享链接在未登录浏览器可直接打开；
- 整库导出后目录结构与附件完整。
"""

SHEET = {
    "version": 3,
    "sheets": [{
        "name": "功能清单", "index": 0, "order": 0, "status": 1, "row": 40, "column": 8,
        "celldata": [
            {"r": 0, "c": 0, "v": {"v": "模块", "m": "模块", "bl": 1, "bg": "#eef2ff", "fc": "#1d4ed8"}},
            {"r": 0, "c": 1, "v": {"v": "功能", "m": "功能", "bl": 1, "bg": "#eef2ff", "fc": "#1d4ed8"}},
            {"r": 0, "c": 2, "v": {"v": "优先级", "m": "优先级", "bl": 1, "bg": "#eef2ff", "fc": "#1d4ed8"}},
            {"r": 0, "c": 3, "v": {"v": "状态", "m": "状态", "bl": 1, "bg": "#eef2ff", "fc": "#1d4ed8"}},
            {"r": 0, "c": 4, "v": {"v": "负责人", "m": "负责人", "bl": 1, "bg": "#eef2ff", "fc": "#1d4ed8"}},
            {"r": 1, "c": 0, "v": {"v": "知识库", "m": "知识库"}}, {"r": 1, "c": 1, "v": {"v": "书架与目录树", "m": "书架与目录树"}},
            {"r": 1, "c": 2, "v": {"v": "P0", "m": "P0"}}, {"r": 1, "c": 3, "v": {"v": "已完成", "m": "已完成", "fc": "#13a86b"}},
            {"r": 1, "c": 4, "v": {"v": "李海", "m": "李海"}},
            {"r": 2, "c": 0, "v": {"v": "编辑器", "m": "编辑器"}}, {"r": 2, "c": 1, "v": {"v": "九种文档类型", "m": "九种文档类型"}},
            {"r": 2, "c": 2, "v": {"v": "P0", "m": "P0"}}, {"r": 2, "c": 3, "v": {"v": "已完成", "m": "已完成", "fc": "#13a86b"}},
            {"r": 2, "c": 4, "v": {"v": "王工", "m": "王工"}},
            {"r": 3, "c": 0, "v": {"v": "检索", "m": "检索"}}, {"r": 3, "c": 1, "v": {"v": "全文搜索", "m": "全文搜索"}},
            {"r": 3, "c": 2, "v": {"v": "P1", "m": "P1"}}, {"r": 3, "c": 3, "v": {"v": "已完成", "m": "已完成", "fc": "#13a86b"}},
            {"r": 3, "c": 4, "v": {"v": "李海", "m": "李海"}},
            {"r": 4, "c": 0, "v": {"v": "分享", "m": "分享"}}, {"r": 4, "c": 1, "v": {"v": "免登录分享链接", "m": "免登录分享链接"}},
            {"r": 4, "c": 2, "v": {"v": "P1", "m": "P1"}}, {"r": 4, "c": 3, "v": {"v": "进行中", "m": "进行中", "fc": "#d97706"}},
            {"r": 4, "c": 4, "v": {"v": "陈工", "m": "陈工"}},
            {"r": 5, "c": 0, "v": {"v": "导出", "m": "导出"}}, {"r": 5, "c": 1, "v": {"v": "多格式服务端导出", "m": "多格式服务端导出"}},
            {"r": 5, "c": 2, "v": {"v": "P1", "m": "P1"}}, {"r": 5, "c": 3, "v": {"v": "已完成", "m": "已完成", "fc": "#13a86b"}},
            {"r": 5, "c": 4, "v": {"v": "李海", "m": "李海"}},
            {"r": 6, "c": 0, "v": {"v": "部署", "m": "部署"}}, {"r": 6, "c": 1, "v": {"v": "单容器离线部署", "m": "单容器离线部署"}},
            {"r": 6, "c": 2, "v": {"v": "P1", "m": "P1"}}, {"r": 6, "c": 3, "v": {"v": "待开始", "m": "待开始", "fc": "#8a919f"}},
            {"r": 6, "c": 4, "v": {"v": "运维组", "m": "运维组"}},
        ],
        "config": {},
    }],
}

MINDMAP = {
    "version": 2,
    "layout": "logicalStructure",
    "root": {
        "data": {"text": "寄海文库", "expand": True},
        "children": [
            {"data": {"text": "前端", "expand": True}, "children": [
                {"data": {"text": "React 18 + TypeScript", "expand": True}, "children": []},
                {"data": {"text": "Vditor 富文本编辑", "expand": True}, "children": []},
                {"data": {"text": "按需加载分包", "expand": True}, "children": []},
            ]},
            {"data": {"text": "后端", "expand": True}, "children": [
                {"data": {"text": "Go + Gin 接口层", "expand": True}, "children": []},
                {"data": {"text": "GORM 数据层", "expand": True}, "children": []},
                {"data": {"text": "服务端导出转换", "expand": True}, "children": []},
            ]},
            {"data": {"text": "部署", "expand": True}, "children": [
                {"data": {"text": "多阶段 Docker 构建", "expand": True}, "children": []},
                {"data": {"text": "前端 embed 进二进制", "expand": True}, "children": []},
                {"data": {"text": "全离线无 CDN", "expand": True}, "children": []},
            ]},
        ],
    },
}

FLOWCHART = """graph TD
  A[用户打开寄海文库] --> B{是否已登录}
  B -- 否 --> C[登录 / 注册]
  B -- 是 --> D[首页 Dashboard]
  C --> D
  D --> E[选择知识库]
  E --> F[新建或打开文档]
  F --> G[编辑内容 · 自动保存]
  G --> H{是否需要交付}
  H -- 分享 --> I[生成免登录链接]
  H -- 导出 --> J[转 Word / PDF / Excel]
  H -- 否 --> K[继续编辑]
"""

GANTT = {
    "version": 1,
    "tasks": [
        {"id": 1, "text": "寄海文库三期", "start": d(-14), "duration": 70, "progress": 62,
         "type": "summary", "parent": 0, "priority": 8, "assignees": ["李海"], "details": "三期整体计划", "open": True},
        {"id": 2, "text": "需求与设计", "start": d(-14), "duration": 16, "progress": 100,
         "type": "summary", "parent": 1, "priority": 7, "assignees": ["李海"], "open": True},
        {"id": 3, "text": "需求评审", "start": d(-14), "duration": 6, "progress": 100, "type": "task",
         "parent": 2, "priority": 6, "assignees": ["李海", "王工"], "details": "输出 PRD 并通过评审"},
        {"id": 4, "text": "交互与视觉设计", "start": d(-8), "duration": 10, "progress": 100, "type": "task",
         "parent": 2, "priority": 5, "assignees": ["陈工"], "details": "首页与编辑器视觉稿"},
        {"id": 5, "text": "研发实现", "start": d(2), "duration": 36, "progress": 55,
         "type": "summary", "parent": 1, "priority": 9, "assignees": ["王工"], "open": True},
        {"id": 6, "text": "知识库与目录树", "start": d(2), "duration": 12, "progress": 100, "type": "task",
         "parent": 5, "priority": 8, "assignees": ["王工"], "details": "拖拽排序与跨库移动"},
        {"id": 7, "text": "九种文档类型", "start": d(6), "duration": 18, "progress": 70, "type": "task",
         "parent": 5, "priority": 9, "assignees": ["王工", "李海"], "details": "表格/导图/甘特/接口等"},
        {"id": 8, "text": "全文搜索与分享", "start": d(14), "duration": 14, "progress": 30, "type": "task",
         "parent": 5, "priority": 6, "assignees": ["陈工"], "details": "权限过滤与分享链接"},
        {"id": 9, "text": "测试与上线", "start": d(38), "duration": 18, "progress": 0,
         "type": "summary", "parent": 1, "priority": 7, "assignees": ["测试组"], "open": True},
        {"id": 10, "text": "集成测试", "start": d(38), "duration": 10, "progress": 0, "type": "task",
         "parent": 9, "priority": 6, "assignees": ["测试组"], "details": "全链路回归"},
        {"id": 11, "text": "灰度发布", "start": d(48), "duration": 8, "progress": 0, "type": "task",
         "parent": 9, "priority": 5, "assignees": ["运维组"], "details": "容器化部署与观察"},
    ],
    "links": [{"id": 1, "source": 4, "target": 6, "type": "e2s"}],
}

TODO = {
    "version": 1,
    "items": [
        {"id": "t1", "text": "完成三期需求评审并归档 PRD", "done": True, "due": d(-6), "priority": "high", "note": "已在知识库留存纪要"},
        {"id": "t2", "text": "补充甘特图文档的导出说明", "done": True, "due": d(-2), "priority": "medium", "note": ""},
        {"id": "t3", "text": "前端首页 Dashboard 改版自测", "done": False, "due": d(1), "priority": "high", "note": "重点验证关闭后不再弹出"},
        {"id": "t4", "text": "整理对外分享的使用规范", "done": False, "due": d(3), "priority": "medium", "note": "密码与有效期建议"},
        {"id": "t5", "text": "录制操作演示视频", "done": False, "due": d(5), "priority": "low", "note": "带语音讲解"},
    ],
}

CALENDAR = {
    "version": 1,
    "tasks": [
        {"title": "三期需求评审", "start": d(-6), "end": d(-6), "done": True, "cancelled": False, "note": "评审通过"},
        {"title": "首页改版联调", "start": d(1), "end": d(3), "done": False, "cancelled": False, "note": ""},
        {"title": "文档类型回归测试", "start": d(4), "end": d(6), "done": False, "cancelled": False, "note": "覆盖九种类型"},
        {"title": "版本发布窗口", "start": d(9), "end": d(9), "done": False, "cancelled": False, "note": "晚 20:00"},
    ],
}

DOCS = [
    ("产品需求文档", "markdown", MARKDOWN),
    ("功能清单", "sheet", json.dumps(SHEET, ensure_ascii=False)),
    ("系统架构", "mindmap", json.dumps(MINDMAP, ensure_ascii=False)),
    ("订单流程", "flowchart", FLOWCHART),
    ("迭代计划", "gantt", json.dumps(GANTT, ensure_ascii=False)),
    ("本周待办", "todo", json.dumps(TODO, ensure_ascii=False)),
    ("版本排期", "calendar", json.dumps(CALENDAR, ensure_ascii=False)),
]

ids = {"token": TOKEN, "me": ME, "mate_token": MATE_TOKEN, "mate": MATE_ME,
       "team": team, "books": {"dev": kb["id"], "mkt": kb2["id"]}, "docs": {}}
for title, dtype, content in DOCS:
    doc = api("POST", f"/api/books/{kb['id']}/docs",
              {"title": title, "doc_type": dtype, "content": content}, TOKEN)
    ids["docs"][dtype] = {"id": doc["id"], "title": title}

# 团队文库放一篇文档（演示「团队文库」这一类）
libs = api("GET", f"/api/teams/{team['id']}/books", None, TOKEN)
if libs:
    ids["books"]["team"] = libs[0]["id"]
    tdoc = api("POST", f"/api/books/{libs[0]['id']}/docs", {
        "title": "三期排期共识", "doc_type": "markdown",
        "content": "# 三期排期共识\n\n- 需求与设计：已完成\n- 研发实现：进行中\n- 测试与上线：待启动\n\n"
                   "本周同步会上确认：首页改版与操作视频一并在下个窗口发布。\n",
    }, TOKEN)
    ids["docs"]["team_md"] = {"id": tdoc["id"], "title": "三期排期共识"}

# 市场库放一篇公开文档，用于分享演示（公开库可免登录打开）
md2 = api("POST", f"/api/books/{kb2['id']}/docs", {
    "title": "寄海文库产品介绍", "doc_type": "markdown",
    "content": "# 寄海文库产品介绍\n\n寄海文库是面向企业的一体化知识库平台，"
               "支持九种文档类型、全文搜索、团队协作与免登录分享。\n\n"
               "## 核心卖点\n\n- 书架式知识库组织，资料不再散落\n- 九种文档类型覆盖日常全部表达场景\n"
               "- 全文搜索与最近更新，找文档只要几秒\n- 一键生成分享链接，外部协作零门槛\n",
}, TOKEN)
ids["docs"]["market_md"] = {"id": md2["id"], "title": "寄海文库产品介绍"}

# 「产品需求文档」加一位协作者（演示协作与首页「最近更新」里的协作文档）
api("POST", f"/api/docs/{ids['docs']['markdown']['id']}/collaborators",
    {"identifier": MATE_ME["email"]}, TOKEN)

# 给「产品需求文档」开启分享（演示分享面板）
share = api("PUT", f"/api/docs/{ids['docs']['markdown']['id']}/share", {"enabled": True}, TOKEN)
ids["share"] = share

with open(OUT, "w", encoding="utf-8") as f:
    json.dump(ids, f, ensure_ascii=False, indent=2)
print("SEED_OK", json.dumps({"books": ids["books"], "docs": {k: v["id"] for k, v in ids["docs"].items()}}, ensure_ascii=False))
