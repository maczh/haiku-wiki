import { useEffect, useRef } from "react";

export interface DialogProps {
  open: boolean;
  title: string;
  /** 多行输入用 textarea */
  multiline?: boolean;
  value: string;
  placeholder?: string;
  confirmText?: string;
  onChange: (v: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}

/** 轻量模态框：用于编辑备注 / 超链接等长文本。 */
export function Dialog({
  open,
  title,
  multiline,
  value,
  placeholder,
  confirmText = "确定",
  onChange,
  onCancel,
  onConfirm,
}: DialogProps) {
  const inputRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 30);
      return () => clearTimeout(t);
    }
  }, [open]);

  if (!open) return null;

  return (
    <div className="mm-modal-mask" onMouseDown={onCancel}>
      <div className="mm-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="mm-modal-title">{title}</div>
        {multiline ? (
          <textarea
            ref={inputRef}
            className="mm-modal-input"
            rows={5}
            value={value}
            placeholder={placeholder}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Escape") onCancel();
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) onConfirm();
            }}
          />
        ) : (
          <input
            ref={inputRef}
            className="mm-modal-input"
            value={value}
            placeholder={placeholder}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Escape") onCancel();
              if (e.key === "Enter") onConfirm();
            }}
          />
        )}
        <div className="mm-modal-actions">
          <button type="button" className="mm-btn-ghost" onClick={onCancel}>
            取消
          </button>
          <button type="button" className="mm-btn-primary" onClick={onConfirm}>
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

export default Dialog;
