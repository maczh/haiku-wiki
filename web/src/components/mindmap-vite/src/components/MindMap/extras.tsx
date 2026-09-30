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
import type { MindAssocLine, MindNode } from "./types";

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

export interface AssocLineGeom {
  line: MindAssocLine;
  d: string;
  lx: number;
  ly: number;
  color: string;
}

/** 由节点盒集合计算关联线几何（自源节点右缘出、目标节点左缘入，三次贝塞尔） */
export function buildAssocGeom(
  lines: MindAssocLine[],
  pos: Map<string, { x: number; y: number; w: number; h: number }>,
): AssocLineGeom[] {
  const out: AssocLineGeom[] = [];
  for (const line of lines) {
    const a = pos.get(line.fromId);
    const b = pos.get(line.toId);
    if (!a || !b) continue;
    const x1 = a.x + a.w;
    const y1 = a.y + a.h / 2;
    const x2 = b.x;
    const y2 = b.y + b.h / 2;
    const mx = (x1 + x2) / 2;
    out.push({
      line,
      d: `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`,
      lx: mx,
      ly: (y1 + y2) / 2,
      color: line.color || "#2f6fed",
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
}: {
  root: NodeLike & { assocLines?: MindAssocLine[] };
  nodes: { id: string; x: number; y: number; w: number; h: number }[];
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
        const pad = 12;
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

  if (!assocGeom.length && !frames.length && !gens.length) return null;

  return (
    <g className="mm-extras" style={{ pointerEvents: "none" }}>
      {frames.map((f) => (
        <g key={`frame-${f.box.x}-${f.box.y}`}>
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
          {f.label && (
            <text x={f.box.x + 8} y={f.box.y - 4} fontSize={11} fill={f.color} fontWeight={600}>
              {f.label}
            </text>
          )}
        </g>
      ))}

      {gens.map((g) => (
        <g key={`gen-${g.box.x}-${g.box.y}`}>
          {g.d && <path d={g.d} fill="none" stroke={g.color} strokeWidth={1.4} strokeDasharray="6 4" />}
          <rect x={g.box.x} y={g.box.y} width={g.box.w} height={g.box.h} rx={6} ry={6} fill="#fff" stroke={g.color} strokeWidth={1.2} strokeDasharray="5 3" />
          <text x={g.box.x + g.box.w / 2} y={g.box.y + g.box.h / 2 + 4} fontSize={11} fill={g.color} textAnchor="middle">
            {g.label}
          </text>
        </g>
      ))}

      {assocGeom.map((g) => (
        <g key={g.line.id}>
          <path d={g.d} fill="none" stroke={g.color} strokeWidth={1.6} strokeDasharray="7 5" />
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

