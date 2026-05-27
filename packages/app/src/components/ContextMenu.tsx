import { useEffect, useLayoutEffect, useRef, useState } from "react";

export interface MenuAction {
  label: string;
  icon?: React.ReactNode;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

export type MenuItem = MenuAction | { type: "header"; label: string } | "separator";

interface Props {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}

export function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: x, top: y });

  // Adjust position after render so menu stays on-screen
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPos({
      left: Math.min(x, window.innerWidth - width - 8),
      top: Math.min(y, window.innerHeight - height - 8),
    });
  }, [x, y]);

  // Focus first interactive item on mount
  useEffect(() => {
    const first = itemRefs.current.find((el) => el && !el.disabled);
    first?.focus();
  }, []);

  useEffect(() => {
    const mouseHandler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return; }

      const focusable = itemRefs.current.filter((el) => el && !el.disabled) as HTMLButtonElement[];
      const cur = document.activeElement as HTMLButtonElement;
      const idx = focusable.indexOf(cur);

      if (e.key === "ArrowDown") {
        e.preventDefault();
        focusable[(idx + 1) % focusable.length]?.focus();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        focusable[(idx - 1 + focusable.length) % focusable.length]?.focus();
      } else if (e.key === "Enter" && cur) {
        e.preventDefault();
        cur.click();
      }
    };
    window.addEventListener("mousedown", mouseHandler);
    window.addEventListener("keydown", keyHandler);
    return () => {
      window.removeEventListener("mousedown", mouseHandler);
      window.removeEventListener("keydown", keyHandler);
    };
  }, [onClose]);

  let btnIdx = 0;

  return (
    <div ref={ref} className="context-menu" role="menu" style={{ position: "fixed", ...pos, zIndex: 1000 }}>
      {items.map((item, i) => {
        if (item === "separator") return <div key={i} className="ctx-separator" role="separator" />;
        if ("type" in item && item.type === "header") {
          return <div key={i} className="ctx-header" role="presentation">{item.label}</div>;
        }
        const action = item as MenuAction;
        const idx = btnIdx++;
        return (
          <button
            key={i}
            ref={(el) => { itemRefs.current[idx] = el; }}
            className={`ctx-item ${action.danger ? "danger" : ""}`}
            role="menuitem"
            disabled={action.disabled}
            onClick={() => { onClose(); action.onClick(); }}
          >
            {action.icon && <span className="ctx-icon" aria-hidden="true">{action.icon}</span>}
            {action.label}
          </button>
        );
      })}
    </div>
  );
}
