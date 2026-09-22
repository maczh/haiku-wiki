#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""批量铺绘图模板源文件（`_src/drawing/*.json`）。

为什么有这个东西
----------------
`_src/drawing/*.json` 是绘图模板的**唯一事实来源**（由 gen-drawing.py 消费）。
单个模板手工写 x/y 尚可，但成批铺量时纯手写极易出现越界与重叠，因此这里用
「版式助手 + 紧凑声明」的方式生成：**助手只负责算坐标**，内容仍是逐条写死的示例数据。

生成结果与手写 JSON 完全等价，后续微调可直接改 JSON（不会与本脚本冲突，脚本默认拒绝覆盖）。

用法
----
    python3 tools/templates/build-drawing-src.py --batch flow       # 002-014 业务流程
    python3 tools/templates/build-drawing-src.py --batch analysis   # 029-037 分析决策
    python3 tools/templates/build-drawing-src.py --batch structure  # 038-045 关系与结构
    python3 tools/templates/build-drawing-src.py --batch all --force
"""

import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
SRC_DIR = os.path.join(REPO, "server", "internal", "repository", "templates", "_src", "drawing")

# ── 版式常量 ────────────────────────────────────────────────────────────────
W = 1080                 # 业务流程类画布宽
MAIN_X, MAIN_W = 400, 240     # 主流程列
SIDE_X, SIDE_W = 720, 300     # 分支/异常列
ROW_PITCH = 100
STAGE_GAP = 12
NOTE_H = 44


def N(i, t, x, y, w=MAIN_W, h=54, **kw):
    d = {"id": i, "t": t, "x": x, "y": y, "w": w, "h": h}
    d.update(kw)
    return d


def G(t, x, y, w, h, palette="gray"):
    return {"t": t, "x": x, "y": y, "w": w, "h": h, "palette": palette}


def E(f, t, label=None, dir=None, **kw):
    d = {"f": f, "t": t}
    if label:
        d["label"] = label
    if dir:
        d["dir"] = dir
    d.update(kw)
    return d


def note(text, y, x=40, w=W - 80):
    return {"t": text, "x": x, "y": y, "w": w, "h": NOTE_H, "shape": "note", "palette": "gray"}


def vcol(items, x, y0, w=MAIN_W, h=54, gap=46, **style):
    out = []
    y = y0
    for it in items:
        i, t = it[0], it[1]
        extra = dict(style)
        if len(it) > 2:
            extra.update(it[2])
        out.append(N(i, t, x, y, w, h, **extra))
        y += h + gap
    return out


def hrow(items, x0, y, w=200, h=54, gap=50, **style):
    out = []
    x = x0
    for it in items:
        i, t = it[0], it[1]
        extra = dict(style)
        if len(it) > 2:
            extra.update(it[2])
        out.append(N(i, t, x, y, w, h, **extra))
        x += w + gap
    return out


def grid(rows, x0, y0, w, h, gx=20, gy=20, palettes=("blue",), style=None):
    """rows: [[(id, text), ...], ...] 按行铺满；palettes 可按行取色。"""
    out = []
    for ri, row in enumerate(rows):
        pal = palettes[ri % len(palettes)]
        for ci, (i, t) in enumerate(row):
            s = dict(style or {})
            s.setdefault("palette", pal)
            out.append(N(i, t, x0 + ci * (w + gx), y0 + ri * (h + gy), w, h, **s))
    return out


def tree(levels, y0, w=200, h=56, gap_x=50, pitch=110, palettes=("indigo", "purple", "cyan", "teal"),
         canvas_w=W, fs=None, shapes=None):
    """levels: [[(id, text), ...], ...] 每层水平居中。"""
    out = []
    for li, row in enumerate(levels):
        n = len(row)
        total = n * w + (n - 1) * gap_x
        x0 = (canvas_w - total) / 2
        for ci, (i, t) in enumerate(row):
            kw = {"palette": palettes[li % len(palettes)]}
            if fs:
                kw["fs"] = fs
            if shapes and shapes[li]:
                kw["shape"] = shapes[li]
            out.append(N(i, t, x0 + ci * (w + gap_x), y0 + li * pitch, w, h, **kw))
    return out


def mkflow(name, title, stages, labels=None, extra_edges=(), w=W, category="绘图模板·业务流程",
           note_text=None, y0=90):
    """业务流程成套版式：阶段色带 + 主流程列 + 分支/异常列，坐标全自动。

    stages: [{"t": 阶段名, "main": [{"id","t","shape"?,"palette"?}...],
              "side": [{"id","t","row","frm","label"?,"palette"?,"shape"?}...]}]
    """
    labels = labels or {}
    nodes, groups, edges = [], [], []
    Y = y0
    for si, st in enumerate(stages):
        main = st["main"]
        side = st.get("side", [])
        heights = [88 if m.get("shape") == "diamond" else 54 for m in main]
        g_h = (len(main) - 1) * ROW_PITCH + heights[-1] + 54
        groups.append(G(st["t"], 40, Y - 32, w - 80, g_h))
        for i, m in enumerate(main):
            nodes.append(N(m["id"], m["t"], MAIN_X, Y + i * ROW_PITCH, MAIN_W, heights[i],
                           shape=m.get("shape", "round"), palette=m.get("palette", "blue")))
        for s in side:
            r = s.get("row", len(main) - 1)
            nodes.append(N(s["id"], s["t"], SIDE_X, Y + r * ROW_PITCH, SIDE_W,
                           88 if s.get("shape") == "diamond" else 54,
                           shape=s.get("shape", "round"), palette=s.get("palette", "red")))
            if s.get("frm"):
                edges.append(E(s["frm"], s["id"], s.get("label")))
        for i in range(len(main) - 1):
            edges.append(E(main[i]["id"], main[i + 1]["id"], labels.get((main[i]["id"], main[i + 1]["id"]))))
        if si > 0:
            prev_last = stages[si - 1]["main"][-1]["id"]
            edges.append(E(prev_last, main[0]["id"], labels.get((prev_last, main[0]["id"]))))
        Y += g_h + STAGE_GAP
    edges.extend(extra_edges)
    spec = {
        "name": name, "title": title, "category": category, "w": w, "h": int(Y + NOTE_H + 30),
        "groups": groups, "nodes": nodes, "edges": edges,
        "notes": [note(note_text or "填写说明：本图为示例模板，节点、判断条件与时限请按实际业务调整。", Y)],
    }
    return spec


def mkplain(name, title, category, w, h, groups=(), nodes=(), edges=(), note_text=None, note_y=None):
    spec = {"name": name, "title": title, "category": category, "w": w, "h": h,
            "groups": list(groups), "nodes": list(nodes), "edges": list(edges)}
    ny = note_y if note_y is not None else h - NOTE_H - 24
    spec["notes"] = [note(note_text or "填写说明：本图为示例模板，条目与数值请按实际情况替换。", ny, w=w - 80)]
    return spec


# ═══════════════════════════════════════════════════════════════════════════
# 批次一：业务流程（002–014）
# ═══════════════════════════════════════════════════════════════════════════
def batch_flow():
    return [
        mkflow("电商下单支付流程", "电商下单支付流程图", [
            {"t": "阶段一 · 选购与校验",
             "main": [{"id": "m1", "t": "进入商城浏览商品", "shape": "pill", "palette": "green"},
                      {"id": "m2", "t": "加入购物车并提交结算"},
                      {"id": "m3", "t": "库存与限购校验通过?", "shape": "diamond", "palette": "amber"}],
             "side": [{"id": "x1", "t": "库存不足，提示改选或预约到货", "row": 2, "frm": "m3", "label": "不足", "palette": "red"}]},
            {"t": "阶段二 · 支付与订单生成",
             "main": [{"id": "m4", "t": "确认收货地址与发票信息"},
                      {"id": "m5", "t": "发起支付并调起收银台"},
                      {"id": "m6", "t": "支付是否成功?", "shape": "diamond", "palette": "amber"}],
             "side": [{"id": "x2", "t": "支付失败，订单保留 15 分钟后自动关单", "row": 2, "frm": "m6", "label": "失败", "palette": "red"}]},
            {"t": "阶段三 · 履约与通知",
             "main": [{"id": "m7", "t": "生成订单并锁定库存"},
                      {"id": "m8", "t": "推送仓储拣货与出库"},
                      {"id": "m9", "t": "下单完成，发送短信与企微通知", "shape": "pill", "palette": "green"}],
             "side": [{"id": "x3", "t": "用户主动取消，释放库存并原路退款", "row": 1, "frm": "m8", "label": "取消", "palette": "orange"}]},
        ], labels={("m3", "m4"): "库存充足", ("m6", "m7"): "成功"},
            note_text="填写说明：本图为示例模板，关单时限、限购规则与退款渠道请按实际规则调整。"),

        mkflow("员工请假审批流程", "员工请假审批流程图", [
            {"t": "阶段一 · 员工提交申请",
             "main": [{"id": "m1", "t": "员工在 OA 发起请假单", "shape": "pill", "palette": "green"},
                      {"id": "m2", "t": "选择假别与起止时间并上传证明"},
                      {"id": "m3", "t": "直属主管是否同意?", "shape": "diamond", "palette": "amber"}],
             "side": [{"id": "x1", "t": "驳回并附意见，退回申请人补充", "row": 2, "frm": "m3", "label": "驳回", "palette": "red"}]},
            {"t": "阶段二 · 人事复核",
             "main": [{"id": "m4", "t": "人事核对假期余额与工龄规则"},
                      {"id": "m5", "t": "是否连续超过 3 个工作日?", "shape": "diamond", "palette": "amber"}],
             "side": [{"id": "x2", "t": "部门负责人加签确认排班影响", "row": 1, "frm": "m5", "label": "是", "palette": "orange"}]},
            {"t": "阶段三 · 归档与同步",
             "main": [{"id": "m6", "t": "更新考勤台账与假期余额"},
                      {"id": "m7", "t": "请假单归档并抄送所在班组", "shape": "pill", "palette": "green"}],
             "side": [{"id": "x3", "t": "员工撤回申请，恢复已扣假期余额", "row": 1, "frm": "m6", "label": "撤回", "palette": "gray"}]},
        ], labels={("m3", "m4"): "同意", ("m5", "m6"): "否", },
            extra_edges=[E("x2", "m6", "加签通过")],
            note_text="填写说明：本图为示例模板，加签阈值、假别与证明要求请按公司考勤制度调整。"),

        mkflow("招聘面试与录用流程", "招聘面试与录用流程图", [
            {"t": "阶段一 · 简历筛选",
             "main": [{"id": "m1", "t": "用人部门发起岗位需求", "shape": "pill", "palette": "green"},
                      {"id": "m2", "t": "HR 筛选渠道简历并初筛"},
                      {"id": "m3", "t": "是否匹配岗位画像?", "shape": "diamond", "palette": "amber"}],
             "side": [{"id": "x1", "t": "进入人才库，标记为后续储备", "row": 2, "frm": "m3", "label": "不匹配", "palette": "gray"}]},
            {"t": "阶段二 · 面试评估",
             "main": [{"id": "m4", "t": "安排技术面与业务面"},
                      {"id": "m5", "t": "HR 面谈确认薪资与到岗时间"},
                      {"id": "m6", "t": "面试综合评级是否通过?", "shape": "diamond", "palette": "amber"}],
             "side": [{"id": "x2", "t": "发放感谢信，流程关闭", "row": 2, "frm": "m6", "label": "未通过", "palette": "red"}]},
            {"t": "阶段三 · 录用与入职",
             "main": [{"id": "m7", "t": "发起录用审批与背调"},
                      {"id": "m8", "t": "发放 offer 并跟踪接受情况"},
                      {"id": "m9", "t": "入职办理完成", "shape": "pill", "palette": "green"}],
             "side": [{"id": "x3", "t": "候选人拒绝 offer，重启候选人池", "row": 1, "frm": "m8", "label": "拒绝", "palette": "orange"}]},
        ], labels={("m3", "m4"): "匹配", ("m6", "m7"): "通过"},
            note_text="填写说明：本图为示例模板，面试轮次、评级标准与背调范围请按公司招聘制度调整。"),

        mkflow("采购申请到验收入库", "采购申请到验收入库流程图", [
            {"t": "阶段一 · 需求提出与审批",
             "main": [{"id": "m1", "t": "使用部门提交采购申请单", "shape": "pill", "palette": "green"},
                      {"id": "m2", "t": "核对预算科目与采购方式"},
                      {"id": "m3", "t": "金额是否超过 5 万元?", "shape": "diamond", "palette": "amber"}],
             "side": [{"id": "x1", "t": "总经理办公会审议后重新提报", "row": 2, "frm": "m3", "label": "超过", "palette": "orange"}]},
            {"t": "阶段二 · 寻源与签约",
             "main": [{"id": "m4", "t": "三家比价或公开招标"},
                      {"id": "m5", "t": "商务谈判并签订采购合同"},
                      {"id": "m6", "t": "合同是否通过法务复核?", "shape": "diamond", "palette": "amber"}],
             "side": [{"id": "x2", "t": "退回业务补充条款与验收标准", "row": 2, "frm": "m6", "label": "驳回", "palette": "red"}]},
            {"t": "阶段三 · 到货验收与结算",
             "main": [{"id": "m7", "t": "供应商发货，仓库到货点收"},
                      {"id": "m8", "t": "质检合格后办理入库"},
                      {"id": "m9", "t": "对账开票并付款", "shape": "pill", "palette": "green"}],
             "side": [{"id": "x3", "t": "不合格品拒收，启动退换货索赔", "row": 1, "frm": "m8", "label": "不合格", "palette": "red"}]},
        ], labels={("m3", "m4"): "未超过", ("m6", "m7"): "通过"},
            note_text="填写说明：本图为示例模板，招标金额门槛、比价家数与质检标准请按采购制度调整。"),

        mkflow("软件研发迭代流程", "软件研发迭代流程图", [
            {"t": "阶段一 · 需求与排期",
             "main": [{"id": "m1", "t": "产品经理编写需求文档", "shape": "pill", "palette": "green"},
                      {"id": "m2", "t": "需求评审会确认验收标准"},
                      {"id": "m3", "t": "需求是否进入本迭代?", "shape": "diamond", "palette": "amber"}],
             "side": [{"id": "x1", "t": "进入需求池，参与下轮排期", "row": 2, "frm": "m3", "label": "否", "palette": "gray"}]},
            {"t": "阶段二 · 开发与测试",
             "main": [{"id": "m4", "t": "拆解任务并估算工时"},
                      {"id": "m5", "t": "编码实现与代码评审"},
                      {"id": "m6", "t": "单元测试与联调是否通过?", "shape": "diamond", "palette": "amber"}],
             "side": [{"id": "x2", "t": "提缺陷单退回开发修复", "row": 2, "frm": "m6", "label": "不通过", "palette": "red"}]},
            {"t": "阶段三 · 发布与复盘",
             "main": [{"id": "m7", "t": "测试环境验收与回归"},
                      {"id": "m8", "t": "灰度发布并观察 24 小时"},
                      {"id": "m9", "t": "全量上线并输出迭代复盘", "shape": "pill", "palette": "green"}],
             "side": [{"id": "x3", "t": "监控异常超阈值，一键回滚", "row": 1, "frm": "m8", "label": "异常", "palette": "red"}]},
        ], labels={("m3", "m4"): "是", ("m6", "m7"): "通过"},
            note_text="填写说明：本图为示例模板，迭代周期、评审门禁与灰度观测时长请按团队规范调整。"),

        mkflow("CI/CD 持续交付流程", "CI/CD 持续交付流程图", [
            {"t": "阶段一 · 代码提交与构建",
             "main": [{"id": "m1", "t": "开发者推送特性分支", "shape": "pill", "palette": "green"},
                      {"id": "m2", "t": "触发流水线：拉取依赖并编译"},
                      {"id": "m3", "t": "静态检查与单元测试是否通过?", "shape": "diamond", "palette": "amber"}],
             "side": [{"id": "x1", "t": "流水线中断，通知提交人修复", "row": 2, "frm": "m3", "label": "失败", "palette": "red"}]},
            {"t": "阶段二 · 制品与预发验证",
             "main": [{"id": "m4", "t": "构建镜像并推送制品库"},
                      {"id": "m5", "t": "部署预发环境跑自动化用例"},
                      {"id": "m6", "t": "接口与核心链路用例是否全绿?", "shape": "diamond", "palette": "amber"}],
             "side": [{"id": "x2", "t": "生成质量报告并阻断发布", "row": 2, "frm": "m6", "label": "有失败", "palette": "red"}]},
            {"t": "阶段三 · 发布与回滚",
             "main": [{"id": "m7", "t": "合并主干并创建发布单"},
                      {"id": "m8", "t": "分批次滚动更新生产集群"},
                      {"id": "m9", "t": "发布完成并归档制品版本", "shape": "pill", "palette": "green"}],
             "side": [{"id": "x3", "t": "健康检查失败，自动回滚上一版本", "row": 1, "frm": "m8", "label": "不健康", "palette": "red"}]},
        ], labels={("m3", "m4"): "通过", ("m6", "m7"): "全绿"},
            note_text="填写说明：本图为示例模板，门禁规则、制品保留策略与回滚判定请按实际流水线调整。"),

        mkflow("客服工单流转与升级", "客服工单流转与升级流程图", [
            {"t": "阶段一 · 受理与分类",
             "main": [{"id": "m1", "t": "客户通过电话或在线渠道报障", "shape": "pill", "palette": "green"},
                      {"id": "m2", "t": "客服登记工单并判定问题类型"},
                      {"id": "m3", "t": "是否属于一线可自助解决?", "shape": "diamond", "palette": "amber"}],
             "side": [{"id": "x1", "t": "直接答复客户并结单", "row": 2, "frm": "m3", "label": "是", "palette": "teal"}]},
            {"t": "阶段二 · 处理与升级",
             "main": [{"id": "m4", "t": "派单至二线技术支持"},
                      {"id": "m5", "t": "排查定位并给出解决方案"},
                      {"id": "m6", "t": "是否在 4 小时内解决?", "shape": "diamond", "palette": "amber"}],
             "side": [{"id": "x2", "t": "升级至研发值班并抄送主管", "row": 2, "frm": "m6", "label": "超时", "palette": "orange"}]},
            {"t": "阶段三 · 回访与归档",
             "main": [{"id": "m7", "t": "与客户确认问题已解决"},
                      {"id": "m8", "t": "邀请客户评价服务满意度"},
                      {"id": "m9", "t": "工单归档并沉淀知识库", "shape": "pill", "palette": "green"}],
             "side": [{"id": "x3", "t": "客户不满意，重开工单并升级", "row": 1, "frm": "m8", "label": "不满意", "palette": "red"}]},
        ], labels={("m3", "m4"): "否", ("m6", "m7"): "已解决"},
            note_text="填写说明：本图为示例模板，自助范围、升级时限与满意度阈值请按客服 SLA 调整。"),

        mkflow("电商退款退货流程", "电商退款退货流程图", [
            {"t": "阶段一 · 申请与受理",
             "main": [{"id": "m1", "t": "买家在订单页提交退货申请", "shape": "pill", "palette": "green"},
                      {"id": "m2", "t": "系统校验是否在 7 天无理由期内"},
                      {"id": "m3", "t": "是否符合退货条件?", "shape": "diamond", "palette": "amber"}],
             "side": [{"id": "x1", "t": "驳回申请并说明不支持原因", "row": 2, "frm": "m3", "label": "不符合", "palette": "red"}]},
            {"t": "阶段二 · 寄回与质检",
             "main": [{"id": "m4", "t": "系统生成退货地址与运单"},
                      {"id": "m5", "t": "买家寄回并填写物流单号"},
                      {"id": "m6", "t": "仓库质检是否合格?", "shape": "diamond", "palette": "amber"}],
             "side": [{"id": "x2", "t": "质检不合格，原物退回并通知买家", "row": 2, "frm": "m6", "label": "不合格", "palette": "red"}]},
            {"t": "阶段三 · 退款与结算",
             "main": [{"id": "m7", "t": "生成退款单并回滚库存"},
                      {"id": "m8", "t": "原路退回支付渠道"},
                      {"id": "m9", "t": "退款到账并推送通知", "shape": "pill", "palette": "green"}],
             "side": [{"id": "x3", "t": "超 7 日未到账，人工核查支付通道", "row": 1, "frm": "m8", "label": "异常", "palette": "orange"}]},
        ], labels={("m3", "m4"): "符合", ("m6", "m7"): "合格"},
            note_text="填写说明：本图为示例模板，无理由期限、质检标准与到账时效请按平台规则调整。"),

        mkflow("生产制造工序流程", "生产制造工序流程图", [
            {"t": "阶段一 · 工单下达与备料",
             "main": [{"id": "m1", "t": "生产计划下达制造工单", "shape": "pill", "palette": "green"},
                      {"id": "m2", "t": "仓库按 BOM 齐套发料"},
                      {"id": "m3", "t": "物料齐套是否满足开工?", "shape": "diamond", "palette": "amber"}],
             "side": [{"id": "x1", "t": "缺料挂起，触发紧急采购补料", "row": 2, "frm": "m3", "label": "缺料", "palette": "orange"}]},
            {"t": "阶段二 · 加工与质检",
             "main": [{"id": "m4", "t": "首件加工并送检确认"},
                      {"id": "m5", "t": "批量加工，工序流转扫码报工"},
                      {"id": "m6", "t": "过程巡检是否合格?", "shape": "diamond", "palette": "amber"}],
             "side": [{"id": "x2", "t": "停线返工，追溯不良批次与设备", "row": 2, "frm": "m6", "label": "不合格", "palette": "red"}]},
            {"t": "阶段三 · 完工入库",
             "main": [{"id": "m7", "t": "完工检验并打印合格证"},
                      {"id": "m8", "t": "成品打包，赋码入库"},
                      {"id": "m9", "t": "报工结算，工单关闭", "shape": "pill", "palette": "green"}],
             "side": [{"id": "x3", "t": "报废处理并登记质量成本", "row": 1, "frm": "m8", "label": "报废", "palette": "red"}]},
        ], labels={("m3", "m4"): "齐套", ("m6", "m7"): "合格"},
            note_text="填写说明：本图为示例模板，齐套率标准、巡检频次与报废判定请按工厂品质标准调整。"),

        mkflow("仓储拣货出库流程", "仓储拣货出库流程图", [
            {"t": "阶段一 · 订单下发与波次",
             "main": [{"id": "m1", "t": "销售订单同步至 WMS", "shape": "pill", "palette": "green"},
                      {"id": "m2", "t": "按配送线路组波次并分配库位"},
                      {"id": "m3", "t": "波次库存是否需要补货?", "shape": "diamond", "palette": "amber"}],
             "side": [{"id": "x1", "t": "生成补货任务，拣货前补至拣选位", "row": 2, "frm": "m3", "label": "需要", "palette": "orange"}]},
            {"t": "阶段二 · 拣货与复核",
             "main": [{"id": "m4", "t": "拣货员按 PDA 指引拣取商品"},
                      {"id": "m5", "t": "复核台核对数量与效期"},
                      {"id": "m6", "t": "复核是否一致?", "shape": "diamond", "palette": "amber"}],
             "side": [{"id": "x2", "t": "差异登记并回库位重拣", "row": 2, "frm": "m6", "label": "不一致", "palette": "red"}]},
            {"t": "阶段三 · 打包与交接",
             "main": [{"id": "m7", "t": "按订单打包并贴面单"},
                      {"id": "m8", "t": "称重复核，生成出库单"},
                      {"id": "m9", "t": "与承运商交接，出库完成", "shape": "pill", "palette": "green"}],
             "side": [{"id": "x3", "t": "超重或异常件，转人工处理台", "row": 1, "frm": "m8", "label": "异常", "palette": "orange"}]},
        ], labels={("m3", "m4"): "不需要", ("m6", "m7"): "一致"},
            note_text="填写说明：本图为示例模板，波次规则、复核要素与交接单据请按仓库作业规范调整。"),

        mkflow("医院门诊就诊流程", "医院门诊就诊流程图", [
            {"t": "阶段一 · 挂号与分诊",
             "main": [{"id": "m1", "t": "患者线上预约或现场取号", "shape": "pill", "palette": "green"},
                      {"id": "m2", "t": "分诊台测量体征并分级"},
                      {"id": "m3", "t": "是否为急危重症?", "shape": "diamond", "palette": "amber"}],
             "side": [{"id": "x1", "t": "走绿色通道直送急诊抢救室", "row": 2, "frm": "m3", "label": "是", "palette": "red"}]},
            {"t": "阶段二 · 就诊与检查",
             "main": [{"id": "m4", "t": "候诊叫号，医生问诊开单"},
                      {"id": "m5", "t": "缴费后完成检验与影像检查"},
                      {"id": "m6", "t": "检查结果是否支持确诊?", "shape": "diamond", "palette": "amber"}],
             "side": [{"id": "x2", "t": "补充检查或转多学科会诊", "row": 2, "frm": "m6", "label": "否", "palette": "orange"}]},
            {"t": "阶段三 · 治疗与随访",
             "main": [{"id": "m7", "t": "开具处方并完成治疗处置"},
                      {"id": "m8", "t": "药房取药，交代用药与复诊"},
                      {"id": "m9", "t": "纳入随访计划，就诊结束", "shape": "pill", "palette": "green"}],
             "side": [{"id": "x3", "t": "需住院者转住院部办理入院", "row": 1, "frm": "m8", "label": "需住院", "palette": "purple"}]},
        ], labels={("m3", "m4"): "否", ("m6", "m7"): "是"},
            note_text="填写说明：本图为示例模板，分级标准、检查项目与随访周期请按医院诊疗规范调整。"),

        mkflow("保险理赔处理流程", "保险理赔处理流程图", [
            {"t": "阶段一 · 报案与立案",
             "main": [{"id": "m1", "t": "被保险人报案并提交材料", "shape": "pill", "palette": "green"},
                      {"id": "m2", "t": "客服核对保单责任与有效期"},
                      {"id": "m3", "t": "是否属于保险责任范围?", "shape": "diamond", "palette": "amber"}],
             "side": [{"id": "x1", "t": "出具拒赔通知并说明依据", "row": 2, "frm": "m3", "label": "不属于", "palette": "red"}]},
            {"t": "阶段二 · 查勘与定损",
             "main": [{"id": "m4", "t": "查勘员现场或线上查勘取证"},
                      {"id": "m5", "t": "核定损失金额并剔除免赔"},
                      {"id": "m6", "t": "定损金额是否超过 5 万元?", "shape": "diamond", "palette": "amber"}],
             "side": [{"id": "x2", "t": "提交上级核赔人复核审批", "row": 2, "frm": "m6", "label": "超过", "palette": "orange"}]},
            {"t": "阶段三 · 核赔与赔付",
             "main": [{"id": "m7", "t": "核赔通过，生成赔付方案"},
                      {"id": "m8", "t": "财务复核并制单付款"},
                      {"id": "m9", "t": "赔款到账，case 结案归档", "shape": "pill", "palette": "green"}],
             "side": [{"id": "x3", "t": "材料不全，发出补材通知中止时效", "row": 1, "frm": "m8", "label": "缺件", "palette": "gray"}]},
        ], labels={("m3", "m4"): "属于", ("m6", "m7"): "未超过"},
            note_text="填写说明：本图为示例模板，责任判定口径、免赔规则与核赔限额请按险种条款调整。"),

        mkflow("银行贷款审批流程", "银行贷款审批流程图", [
            {"t": "阶段一 · 受理与初筛",
             "main": [{"id": "m1", "t": "客户提交贷款申请资料", "shape": "pill", "palette": "green"},
                      {"id": "m2", "t": "客户经理面谈并录入系统"},
                      {"id": "m3", "t": "资料是否齐全合规?", "shape": "diamond", "palette": "amber"}],
             "side": [{"id": "x1", "t": "发出补件清单，客户补交后重提", "row": 2, "frm": "m3", "label": "不齐", "palette": "orange"}]},
            {"t": "阶段二 · 资信调查与审贷",
             "main": [{"id": "m4", "t": "查询征信、流水与抵押物评估"},
                      {"id": "m5", "t": "风控模型打分与人工复核"},
                      {"id": "m6", "t": "审贷会是否批准?", "shape": "diamond", "palette": "amber"}],
             "side": [{"id": "x2", "t": "否决，出具理由并结束流程", "row": 2, "frm": "m6", "label": "否决", "palette": "red"}]},
            {"t": "阶段三 · 签约与放款",
             "main": [{"id": "m7", "t": "签订借款合同并办理抵押登记"},
                      {"id": "m8", "t": "落实放款前提条件"},
                      {"id": "m9", "t": "放款到账，进入贷后管理", "shape": "pill", "palette": "green"}],
             "side": [{"id": "x3", "t": "抵押登记未落实，暂缓放款", "row": 1, "frm": "m8", "label": "未落实", "palette": "gray"}]},
        ], labels={("m3", "m4"): "齐全", ("m6", "m7"): "批准"},
            note_text="填写说明：本图为示例模板，准入条件、评分卡阈值与放款前提请按本行信贷政策调整。"),
    ]


# ═══════════════════════════════════════════════════════════════════════════
# 批次二：分析决策（029–037）
# ═══════════════════════════════════════════════════════════════════════════
def batch_analysis():
    out = []
    CAT = "绘图模板·分析决策"
    CW = 1200

    # ── 029 用户增长漏斗 ────────────────────────────────────────────────────
    steps = [
        ("s1", "曝光触达 1 280 000 次", 760, "blue"),
        ("s2", "页面访问 486 000 次 · 点击率 38%", 640, "teal"),
        ("s3", "注册转化 128 000 人 · 26%", 520, "green"),
        ("s4", "首次下单 43 600 人 · 34%", 400, "amber"),
        ("s5", "复购留存 12 800 人 · 29%", 280, "red"),
    ]
    nodes = [N(i, t, (CW - w) / 2, 90 + k * 108, w, 70, shape="rect", palette=p, bold=True)
             for k, (i, t, w, p) in enumerate(steps)]
    nodes.append(N("r", "结论：整体转化率 1.0%，付费用户 12 800 人，获客成本 38 元，ROI 2.4",
                   280, 640, 640, 64, shape="round", palette="indigo", fs=12))
    edges = [E(steps[k][0], steps[k + 1][0], dir="V", palette="gray") for k in range(len(steps) - 1)]
    edges.append(E("s5", "r", dir="V", palette="gray"))
    out.append(mkplain("用户增长漏斗分析", "用户增长漏斗分析图", CAT, CW, 800, nodes=nodes, edges=edges,
                       note_text="填写说明：本图为示例模板，漏斗层级与转化口径请按自有埋点体系替换。",
                       note_y=730))

    # ── 030 SWOT ───────────────────────────────────────────────────────────
    quads = [
        ("S · 优势 Strengths", 40, 58, "green", [
            ("g11", "自有品牌复购率 42%，高于行业均值 18 个百分点"),
            ("g12", "冷链仓配自建，核心城市次日达覆盖率 96%"),
            ("g13", "抖音与私域双渠道，获客成本 38 元/人")]),
        ("W · 劣势 Weaknesses", 620, 58, "red", [
            ("g21", "SKU 仅 240 个，长尾品类明显缺失"),
            ("g22", "会员等级体系上线晚，90 天留存仅 21%"),
            ("g23", "华南区域仓仅 1 座，履约成本偏高")]),
        ("O · 机会 Opportunities", 40, 400, "blue", [
            ("g31", "预制菜市场三年 CAGR 21%，需求持续放量"),
            ("g32", "即时零售渠道增长 65%，可承接新增量"),
            ("g33", "地方冷链补贴政策最高覆盖 30% 投入")]),
        ("T · 威胁 Threats", 620, 400, "amber", [
            ("g41", "头部平台自营同款降价 15%，价格战加剧"),
            ("g42", "海产原料受休渔期影响，采购价波动 ±20%"),
            ("g43", "食品安全舆情敏感，单次事故即冲击品牌")]),
    ]
    groups, nodes = [], []
    for title, x, yq, pal, items in quads:
        groups.append(G(title, x, yq, 540, 300, palette=pal))
        for k, (i, t) in enumerate(items):
            nodes.append(N(i, t, x + 20, yq + 46 + k * 78, 500, 64, shape="rect", palette=pal, fs=12))
    out.append(mkplain("SWOT 战略分析", "SWOT 战略分析图", CAT, CW, 810, groups=groups, nodes=nodes,
                       note_text="填写说明：本图为示例模板，四象限条目请替换为最近一次战略会的结论。",
                       note_y=730))

    # ── 031 信贷审批决策树 ─────────────────────────────────────────────────
    groups = [G("第一层 · 受理准入", 40, 56, 1120, 112, palette="gray"),
              G("第二层 · 征信筛查", 40, 240, 1120, 180, palette="slate"),
              G("第三层 · 资信与定价", 40, 452, 1120, 180, palette="gray"),
              G("第四层 · 结果处理", 40, 660, 1120, 112, palette="slate")]
    nodes = [
        N("r", "客户提交经营贷授信申请", 460, 88, 280, 56, shape="pill", palette="green"),
        N("d1", "近 24 个月逾期是否超过 3 次?", 420, 272, 360, 88, shape="diamond", palette="amber", fs=12),
        N("a1", "否决：出具拒绝理由并留档", 60, 284, 300, 64, shape="round", palette="red", fs=12),
        N("d2", "月收入负债比是否高于 55%?", 420, 484, 360, 88, shape="diamond", palette="amber", fs=12),
        N("a3", "降额至 5 万元，转人工复核", 60, 496, 300, 64, shape="round", palette="orange", fs=12),
        N("a4", "通过：额度 20 万，利率 LPR+1.2%", 840, 496, 300, 64, shape="round", palette="green", fs=12),
        N("end1", "签约放款，进入贷后监控", 460, 692, 280, 56, shape="pill", palette="green"),
    ]
    edges = [E("r", "d1", dir="V"),
             E("d1", "a1", "是", dir="H"), E("d1", "d2", "否", dir="V"),
             E("d2", "a3", "是", dir="H"), E("d2", "a4", "否", dir="H"),
             E("a3", "end1", dir="L"), E("a4", "end1", dir="L")]
    out.append(mkplain("信贷审批决策树", "信贷审批决策树图", CAT, CW, 850,
                       groups=groups, nodes=nodes, edges=edges,
                       note_text="填写说明：本图为示例模板，准入规则、负债比阈值与定价请按本行风险政策调整。",
                       note_y=790))

    # ── 032 精益价值流图 VSM ───────────────────────────────────────────────
    proc = ["下料切割", "冲压成型", "焊接组装", "喷涂固化", "总装", "检测包装"]
    waits = ["等待 2.5 h", "等待 1.2 h", "等待 3.0 h", "等待 0.8 h", "等待 2.2 h", "等待 0.5 h"]
    groups = [G("信息流 · 客户订单与生产计划", 40, 56, 1120, 112, palette="gray"),
              G("工艺流 · 从下料到总装（单件周期 42 分钟）", 40, 182, 1120, 198, palette="slate"),
              G("价值流汇总指标", 40, 406, 1120, 112, palette="gray")]
    nodes = [
        N("cust", "客户需求 每日 1200 台", 60, 88, 240, 56, shape="round", palette="blue"),
        N("plan", "生产计划 MES 下发 日排产 1300 台", 760, 88, 380, 56, shape="round", palette="cyan", fs=12),
    ]
    for k in range(6):
        x = 60 + k * 180
        nodes.append(N("p%d" % (k + 1), proc[k], x, 218, 150, 70, shape="rect", palette="blue", fs=12))
        nodes.append(N("w%d" % (k + 1), waits[k], x, 310, 150, 56, shape="rect", palette="amber", fs=12))
    nodes += [
        N("k1", "总前置期 6.8 天", 60, 438, 340, 56, shape="round", palette="purple", fs=12),
        N("k2", "增值时间 42 分钟", 440, 438, 340, 56, shape="round", palette="teal", fs=12),
        N("k3", "增值比 0.43%，改善重点在工序间等待", 820, 438, 320, 56, shape="round", palette="red", fs=12),
    ]
    edges = [E("cust", "p1", dir="L"), E("plan", "p1", dir="L")]
    edges += [E("p%d" % k, "p%d" % (k + 1), dir="H", palette="gray") for k in range(1, 6)]
    edges += [E("p%d" % (k + 1), "w%d" % (k + 1), dir="V", palette="amber") for k in range(6)]
    edges += [E("p6", "k1", dir="L", palette="slate"), E("p6", "k3", dir="L", palette="red")]
    out.append(mkplain("精益价值流图 VSM", "精益价值流图 VSM", CAT, CW, 600,
                       groups=groups, nodes=nodes, edges=edges,
                       note_text="填写说明：本图为示例模板，各工序周期与在制品等待时长请按现场实测数据替换。",
                       note_y=530))

    # ── 033 数据流图 DFD ───────────────────────────────────────────────────
    groups = [G("外部实体", 40, 56, 1120, 112, palette="gray"),
              G("加工过程 · P1–P4", 40, 182, 1120, 140, palette="slate"),
              G("数据存储 · D1–D3", 40, 336, 1120, 140, palette="gray"),
              G("数据服务与消费方", 40, 490, 1120, 140, palette="slate")]
    nodes = [
        N("e1", "客户", 60, 88, 240, 56, shape="rect", palette="blue"),
        N("e2", "商户运营", 350, 88, 240, 56, shape="rect", palette="blue"),
        N("e3", "财务系统", 640, 88, 240, 56, shape="rect", palette="blue"),
        N("e4", "第三方支付", 930, 88, 230, 56, shape="rect", palette="blue", fs=12),
        N("p1", "P1 订单受理", 60, 214, 240, 56, shape="round", palette="indigo", fs=12),
        N("p2", "P2 库存校验", 350, 214, 240, 56, shape="round", palette="indigo", fs=12),
        N("p3", "P3 支付处理", 640, 214, 240, 56, shape="round", palette="indigo", fs=12),
        N("p4", "P4 对账结算", 930, 214, 230, 56, shape="round", palette="indigo", fs=12),
        N("d1", "D1 订单库", 200, 368, 260, 56, shape="para", palette="teal", fs=12),
        N("d2", "D2 库存台账", 520, 368, 260, 56, shape="para", palette="teal", fs=12),
        N("d3", "D3 账务流水", 840, 368, 300, 56, shape="para", palette="teal", fs=12),
        N("v1", "实时看板", 60, 522, 340, 56, shape="round", palette="green", fs=12),
        N("v2", "T+1 经营报表", 460, 522, 340, 56, shape="round", palette="green", fs=12),
        N("v3", "风控指标输出", 860, 522, 280, 56, shape="round", palette="orange", fs=12),
    ]
    edges = [
        E("e1", "p1", dir="V"), E("e2", "p1", dir="L"), E("p1", "d1", dir="V"),
        E("p1", "p2", dir="H"), E("p2", "d2", dir="V"), E("p2", "p3", dir="H"),
        E("e4", "p3", dir="V"), E("p3", "p4", dir="H"), E("p3", "d3", dir="V"),
        E("d1", "v1", dir="L"), E("d2", "v2", dir="L"), E("d3", "v3", dir="V"),
        E("p4", "v3", dir="L", palette="slate"),
    ]
    out.append(mkplain("数据流图 DFD", "数据流图 DFD", CAT, CW, 700,
                       groups=groups, nodes=nodes, edges=edges,
                       note_text="填写说明：本图为示例模板，加工编号、数据存储与流向请按系统数据架构调整。",
                       note_y=648))

    # ── 034 质量问题根因分析（鱼骨图）────────────────────────────────────────
    groups = [G("鱼骨图 · 到货破损率 3.2% 的根因归因（5M1E）", 40, 56, 1120, 560, palette="gray")]
    nodes = [
        N("sp", "", 120, 372, 880, 16, shape="rect", palette="slate"),
        N("eff", "结果\n到货破损率 3.2%\n（目标 ≤1.0%）", 1010, 330, 140, 100, shape="round",
          palette="red", fs=12, bold=True),
        N("c1", "人员 · 新员工操作不熟\n分拣岗新人占 35%", 180, 250, 240, 72, shape="rect", palette="blue", fs=12),
        N("c2", "设备 · 周转箱老化\n箱体开裂未及时更换", 470, 250, 240, 72, shape="rect", palette="teal", fs=12),
        N("c3", "物料 · 冰袋配比不足\n夏季高温时段融化", 760, 250, 240, 72, shape="rect", palette="purple", fs=12),
        N("c4", "方法 · 装箱无固定标准\n未按品类分层码放", 180, 440, 240, 72, shape="rect", palette="indigo", fs=12),
        N("c5", "环境 · 月台暴晒\n装车前露天等待超 20 分钟", 470, 440, 240, 72, shape="rect", palette="amber", fs=12),
        N("c6", "测量 · 无破损抽检记录\n只能事后赔付", 760, 440, 240, 72, shape="rect", palette="orange", fs=12),
    ]
    edges = [E("c%d" % k, "sp", dir="V", palette="slate") for k in range(1, 7)]
    edges.append(E("sp", "eff", dir="H", label="导致", palette="red"))
    out.append(mkplain("质量问题根因分析", "质量问题根因分析鱼骨图", CAT, CW, 680,
                       groups=groups, nodes=nodes, edges=edges,
                       note_text="填写说明：本图为示例模板，归因维度与占比数据请替换为本次质量分析的真实结论。",
                       note_y=632))

    # ── 035 风险矩阵 ───────────────────────────────────────────────────────
    rows_lbl = ["概率极高", "概率较高", "概率中等", "概率较低"]
    cols_lbl = ["影响轻微", "影响一般", "影响严重", "影响灾难"]
    cells = [
        [("低", "gray", "促销文案错别字"), ("中", "amber", "原料价格波动 ±20%"),
         ("高", "orange", "休渔期断供断货"), ("高", "red", "食品安全事故")],
        [("低", "gray", "门店设备小故障"), ("中", "amber", "爆款断货 24 小时"),
         ("高", "orange", "冷链温控失效"), ("高", "red", "区域舆情危机")],
        [("低", "gray", "临时缺勤排班紧"), ("低", "amber", "配送延迟 1 小时"),
         ("中", "orange", "系统故障 4 小时"), ("高", "red", "核心系统数据丢失")],
        [("低", "gray", "差评未及时回复"), ("低", "amber", "包装轻微破损"),
         ("中", "orange", "加盟商违规操作"), ("中", "red", "供应商断供一周")],
    ]
    groups = [G("项目风险矩阵 · 概率 × 影响（颜色即处置优先级）", 40, 56, 1120, 620, palette="gray")]
    nodes = []
    for r in range(4):
        nodes.append(N("yl%d" % r, rows_lbl[r], 56, 90 + r * 122, 104, 110, shape="rect", palette="slate", fs=12))
        for c in range(4):
            key, pal, txt = cells[r][c]
            nodes.append(N("c%d%d" % (r, c), "%s\n%s" % (key, txt), 180 + c * 242, 90 + r * 122,
                           230, 110, shape="rect", palette=pal, fs=12))
    for c in range(4):
        nodes.append(N("xl%d" % c, cols_lbl[c], 180 + c * 242, 585, 230, 44, shape="rect", palette="slate", fs=12))
    out.append(mkplain("项目风险矩阵", "项目风险矩阵图", CAT, CW, 720, groups=groups, nodes=nodes,
                       note_text="填写说明：本图为示例模板，风险条目与象限判定请按本次项目风险清单替换。",
                       note_y=660))

    # ── 036 用户旅程地图 ───────────────────────────────────────────────────
    CX = [55, 337, 619, 901]
    stage_t = ["认知 · 看直播被种草", "考虑 · 比价与看评价", "首购 · 下单与收货", "复购 · 会员与推荐"]
    behav = ["刷到海鲜火锅直播，点进商品详情",
             "对比 3 家同类商品，查看差评与溯源",
             "下单支付，等待冷链到家并开箱",
             "加入会员，参与拼团并向朋友推荐"]
    touch = ["抖音短视频 · 直播间小黄车", "商品详情页 · 评价区 · 客服咨询",
             "下单页 · 支付渠道 · 物流轨迹", "会员中心 · 社群运营 · 推荐有礼"]
    emo = ["兴趣高但担心不新鲜", "价格敏感，犹豫比价耗时",
           "到货新鲜度决定复购意愿", "权益感知弱，容易沉睡"]
    groups = [G("阶段", 40, 56, 1120, 108, palette="gray"),
              G("用户行为", 40, 176, 1120, 108, palette="blue"),
              G("触点与渠道", 40, 296, 1120, 108, palette="teal"),
              G("情绪与痛点", 40, 416, 1120, 108, palette="amber")]
    nodes = []
    for k in range(4):
        nodes.append(N("st%d" % k, stage_t[k], CX[k], 88, 244, 56, shape="pill", palette="indigo", fs=12))
        nodes.append(N("bh%d" % k, behav[k], CX[k], 208, 244, 60, shape="rect", palette="blue", fs=12))
        nodes.append(N("tc%d" % k, touch[k], CX[k], 328, 244, 60, shape="rect", palette="teal", fs=12))
        nodes.append(N("em%d" % k, emo[k], CX[k], 448, 244, 60, shape="rect", palette="amber", fs=12))
    edges = [E("st%d" % k, "st%d" % (k + 1), dir="H", palette="slate") for k in range(3)]
    for k in range(4):
        edges += [E("st%d" % k, "bh%d" % k, dir="V", palette="slate"),
                  E("bh%d" % k, "tc%d" % k, dir="V", palette="slate"),
                  E("tc%d" % k, "em%d" % k, dir="V", palette="slate")]
    out.append(mkplain("用户旅程地图", "用户旅程地图", CAT, CW, 610,
                       groups=groups, nodes=nodes, edges=edges,
                       note_text="填写说明：本图为示例模板，阶段划分、情绪判定与触点请按真实用户访谈结论替换。",
                       note_y=548))

    # ── 037 竞品功能对比矩阵 ───────────────────────────────────────────────
    comps = ["寄海文库", "竞品 A", "竞品 B", "竞品 C"]
    feats = [
        ("多类型文档（15 类）", ["支持", "部分", "不支持", "部分"]),
        ("目录树与版本快照", ["支持", "支持", "不支持", "支持"]),
        ("模板中心（160+ 模板）", ["支持", "部分", "不支持", "不支持"]),
        ("draw.io 绘图文档", ["支持", "不支持", "支持", "不支持"]),
        ("mermaid 八种图型", ["支持", "部分", "不支持", "部分"]),
        ("评论点评与多人协作", ["支持", "支持", "部分", "支持"]),
        ("分享链接与水印只读", ["支持", "支持", "不支持", "部分"]),
        ("全自托管私有部署", ["支持", "不支持", "支持", "不支持"]),
    ]
    PALS = {"支持": "green", "部分": "amber", "不支持": "gray"}
    groups = [G("竞品功能对比矩阵（支持 / 部分 / 不支持）", 40, 76, 1120, 640, palette="gray")]
    nodes = [N("h0", "功能项", 60, 110, 220, 56, shape="rect", palette="slate", bold=True)]
    for k, c in enumerate(comps):
        nodes.append(N("h%d" % (k + 1), c, 300 + k * 212, 110, 205, 56, shape="rect", palette="indigo",
                       bold=True, fs=12))
    for r, (feat, vals) in enumerate(feats):
        y = 180 + r * 62
        nodes.append(N("f%d" % r, feat, 60, y, 220, 52, shape="rect", palette="blue", fs=12))
        for k, v in enumerate(vals):
            nodes.append(N("v%d%d" % (r, k), v, 300 + k * 212, y, 205, 52, shape="rect",
                           palette=PALS[v], fs=12))
    out.append(mkplain("竞品功能对比矩阵", "竞品功能对比矩阵图", CAT, CW, 760,
                       groups=groups, nodes=nodes,
                       note_text="填写说明：本图为示例模板，功能项与判定请按最近一次竞品调研结论替换。",
                       note_y=716))
    return out

# ═══════════════════════════════════════════════════════════════════════════
# 批次三：关系与结构（038–045）
# ═══════════════════════════════════════════════════════════════════════════
def batch_structure():
    out = []
    CAT = "绘图模板·关系与结构"
    CW = 1200

    def tree_edges(levels, links):
        ids = {n[0] for lv in levels for n in lv}
        return [E(a, b, lbl, dir=d) for a, b, lbl, d in links if a in ids and b in ids]

    # ── 038 公司组织架构图 ─────────────────────────────────────────────────
    L = [
        [("t1", "星澜控股集团 · 董事会")],
        [("t2", "集团首席执行官 CEO"), ("t3", "集团首席财务官 CFO"), ("t4", "集团首席技术官 CTO")],
        [("t5", "连锁餐饮事业群"), ("t6", "供应链事业群"), ("t7", "数字化事业部"), ("t8", "职能中心")],
        [("t9", "华东大区 32 家门店"), ("t10", "华南大区 18 家门店"),
         ("t11", "中央厨房 2 座"), ("t12", "冷链物流中心")],
    ]
    nodes = tree(L, 110, w=190, h=64, gap_x=44, pitch=118, canvas_w=CW, fs=12,
                 shapes=["pill", "round", "rect", "rect"])
    edges = tree_edges(L, [
        ("t1", "t2", "聘任", "V"), ("t1", "t3", "聘任", "L"), ("t1", "t4", "聘任", "L"),
        ("t2", "t5", "分管", "L"), ("t2", "t6", "分管", "V"),
        ("t3", "t8", "分管", "L"), ("t4", "t7", "分管", "L"),
        ("t5", "t9", "下辖", "V"), ("t5", "t10", "下辖", "L"),
        ("t6", "t11", "下辖", "L"), ("t6", "t12", "下辖", "L"),
    ])
    out.append(mkplain("公司组织架构图", "公司组织架构图", CAT, CW, 620, nodes=nodes, edges=edges,
                       note_text="填写说明：本图为示例模板，事业群与部门名称、汇报线请按实际组织架构替换。",
                       note_y=550))

    # ── 039 RACI 职责矩阵 ──────────────────────────────────────────────────
    roles = ["项目经理", "开发负责人", "测试负责人", "业务代表"]
    acts = [
        ("需求评审与迭代排期", ["A", "C", "C", "R"]),
        ("技术方案设计与评审", ["C", "A", "C", "I"]),
        ("编码实现与代码评审", ["I", "A", "C", "I"]),
        ("单元测试与联调验证", ["I", "R", "A", "I"]),
        ("测试环境部署与维护", ["C", "R", "A", "I"]),
        ("业务验收测试（UAT）", ["C", "C", "R", "A"]),
        ("生产上线与发布确认", ["A", "R", "C", "I"]),
        ("迭代复盘与改进项跟踪", ["A", "C", "C", "R"]),
    ]
    PAL = {"A": "red", "R": "blue", "C": "amber", "I": "gray"}
    groups = [G("RACI 职责矩阵（A 最终负责 / R 具体执行 / C 被咨询 / I 被通知）",
                40, 76, 1120, 604, palette="gray")]
    nodes = [N("h0", "项目活动", 60, 110, 360, 52, shape="rect", palette="slate", bold=True, fs=12)]
    for k, r in enumerate(roles):
        nodes.append(N("h%d" % (k + 1), r, 440 + k * 180, 110, 170, 52, shape="rect", palette="indigo",
                       bold=True, fs=12))
    for ri, (act, vals) in enumerate(acts):
        y = 176 + ri * 60
        nodes.append(N("a%d" % ri, act, 60, y, 360, 50, shape="rect", palette="blue", fs=12))
        for k, v in enumerate(vals):
            nodes.append(N("r%d%d" % (ri, k), v, 440 + k * 180, y, 170, 50, shape="rect",
                           palette=PAL[v], fs=13, bold=True))
    out.append(mkplain("项目团队 RACI 职责矩阵", "项目团队 RACI 职责矩阵图", CAT, CW, 752,
                       groups=groups, nodes=nodes,
                       note_text="填写说明：本图为示例模板，角色划分与 RACI 分配请按团队实际分工替换。",
                       note_y=692))

    # ── 040 产品功能结构树 ─────────────────────────────────────────────────
    L = [
        [("f0", "寄海文库 · 产品功能")],
        [("f1", "知识库管理"), ("f2", "编辑与协作"), ("f3", "分享与导出"), ("f4", "系统管理")],
        [("f5", "目录树与版本"), ("f6", "多类型编辑器"), ("f7", "分享与只读"), ("f8", "用户与权限")],
        [("f9", "拖拽排序"), ("f10", "160+ 内置模板"), ("f11", "评论与点评"), ("f12", "角色权限矩阵")],
    ]
    nodes = tree(L, 110, w=190, h=64, gap_x=44, pitch=118, canvas_w=CW, fs=12,
                 shapes=["pill", "round", "rect", "rect"])
    edges = tree_edges(L, [
        ("f0", "f1", "", "V"), ("f0", "f2", "", "L"), ("f0", "f3", "", "L"), ("f0", "f4", "", "L"),
        ("f1", "f5", "", "V"), ("f2", "f6", "", "V"), ("f3", "f7", "", "V"), ("f4", "f8", "", "V"),
        ("f5", "f9", "", "V"), ("f6", "f10", "", "V"), ("f7", "f11", "", "V"), ("f8", "f12", "", "V"),
    ])
    out.append(mkplain("产品功能结构树", "产品功能结构树", CAT, CW, 620, nodes=nodes, edges=edges,
                       note_text="填写说明：本图为示例模板，功能分层与子功能请按当前产品规划替换。",
                       note_y=550))

    # ── 041 项目里程碑时间轴 ───────────────────────────────────────────────
    ms = [
        ("m1", "3 月 15 日\n立项与预算批复", 100, "green"),
        ("m2", "4 月 20 日\n需求评审完成", 310, "blue"),
        ("m3", "5 月 30 日\n架构设计冻结", 520, "teal"),
        ("m4", "8 月 10 日\n开发完成进入内测", 730, "indigo"),
        ("m5", "10 月 18 日\n灰度发布并全量上线", 940, "orange"),
    ]
    groups = [G("上半年 · 立项与设计阶段", 40, 140, 1120, 140, palette="gray"),
              G("下半年 · 开发与上线阶段", 40, 320, 1120, 140, palette="slate")]
    nodes = [N("sp", "", 80, 300, 1040, 14, shape="rect", palette="slate")]
    for k, (i, t, x, pal) in enumerate(ms):
        y = 180 if k % 2 == 0 else 360
        nodes.append(N(i, t, x, y, 180, 64, shape="pill", palette=pal, fs=12, bold=True))
    edges = [E(i, "sp", dir="V", palette="slate") for i, _, _, _ in ms]
    edges.append(E("m1", "m5", "总工期 7 个月", dir="L", dash=True, palette="gray"))
    out.append(mkplain("项目里程碑时间轴", "项目里程碑时间轴图", CAT, CW, 560,
                       groups=groups, nodes=nodes, edges=edges,
                       note_text="填写说明：本图为示例模板，里程碑日期与达成标准请按项目主计划替换。",
                       note_y=480))

    # ── 042 订单状态机 ─────────────────────────────────────────────────────
    groups = [G("订单状态迁移（正向履约链路 + 逆向取消 / 退款 / 售后链路）",
                40, 56, 1120, 420, palette="gray")]
    S = [
        ("st1", "待支付", 120, 90, "green"), ("st2", "已支付", 380, 90, "blue"),
        ("st5", "待发货", 640, 90, "cyan"), ("st3", "已发货", 900, 90, "teal"),
        ("st4", "已完成", 900, 240, "green"), ("st6", "已取消", 120, 240, "gray"),
        ("st7", "退款中", 380, 240, "amber"), ("st9", "售后处理中", 640, 240, "orange"),
        ("st8", "已退款", 380, 380, "red"), ("st10", "已关闭", 900, 380, "slate"),
    ]
    nodes = [N(i, t, x, y, 180, 60, shape="pill", palette=p, bold=True) for i, t, x, y, p in S]
    edges = [
        E("st1", "st2", "支付成功", dir="H"), E("st1", "st6", "超时未支付 15 分钟", dir="V"),
        E("st2", "st5", "系统确认与备货", dir="H"), E("st5", "st3", "仓库出库", dir="H"),
        E("st3", "st4", "确认收货", dir="V"), E("st2", "st7", "申请退款", dir="V"),
        E("st7", "st8", "审核通过", dir="V"), E("st3", "st9", "7 日内申请售后", dir="L"),
        E("st9", "st4", "售后完成", dir="L"), E("st7", "st10", "审核驳回且超时", dir="L"),
    ]
    out.append(mkplain("订单状态机图", "订单状态机图", CAT, CW, 540, groups=groups, nodes=nodes,
                       edges=edges,
                       note_text="填写说明：本图为示例模板，状态命名、迁移条件与超时规则请按交易域设计替换。",
                       note_y=496))

    # ── 043 实体关系 ER 图 ─────────────────────────────────────────────────
    groups = [G("电商交易域实体关系（用户 — 订单 — 明细 — 商品 — 库存 — 支付）",
                40, 56, 1120, 460, palette="gray")]
    E_ = [
        ("u", "用户 user\nPK 用户ID bigint\nUK 手机号 varchar\n会员等级 tinyint\n注册时间 datetime",
         60, 90, 300, 170, "blue"),
        ("o", "订单 order\nPK 订单号 varchar\nFK 用户ID bigint\n应付金额 decimal(12,2)\n订单状态 tinyint\n下单时间 datetime",
         480, 90, 300, 170, "green"),
        ("it", "订单明细 order_item\nPK 明细ID bigint\nFK 订单号 varchar\nFK 商品ID bigint\n数量 int\n成交单价 decimal(10,2)",
         900, 90, 260, 170, "teal"),
        ("p", "商品 product\nPK 商品ID bigint\n商品名称 varchar\n品类ID int\n售价 decimal(10,2)",
         60, 330, 300, 140, "indigo"),
        ("s", "库存 stock\nPK 库存ID bigint\nFK 商品ID bigint\n可用数量 int\n锁定数量 int",
         480, 330, 300, 140, "amber"),
        ("pay", "支付流水 payment\nPK 流水号 varchar\nFK 订单号 varchar\n支付渠道 varchar\n支付状态 tinyint",
         900, 330, 260, 140, "purple"),
    ]
    nodes = [N(i, t, x, y, w, h, shape="rect", palette=p, fs=12) for i, t, x, y, w, h, p in E_]
    edges = [
        E("u", "o", "1:N 下单", dir="H"), E("o", "it", "1:N 包含", dir="H"),
        E("p", "s", "1:1 库存", dir="H"), E("s", "pay", "1:1 结算", dir="H"),
        E("s", "o", "N:1 关联", dir="V"), E("o", "pay", "1:N 支付", dir="L"),
        E("p", "u", "N:M 收藏", dir="L", dash=True, palette="gray"),
    ]
    out.append(mkplain("电商交易 ER 图", "电商交易域实体关系 ER 图", CAT, CW, 580,
                       groups=groups, nodes=nodes, edges=edges,
                       note_text="填写说明：本图为示例模板，实体、字段与基数请按实际库表结构替换。",
                       note_y=536))

    # ── 044 课程知识体系树 ─────────────────────────────────────────────────
    L = [
        [("k0", "Go 后端工程师知识体系")],
        [("k1", "语言基础"), ("k2", "工程实践"), ("k3", "数据与中间件"), ("k4", "架构与运维")],
        [("k5", "语法与并发"), ("k6", "测试与重构"), ("k7", "MySQL 与 Redis"), ("k8", "微服务与部署")],
        [("k9", "slice 与 channel"), ("k10", "table 驱动测试"), ("k11", "索引与慢查询"),
         ("k12", "容器与 K8s")],
    ]
    nodes = tree(L, 110, w=190, h=64, gap_x=44, pitch=118, canvas_w=CW, fs=12,
                 shapes=["pill", "round", "rect", "rect"])
    edges = tree_edges(L, [
        ("k0", "k1", "", "V"), ("k0", "k2", "", "L"), ("k0", "k3", "", "L"), ("k0", "k4", "", "L"),
        ("k1", "k5", "", "V"), ("k2", "k6", "", "V"), ("k3", "k7", "", "V"), ("k4", "k8", "", "V"),
        ("k5", "k9", "", "V"), ("k6", "k10", "", "V"), ("k7", "k11", "", "V"), ("k8", "k12", "", "V"),
    ])
    out.append(mkplain("课程知识体系树", "课程知识体系树", CAT, CW, 620, nodes=nodes, edges=edges,
                       note_text="填写说明：本图为示例模板，知识模块与学习顺序请按目标岗位要求调整。",
                       note_y=550))

    # ── 045 连锁门店组织与汇报关系 ─────────────────────────────────────────
    L = [
        [("g1", "华南区域总部 · 深圳")],
        [("g2", "深圳直营片区"), ("g3", "广州加盟片区"), ("g4", "供应链与品控中心")],
        [("g5", "深南旗舰店"), ("g6", "科技园店"), ("g7", "天河店"), ("g8", "番禺店")],
    ]
    nodes = tree(L, 110, w=220, h=64, gap_x=50, pitch=118, canvas_w=CW, fs=12,
                 shapes=["pill", "round", "rect"])
    nodes.append(N("g9", "总部职能支持：人力资源 / 财务共享 / 市场品牌", 350, 470, 500, 56,
                   shape="round", palette="gray", fs=12, dash=True))
    edges = tree_edges(L, [
        ("g1", "g2", "直营管理", "L"), ("g1", "g3", "加盟督导", "L"), ("g1", "g4", "统一调配", "V"),
        ("g2", "g5", "店长汇报", "L"), ("g2", "g6", "店长汇报", "L"),
        ("g3", "g7", "督导检查", "L"), ("g3", "g8", "督导检查", "L"),
    ])
    edges.append(E("g9", "g1", "职能支持", dir="V", dash=True, palette="gray"))
    out.append(mkplain("连锁门店组织与汇报关系", "连锁门店组织与汇报关系图", CAT, CW, 600,
                       nodes=nodes, edges=edges,
                       note_text="填写说明：本图为示例模板，片区划分、门店名单与汇报频次请按实际组织替换。",
                       note_y=545))
    return out


BATCHES = {"flow": batch_flow, "analysis": batch_analysis, "structure": batch_structure}
RANGES = {"flow": range(2, 15), "analysis": range(29, 38), "structure": range(38, 46)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--batch", default="all", choices=["flow", "analysis", "structure", "all"])
    ap.add_argument("--force", action="store_true", help="覆盖已存在的源文件")
    args = ap.parse_args()

    names = list(BATCHES) if args.batch == "all" else [args.batch]
    os.makedirs(SRC_DIR, exist_ok=True)
    written = skipped = 0
    for nm in names:
        specs = BATCHES[nm]()
        expected = RANGES[nm]
        if len(specs) != len(list(expected)):
            raise SystemExit("[build-drawing] %s 批次条目数 %d ≠ 预期 %d" % (nm, len(specs), len(list(expected))))
        for no, spec in zip(expected, specs):
            # 文件名不能含路径分隔符（如「CI/CD 持续交付流程」）
            safe = spec["name"].replace("/", "·").replace("\\", "·")
            path = os.path.join(SRC_DIR, "%03d-%s.json" % (no, safe))
            if os.path.exists(path) and not args.force:
                print("  跳过（已存在）：%s" % os.path.basename(path))
                skipped += 1
                continue
            with open(path, "w", encoding="utf-8") as f:
                json.dump(spec, f, ensure_ascii=False, indent=2)
                f.write("\n")
            written += 1
    print("[build-drawing] 写入 %d 个源文件，跳过 %d 个" % (written, skipped))
    return 0


if __name__ == "__main__":
    sys.exit(main())
