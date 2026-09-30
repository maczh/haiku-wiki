import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { LayoutResult } from "./layout";

/** 缩略图宽度（仅宽度减半：190 → 95，高度保持不变） */
const MM_W = 95;
const MM_H = 124;
const PAD = 8;

interface MinimapProps {
  layout: LayoutResult;
  transform: { scale: number; tx: number; ty: number };
  stageWidth: number;
  stageHeight: number;
  onNavigate: (tx: number, ty: number) => void;
}

/**
 * 缩略图（位置预览）：渲染整张导图的小图，并叠加红色视口矩形；
 * 点击 / 拖拽可把画布中心移动到对应位置。
 */
export function Minimap({ layout, transform, stageWidth, stageHeight, onNavigate }: MinimapProps) {
  const dragging = useRef(false);
  const [hover, setHover] = useState(false);

  const LW = Math.max(layout.width, 1);
  const LH = Math.max(layout.height, 1);
  const scale = Math.min((MM_W - PAD * 2) / LW, (MM_H - PAD * 2) / LH);
  const ox = (MM_W - LW * scale) / 2;
  const oy = (MM_H - LH * scale) / 2;

  // 当前画布可见区域（世界坐标）
  const vx = -transform.tx / transform.scale;
  const vy = -transform.ty / transform.scale;
  const vw = stageWidth / transform.scale;
  const vh = stageHeight / transform.scale;

  // 把缩略图局部坐标换算为「居中到该点」的画布 transform
  const navigateToLocal = (mx: number, my: number) => {
    const wx = (mx - ox) / scale;
    const wy = (my - oy) / scale;
    const tx = stageWidth / 2 - wx * transform.scale;
    const ty = stageHeight / 2 - wy * transform.scale;
    onNavigate(tx, ty);
  };

  const onDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    dragging.current = true;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const rect = e.currentTarget.getBoundingClientRect();
    navigateToLocal(e.clientX - rect.left, e.clientY - rect.top);
  };
  const onMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!dragging.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    navigateToLocal(e.clientX - rect.left, e.clientY - rect.top);
  };
  const onUp = () => {
    dragging.current = false;
  };

  return (
    <div className={`mm-minimap ${hover ? "is-hover" : ""}`} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <svg
        width={MM_W}
        height={MM_H}
        viewBox={`0 0 ${MM_W} ${MM_H}`}
        className="mm-minimap-svg"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerLeave={onUp}
      >
        <rect x={0} y={0} width={MM_W} height={MM_H} rx={8} fill="#f7f8fa" />
        {layout.nodes.map((p) => {
          const isRoot = p.node.id === layout.rootPos.node.id;
          const x = ox + p.x * scale;
          const y = oy + p.y * scale;
          const w = Math.max(2, p.w * scale);
          const h = Math.max(1.5, p.h * scale);
          return (
            <rect
              key={p.node.id}
              x={x}
              y={y}
              width={w}
              height={h}
              rx={Math.min(2, h / 2)}
              fill={isRoot ? "#2f6fed" : "#c4c9d1"}
            />
          );
        })}
        {/* 视口矩形 */}
        <rect
          x={Math.max(0, ox + vx * scale)}
          y={Math.max(0, oy + vy * scale)}
          width={Math.min(MM_W, vw * scale)}
          height={Math.min(MM_H, vh * scale)}
          rx={3}
          fill="rgba(227, 77, 89, 0.12)"
          stroke="#e34d59"
          strokeWidth={1.5}
        />
      </svg>
      <span className="mm-minimap-tip">位置预览</span>
    </div>
  );
}

export default Minimap;
