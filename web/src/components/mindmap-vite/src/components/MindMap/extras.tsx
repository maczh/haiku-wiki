/**
 * 补齐模块：把 simple-mind-map 插件具备、而原 mindmap-vite 未实现的能力
 * （节点缩略图 / 标签 / LaTeX 公式 / 关联线 / 外框 / 概要）落到 SVG 渲染层。
 *
 * 宽高口径在 layout.ts（prefixWidth / nodeSize）与本文件各持一份常量，
 * 两处必须同步；本文件只做渲染与几何计算。
 */
import { useMemo } from "react";
import katex from "katex";
import { IMAGE_BOX, measureTagWidth } from "./layout";
import {
  sketchArrowHead,
  sketchPath,
  sketchRect,
} from "./handdrawn";
import type {
  MindAssocArrow,
  MindAssocLine,
  MindFrameGroup,
  MindNode,
  MindSummaryGroup,
} from "./types";

/* ------------------------------------------------------------------ *
 * LaTeX 公式（渲染 + 量宽）
 * ------------------------------------------------------------------ */

/** 公式文本宽度测量缓存：同一 (latex, fontSize) 只量一次 */
const latexWidthCache = new Map<string, number>();
let measureHost: HTMLElement | null = null;

function ensureMeasureHost(): HTMLElement | null {
  if (measureHost) return measureHost;
  if (typeof document === "undefined") return null;
  const el = document.createElement("div");
  el.style.cssText =
    "position:absolute;left:-99999px;top:-99999px;visibility:hidden;white-space:nowrap;";
  document.body.appendChild(el);
  measureHost = el;
  return el;
}

/** 测量 LaTeX 渲染后的像素宽度（布局阶段给节点盒子预留空间用） */
export function latexWidth(latex: string, fontSize: number): number {
  const key = `${fontSize}::${latex}`;
  const hit = latexWidthCache.get(key);
  if (hit != null) return hit;
  let w: number;
  try {
    const host = ensureMeasureHost();
    if (host) {
      host.innerHTML = katex.renderToString(latex, { throwOnError: false, output: "html" });
      host.style.fontSize = `${fontSize}px`;
      w = Math.ceil(host.getBoundingClientRect().width) + 10;
    } else {
      w = latex.length * fontSize * 0.62;
    }
  } catch {
    // 公式语法异常 / 环境无 DOM：按比例估算，保证布局不崩
    w = latex.length * fontSize * 0.62;
  }
  latexWidthCache.set(key, w);
  return w;
}

/** 渲染一段 LaTeX 为 HTML（语法错误时降级为等宽文本，不打断整棵树） */
function renderLatex(latex: string): string {
  try {
    return katex.renderToString(latex, { throwOnError: false, output: "html" });
  } catch {
    return `<span style="font-family:monospace">${escapeHtml(latex)}</span>`;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/* ------------------------------------------------------------------ *
 * 节点内的补充元素
 * ------------------------------------------------------------------ */

/** 节点缩略图：固定方框内等比裁切（与 layout.ts 的 IMAGE_BOX 同尺寸） */
export function NodeImage({ url, title, h }: { url: string; title?: string; h: number }) {
  const top = h / 2 - IMAGE_BOX / 2;
  return (
    <image
      className="mm-image"
      x={0}
      y={top}
      width={IMAGE_BOX}
      height={IMAGE_BOX}
      href={url}
      preserveAspectRatio="xMidYMid slice"
      style={{ pointerEvents: "none" }}
    >
      <title>{title || "节点图片"}</title>
    </image>
  );
}

/** 节点标签：文字前缀之后的一排小色块 */
export function NodeTags({ tags, cx, cy, fontSize }: { tags: string[]; cx: number; cy: number; fontSize: number }) {
  const total = tags.reduce((s, t) => s + measureTagWidth(t) + TAG_GAP, -TAG_GAP);
  let x = cx - total / 2;
  const th = Math.min(16, Math.max(12, fontSize + 3));
  return (
    <g className="mm-tags" style={{ pointerEvents: "none" }}>
      {tags.map((t) => {
        const tw = measureTagWidth(t);
        const color = tagColor(t);
        const box = (
          <g key={`${t}-${x}`}>
            <rect x={x} y={cy - th / 2} width={tw} height={th} rx={th / 2} ry={th / 2} fill={color} opacity={0.2} />
            <text
              x={x + tw / 2}
              y={cy + 3.4}
              textAnchor="middle"
              fontSize={Math.max(9, fontSize - 3)}
              fill={color}
              style={{ fontWeight: 600, userSelect: "none" }}
            >
              {t}
            </text>
          </g>
        );
        x += tw + TAG_GAP;
        return box;
      })}
    </g>
  );
}

const TAG_GAP = 4;

/** 由标签文本稳定派生一个可读色（避免额外维护配置表） */
function tagColor(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i += 1) h = (h * 31 + text.charCodeAt(i)) % 360;
  return `hsl(${h} 62% 42%)`;
}

/** 公式区块：foreignObject + katex（宽度由 layout.ts 侧量好后传入） */
export function FormulaText({
  latex,
  cx,
  cy,
  fontSize,
  boxW,
}: {
  latex: string;
  cx: number;
  cy: number;
  fontSize: number;
  boxW: number;
}) {
  const html = useMemo(() => renderLatex(latex), [latex]);
  const h = Math.max(fontSize * 2, 28);
  return (
    <foreignObject x={cx - boxW / 2} y={cy - h / 2} width={Math.max(boxW, 24)} height={h} style={{ pointerEvents: "none" }}>
      <div style={{ fontSize, lineHeight: "1.4" }} dangerouslySetInnerHTML={{ __html: html }} />
    </foreignObject>
  );
}

/* ------------------------------------------------------------------ *
 * 关联线（挂在根节点上）
 * ------------------------------------------------------------------ */

/** 关联线箭头三角形（tip 为尖端，dir 为指向，size 为长，halfW 为半宽） */
function assocArrowPoints(
  tip: { x: number; y: number },
  dir: { x: number; y: number },
  size: number,
  halfW: number
): string {
  const bx = tip.x - dir.x * size;
  const by = tip.y - dir.y * size;
  const px = -dir.y * halfW;
  const py = dir.x * halfW;
  const f = (n: number) => (Math.round(n * 100) / 100).toString();
  return `${f(tip.x)},${f(tip.y)} ${f(bx + px)},${f(by + py)} ${f(bx - px)},${f(by - py)}`;
}

export interface AssocLineGeom {
  line: MindAssocLine;
  d: string;
  lx: number;
  ly: number;
  color: string;
  /** 箭头尖端与朝向（手绘要据此生成两根短线）；无箭头时为 undefined */
  arrow?: { tip: { x: number; y: number }; dir: { x: number; y: number } };
}

/**
 * 由节点盒集合计算关联线几何。
 *
 * 走线策略（对齐截图 2）：多数关联线是「同侧两个节点」之间的横向连接，
 * 直接连会与树连线重叠，因此默认从**右侧绕一个弧**再回到目标节点，
 * 并在目标端画一个向内的箭头。跨侧（左右分居）时改走下方弧，避免穿过子树。
 */
export function buildAssocGeom(
  lines: MindAssocLine[],
  pos: Map<string, { x: number; y: number; w: number; h: number }>,
): AssocLineGeom[] {
  const out: AssocLineGeom[] = [];
  for (const line of lines) {
    const a = pos.get(line.fromId);
    const b = pos.get(line.toId);
    if (!a || !b) continue;
    const color = line.color || "#2f6fed";
    const arrowMode: MindAssocArrow = line.arrow ?? "out";

    const aCX = a.x + a.w / 2;
    const bCX = b.x + b.w / 2;
    const aRight = a.x + a.w;
    const bRight = b.x + b.w;
    const aCY = a.y + a.h / 2;
    const bCY = b.y + b.h / 2;
    // 两节点是否「同侧」（中点相距不太远）—— 同侧走右侧弧，异侧走下方弧
    const sameSide = Math.abs(aCX - bCX) < Math.max(a.w, b.w) * 3;

    let d: string;
    let lx: number;
    let ly: number;
    /** 箭头尖端位置与朝向 */
    let tip: { x: number; y: number } | null = null;
    let dirTip: { x: number; y: number } | null = null;

    if (sameSide) {
      // 右侧绕行：从源节点右缘出发，鼓到两节点右侧之外，再折回目标节点右缘
      const bulgeX = Math.max(aRight, bRight) + 46;
      const x1 = aRight;
      const x2 = bRight;
      d = `M ${x1} ${aCY} C ${bulgeX} ${aCY}, ${bulgeX} ${bCY}, ${x2} ${bCY}`;
      lx = bulgeX - 16;
      ly = (aCY + bCY) / 2;
      if (arrowMode === "out") {
        // 尖端贴在目标右缘、朝左（指回节点）
        tip = { x: x2, y: bCY };
        dirTip = { x: -1, y: 0 };
      } else if (arrowMode === "in") {
        tip = { x: x1, y: aCY };
        dirTip = { x: 1, y: 0 };
      }
    } else {
      // 异侧：走下方弧，避开子树主体
      const dropY = Math.max(a.y + a.h, b.y + b.h) + 40;
      d = `M ${aCX} ${a.y + a.h} C ${aCX} ${dropY}, ${bCX} ${dropY}, ${bCX} ${
        b.y + b.h
      }`;
      lx = (aCX + bCX) / 2;
      ly = dropY - 8;
      if (arrowMode === "out") {
        tip = { x: bCX, y: b.y + b.h };
        dirTip = { x: 0, y: -1 };
      } else if (arrowMode === "in") {
        tip = { x: aCX, y: a.y + a.h };
        dirTip = { x: 0, y: 1 };
      }
    }

    out.push({
      line,
      d,
      lx,
      ly,
      color,
      arrow: tip && dirTip ? { tip, dir: dirTip } : undefined,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * 外框 / 概要：依赖「可见节点盒子集合」的几何计算
 * ------------------------------------------------------------------ */

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * 求一组节点 id 的包围盒（只统计实际渲染出来的节点），
 * 外框用它框住整棵子树，概要用它定位汇总节点落点。
 */
export function boundsOf(ids: string[], pos: Map<string, Box>): Box | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let n = 0;
  for (const id of ids) {
    const b = pos.get(id);
    if (!b) continue;
    n += 1;
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }
  if (!n) return null;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** 概要（汇总）节点：挂在子树右下方，用虚线连回被汇总的目标节点 */
export function generalizationGeom(
  ownerId: string,
  targetId: string,
  pos: Map<string, Box>,
  label: string,
): { box: Box; d: string; color: string } | null {
  const owner = pos.get(ownerId);
  const target = pos.get(targetId);
  if (!owner) return null;
  const w = Math.max(48, label.length * 12 + 16);
  const h = 24;
  const box: Box = {
    x: owner.x + owner.w + 16,
    y: owner.y + owner.h - h / 2,
    w,
    h,
  };
  const color = owner.w >= 0 ? "#7c879b" : "#7c879b";
  const d = target
    ? `M ${box.x} ${box.y + box.h / 2} C ${box.x + 24} ${box.y + box.h / 2}, ${
        target.x - 30
      } ${target.y + target.h / 2}, ${target.x} ${target.y + target.h / 2}`
    : "";
  return { box, d, color };
}

/* ------------------------------------------------------------------ *
 * 概要（截图 3）/ 分组框（截图 4）：由「多选的一组节点」聚合而成
 * ------------------------------------------------------------------ */

export interface SummaryGeom {
  /** 括号的 d：尖端贴节点组外缘，腰部朝概要框一侧鼓出 */
  brace: string;
  /** 括号腰部到概要框的连接线 */
  link: string;
  /** 概要节点盒 */
  box: Box;
  label: string;
  color: string;
  /** 概要框所在侧：1 = 右侧，-1 = 左侧 */
  side: 1 | -1;
}

/**
 * 概要几何：被汇总节点组**外侧**立一个括号，括号腰部再水平连到一个圆角概要框。
 *
 * 形状对齐参考截图（`verify-shots-20261003` 里的 summary-before/after）：
 *
 * ```
 *   节点组            节点组
 *   ┌────┐            ┌────┐
 *   │ A  │            │ A  │
 *   └────┘ }─┬─[概要] └────┘
 *   ┌────┐   │        ┌────┐
 *   │ B  │ } │        │ B  │
 *   └────┘   │        └────┘
 * ```
 *
 * 四条硬约束（改这里之前先看截图）：
 * 1. **方向朝外**：概要永远落在「顺着分支继续往外」的一侧——
 *    被选节点在父节点**左边** → 概要去**左**边；在**右边** → 去**右边**。
 *    判据是**共同父节点**的位置，不是画布中心（思维导图左右均衡时两者同号，
 *    但「逻辑结构图」这类整体偏右的布局只有父节点判据是对的）。
 * 2. **括号贯穿整组**：上下尖端落在「首个节点中心」与「末个节点中心」，
 *    不是包围盒高度的固定比例——写死比例会让括号缩成一个小钩子（历史 bug）。
 * 3. **弧线两头端点朝向被选节点**：尖端贴节点组外缘（位于节点那一侧），
 *    腰部反向鼓向概要框，弧线凹面因此正对被汇总的那几个节点。
 * 4. **引线连着概要文字**：腰部的水平引线连到概要框朝向括号的那条边，框垂直居中于括号。
 *
 * ## 历史 bug（别再犯）
 * - v1：方向按「相对画布中心」取反 → 概要落在分支**内侧**，直接压住父节点。
 * - v2：腰部朝节点凸 → 弧线凹面背对被选节点。
 * - v3：括号高度写死包围盒的 30% → 缩成小钩子。
 *
 * `allPos` 用于避让：若概要框压到**不属于本组**的其他节点，
 * 就把「括号 + 框」整体沿摆放方向外推（上限 6 次，避免无限外移）。
 *
 * @param parentCx 共同父节点的中心 x；传 null / 不传则退回画布中心判据
 */
export function summaryGroupGeom(
  nodeIds: string[],
  pos: Map<string, Box>,
  label: string,
  color: string,
  allPos?: Map<string, Box>,
  parentCx?: number | null
): SummaryGeom | null {
  const b = boundsOf(nodeIds, pos);
  if (!b) return null;
  const inGroup = new Set(nodeIds);
  const labelW = Math.max(52, label.length * 13 + 22);
  const h = 26;
  const groupCx = b.x + b.w / 2;

  /* ---- 方向判据：优先「相对共同父节点」，缺失时退回「相对画布中心」 ---- */
  let canvasCx = b.x + b.w / 2;
  if (allPos && allPos.size > 0) {
    let min = Infinity;
    let max = -Infinity;
    for (const o of allPos.values()) {
      min = Math.min(min, o.x);
      max = Math.max(max, o.x + o.w);
    }
    if (Number.isFinite(min) && Number.isFinite(max)) canvasCx = (min + max) / 2;
  }
  const anchorCx = parentCx != null ? parentCx : canvasCx;
  // 在锚点左侧 → 继续往左外侧；右侧 → 继续往右外侧
  const side: 1 | -1 = groupCx < anchorCx - 1 ? -1 : 1;

  /* ---- 括号的纵向跨度：首个节点中心 → 末个节点中心 ---- */
  let topY = Infinity;
  let botY = -Infinity;
  for (const id of nodeIds) {
    const o = pos.get(id);
    if (!o) continue;
    topY = Math.min(topY, o.y + o.h / 2);
    botY = Math.max(botY, o.y + o.h / 2);
  }
  if (!Number.isFinite(topY) || !Number.isFinite(botY)) {
    topY = b.y + 4;
    botY = b.y + b.h - 4;
  }
  if (botY - topY < 12) {
    // 单节点（或纵向几乎重合）：给一个矮括号，避免退化成一条直线
    const c = (topY + botY) / 2;
    topY = c - 12;
    botY = c + 12;
  }
  const midY = (topY + botY) / 2;

  /* ---- 横向：尖端贴节点组外缘，腰部朝概要框方向鼓 ---- */
  const GAP = 22; // 括号尖端 ↔ 节点组外缘
  const LINK = 20; // 腰部 → 概要框内侧边缘的连接线长度
  const span = botY - topY;
  // 鼓包随组高自适应：太扁的两瓣合起来不像弧线，太深又显得笨重
  const BELLY = Math.max(10, Math.min(34, span * 0.34));
  const outerEdge = side === 1 ? b.x + b.w : b.x;

  /** push = 避让外推量（px） */
  const layout = (push: number) => {
    const tipX = outerEdge + side * (GAP + push);
    const bellyX = tipX + side * BELLY;
    const innerX = bellyX + side * LINK;
    return {
      tipX,
      bellyX,
      box: { x: side === 1 ? innerX : innerX - labelW, y: midY - h / 2, w: labelW, h } as Box,
    };
  };

  /** 概要框占位是否与「组外节点」相撞 */
  const hits = (box: Box): boolean => {
    if (!allPos) return false;
    for (const [id, o] of allPos) {
      if (inGroup.has(id)) continue;
      const overlapX = box.x < o.x + o.w && box.x + box.w > o.x;
      const overlapY = box.y < o.y + o.h && box.y + box.h > o.y;
      if (overlapX && overlapY) return true;
    }
    return false;
  };

  // 避让：把「括号 + 概要框」整体外推，最多 6 次
  let push = 0;
  for (let i = 0; i < 6; i += 1) {
    if (!hits(layout(push).box)) break;
    push += 26;
  }

  const { tipX, bellyX, box } = layout(push);

  /**
   * 括号形状：**一条**连续弧线（`C` 形），不是两瓣。
   *
   * 关键：三次贝塞尔的两个控制点**都放在腰线上**（x = bellyX）。
   * 这样腰部（t=0.5）恰好落在 bellyX，形成唯一的鼓包；
   * 若像旧写法那样把中点收回 tipX，腰部会向内凹出尖角、
   * 鼓包被挤到上下两端，视觉上就成了「B」形双瓣。
   *
   * 上半段：M(tipX, topY) C(bellyX, topY) (bellyX, midY) → (bellyX, midY)
   * 下半段：(bellyX, midY) C(bellyX, botY) (tipX, botY) → (tipX, botY)
   * 两段在腰部同为竖直切线，接缝处切线连续（视觉上就是一条整弧）。
   */
  const brace =
    `M ${tipX} ${topY} C ${bellyX} ${topY}, ${bellyX} ${midY}, ${bellyX} ${midY} ` +
    `C ${bellyX} ${midY}, ${bellyX} ${botY}, ${tipX} ${botY}`;

  // 连接线：括号腰部 → 概要框的内侧边缘
  const link = `M ${bellyX} ${midY} L ${box.x + (side === 1 ? 0 : box.w)} ${midY}`;
  return { brace, link, box, label, color, side };
}

export interface FrameGroupGeom {
  box: Box;
  label: string;
  color: string;
}

/** 分组框几何：节点集合的包围盒外扩 padding，虚线圆角矩形 */
export function frameGroupGeom(
  nodeIds: string[],
  pos: Map<string, Box>,
  label: string,
  color: string,
  pad = 14
): FrameGroupGeom | null {
  const b = boundsOf(nodeIds, pos);
  if (!b) return null;
  return {
    box: { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 },
    label,
    color,
  };
}

/** 在树里按 id 找节点（ExtrasLayer 只持有根节点引用 + 节点 id 列表） */
function findNodeById(root: NodeLike, id: string): MindNode | null {
  if (root.id === id) return root as unknown as MindNode;
  let found: MindNode | null = null;
  const walk = (n: NodeLike & MindNode): void => {
    if (found) return;
    if (n.id === id) {
      found = n;
      return;
    }
    for (const c of n.children as NodeLike[]) walk(c as NodeLike & MindNode);
  };
  walk(root as unknown as NodeLike & MindNode);
  return found;
}

/** 节点是否带任何补齐项（供渲染层短路判断，避免无谓分支） */
export function hasExtras(n: { image?: unknown; formula?: unknown; frame?: unknown; generalization?: unknown; tags?: unknown }): boolean {
  return Boolean(
    n.image || n.formula || n.frame || n.generalization || (Array.isArray(n.tags) && n.tags.length > 0)
  );
}

/**
 * 求一组节点的**最低公共祖先**中心 x，用作概要的方向锚点。
 *
 * 为什么必须是祖先而不是画布中心：概要要落在「顺着分支继续往外」的一侧，
 * 而「往外」是由父节点位置定义的。用户截图里两组分别是
 * 「技术选型 →（左）Go+Gin / Redis锁 / MySQL分表」与
 * 「对接 baseServ →（右）开台消息 / 幂等与重试」，
 * 只有拿父节点当锚点才能判出「一组在左、一组在右」。
 *
 * 找不到公共祖先（跨子树乱选 / id 不全）时返回 null，
 * 由 `summaryGroupGeom` 退回画布中心判据。
 */
export function commonAncestorCx(
  root: NodeLike,
  nodeIds: string[],
  pos: Map<string, Box>
): number | null {
  if (nodeIds.length === 0) return null;
  /** id → 从根到该节点的 id 路径（含自身） */
  const paths = new Map<string, string[]>();
  const walk = (n: NodeLike, path: string[]): void => {
    const next = [...path, n.id];
    paths.set(n.id, next);
    for (const c of n.children) walk(c, next);
  };
  walk(root, []);

  let common: string[] | null = null;
  for (const id of nodeIds) {
    const p = paths.get(id);
    if (!p) return null; // 有 id 不在树里，锚点不可信
    if (!common) {
      common = p;
      continue;
    }
    let i = 0;
    while (i < common.length && i < p.length && common[i] === p[i]) i += 1;
    common = common.slice(0, i);
    if (common.length === 0) return null;
  }
  if (!common) return null;
  // 公共祖先若自己也在被选集合里（选的是「父 + 自己的子节点」），
  // 方向应由上一级决定，否则会把自己当锚点得出恒为右侧的结论
  if (nodeIds.includes(common[common.length - 1]) && common.length > 1) {
    common = common.slice(0, common.length - 1);
  }
  const anchorId = common[common.length - 1];
  const box = pos.get(anchorId);
  return box ? box.x + box.w / 2 : null;
}

/* ------------------------------------------------------------------ *
 * 概要 / 分组框文案的「可编辑目标」：双击画布 → 内联编辑
 * ------------------------------------------------------------------ */

/**
 * 一个可编辑目标（画布坐标系）。`x/y/w/h` 与 ExtrasLayer 里实际画出的
 * 概要框 / 分组标题胶囊严格对齐，于是内联输入框能严丝合缝盖在原文案上。
 */
export interface ExtrasTarget {
  kind: "summary" | "frame";
  id: string;
  /** 当前文案（进入编辑态时用初值） */
  value: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** 输入框字号：与 ExtrasLayer 里画出来的字号一致，缩放时才不跳字 */
  fontSize: number;
}

type ExtraRoot = NodeLike & {
  summaryGroups?: MindSummaryGroup[];
  frameGroups?: MindFrameGroup[];
};

/**
 * 分组标题胶囊的尺寸常量——必须与 ExtrasLayer 里画胶囊的那段保持一致
 * （那里是 `width = label.length * 12 + 14`、`height = 18`、偏移 `+8/+2`）。
 */
const FRAME_LABEL = { charW: 12, padX: 14, h: 18, offX: 8, offY: 2 } as const;

/** 把某个概要 / 分组框解析成可编辑目标；找不到（id 过期 / 几何退化）返回 null */
export function extrasEditTarget(
  root: ExtraRoot,
  boxes: Map<string, Box>,
  kind: "summary" | "frame",
  id: string
): ExtrasTarget | null {
  if (kind === "summary") {
    const g = root.summaryGroups?.find((s) => s.id === id);
    if (!g) return null;
    const geom = summaryGroupGeom(
      g.nodeIds,
      boxes,
      g.text || "概要",
      g.color || "#7c879b",
      boxes,
      commonAncestorCx(root, g.nodeIds, boxes)
    );
    if (!geom) return null;
    return {
      kind,
      id,
      value: g.text || "概要",
      x: geom.box.x,
      y: geom.box.y,
      w: geom.box.w,
      h: geom.box.h,
      fontSize: 12,
    };
  }
  const g = root.frameGroups?.find((s) => s.id === id);
  if (!g) return null;
  const text = g.label ?? "";
  const geom = frameGroupGeom(g.nodeIds, boxes, text, g.color || "#8b95a5", text ? 20 : 14);
  if (!geom) return null;
  return {
    kind,
    id,
    value: text,
    x: geom.box.x + FRAME_LABEL.offX,
    y: geom.box.y + FRAME_LABEL.offY,
    w: Math.max(FRAME_LABEL.charW * text.length + FRAME_LABEL.padX, 46),
    h: FRAME_LABEL.h,
    fontSize: 11,
  };
}

/**
 * 双击命中测试：给一个画布坐标，判断它落在哪个**可编辑文案**上。
 *
 * 分组框分两档命中：
 * 1. 标题胶囊本身（最直觉）；
 * 2. 框内空白处——但要求没压到任何节点，否则双击会变成「编辑节点文字」。
 *
 * 概要框整体都可命中（它本来就小，且画在节点之外不会误伤）。
 */
export function extrasHitTest(
  root: ExtraRoot,
  boxes: Map<string, Box>,
  px: number,
  py: number
): ExtrasTarget | null {
  /* 概要框优先：位置靠外，先判它不会误吞分组框 */
  for (const g of root.summaryGroups ?? []) {
    const t = extrasEditTarget(root, boxes, "summary", g.id);
    if (!t) continue;
    if (px >= t.x - 4 && px <= t.x + t.w + 4 && py >= t.y - 4 && py <= t.y + t.h + 4) return t;
  }

  for (const g of root.frameGroups ?? []) {
    const t = extrasEditTarget(root, boxes, "frame", g.id);
    if (!t) continue;
    // 1) 标题胶囊（外扩 3px，方便点中）
    if (px >= t.x - 3 && px <= t.x + t.w + 3 && py >= t.y - 3 && py <= t.y + t.h + 3) return t;
    // 2) 框内空白处
    const geom = frameGroupGeom(
      g.nodeIds,
      boxes,
      g.label ?? "",
      g.color || "#8b95a5",
      g.label ? 20 : 14
    );
    if (!geom) continue;
    const b = geom.box;
    if (px < b.x || px > b.x + b.w || py < b.y || py > b.y + b.h) continue;
    let overNode = false;
    for (const o of boxes.values()) {
      if (px >= o.x && px <= o.x + o.w && py >= o.y && py <= o.y + o.h) {
        overNode = true;
        break;
      }
    }
    if (!overNode) return t;
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * 图层：关联线 / 外框 / 概要（统一画在连线之上、节点之下）
 * ------------------------------------------------------------------ */

/** 收集从 startId 出发的可见子树 id（尊重 collapsed，被收起的分支不参与） */
function visibleDescendants(node: NodeLike, out: string[] = []): string[] {
  out.push(node.id);
  if (node.collapsed) return out;
  for (const c of node.children) visibleDescendants(c, out);
  return out;
}

interface NodeLike {
  id: string;
  collapsed?: boolean;
  children: NodeLike[];
}

export function ExtrasLayer({
  root,
  nodes,
  handDrawn,
  handJitter = 1.5,
}: {
  root: NodeLike & {
    assocLines?: MindAssocLine[];
    summaryGroups?: MindSummaryGroup[];
    frameGroups?: MindFrameGroup[];
  };
  nodes: { id: string; x: number; y: number; w: number; h: number }[];
  /** 手绘主题：外框/概要框改用手绘抖动路径 */
  handDrawn?: boolean;
  handJitter?: number;
}) {
  const boxes: Map<string, Box> = new Map();
  for (const p of nodes) boxes.set(p.id, { x: p.x, y: p.y, w: p.w, h: p.h });

  const assocGeom = root.assocLines?.length ? buildAssocGeom(root.assocLines, boxes) : [];

  const frames: { box: Box; color: string; label: string }[] = [];
  const gens: { box: Box; d: string; color: string; label: string }[] = [];
  for (const p of nodes) {
    const node = findNodeById(root, p.id);
    if (!node) continue;
    if (node.frame) {
      const ids = visibleDescendants(node);
      const b = boundsOf(ids, boxes);
      if (b) {
        // 有标签时上边距额外撑开，标签画在框内（见下方 frameGeoms 的同类处理）
        const pad = node.frame.label ? 20 : 12;
        frames.push({
          box: { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 },
          color: node.frame.color || "#2f6fed",
          label: node.frame.label || "",
        });
      }
    }
    if (node.generalization?.targetId) {
      const label = node.generalization.text || "概要";
      const g = generalizationGeom(node.id, node.generalization.targetId, boxes, label);
      if (g) gens.push({ box: g.box, d: g.d, color: g.color, label });
    }
  }

  /* ---------------- 多选聚合：概要（截图 3）/ 分组框（截图 4） ---------------- */

  const summaryGeoms = (root.summaryGroups ?? [])
    .map((g) =>
      summaryGroupGeom(
        g.nodeIds,
        boxes,
        g.text || "概要",
        g.color || "#7c879b",
        boxes,
        commonAncestorCx(root, g.nodeIds, boxes)
      )
    )
    .filter((g): g is SummaryGeom => g !== null);

  /**
   * 分组框内边距要能容下标签：截图 4 的标签压在框线上，
   * 因此含标签时把框的上边距额外撑开一段，标签画在框内左上角，
   * 避免被上层节点（绘制顺序在后）盖住。
   */
  const frameGeoms = (root.frameGroups ?? [])
    .map((g) => {
      const pad = g.label ? 20 : 14;
      return frameGroupGeom(g.nodeIds, boxes, g.label || "", g.color || "#8b95a5", pad);
    })
    .filter((g): g is FrameGroupGeom => g !== null);

  if (!assocGeom.length && !frames.length && !gens.length && !summaryGeoms.length && !frameGeoms.length) {
    return null;
  }

  return (
    <g className="mm-extras" style={{ pointerEvents: "none" }}>
      {/* 逐节点外框（子树汇总） */}
      {frames.map((f) => (
        <g key={`frame-${f.box.x}-${f.box.y}`}>
          {handDrawn ? (
            /* 手绘：子树外框同样走双笔触，笔法与节点外框一致 */
            sketchRect(f.box.x, f.box.y, f.box.w, f.box.h, 14, `nframe-${f.box.x}-${f.box.y}`, {
              amp: handJitter,
              gap: 2.2,
            }).map((pd, k) => (
              <path
                key={`nfs${k}`}
                d={pd}
                fill="none"
                stroke={f.color}
                strokeWidth={k === 0 ? 1.5 : 1.3}
                strokeDasharray="8 6"
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={0.85}
              />
            ))
          ) : (
          <rect
            x={f.box.x}
            y={f.box.y}
            width={f.box.w}
            height={f.box.h}
            rx={14}
            ry={14}
            fill="none"
            stroke={f.color}
            strokeWidth={1.5}
            strokeDasharray="8 6"
            opacity={0.85}
          />
          )}
          {f.label && (
            /* 同样贴在框内，避免被上层节点遮挡 */
            <g>
              <rect
                x={f.box.x + 8}
                y={f.box.y + 2}
                width={f.label.length * 12 + 14}
                height={18}
                rx={9}
                ry={9}
                fill="#fff"
                stroke={f.color}
                strokeWidth={1}
              />
              <text
                x={f.box.x + 15}
                y={f.box.y + 15}
                fontSize={11}
                fill={f.color}
                fontWeight={600}
              >
                {f.label}
              </text>
            </g>
          )}
        </g>
      ))}

      {/* 多选分组框（截图 4）：虚线圆角框 + 左上角标签 */}
      {frameGeoms.map((f, i) => (
        <g key={`fgroup-${i}`}>
          {handDrawn ? (
            /* 手绘：分组框改走「双笔触」圆角框（两道线在角点收拢交叉） */
            sketchRect(f.box.x, f.box.y, f.box.w, f.box.h, 16, `fg${i}`, {
              amp: handJitter,
              gap: 2.2,
            }).map((pd, k) => (
              <path
                key={`fhs${k}`}
                d={pd}
                fill="none"
                stroke={f.color}
                strokeWidth={k === 0 ? 1.6 : 1.35}
                strokeDasharray="9 6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))
          ) : (
            <rect
              x={f.box.x}
              y={f.box.y}
              width={f.box.w}
              height={f.box.h}
              rx={16}
              ry={16}
              fill="none"
              stroke={f.color}
              strokeWidth={1.6}
              strokeDasharray="9 6"
            />
          )}
          {f.label && (
            /* 标签贴在框线内侧左上角：ExtrasLayer 画在节点之下，
               放框外会被上层节点遮住，放框内并留出上边距即可稳定可见 */
            <g>
              <rect
                x={f.box.x + 8}
                y={f.box.y + 2}
                width={f.label.length * 12 + 14}
                height={18}
                rx={9}
                ry={9}
                fill="#fff"
                stroke={f.color}
                strokeWidth={1}
              />
              <text
                x={f.box.x + 15}
                y={f.box.y + 15}
                fontSize={11}
                fill={f.color}
                fontWeight={600}
              >
                {f.label}
              </text>
            </g>
          )}
        </g>
      ))}

      {/* 逐节点概要（子树汇总） */}
      {gens.map((g) => (
        <g key={`gen-${g.box.x}-${g.box.y}`}>
          {g.d && <path d={g.d} fill="none" stroke={g.color} strokeWidth={1.4} strokeDasharray="6 4" />}
          <rect x={g.box.x} y={g.box.y} width={g.box.w} height={g.box.h} rx={6} ry={6} fill="#fff" stroke={g.color} strokeWidth={1.2} strokeDasharray="5 3" />
          <text x={g.box.x + g.box.w / 2} y={g.box.y + g.box.h / 2 + 4} fontSize={11} fill={g.color} textAnchor="middle">
            {g.label}
          </text>
        </g>
      ))}

      {/* 多选概要（截图 3）：右侧括号 + 连接线 + 概要框 */}
      {summaryGeoms.map((s, i) => (
        <g key={`sgroup-${i}`}>
          {handDrawn ? (
            <>
              {/* 手绘：括号与连接线都走双笔触，笔法与外框/连线一致 */}
              {sketchPath(s.brace, `brace-${i}`, { amp: handJitter, gap: 1.7 }).map((pd, k) => (
                <path
                  key={`bs${k}`}
                  d={pd}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={k === 0 ? 1.8 : 1.5}
                  strokeLinecap="round"
                />
              ))}
              {sketchPath(s.link, `slink-${i}`, { amp: handJitter, gap: 1.6 }).map((pd, k) => (
                <path
                  key={`sl${k}`}
                  d={pd}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={k === 0 ? 1.4 : 1.15}
                  strokeLinecap="round"
                />
              ))}
            </>
          ) : (
            <>
              <path
                d={s.brace}
                fill="none"
                stroke={s.color}
                strokeWidth={1.8}
                strokeLinecap="round"
              />
              <path d={s.link} fill="none" stroke={s.color} strokeWidth={1.4} />
            </>
          )}
          <rect
            x={s.box.x}
            y={s.box.y}
            width={s.box.w}
            height={s.box.h}
            rx={8}
            ry={8}
            fill="#fff"
            stroke={s.color}
            strokeWidth={1.6}
          />
          <text
            x={s.box.x + s.box.w / 2}
            y={s.box.y + s.box.h / 2 + 4.5}
            fontSize={12}
            fill={s.color}
            textAnchor="middle"
            fontWeight={600}
          >
            {s.label}
          </text>
        </g>
      ))}

      {/* 关联线（截图 2）：虚线 + 目标端箭头 + 可选文案 */}
      {assocGeom.map((g) => (
        <g key={g.line.id}>
          {handDrawn ? (
            /* 手绘：双笔触虚线 + 空心 V 箭头（与参考截图的关联线同款笔法） */
            sketchPath(g.d, `assoc-${g.line.id}`, { amp: handJitter, gap: 1.7 }).map((pd, k) => (
              <path
                key={`as${k}`}
                d={pd}
                fill="none"
                stroke={g.color}
                strokeWidth={k === 0 ? 1.6 : 1.35}
                strokeDasharray="7 5"
                strokeLinecap="round"
              />
            ))
          ) : (
            <path
              d={g.d}
              fill="none"
              stroke={g.color}
              strokeWidth={1.6}
              strokeDasharray="7 5"
              strokeLinecap="round"
            />
          )}
          {g.arrow &&
            (handDrawn ? (
              sketchArrowHead(g.arrow.tip, g.arrow.dir, 11, 5, `aah-${g.line.id}`, {
                amp: handJitter,
              }).map((pd, k) => (
                <path
                  key={`aah${k}`}
                  d={pd}
                  fill="none"
                  stroke={g.color}
                  strokeWidth={1.7}
                  strokeLinecap="round"
                />
              ))
            ) : (
              <polygon points={assocArrowPoints(g.arrow.tip, g.arrow.dir, 11, 5)} fill={g.color} />
            ))}
          {g.line.label && (
            <g>
              <rect
                x={g.lx - (g.line.label.length * 12) / 2 - 6}
                y={g.ly - 9}
                width={(g.line.label || "").length * 12 + 12}
                height={18}
                rx={9}
                ry={9}
                fill="#fff"
                stroke={g.color}
                strokeWidth={1}
              />
              <text x={g.lx} y={g.ly + 4} fontSize={11} fill={g.color} textAnchor="middle">
                {g.line.label}
              </text>
            </g>
          )}
        </g>
      ))}
    </g>
  );
}

