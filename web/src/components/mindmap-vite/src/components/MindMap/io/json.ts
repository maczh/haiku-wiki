import type {
  MindAssocLine,
  MindFrameGroup,
  MindNode,
  MindNodeStyle,
  MindSummaryGroup,
} from "../types";
import { uid } from "../tree";

/** 有道 / KityMinder 扁平节点 */
export interface FlatNode {
  id?: string;
  isroot?: boolean;
  topic?: string;
  text?: string;
  parentid?: string | null;
  expanded?: boolean;
  color?: string;
  style?: Record<string, unknown>;
  customStyle?: Record<string, unknown>;
  markers?: string[];
  note?: string;
  hyperlink?: string;
  link?: string;
  [key: string]: unknown;
}

interface NestedRaw {
  id?: string;
  topic?: string;
  text?: string;
  title?: string;
  expanded?: boolean;
  color?: string;
  style?: Record<string, unknown>;
  customStyle?: Record<string, unknown>;
  markers?: string[];
  note?: string;
  hyperlink?: string;
  link?: string;
  /** simple-mind-map 把内容放在 data 里 */
  data?: Record<string, unknown>;
  children?: NestedRaw[] | { attached?: NestedRaw[] };
  [key: string]: unknown;
}

const num = (v: unknown): number | undefined => {
  const n = typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : undefined;
};

/** 优先级落在 1–9 */
const clampPri = (v: unknown): number | undefined => {
  const n = num(v);
  return n == null ? undefined : Math.min(9, Math.max(1, Math.round(n)));
};
/** 进度落在 0–10（每级 10%） */
const clampProg = (v: unknown): number | undefined => {
  const n = num(v);
  return n == null ? undefined : Math.min(10, Math.max(0, Math.round(n)));
};

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v !== "" ? v : undefined;

/** 把各种风格化字段（KityMinder style / simple-mind-map data）映射成 MindNodeStyle */
function readStyle(...sources: (Record<string, unknown> | undefined)[]): MindNodeStyle | undefined {
  const style: MindNodeStyle = {};
  let has = false;
  for (const s of sources) {
    if (!s) continue;
    const size = num(s.fontSize ?? s["font-size"]);
    if (size) (style.fontSize = size), (has = true);
    const family = str(s.fontFamily ?? s["font-family"]);
    if (family) (style.fontFamily = family), (has = true);
    const weight = s.fontWeight ?? s["font-weight"];
    if (weight === "bold" || weight === 700 || weight === "700" || weight === true) {
      style.bold = true;
      has = true;
    }
    if (s.fontStyle === "italic" || s.italic === true) {
      style.italic = true;
      has = true;
    }
    const deco = s.textDecoration ?? s["text-decoration"];
    if (typeof deco === "string") {
      if (deco.includes("underline")) (style.underline = true), (has = true);
      if (deco.includes("line-through")) (style.strike = true), (has = true);
    }
    if (s.underline === true) (style.underline = true), (has = true);
    if (s.strike === true || s["line-through"] === true) (style.strike = true), (has = true);
    const color = str(s.color ?? s.fontColor ?? s["font-color"]);
    if (color) (style.color = color), (has = true);
    const bg = str(s.fillColor ?? s.background ?? s["background-color"]);
    if (bg) (style.background = bg), (has = true);
    const border = str(s.borderColor ?? s["border-color"] ?? s["line-color"]);
    if (border) (style.borderColor = border), (has = true);
    // 节点外框线型：实线 / 虚线 / 点线 / 点划线
    const bs = str(s.borderStyle ?? s["border-style"]);
    if (bs === "solid" || bs === "dashed" || bs === "dotted" || bs === "dashdot") {
      style.borderStyle = bs;
      has = true;
    }
    // 节点形状
    const sh = str(s.shape ?? s["border-radius-shape"]);
    if (sh === "rect" || sh === "rounded" || sh === "capsule" || sh === "underline" || sh === "none") {
      style.shape = sh;
      has = true;
    }
  }
  return has ? style : undefined;
}

function readMarkers(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v
    .map((m) =>
      typeof m === "string"
        ? m
        : typeof m === "object" && m
        ? str((m as Record<string, unknown>).markerId) ??
          str((m as Record<string, unknown>).id)
        : undefined
    )
    .filter(Boolean) as string[];
  return out.length ? out : undefined;
}

function readNote(v: unknown): string | undefined {
  if (typeof v === "string") return str(v);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const plain = o.plain as Record<string, unknown> | undefined;
    if (plain) return str(plain.content);
    return str(o.content) ?? str(o.text);
  }
  return undefined;
}

/** 把嵌套结构（KityMinder json / simple-mind-map）转成内部树 */
export function fromNested(raw: NestedRaw, isRoot = true): MindNode {
  const d = (raw.data ?? {}) as Record<string, unknown>;
  const title =
    str(raw.topic) ??
    str(d.text) ??
    str(raw.text) ??
    str(raw.title) ??
    (isRoot ? "中心主题" : "分支主题");

  let kidsRaw: NestedRaw[] = [];
  if (Array.isArray(raw.children)) kidsRaw = raw.children;
  else if (raw.children && Array.isArray((raw.children as { attached?: NestedRaw[] }).attached)) {
    kidsRaw = (raw.children as { attached?: NestedRaw[] }).attached!;
  }

  const style = readStyle(
    raw.style,
    raw.customStyle,
    d,
    raw as Record<string, unknown>
  );

  const expanded = raw.expanded ?? (d.expand as boolean | undefined);

  const priority = num(raw.priority ?? d.priority);
  const progress = num(raw.progress ?? d.progress);
  const icons = readIcons(raw.icons ?? d.icons);

  // 根节点专属的聚合字段（关联线 / 概要 / 分组框），非根节点不读取
  const assocLines = isRoot ? readAssocLines(raw.assocLines ?? d.assocLines) : undefined;
  const summaryGroups = isRoot ? readSummaryGroups(raw.summaryGroups ?? d.summaryGroups) : undefined;
  const frameGroups = isRoot ? readFrameGroups(raw.frameGroups ?? d.frameGroups) : undefined;

  return {
    id: str(raw.id) ?? str(d.uid) ?? uid(),
    title,
    children: kidsRaw.map((c) => fromNested(c, false)),
    collapsed: expanded === false ? true : undefined,
    color: str(raw.color) ?? str(d.color) ?? undefined,
    style,
    markers: readMarkers(raw.markers ?? d.icon ?? d.tag),
    note: readNote(raw.note ?? d.note),
    link: str(raw.hyperlink ?? raw.link ?? d.hyperlink) ?? undefined,
    priority: priority != null ? Math.min(9, Math.max(1, Math.round(priority))) : undefined,
    progress: progress != null ? Math.min(10, Math.max(0, Math.round(progress))) : undefined,
    icons,
    isRoot: isRoot || undefined,
    assocLines,
    summaryGroups,
    frameGroups,
  };
}

/** 读取关联线数组（宽容处理：缺字段 / 类型不符一律丢弃该条） */
function readAssocLines(v: unknown): MindAssocLine[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v
    .map((raw, i) => {
      const o = (raw ?? {}) as Record<string, unknown>;
      const fromId = str(o.fromId ?? o.from);
      const toId = str(o.toId ?? o.to);
      if (!fromId || !toId || fromId === toId) return null;
      const arrowRaw = str(o.arrow);
      const arrow =
        arrowRaw === "in" || arrowRaw === "out" || arrowRaw === "none"
          ? arrowRaw
          : undefined;
      return {
        id: str(o.id) ?? `assoc-import-${i}`,
        fromId,
        toId,
        label: str(o.label),
        color: str(o.color),
        arrow,
      } as MindAssocLine;
    })
    .filter(Boolean) as MindAssocLine[];
  return out.length ? out : undefined;
}

/** 读取多选概要数组（nodeIds 至少 2 个才有效） */
function readSummaryGroups(v: unknown): MindSummaryGroup[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v
    .map((raw, i) => {
      const o = (raw ?? {}) as Record<string, unknown>;
      const nodeIds = Array.isArray(o.nodeIds)
        ? o.nodeIds.map((x) => str(x)).filter(Boolean) as string[]
        : [];
      if (nodeIds.length < 2) return null;
      return {
        id: str(o.id) ?? `sum-import-${i}`,
        nodeIds,
        text: str(o.text) ?? "概要",
        color: str(o.color),
      } as MindSummaryGroup;
    })
    .filter(Boolean) as MindSummaryGroup[];
  return out.length ? out : undefined;
}

/** 读取多选分组框数组（nodeIds 至少 1 个才有效） */
function readFrameGroups(v: unknown): MindFrameGroup[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v
    .map((raw, i) => {
      const o = (raw ?? {}) as Record<string, unknown>;
      const nodeIds = Array.isArray(o.nodeIds)
        ? o.nodeIds.map((x) => str(x)).filter(Boolean) as string[]
        : [];
      if (!nodeIds.length) return null;
      return {
        id: str(o.id) ?? `frm-import-${i}`,
        nodeIds,
        label: str(o.label),
        color: str(o.color),
      } as MindFrameGroup;
    })
    .filter(Boolean) as MindFrameGroup[];
  return out.length ? out : undefined;
}

/** 读取节点图标前缀（emoji id 列表） */
function readIcons(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v
    .map((m) => (typeof m === "string" ? m : ""))
    .filter(Boolean);
  return out.length ? out : undefined;
}

/** 把扁平 nodes 数组（有道 / KityMinder）转成内部树 */
export function fromFlat(nodes: FlatNode[]): MindNode {
  const map = new Map<string, MindNode>();
  const idOf = (n: FlatNode, i: number) => String(n.id ?? `flat-${i}`);
  let rootId: string | undefined;

  nodes.forEach((n, i) => {
    const id = idOf(n, i);
    const style = readStyle(n.style, n.customStyle, n as Record<string, unknown>);
    map.set(id, {
      id,
      title: String(n.topic ?? n.text ?? ""),
      children: [],
      collapsed: n.expanded === false ? true : undefined,
      color: str(n.color) ?? str(n.customStyle?.borderColor),
      style,
    markers: readMarkers(n.markers),
    note: readNote(n.note),
    link: str(n.hyperlink ?? n.link),
      priority: clampPri(n.priority),
      progress: clampProg(n.progress),
      icons: readIcons(n.icons),
    isRoot: n.isroot || undefined,
  });
    if (n.isroot) rootId = id;
  });

  nodes.forEach((n, i) => {
    const pid = n.parentid;
    if (pid != null && map.has(String(pid))) {
      map.get(String(pid))!.children.push(map.get(idOf(n, i))!);
    }
  });

  if (!rootId) {
    // 没有显式 root：根是「parentid 为空或指向不存在节点」的那个节点
    // （在合法树中通常唯一；若有多个候选则优先带 isroot 的）
    const candidates: Array<{ n: FlatNode; i: number }> = [];
    nodes.forEach((n, i) => {
      const pid = n.parentid;
      if (pid == null || !map.has(String(pid))) candidates.push({ n, i });
    });
    if (candidates.length) {
      const pick = candidates.find((c) => c.n.isroot) ?? candidates[0];
      rootId = idOf(pick.n, pick.i);
    }
  }
  const root = rootId ? map.get(rootId) : undefined;
  if (!root) throw new Error("未找到根节点（isroot / parentid 结构异常）");
  root.isRoot = true;
  return root;
}

/** 识别并解析 KityMinder / 有道 / simple-mind-map 的 JSON 数据 */
export function parseMindmapJson(raw: unknown): MindNode {
  const obj = raw as Record<string, unknown>;
  if (!obj || typeof obj !== "object") throw new Error("JSON 内容不是对象");

  // simple-mind-map 结构：{ root: {...}, layout, theme, view }
  if (obj.root && typeof obj.root === "object") {
    return fromNested(obj.root as NestedRaw, true);
  }
  // 有道 / 扁平结构
  if (Array.isArray(obj.nodes)) {
    return fromFlat(obj.nodes as FlatNode[]);
  }
  // 数组：可能是 [sheet] 形式（XMind content.json）
  if (Array.isArray(raw)) {
    const sheet = raw[0] as Record<string, unknown> | undefined;
    const rootTopic = sheet?.rootTopic;
    if (rootTopic) return fromNested(rootTopic as NestedRaw, true);
  }
  // 自身就是一个嵌套节点
  if (obj.topic || obj.text || obj.title || obj.data) {
    return fromNested(obj as NestedRaw, true);
  }
  throw new Error("无法识别的思维导图 JSON 结构");
}
