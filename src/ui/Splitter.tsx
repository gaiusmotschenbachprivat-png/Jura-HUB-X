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
  /** Lage des Bereichs, dessen Größe `value` ist; „top“ = waagerechter Trenner */
  side: "left" | "right" | "top";
  label: string;
}) {
  const start = useRef<{ x: number; v: number } | null>(null);
  const horizontal = side === "top";
  const sign = side === "right" ? -1 : 1;
  const clamp = (v: number) => Math.round(Math.min(max, Math.max(min, v)));
  return (
    <div
      className={`splitter ${horizontal ? "is-horizontal" : ""}`}
      role="separator"
      aria-orientation={horizontal ? "horizontal" : "vertical"}
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onKeyDown={(e) => {
        const d = horizontal ? (e.key === "ArrowUp" ? -16 : e.key === "ArrowDown" ? 16 : 0) : e.key === "ArrowLeft" ? -16 : e.key === "ArrowRight" ? 16 : 0;
        if (d) onChange(clamp(value + sign * d));
      }}
      onPointerDown={(e) => {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        start.current = { x: horizontal ? e.clientY : e.clientX, v: value };
        document.body.classList.add("is-resizing");
      }}
      onPointerMove={(e) => {
        if (!start.current) return;
        const dx = (horizontal ? e.clientY : e.clientX) - start.current.x;
        onChange(clamp(start.current.v + sign * dx));
      }}
      onPointerUp={() => {
        start.current = null;
        document.body.classList.remove("is-resizing");
      }}
    />
  );
}
