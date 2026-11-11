import { useEffect, useRef, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

import { Button } from "./Button";

export function Dialog({
  title,
  children,
  onClose,
  footer,
  width = 520,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  width?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>("input, textarea, select, button.btn-primary, button");
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeRef.current();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      // Fokus nur zurückgeben, wenn ihn niemand sonst übernommen hat (z. B. der Editor beim Speichern)
      const now = document.activeElement;
      if (!now || now === document.body || ref.current?.contains(now)) prev?.focus?.();
    };
  }, []);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title} ref={ref} style={{ width }}>
        <div className="dialog-head">
          <h2>{title}</h2>
        </div>
        <div className="dialog-body">{children}</div>
        {footer && <div className="dialog-foot">{footer}</div>}
      </div>
    </div>
  );
}

/** Bestätigungsdialog als Promise. */
export function confirmDialog(opts: {
  title: string;
  message: ReactNode;
  confirm: string;
  danger?: boolean;
}): Promise<boolean> {
  return new Promise((resolve) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const done = (v: boolean) => {
      root.unmount();
      host.remove();
      resolve(v);
    };
    root.render(
      <Dialog
        title={opts.title}
        onClose={() => done(false)}
        width={440}
        footer={
          <>
            <Button onClick={() => done(false)}>Abbrechen</Button>
            <Button variant={opts.danger ? "danger" : "primary"} onClick={() => done(true)}>
              {opts.confirm}
            </Button>
          </>
        }
      >
        <div className="confirm-text">{opts.message}</div>
      </Dialog>,
    );
  });
}

/** Eingabedialog als Promise (null = abgebrochen). */
export function promptDialog(opts: { title: string; label: string; value?: string; confirm: string; hint?: ReactNode }): Promise<string | null> {
  return new Promise((resolve) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    let value = opts.value ?? "";
    const done = (v: string | null) => {
      root.unmount();
      host.remove();
      resolve(v);
    };
    root.render(
      <Dialog
        title={opts.title}
        onClose={() => done(null)}
        width={460}
        footer={
          <>
            <Button onClick={() => done(null)}>Abbrechen</Button>
            <Button variant="primary" onClick={() => done(value.trim() || null)}>
              {opts.confirm}
            </Button>
          </>
        }
      >
        <label className="field">
          <span className="field-label">{opts.label}</span>
          <input
            defaultValue={value}
            aria-label={opts.label}
            onChange={(e) => (value = e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                done(value.trim() || null);
              }
            }}
          />
          {opts.hint && <span className="field-hint">{opts.hint}</span>}
        </label>
      </Dialog>,
    );
  });
}
