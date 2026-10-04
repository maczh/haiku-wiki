/**
 * 手绘风格路径生成 —— 仿参考截图的「双笔触炭笔手绘」。
 *
 * ## 与上一版「低频谐波抖动」的区别
 * 上一版把形状画成一条抖动的闭合曲线，追求的是「流畅」；
 * 参考截图里的手绘（XMind / rough.js 一路的手绘感）真正的识别特征是：
 *
 *   1. **双笔触**：每个轮廓 / 每根连线都画**两遍**，
 *      两笔在两端交汇、在中部错开约 1.5~2px —— 这就是截图里
 *      「一条线看着像两根平行线」的成因；
 *   2. **接缝收拢、中段张开**：两笔在角点附近几乎重合，
 *      笔尖处还略微**出头（overshoot）**，交叉出「勾」；
 *   3. **转角是圆的**：圆角矩形 / 椭圆的拐角由圆弧采样 + Catmull-Rom 过渡，
 *      不是切角；
 *   4. **空心箭头**：箭头不是实心三角，而是两根短线撑起的「V」；
 *   5. 端点**严格锚定**（连线两端仍精确贴住节点边缘），
 *      只有轮廓线与箭头允许出头。
 *
 * ## 硬约束：确定性
 * 抖动只依赖「几何 + 种子」，绝不使用 Math.random()。
 * 否则每次重渲染 / 每次导出 SVG 线条都会变样，缩略图与导出图对不上。
 */

interface Pt {
  x: number;
  y: number;
}

/** 字符串 → 32bit 种子（FNV-1a） */
function hashSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** 由种子导出一个稳定的 [0,1) 值 */
function rand01(seed: number, salt: number): number {
  let h = seed ^ Math.imul(salt + 1, 0x27d4eb2d);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 0x100000000;
}

/** 保留两位小数，避免 path 里出现一长串浮点误差 */
const f2 = (n: number) => (Math.round(n * 100) / 100).toString();

/**
 * 低频谐波叠加器 —— 手绘笔触的「灵魂」。
 * 用 3 个低频谐波（0.5 / 1 / 1.5）叠加，相位由种子决定：
 * 整体走势稳定，只在中段有缓慢摆动，收笔处自然回正。
 */
function wobble(
  seed: number,
  amp: number,
  t: number,
  anchor: "both" | "end" | "none" = "both"
): number {
  if (amp === 0) return 0;
  const f = [0.5, 1, 1.5];
  const w = [1, 0.45, 0.22];
  let v = 0;
  for (let k = 0; k < 3; k += 1) {
    const phase = rand01(seed, k) * Math.PI * 2;
    v += w[k] * Math.sin(2 * Math.PI * f[k] * t + phase);
  }
  v /= 1.67; // 归一到约 [-1,1]
  v *= amp;
  if (anchor === "both") v *= Math.sin(Math.PI * t);
  else if (anchor === "end") v *= 1 - t * t;
  return v;
}

/* ------------------------------------------------------------------ *
 * 采样 → 路径
 * ------------------------------------------------------------------ */

/**
 * Catmull-Rom 转到三次贝塞尔。
 *
 * ⚠️ 这里有个容易踩的坑：若用「中点作终点、当前点作控制点」的
 * `Q cur mid(cur,next)`，曲线会被拉直 —— 转角变成折线尖角，
 * 画出来是「切角矩形」，完全不像手绘。
 * 正确做法是控制点取「当前点 ± (邻点差)/6」，曲线才会穿过采样点并自然圆转。
 */
function catmullRom(pts: Pt[], close: boolean): string {
  const n = pts.length;
  if (n < 2) return "";
  const at = (i: number) => pts[(i + n) % n];
  const cmds: string[] = [`M ${f2(pts[0].x)} ${f2(pts[0].y)}`];
  const last = close ? n : n - 1;
  for (let i = 0; i < last; i += 1) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    cmds.push(
      `C ${f2(p1.x + (p2.x - p0.x) / 6)} ${f2(p1.y + (p2.y - p0.y) / 6)}, ` +
        `${f2(p2.x - (p3.x - p1.x) / 6)} ${f2(p2.y - (p3.y - p1.y) / 6)}, ` +
        `${f2(p2.x)} ${f2(p2.y)}`
    );
  }
  return `${cmds.join(" ")}${close ? " Z" : ""}`;
}

/** 折线 → path */
function polyline(pts: Pt[]): string {
  return `M ${pts.map((p) => `${f2(p.x)} ${f2(p.y)}`).join(" L ")}`;
}

/* ------------------------------------------------------------------ *
 * 双笔触
 * ------------------------------------------------------------------ */

/** 手绘笔触参数：`amp` 起伏，`gap` 双笔张开量，`overshoot` 端点出头 */
export interface SketchOptions {
  /** 起伏幅度（px） */
  amp?: number;
  /** 双笔在中部错开的最大距离（px） */
  gap?: number;
  /** 笔触条数（固定 2 笔，与参考截图一致） */
  passes?: number;
  /** 闭合轮廓的端点出头（px），模拟「一笔没收住」 */
  overshoot?: number;
  /** 开放笔触的采样段数 */
  segments?: number;
}

const normOpts = (o?: SketchOptions): Required<SketchOptions> => ({
  amp: o?.amp ?? 1.2,
  gap: o?.gap ?? 2.1,
  passes: o?.passes ?? 2,
  overshoot: o?.overshoot ?? 0,
  segments: o?.segments ?? 12,
});

/** 点集质心（法线朝向的基准） */
function centroid(pts: Pt[]): Pt {
  let x = 0;
  let y = 0;
  for (const p of pts) {
    x += p.x;
    y += p.y;
  }
  return { x: x / pts.length, y: y / pts.length };
}

/**
 * 第 i 个点处「背离质心」的单位外法线。
 * 用相邻点差分求切向再取垂线，比解析求法线更省事，且矩形 / 椭圆通用。
 */
function outwardNormal(pts: Pt[], i: number, c: Pt): Pt {
  const n = pts.length;
  const a = pts[(i - 1 + n) % n];
  const b = pts[(i + 1) % n];
  let tx = b.x - a.x;
  let ty = b.y - a.y;
  const L = Math.hypot(tx, ty) || 1;
  tx /= L;
  ty /= L;
  // 垂线两个方向，取与「点 - 质心」同向的那个
  let nx = -ty;
  let ny = tx;
  const rx = pts[i].x - c.x;
  const ry = pts[i].y - c.y;
  if (nx * rx + ny * ry < 0) {
    nx = -nx;
    ny = -ny;
  }
  return { x: nx, y: ny };
}

/**
 * 闭合凸轮廓的双笔触（矩形 / 椭圆共用）。
 *
 * 两笔沿外法线错开：`gap/2` 为基准，再乘一个「接缝处收拢、中段张开」
 * 的包络，最后叠加低频起伏 —— 于是两个笔触在角点附近几乎重合、
 * 在边的中段分得最开，正是参考截图那种「一笔画两遍」的形态。
 */
function sketchRing(
  base: Pt[],
  seed: string,
  o: Required<SketchOptions>
): string[] {
  const c = centroid(base);
  const normals = base.map((_, i) => outwardNormal(base, i, c));
  const n = base.length;
  const seedNum = hashSeed(seed);
  const paths: string[] = [];

  for (let k = 0; k < o.passes; k += 1) {
    const dir = k === 0 ? 1 : -1;
    // 相位偏移让两笔的起伏不同步，避免「两张一模一样的皮」
    const s = hashSeed(`${seedPurity(seedNum)}#${k}`);
    const ph = rand01(s, 7) * Math.PI * 2;
    const pts: Pt[] = [];
    for (let i = 0; i < n; i += 1) {
      const u = i / n;
      // 接缝（u=0 / u=1）处收拢到 0.25，中段张开到 1.0
      const env = 0.25 + 0.75 * Math.sin(Math.PI * u);
      const off =
        dir * (o.gap / 2) * env * (0.7 + 0.3 * Math.sin(2 * Math.PI * u + ph)) +
        wobble(s, o.amp, u, "none");
      pts.push({
        x: base[i].x + normals[i].x * off,
        y: base[i].y + normals[i].y * off,
      });
    }
    paths.push(catmullRom(pts, true));
  }
  return paths;
}

/** 种子稳定性：避免每次调用把同一个字符串再 hash 一次 */
function seedPurity(n: number): string {
  return `s${n.toString(36)}`;
}

/**
 * 开放笔触的双笔触（连线 / 箭头共用）。
 * 两端**严格锚定**（不偏移），错开量走 `sin(πt)` 包络 ——
 * 于是两笔在两端收成一个点、在中部平行分开，
 * 箭头尖端的两根线才会自然合拢。
 */
function sketchOpen(
  at: (t: number) => Pt,
  count: number,
  seed: string,
  o: Required<SketchOptions>
): string[] {
  const n = Math.max(4, count);
  const paths: string[] = [];
  for (let k = 0; k < o.passes; k += 1) {
    const dir = k === 0 ? 1 : -1;
    const s = hashSeed(`${seedPurity(hashSeed(seed))}#${k}`);
    const ph = rand01(s, 9) * Math.PI * 2;
    const pts: Pt[] = [];
    for (let i = 0; i <= n; i += 1) {
      const t = i / n;
      const p = at(t);
      if (i === 0 || i === n) {
        pts.push(p);
        continue;
      }
      // 端点法线：用前后邻点的差分近似
      const pa = at(Math.max(0, t - 1 / n));
      const pb = at(Math.min(1, t + 1 / n));
      let tx = pb.x - pa.x;
      let ty = pb.y - pa.y;
      const L = Math.hypot(tx, ty) || 1;
      tx /= L;
      ty /= L;
      const off =
        dir * (o.gap / 2) * Math.sin(Math.PI * t) +
        wobble(s, o.amp, t, "both") * (0.6 + 0.4 * Math.sin(Math.PI * t + ph));
      pts.push({ x: p.x - ty * off, y: p.y + tx * off });
    }
    paths.push(polyline(pts));
  }
  return paths;
}

/* ------------------------------------------------------------------ *
 * 对外：闭合轮廓
 * ------------------------------------------------------------------ */

/** 圆角矩形的基础采样环（四条直边 + 四个转角圆弧） */
function rectRing(x: number, y: number, w: number, h: number, r: number): Pt[] {
  const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  const EDGE = 6; // 每条直边采样点数（含首点）
  const ARC = 5; // 每 1/4 圆弧采样点数（含首点）
  // 转角多走 7% 圆周（约 6.5°），两笔的端点因此越过理论角点，
  // 在角上交叉出「勾」—— 手绘描边的标志。
  const SPAN = (Math.PI / 2) * 1.07;
  const pts: Pt[] = [];

  const seg = (ax: number, ay: number, bx: number, by: number) => {
    for (let i = 0; i < EDGE; i += 1) {
      const t = i / EDGE;
      pts.push({ x: ax + (bx - ax) * t, y: ay + (by - ay) * t });
    }
  };
  const arc = (cx: number, cy: number, a0: number, a1: number) => {
    for (let i = 0; i < ARC; i += 1) {
      const t = i / ARC;
      const a = a0 + (a1 - a0) * t;
      pts.push({ x: cx + Math.cos(a) * rr, y: cy + Math.sin(a) * rr });
    }
  };

  seg(x + rr, y, x + w - rr, y);
  arc(x + w - rr, y + rr, -Math.PI / 2, -Math.PI / 2 + SPAN);
  seg(x + w, y + rr, x + w, y + h - rr);
  arc(x + w - rr, y + h - rr, 0, SPAN);
  seg(x + w - rr, y + h, x + rr, y + h);
  arc(x + rr, y + h - rr, Math.PI / 2, Math.PI / 2 + SPAN);
  seg(x, y + h - rr, x, y + rr);
  arc(x + rr, y + rr, Math.PI, Math.PI + SPAN);
  return pts;
}

/** 椭圆基础采样环 */
function ellipseRing(cx: number, cy: number, rx: number, ry: number, n = 30): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < n; i += 1) {
    const a = (i / n) * Math.PI * 2;
    pts.push({ x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry });
  }
  return pts;
}

/**
 * 手绘圆角矩形：返回 2 条闭合笔触。
 * 第 0 笔基本在外、第 1 笔基本在内，两笔在角点处收拢交叉。
 */
export function sketchRect(
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  seed: string,
  o?: SketchOptions
): string[] {
  const opt = normOpts(o);
  const base = rectRing(x, y, w, h, r);
  return sketchRing(base, seed, opt);
}

/**
 * 手绘椭圆：返回 2 条闭合笔触。
 * 参考截图里中心节点就是**两道同心外框**，所以 gap 略大于矩形。
 */
export function sketchEllipse(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  seed: string,
  o?: SketchOptions
): string[] {
  const opt = normOpts(o);
  opt.gap = opt.gap * 1.35;
  const base = ellipseRing(cx, cy, rx, ry);
  return sketchRing(base, seed, opt);
}

/* ------------------------------------------------------------------ *
 * 对外：开放笔触
 * ------------------------------------------------------------------ */

/** 手绘直线（双笔触）：返回 2 条 path */
export function sketchLine(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  seed: string,
  o?: SketchOptions
): string[] {
  const opt = normOpts(o);
  const dx = x2 - x1;
  const dy = y2 - y1;
  return sketchOpen(
    (t) => ({ x: x1 + dx * t, y: y1 + dy * t }),
    opt.segments,
    seed,
    opt
  );
}

/** 手绘曲线（双笔触）：在原三次贝塞尔上采样后加笔触偏移 */
export function sketchCurve(
  p0: { x: number; y: number },
  c1: { x: number; y: number },
  c2: { x: number; y: number },
  p1: { x: number; y: number },
  seed: string,
  o?: SketchOptions
): string[] {
  const opt = normOpts(o);
  return sketchOpen((t) => {
    const u = 1 - t;
    return {
      x:
        u * u * u * p0.x +
        3 * u * u * t * c1.x +
        3 * u * t * t * c2.x +
        t * t * t * p1.x,
      y:
        u * u * u * p0.y +
        3 * u * u * t * c1.y +
        3 * u * t * t * c2.y +
        t * t * t * p1.y,
    };
  }, opt.segments, seed, opt);
}

/**
 * 任意「M / L / C」路径 → 双笔触 sketch 路径。
 *
 * 关联线、概要括号这类几何是别处直接拼出来的 `d`（含三次贝塞尔），
 * 不方便回头改成端点式调用；这里统一摊平成折线后套用同一套笔法，
 * 保证「每个笔画都画两遍」在全画布一致。
 *
 * @param d     形如 `M x y` / `M x y L x y …` / `M x y C c1 c2 x y` 的路径
 * @param seed  种子（同一条线必须给出同一 seed，否则每次渲染都在抖）
 */
export function sketchPath(d: string, seed: string, o?: SketchOptions): string[] {
  if (!d) return [];
  const nums = d.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  if (nums.length < 4) return [d];
  const opt = normOpts(o);
  const pts: Pt[] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) {
    pts.push({ x: nums[i], y: nums[i + 1] });
  }
  const isCubic = /\bC\b/.test(d) && pts.length >= 4;
  if (isCubic) {
    const [p0, c1, c2, p1] = pts;
    return sketchOpen(
      (t) => {
        const u = 1 - t;
        return {
          x: u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p1.x,
          y: u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p1.y,
        };
      },
      opt.segments,
      seed,
      opt
    );
  }
  // 折线：把 t 摊到「段索引 + 段内参数」上，保证采样密度均匀
  const m = Math.max(1, pts.length - 1);
  return sketchOpen(
    (t) => {
      const f = t * m;
      const i = Math.min(m - 1, Math.floor(f));
      const u = f - i;
      return {
        x: pts[i].x + (pts[i + 1].x - pts[i].x) * u,
        y: pts[i].y + (pts[i + 1].y - pts[i].y) * u,
      };
    },
    opt.segments,
    seed,
    opt
  );
}

/** 手绘箭头「V」（空心，两根短线）：返回 2 条 path */
export function sketchArrowHead(
  tip: { x: number; y: number },
  dir: { x: number; y: number },
  size: number,
  halfW: number,
  seed: string,
  o?: SketchOptions
): string[] {
  const opt = normOpts(o);
  opt.gap = 0; // 箭头两笔本身就是「分叉」，不再额外错开
  const bx = tip.x - dir.x * size;
  const by = tip.y - dir.y * size;
  const px = -dir.y * halfW;
  const py = dir.x * halfW;
  const a = sketchLine(bx + px, by + py, tip.x, tip.y, `${seed}-a0`, opt);
  const b = sketchLine(bx - px, by - py, tip.x, tip.y, `${seed}-a1`, opt);
  return [a[0], b[0]];
}

/* ------------------------------------------------------------------ *
 * 兼容导出（单笔返回，供需要单条 path 的下游使用）
 * ------------------------------------------------------------------ */

/**
 * 兼容导出：单笔墨迹（双笔中的第 0 条）。
 * 保留原签名，避免 index.ts 的公开导出与既有调用点断掉。
 */
export function handLine(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  seed: string,
  amp = 1.5,
  segments = 10
): string {
  return sketchLine(x1, y1, x2, y2, seed, { amp, segments })[0];
}

export function handCurve(
  p0: { x: number; y: number },
  c1: { x: number; y: number },
  c2: { x: number; y: number },
  p1: { x: number; y: number },
  seed: string,
  amp = 1.5
): string {
  return sketchCurve(p0, c1, c2, p1, seed, { amp })[0];
}

export function handRect(
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  seed: string,
  amp = 1.6
): string {
  return sketchRect(x, y, w, h, r, seed, { amp })[0];
}

export function handEllipse(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  seed: string,
  amp = 1.6
): string {
  return sketchEllipse(cx, cy, rx, ry, seed, { amp })[0];
}
