/**
 * 分支样式（截图 1）：在父节点与子节点之间生成「括号 / 圆弧 / 分叉」形态的连线。
 *
 * 与 `lineStyle`（curve / elbow / straight）正交：
 * - `lineStyle` 决定基础骨架怎么走（曲线还是折线）
 * - `branchStyle` 在骨架上再叠一层外壳，得到截图里那些「括号」观感
 *
 * 所有形状都保证**两端点 = 传入的锚点**，这样连线依然精确接在节点边缘。
 */

/** 一条分支连线的几何：由 MindMap.tsx 从 linkPath 解析得到 */
export interface BranchGeom {
  p0: { x: number; y: number };
  p1: { x: number; y: number };
  /** 起点切向（离开 p0 的方向） */
  v0: { x: number; y: number };
  /** 终点切向（进入 p1 的方向，指向 p1） */
  v1: { x: number; y: number };
  /** 是否为三次贝塞尔（曲线路径需要保留控制点形态） */
  cubic: boolean;
  /** 贝塞尔控制点（cubic 时有效） */
  c1?: { x: number; y: number };
  c2?: { x: number; y: number };
}

/** 按主轴方向取「垂直」单位向量 */
function perp(v: { x: number; y: number }) {
  const L = Math.hypot(v.x, v.y) || 1;
  return { x: (-v.y / L) * 1, y: (v.x / L) * 1 };
}

const f = (n: number) => (Math.round(n * 100) / 100).toString();

/** 以 g 为基准，沿 dir 移动 d */
const along = (g: { x: number; y: number }, dir: { x: number; y: number }, d: number) => ({
  x: g.x + dir.x * d,
  y: g.y + dir.y * d,
});

/**
 * 生成分支连线的 d。
 * `style` 为 default 时返回 null，表示「沿用基础骨架，不额外包装」。
 */
export function branchPath(
  style: string,
  g: BranchGeom,
  /** 括号类样式的横向进深（px） */
  depth = 18
): string | null {
  const { p0, p1, v0, v1, cubic, c1, c2 } = g;
  const dir = v0;
  const n = perp(dir);
  const dist = Math.hypot(p1.x - p0.x, p1.y - p0.y);
  // 进深不超过实际距离的 45%，否则短连线会出现「括号比线还长」的畸形
  const dep = Math.max(8, Math.min(depth, dist * 0.45));

  switch (style) {
    /* 左直角括号：先垂直出一段再水平进入（形如 ⌐ 转向） */
    case "bracket-left": {
      const a = along(p0, dir, dep);
      return `M ${f(p0.x)} ${f(p0.y)} L ${f(a.x)} ${f(a.y)} L ${f(p1.x)} ${f(p1.y)}`;
    }

    /* 右直角括号：进入前先垂直下沉，末端再水平收口 */
    case "bracket-right": {
      const a = along(p1, { x: -v1.x, y: -v1.y }, dep);
      return `M ${f(p0.x)} ${f(p0.y)} L ${f(a.x)} ${f(a.y)} L ${f(p1.x)} ${f(p1.y)}`;
    }

    /* 花括号：两段反向圆弧拼接，模拟 { 的收腰 */
    case "brace": {
      const d = dep * 1.15;
      const a = along(p0, dir, d);
      const b = along(p1, { x: -v1.x, y: -v1.y }, d);
      const bulge = { x: -n.x * d * 0.42, y: -n.y * d * 0.42 };
      const mid1 = { x: (p0.x + a.x) / 2 + bulge.x, y: (p0.y + a.y) / 2 + bulge.y };
      const mid2 = { x: (b.x + p1.x) / 2 + bulge.x, y: (b.y + p1.y) / 2 + bulge.y };
      return [
        `M ${f(p0.x)} ${f(p0.y)}`,
        `Q ${f(mid1.x)} ${f(mid1.y)} ${f(a.x)} ${f(a.y)}`,
        `Q ${f(mid1.x)} ${f(mid1.y)} ${f((a.x + b.x) / 2)} ${f((a.y + b.y) / 2)}`,
        `Q ${f(mid2.x)} ${f(mid2.y)} ${f(b.x)} ${f(b.y)}`,
        `Q ${f(mid2.x)} ${f(mid2.y)} ${f(p1.x)} ${f(p1.y)}`,
      ].join(" ");
    }

    /* 右圆弧：以法线右侧鼓出的贝塞尔（形如 ） */
    case "arc-right": {
      const bulge = dep * 0.85;
      return `M ${f(p0.x)} ${f(p0.y)} Q ${f(
        p0.x + dir.x * dep + n.x * bulge
      )} ${f(p0.y + dir.y * dep + n.y * bulge)} ${f(p1.x)} ${f(p1.y)}`;
    }

    /* 左圆弧：反向鼓出（形如 （） */
    case "arc-left": {
      const bulge = dep * 0.85;
      return `M ${f(p0.x)} ${f(p0.y)} Q ${f(
        p0.x + dir.x * dep - n.x * bulge
      )} ${f(p0.y + dir.y * dep - n.y * bulge)} ${f(p1.x)} ${f(p1.y)}`;
    }

    /* 分叉：父端分出两条腿再汇到子端（形如 Y） */
    case "fork": {
      const d = dep * 1.1;
      const a = along(p0, dir, d);
      const leg = dep * 0.5;
      return [
        `M ${f(p0.x)} ${f(p0.y)} L ${f(a.x)} ${f(a.y)}`,
        `M ${f(a.x + n.x * leg)} ${f(a.y + n.y * leg)} L ${f(p1.x)} ${f(p1.y)}`,
        `M ${f(a.x - n.x * leg)} ${f(a.y - n.y * leg)} L ${f(p1.x)} ${f(p1.y)}`,
      ].join(" ");
    }

    /* 钩形：先直线再回勾一个小尾巴（形如 ⌐ + 钩） */
    case "hook": {
      const d = dep * 0.7;
      const a = along(p0, dir, d);
      const b = along(p1, { x: -v1.x, y: -v1.y }, dep * 0.45);
      const tail = along(b, v1, dep * 0.3);
      return [
        `M ${f(p0.x)} ${f(p0.y)} L ${f(a.x)} ${f(a.y)} L ${f(p1.x)} ${f(p1.y)}`,
        `M ${f(b.x)} ${f(b.y)} L ${f(tail.x)} ${f(tail.y)}`,
      ].join(" ");
    }

    /* cubic 时若不套外壳，仍可选择「保留贝塞尔」形态 */
    default:
      if (cubic && c1 && c2) {
        return `M ${f(p0.x)} ${f(p0.y)} C ${f(c1.x)} ${f(c1.y)}, ${f(c2.x)} ${f(
          c2.y
        )}, ${f(p1.x)} ${f(p1.y)}`;
      }
      return null;
  }
}
