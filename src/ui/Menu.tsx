import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { safeTop } from "../lib/safeArea";

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onSelect?: () => void;
  danger?: boolean;
  disabled?: boolean;
  shortcut?: string;
  separator?: boolean;
  /** Gruppenüberschrift (nicht wählbar), optional mit Farbpunkt */
  header?: boolean;
  color?: string;
}

/** Kontextmenü an einer Bildschirmposition. */
export function Menu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ x: Math.max(8, Math.min(x, window.innerWidth - r.width - 8)), y: Math.max(8 + safeTop(), Math.min(y, window.innerHeight - r.height - 8)) });
    el.querySelector<HTMLElement>("button:not(:disabled)")?.focus();
  }, [x, y]);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const btns = [...(ref.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
        const i = btns.indexOf(document.activeElement as HTMLButtonElement);
        const next = btns[(i + (e.key === "ArrowDown" ? 1 : -1) + btns.length) % btns.length];
        next?.focus();
      }
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", key);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", key);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);
  return createPortal(
    <div className="menu" ref={ref} style={{ left: pos.x, top: pos.y }} role="menu">
      {items.map((it, i) =>
        it.separator ? (
          <div key={i} className="menu-sep" />
        ) : it.header ? (
          <div key={i} className="menu-header" role="presentation" style={it.color ? { ["--g" as string]: it.color } : undefined}>
            {it.label}
          </div>
        ) : (
          <button
            key={i}
            type="button"
            role="menuitem"
            className={`menu-item ${it.danger ? "is-danger" : ""}`}
            disabled={it.disabled}
            onClick={() => {
              onClose();
              it.onSelect?.();
            }}
          >
            <span className="menu-icon">{it.icon}</span>
            <span className="grow">{it.label}</span>
            {it.shortcut && <kbd>{it.shortcut}</kbd>}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}

export function useMenu() {
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const el = menu ? <Menu {...menu} onClose={() => setMenu(null)} /> : null;
  return {
    el,
    openAt: (e: { clientX: number; clientY: number; preventDefault?: () => void }, items: MenuItem[]) => {
      e.preventDefault?.();
      setMenu({ x: e.clientX, y: e.clientY, items });
    },
    openBelow: (target: HTMLElement, items: MenuItem[]) => {
      const r = target.getBoundingClientRect();
      setMenu({ x: r.left, y: r.bottom + 4, items });
    },
  };
}
