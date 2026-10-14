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
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>("input, textarea, select, button.btn-primary, button");
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      prev?.focus?.();
    };
  }, [onClose]);
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
