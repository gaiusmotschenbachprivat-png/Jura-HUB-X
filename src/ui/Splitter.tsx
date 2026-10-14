import { useRef } from "react";

/** Ziehbarer Trenner zwischen zwei Spalten. `side`: welche Spalte wächst beim Ziehen nach rechts. */
export function Splitter({
  value,
  onChange,
  min,
  max,
  side,
  label,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  side: "left" | "right";
  label: string;
}) {
  const start = useRef<{ x: number; v: number } | null>(null);
  const clamp = (v: number) => Math.round(Math.min(max, Math.max(min, v)));
  return (
    <div
      className="splitter"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onKeyDown={(e) => {
        const d = e.key === "ArrowLeft" ? -16 : e.key === "ArrowRight" ? 16 : 0;
        if (d) onChange(clamp(value + (side === "left" ? d : -d)));
      }}
      onPointerDown={(e) => {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        start.current = { x: e.clientX, v: value };
        document.body.classList.add("is-resizing");
      }}
      onPointerMove={(e) => {
        if (!start.current) return;
        const dx = e.clientX - start.current.x;
        onChange(clamp(start.current.v + (side === "left" ? dx : -dx)));
      }}
      onPointerUp={() => {
        start.current = null;
        document.body.classList.remove("is-resizing");
      }}
    />
  );
}
