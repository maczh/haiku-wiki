import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "./Icons";
import { PopLabel } from "./Popover";
import {
  BaseStylePanel,
  IconPanel,
  MarkerPanel,
  NodeStylePanel,
  PriorityPanel,
  ProgressPanel,
  StructurePanel,
  ThemePanel,
} from "./panels";
import type { BaseStyle, MindMapConfig, MindNodeStyle } from "./types";
import { EXPORT_LABELS, type ExportFormat } from "./io";

/* ------------------------------------------------------------------ *
 * 九宫格主菜单
 *
 * 需求：点九宫格弹出「包含工具条上所有功能」的主菜单，且含下级子菜单，
 * 功能与工具条一致。因此面板内容全部复用 `panels.tsx`，
 * 这里只负责**菜单骨架**（一级项 / 二级飞出面板 / 快捷键提示）。
 * ------------------------------------------------------------------ */

const GAP = 6;
const EDGE = 8;
const SUB_W = 244;
const SUB_H = 320;

export interface MainMenuItem {
  key: string;
  label: string;
  icon?: IconName;
  /** 键盘快捷键提示，渲染在右侧 */
  hint?: string;
  disabled?: boolean;
  /** 有下级子菜单时提供；返回 null 表示子菜单为空 */
  children?: () => ReactNode;
  /** 直接执行的动作（叶子项） */
  onSelect?: () => void;
}

export interface MainMenuProps {
  /**
   * 菜单项定义。接收 `close` 回调 —— 二级面板里的动作执行后
   * 应关掉整个主菜单，因此由容器把 close 注入到 items 构造过程。
   */
  buildItems: (close: () => void) => MainMenuItem[];
  /** 面板最大高度占视口比例 */
  maxRatio?: number;
}

/** 悬停延迟：掠过多个菜单项时不该让子菜单疯狂闪烁 */
const OPEN_DELAY = 90;
const CLOSE_DELAY = 180;

export function MainMenu({ buildItems, maxRatio = 0.78 }: MainMenuProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; maxHeight: number } | null>(null);
  /** 当前展开下级的项 key；null = 无子菜单打开 */
  const [active, setActive] = useState<string | null>(null);
  const [subLeft, setSubLeft] = useState<"right" | "left">("right");
  const anchorRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());
  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);

  const clearTimers = () => {
    if (openTimer.current != null) window.clearTimeout(openTimer.current);
    if (closeTimer.current != null) window.clearTimeout(closeTimer.current);
    openTimer.current = null;
    closeTimer.current = null;
  };
  useEffect(() => clearTimers, []);

  /* ---------------- 一级面板定位（贴触发器下方，空间不足上翻） ---------------- */
  const place = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = 200;
    const maxHeight = Math.max(220, Math.min(vh * maxRatio, vh - EDGE * 2));
    let left = Math.min(Math.max(EDGE, r.left), Math.max(EDGE, vw - w - EDGE));
    const h = panelRef.current?.offsetHeight ?? 0;
    let top = r.bottom + GAP;
    if (h && top + h > vh - EDGE) {
      const above = r.top - GAP - h;
      top = above >= EDGE ? above : Math.max(EDGE, vh - EDGE - h);
    }
    setPos((prev) =>
      prev && prev.top === top && prev.left === left && prev.maxHeight === maxHeight
        ? prev
        : { top, left, maxHeight }
    );
  }, [maxRatio]);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    place();
    const id = requestAnimationFrame(place);
    return () => cancelAnimationFrame(id);
  }, [open, place, active]);

  /* ---------------- 二级面板：默认向右飞出，右侧放不下则翻左 ---------------- */
  useLayoutEffect(() => {
    if (!open || !active) return;
    const row = rowRefs.current.get(active);
    if (!row) return;
    const r = row.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let dir: "right" | "left" = "right";
    if (r.right + GAP + SUB_W > vw - EDGE) dir = "left";
    setSubLeft(dir);
    // 纵向跟随触发项，并夹在视口内
    const top = Math.min(Math.max(EDGE, r.top - 6), Math.max(EDGE, vh - SUB_H - EDGE));
    row.dataset.subTop = String(top);
  }, [open, active]);

  /* ---------------- 外部点击 / Esc / 滚动关闭 ---------------- */
  useEffect(() => {
    if (!open) return;
    const inside = (t: EventTarget | null) =>
      !!t &&
      (anchorRef.current?.contains(t as Node) === true ||
        panelRef.current?.contains(t as Node) === true ||
        document.querySelector(".mm-submenu")?.contains(t as Node) === true);
    const onDown = (e: MouseEvent) => {
      if (!inside(e.target)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        // 有子菜单先收子菜单，再关主菜单
        if (active) setActive(null);
        else setOpen(false);
      }
    };
    const onScroll = () => place();
    const onResize = () => setOpen(false);
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open, active, place]);

  const hoverOpen = (key: string) => {
    clearTimers();
    openTimer.current = window.setTimeout(() => setActive(key), OPEN_DELAY);
  };
  const hoverClose = () => {
    clearTimers();
    closeTimer.current = window.setTimeout(() => setActive(null), CLOSE_DELAY);
  };

  const run = (it: MainMenuItem) => {
    if (it.disabled) return;
    if (it.children) {
      setActive((v) => (v === it.key ? null : it.key));
      return;
    }
    it.onSelect?.();
    setOpen(false);
  };

  const subTop = (() => {
    if (!active) return 0;
    const raw = rowRefs.current.get(active)?.dataset.subTop;
    return raw ? Number(raw) : 0;
  })();

  /** 关闭整个主菜单（二级面板里的动作执行后调用） */
  const closeAll = useCallback(() => {
    setActive(null);
    setOpen(false);
  }, []);

  const items = buildItems(closeAll);

  return (
    <div className="mm-pop" ref={anchorRef}>
      <button
        type="button"
        className={`mm-tb-btn ${open ? "is-open" : ""}`}
        title="主菜单：全部功能"
        aria-expanded={open}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="grid" size={17} />
      </button>

      {open &&
        pos &&
        createPortal(
          <>
            <div
              ref={panelRef}
              className="mm-pop-panel mm-menu"
              role="menu"
              style={{ top: pos.top, left: pos.left, width: 200, maxHeight: pos.maxHeight }}
              onMouseDown={(e) => {
                // 保持画布焦点（表单控件除外），否则快捷键会失效
                e.stopPropagation();
                const t = e.target as HTMLElement;
                if (t.closest("select, input, textarea, label")) return;
                e.preventDefault();
              }}
              onMouseLeave={hoverClose}
            >
              {items.map((it) =>
                it.key === "-" ? (
                  <div key={it.key} className="mm-menu-sep" />
                ) : (
                  <button
                    key={it.key}
                    ref={(el) => {
                      if (el) rowRefs.current.set(it.key, el);
                      else rowRefs.current.delete(it.key);
                    }}
                    type="button"
                    role="menuitem"
                    className={`mm-menu-item ${active === it.key ? "is-active" : ""}`}
                    disabled={it.disabled}
                    onMouseEnter={() => (it.children ? hoverOpen(it.key) : setActive(null))}
                    onClick={() => run(it)}
                  >
                    {it.icon && <Icon name={it.icon} size={16} />}
                    <span>{it.label}</span>
                    {it.hint && <kbd>{it.hint}</kbd>}
                    {it.children && <Icon name="chevron" size={13} className="mm-menu-arrow" />}
                  </button>
                )
              )}
            </div>

            {/* 二级面板：与工具条上的 Popover 同一套样式，向侧边飞出 */}
            {active &&
              (() => {
                const it = items.find((x) => x.key === active);
                if (!it?.children) return null;
                const row = rowRefs.current.get(active);
                const r = row?.getBoundingClientRect();
                if (!r) return null;
                const left =
                  subLeft === "right" ? r.right + 4 : r.left - SUB_W - 4;
                return createPortal(
                  <div
                    className={`mm-pop-panel mm-submenu ${subLeft === "left" ? "is-left" : ""}`}
                    role="menu"
                    style={{
                      top: subTop,
                      left: Math.max(EDGE, left),
                      width: SUB_W,
                      maxHeight: Math.max(220, window.innerHeight - subTop - EDGE),
                    }}
                    onMouseEnter={clearTimers}
                    onMouseLeave={hoverClose}
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      const t = e.target as HTMLElement;
                      if (t.closest("select, input, textarea, label")) return;
                      e.preventDefault();
                    }}
                  >
                    {it.children()}
                  </div>,
                  document.body
                );
              })()}
          </>,
          document.body
        )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * 菜单骨架：把工具条的功能组织成一级项 + 下级子菜单
 * （面板内容全部来自 panels.tsx，与工具条共用同一实现）
 * ------------------------------------------------------------------ */

export interface MainMenuActions {
  /* 文件 */
  onNew: () => void;
  onOpen: () => void;
  onExport: (format: ExportFormat) => void;
  /* 编辑 */
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onDelete: () => void;
  canDelete: boolean;
  onInsertParent: () => void;
  onInsertSiblingBefore: () => void;
  onInsertSiblingAfter: () => void;
  onInsertChild: () => void;
  onNote: () => void;
  onLink: () => void;
  /* 样式 */
  style: MindNodeStyle;
  onStyle: (patch: Partial<MindNodeStyle>) => void;
  config: MindMapConfig;
  onConfig: (patch: Partial<MindMapConfig>) => void;
  onBase: (patch: Partial<BaseStyle>) => void;
  /* 标记 */
  markers: string[];
  onToggleMarker: (id: string) => void;
  priority?: number;
  onSetPriority: (v: number | undefined) => void;
  progress?: number;
  onSetProgress: (v: number | undefined) => void;
  icons: string[];
  onToggleIcon: (id: string) => void;
}

export function buildMainMenu(a: MainMenuActions): (close: () => void) => MainMenuItem[] {
  return (close) => {
    /** 执行一个动作并收起主菜单 */
    const act = (fn: () => void) => () => {
      fn();
      close();
    };
    return [
      {
        key: "file",
        label: "文件",
        icon: "folder",
        children: () => (
          <>
            <button type="button" className="mm-pop-action" onClick={act(a.onOpen)}>
              <Icon name="folder" size={15} /> 打开…
            </button>
            <button type="button" className="mm-pop-action" onClick={act(() => a.onExport("km"))}>
              <Icon name="save" size={15} /> 保存（.km）
            </button>
            <PopLabel>导出为</PopLabel>
            {(Object.keys(EXPORT_LABELS) as ExportFormat[]).map((f) => (
              <button key={f} type="button" className="mm-pop-action" onClick={act(() => a.onExport(f))}>
                <Icon name="save" size={15} /> {EXPORT_LABELS[f]}
              </button>
            ))}
            <PopLabel>其他</PopLabel>
            <button type="button" className="mm-pop-action" onClick={act(a.onNew)}>
              <Icon name="file-plus" size={15} /> 新建空白导图
            </button>
          </>
        ),
      },
      {
        key: "edit",
        label: "编辑",
        icon: "undo",
        children: () => (
          <>
            <button type="button" className="mm-pop-action" disabled={!a.canUndo} onClick={act(a.onUndo)}>
              <Icon name="undo" size={15} /> 撤销
            </button>
            <button type="button" className="mm-pop-action" disabled={!a.canRedo} onClick={act(a.onRedo)}>
              <Icon name="redo" size={15} /> 重做
            </button>
            <div className="mm-menu-sep" />
            <button type="button" className="mm-pop-action" onClick={act(a.onInsertParent)}>
              <Icon name="insert-parent" size={15} /> 插入上级节点
            </button>
            <button type="button" className="mm-pop-action" onClick={act(() => a.onInsertSiblingAfter())}>
              <Icon name="insert-sibling-below" size={15} /> 在下方插入同级
            </button>
            <button type="button" className="mm-pop-action" onClick={act(() => a.onInsertSiblingBefore())}>
              <Icon name="insert-sibling-above" size={15} /> 在上方插入同级
            </button>
            <button type="button" className="mm-pop-action" onClick={act(a.onInsertChild)}>
              <Icon name="insert-child" size={15} /> 插入子节点
            </button>
            <div className="mm-menu-sep" />
            <button type="button" className="mm-pop-action" onClick={act(a.onNote)}>
              <Icon name="note" size={15} /> 节点备注
            </button>
            <button type="button" className="mm-pop-action" onClick={act(a.onLink)}>
              <Icon name="link" size={15} /> 超链接
            </button>
            <div className="mm-menu-sep" />
            <button type="button" className="mm-pop-action" disabled={!a.canDelete} onClick={act(a.onDelete)}>
              <Icon name="trash" size={15} /> 删除节点
            </button>
          </>
        ),
      },
      {
        key: "node",
        label: "节点样式",
        icon: "node-style",
        children: () => <NodeStylePanel style={a.style} onStyle={a.onStyle} />,
      },
      {
        key: "base",
        label: "基础样式",
        icon: "base-style",
        children: () => <BaseStylePanel base={a.config.base ?? {}} onBase={a.onBase} />,
      },
      {
        key: "theme",
        label: "主题",
        icon: "theme",
        children: () => <ThemePanel config={a.config} onConfig={a.onConfig} />,
      },
      {
        key: "struct",
        label: "结构",
        icon: "structure",
        children: () => <StructurePanel config={a.config} onConfig={a.onConfig} />,
      },
      {
        key: "marker",
        label: "标记与图标",
        icon: "marker",
        children: () => (
          <>
            <MarkerPanel markers={a.markers} onToggleMarker={a.onToggleMarker} />
            <div className="mm-menu-sep" />
            <IconPanel icons={a.icons} onToggleIcon={a.onToggleIcon} />
          </>
        ),
      },
      {
        key: "prio",
        label: "优先级",
        icon: "priority",
        children: () => <PriorityPanel priority={a.priority} onSetPriority={a.onSetPriority} />,
      },
      {
        key: "prog",
        label: "进度",
        icon: "progress",
        children: () => <ProgressPanel progress={a.progress} onSetProgress={a.onSetProgress} />,
      },
    ];
  };
}

export default MainMenu;
