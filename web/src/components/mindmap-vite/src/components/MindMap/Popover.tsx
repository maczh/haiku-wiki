import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

interface PopoverProps {
  /** 触发按钮内容 */
  trigger: (open: boolean) => ReactNode;
  children: (close: () => void) => ReactNode;
  title?: string;
  className?: string;
  width?: number;
  align?: "left" | "right";
}

/** 面板与触发器之间的间距 */
const GAP = 8;
/** 面板距视口边缘的最小留白 */
const EDGE = 8;
/** 面板最大高度占视口高度的比例 */
const MAX_RATIO = 0.72;

interface PanelPos {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
}

/**
 * 轻量下拉浮层：点击触发，点击外部 / Esc 关闭。
 *
 * 面板通过 Portal 挂载到 document.body 并使用 fixed 定位，
 * 因此不会被工具栏 / 画布容器的 `overflow: hidden` 裁剪，
 * 也不会被父级 z-index 层叠上下文压住。
 */
export function Popover({
  trigger,
  children,
  title,
  className,
  width = 200,
  align = "left",
}: PopoverProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<PanelPos | null>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  /** 依据触发器位置计算面板坐标；下方空间不足时自动上翻 */
  const place = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const w = Math.min(width, Math.max(120, vw - EDGE * 2));
    const maxHeight = Math.max(160, Math.min(vh * MAX_RATIO, vh - EDGE * 2));

    let left = align === "right" ? r.right - w : r.left;
    left = Math.min(Math.max(EDGE, left), Math.max(EDGE, vw - w - EDGE));

    const h = panelRef.current?.offsetHeight ?? 0;
    let top = r.bottom + GAP;
    if (h && top + h > vh - EDGE) {
      const above = r.top - GAP - h;
      top = above >= EDGE ? above : Math.max(EDGE, vh - EDGE - h);
    }

    setPos((prev) =>
      prev && prev.top === top && prev.left === left && prev.width === w && prev.maxHeight === maxHeight
        ? prev
        : { top, left, width: w, maxHeight }
    );
  }, [align, width]);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    place();
    // 面板挂载并测量到实际高度后再校正一次（处理上翻）
    const id = requestAnimationFrame(place);
    return () => cancelAnimationFrame(id);
  }, [open, place]);

  useEffect(() => {
    if (!open) return;

    const inside = (t: EventTarget | null) =>
      !!t &&
      (anchorRef.current?.contains(t as Node) === true ||
        panelRef.current?.contains(t as Node) === true);

    const onDocDown = (e: MouseEvent) => {
      if (!inside(e.target)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    const onScroll = () => place();
    const onResize = () => place();

    document.addEventListener("mousedown", onDocDown, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("mousedown", onDocDown, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open, place]);

  /** 面板内按下时保持画布焦点（表单控件除外），避免快捷键失效 */
  const keepCanvasFocus = (e: ReactMouseEvent) => {
    e.stopPropagation();
    const t = e.target as HTMLElement;
    if (t.closest("select, input, textarea, label")) return;
    e.preventDefault();
  };

  return (
    <div className={`mm-pop ${className ?? ""}`} ref={anchorRef}>
      <button
        type="button"
        className={`mm-tb-btn ${open ? "is-open" : ""}`}
        title={title}
        aria-expanded={open}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((v) => !v)}
      >
        {trigger(open)}
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={panelRef}
            className="mm-pop-panel"
            role="menu"
            style={{
              top: pos.top,
              left: pos.left,
              width: pos.width,
              maxHeight: pos.maxHeight,
            }}
            onMouseDown={keepCanvasFocus}
          >
            {children(() => setOpen(false))}
          </div>,
          document.body
        )}
    </div>
  );
}

/** 面板内的小标题 */
export function PopLabel({ children }: { children: ReactNode }) {
  return <div className="mm-pop-label">{children}</div>;
}

export default Popover;
