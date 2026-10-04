import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icons";

export interface MultiSelectBarProps {
  /** 被选节点包围盒（画布坐标系，未缩放） */
  bounds: { x: number; y: number; w: number; h: number } | null;
  /** 画布变换（节点坐标 → 容器像素） */
  transform: { tx: number; ty: number; scale: number };
  /** 选区下方空间不足时是否翻到上方 */
  preferBelow?: boolean;
  onAddAssoc: () => void;
  /** 点一下就落地：先画出概要弧线 + 概要文案，随后在画布上直接编辑文案 */
  onAddSummary: () => void;
  /** 点一下就落地：先画出分组框（含默认标题），随后双击可改标题 */
  onAddFrame: () => void;
  onClear: () => void;
}

interface Placed {
  top: number;
  left: number;
}

const GAP = 10;
const EDGE = 8;
const BAR_H = 44;

/**
 * 多选浮动条：选中 ≥2 个节点时浮现在选区旁（样式对齐右键菜单的半透明卡片）。
 *
 * 定位完全走 Portal + `position: fixed`，因此不会被画布容器的
 * `overflow: hidden` 裁掉；同时跟随画布的平移 / 缩放实时更新。
 */
export function MultiSelectBar({
  bounds,
  transform,
  preferBelow,
  onAddAssoc,
  onAddSummary,
  onAddFrame,
  onClear,
}: MultiSelectBarProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [placed, setPlaced] = useState<Placed | null>(null);

  /** 依据选区包围盒计算浮动条坐标：优先放在选区下方，空间不够则翻到上方 */
  const place = () => {
    const el = ref.current;
    if (!el || !bounds) return;
    const w = el.offsetWidth || 168;
    const h = el.offsetHeight || BAR_H;
    const stage = el.parentElement; // Portal 挂在 body 下，用视口兜底
    const vw = stage?.clientWidth ?? window.innerWidth;
    const vh = stage?.clientHeight ?? window.innerHeight;

    // 画布坐标 → 容器像素
    const cx = transform.tx + (bounds.x + bounds.w / 2) * transform.scale;
    const top0 = transform.ty + bounds.y * transform.scale;
    const bot0 = transform.ty + (bounds.y + bounds.h) * transform.scale;

    let top = preferBelow ? top0 : bot0 + GAP;
    if (top + h > vh - EDGE) {
      // 下方放不下 → 翻到上方；上方也放不下就贴边
      const above = (preferBelow ? bot0 + GAP : top0) - GAP - h;
      top = above >= EDGE ? above : Math.max(EDGE, Math.min(top, vh - EDGE - h));
    }
    const left = Math.min(Math.max(EDGE, cx - w / 2), Math.max(EDGE, vw - w - EDGE));
    setPlaced((prev) =>
      prev && Math.abs(prev.top - top) < 0.5 && Math.abs(prev.left - left) < 0.5
        ? prev
        : { top, left }
    );
  };

  useLayoutEffect(() => {
    place();
    const id = requestAnimationFrame(place);
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bounds?.x, bounds?.y, bounds?.w, bounds?.h, transform.tx, transform.ty, transform.scale]);

  useEffect(() => {
    const onMove = () => place();
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bounds, transform]);

  if (!bounds) return null;

  return createPortal(
    <div
      ref={ref}
      className="mm-msbar"
      style={placed ? { top: placed.top, left: placed.left } : { top: -9999, left: -9999 }}
      onContextMenu={(e) => e.preventDefault()}
      // 阻止冒泡：点浮动条不该触发画布的「空白点击清空选择」
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="mm-msbar-row">
        <button
          type="button"
          className="mm-msbar-btn"
          title="为所选节点添加关联线"
          onClick={() => onAddAssoc()}
        >
          <Icon name="assoc" size={19} />
          <span>关联线</span>
        </button>
        <button
          type="button"
          className="mm-msbar-btn"
          title="把所选节点汇总为一个概要（生成后可双击改文案）"
          onClick={() => onAddSummary()}
        >
          <Icon name="summary" size={19} />
          <span>概要</span>
        </button>
        <button
          type="button"
          className="mm-msbar-btn"
          title="把所选节点圈成分组框（生成后可双击改标题）"
          onClick={() => onAddFrame()}
        >
          <Icon name="group" size={19} />
          <span>分组</span>
        </button>
        <i className="mm-msbar-sep" />
        <button type="button" className="mm-msbar-btn is-ghost" title="取消多选" onClick={() => onClear()}>
          <Icon name="check" size={17} />
        </button>
      </div>
    </div>,
    document.body
  );
}

export default MultiSelectBar;
