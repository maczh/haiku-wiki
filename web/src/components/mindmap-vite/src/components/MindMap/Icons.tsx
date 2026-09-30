/** 工具栏图标集：统一 24x24 线性图标，使用 currentColor 着色。 */
export type IconName =
  | "undo"
  | "redo"
  | "insert-parent"
  | "insert-sibling-above"
  | "insert-sibling-below"
  | "insert-child"
  | "marker"
  | "note"
  | "link"
  | "style"
  | "node-style"
  | "base-style"
  | "theme"
  | "structure"
  | "priority"
  | "progress"
  | "icon"
  | "fit"
  | "zoom-in"
  | "zoom-out"
  | "chevron"
  | "folder"
  | "save"
  | "trash"
  | "copy"
  | "check"
  | "brush"
  | "file-plus"
  | "keyboard";

const PATHS: Record<IconName, string[]> = {
  undo: ["M9 14 4 9l5-5", "M4 9h10.5a5.5 5.5 0 0 1 0 11H9"],
  redo: ["M15 14l5-5-5-5", "M20 9H9.5a5.5 5.5 0 0 0 0 11H15"],
  "insert-parent": ["M8.5 3h7v6h-7z", "M12 9v6", "M9 12.5 12 15.5l3-3", "M8 18h8"],
  "insert-sibling-above": [
    "M5.5 16.5h13",
    "M5.5 20.5h13",
    "M12 3.5v9",
    "M9 6.5 12 3.5l3 3",
  ],
  "insert-sibling-below": [
    "M5.5 3.5h13",
    "M5.5 7.5h13",
    "M12 11.5v9",
    "M9 17.5l3 3 3-3",
  ],
  "insert-child": ["M3.5 5.5h7v13h-7z", "M13.5 12h4", "M15.5 9.5 18 12l-2.5 2.5", "M18 7.5h2.5v9H18"],
  marker: ["M6 3.5v17", "M6 4.5h11l-2.6 4.4L17 13H6z"],
  note: ["M6 3.5h7.5L19 9v11.5H6z", "M13 3.5V9h5.5", "M9 13h6", "M9 16.5h4"],
  link: [
    "M9.6 14.4 14.4 9.6",
    "M10.7 6.6l1.7-1.7a4.2 4.2 0 0 1 6 6l-1.7 1.7",
    "M13.3 17.4l-1.7 1.7a4.2 4.2 0 0 1-6-6l1.7-1.7",
  ],
  style: [
    "M12 3.2a8.8 8.8 0 1 0 0 17.6c1.2 0 1.9-1 1.5-2-.4-1.1.4-2.2 1.6-2.2h1.7a3 3 0 0 0 3-3c0-4.7-3.9-8.4-8.8-8.4z",
    "M7.6 9.4h.01",
    "M11 7.2h.01",
    "M15 8.4h.01",
    "M7.4 13.6h.01",
  ],
  "node-style": [
    "M4 5.5h16v11H4z",
    "M4 13l4.5 4.5h11",
    "M9 9.5h.01",
    "M13 9.5h.01",
  ],
  "base-style": [
    "M12 3.5 21 8 12 12.5 3 8z",
    "M3 12l9 4.5L21 12",
    "M3 16l9 4.5L21 16",
  ],
  theme: [
    "M12 3.2a8.8 8.8 0 1 0 0 17.6c1.2 0 1.9-1 1.5-2-.4-1.1.4-2.2 1.6-2.2h1.7a3 3 0 0 0 3-3c0-4.7-3.9-8.4-8.8-8.4z",
    "M7.6 9.4h.01",
    "M11 7.2h.01",
    "M15 8.4h.01",
    "M7.4 13.6h.01",
  ],
  structure: [
    "M9.5 3.5h5v4h-5z",
    "M3 16.5h5v4H3z",
    "M16 16.5h5v4h-5z",
    "M12 7.5v4.5",
    "M8 12v4.5",
    "M16 12v4.5",
  ],
  priority: ["M5 3.5v17", "M5 4.5h11l-2.6 4.4L16 13H5z"],
  progress: [
    "M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17z",
    "M12 3.5v8.5",
    "M12 3.5h8.5",
  ],
  icon: [
    "M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16z",
    "M9 10h.01",
    "M15 10h.01",
    "M8.5 14.5c1.5 1.8 5.5 1.8 7 0",
  ],
  fit: ["M4 9.5V4h5.5", "M20 9.5V4h-5.5", "M4 14.5V20h5.5", "M20 14.5V20h-5.5"],
  "zoom-in": ["M11 4.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13z", "M20 20l-4.2-4.2", "M11 8.5v5", "M8.5 11h5"],
  "zoom-out": ["M11 4.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13z", "M20 20l-4.2-4.2", "M8.5 11h5"],
  chevron: ["M6 9.5l6 6 6-6"],
  folder: ["M3.5 7.5a2 2 0 0 1 2-2h3.6l2 2h7.4a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"],
  save: ["M12 3.5v11", "M7.5 10 12 14.5 16.5 10", "M4 19.5h16"],
  trash: ["M4.5 7h15", "M9.5 7V4.5h5V7", "M6.5 7l.9 12.5h9.2L17.5 7", "M10.5 10.5v6", "M13.5 10.5v6"],
  copy: ["M9 8.5h10.5V21H9z", "M15 8.5V3.5H4.5V16H9"],
  check: ["M5 12.5 10 17.5 19 6.5"],
  brush: [
    "M14.5 3.5 20.5 9.5",
    "M17.5 6.5 8 16 4 17.5 5.5 13.5 15 4z",
    "M7.5 18.5c1.5 1 2.5 2 2.5 2s-4 .5-5-1.5c-.6-1.2.5-2.5.5-2.5z",
  ],
  "file-plus": ["M6 3.5h7.5L19 9v11.5H6z", "M13 3.5V9h5.5", "M11 12v5", "M8.5 14.5h5"],
  keyboard: [
    "M3.5 6.5h17v11h-17z",
    "M7 10h.01",
    "M10.5 10h.01",
    "M14 10h.01",
    "M17.5 10h.01",
    "M8 13.5h8",
  ],
};

export interface IconProps {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  className?: string;
}

export function Icon({ name, size = 18, strokeWidth = 1.7, className }: IconProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name].map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}

export default Icon;
