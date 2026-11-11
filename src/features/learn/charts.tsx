/**
 * Kleine SVG-Diagramme für die Kartenstatistik: Säulen (auch gestapelt),
 * Kalender-Heatmap und segmentierter Balken. Farben über CSS-Variablen
 * (.viz-root in learning.css, je Modus validiert); Tooltip beim Zeigen bzw.
 * Antippen; jede Grafik hat eine Tabellenansicht.
 */
import { useMemo, useRef, useState, type ReactNode } from "react";

export interface Series {
  label: string;
  /** CSS-Variable, z. B. "var(--series-1)" */
  color: string;
}

export interface Column {
  label: string;
  values: number[];
  /** zusätzliche Zeile im Tooltip */
  note?: string;
}

const nice = (max: number) => {
  if (max <= 4) return Math.max(1, Math.ceil(max));
  const p = 10 ** Math.floor(Math.log10(max));
  const m = max / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
};
const fmt = (v: number) => v.toLocaleString("de-DE", { maximumFractionDigits: 1 });

function Tip({ x, children }: { x: number; children: ReactNode }) {
  return (
    <div className="viz-tip" style={{ left: `clamp(70px, ${x}%, calc(100% - 70px))` }} role="status">
      {children}
    </div>
  );
}

export function Legend({ series }: { series: Series[] }) {
  if (series.length < 2) return null;
  return (
    <div className="viz-legend">
      {series.map((s) => (
        <span key={s.label}>
          <i style={{ background: s.color }} />
          {s.label}
        </span>
      ))}
    </div>
  );
}

/** Säulen; mehrere Werte je Säule werden gestapelt (2px Lücke dazwischen, oberstes Teil mit runder Kante). */
export function ColumnChart({ data, series, height = 160, every = 1, label, unit = "", width = 640 }: { data: Column[]; series: Series[]; height?: number; every?: number; label: string; unit?: string; /** Breite des Koordinatensystems (kleiner = größere Schrift in schmalen Karten) */ width?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const ref = useRef<SVGSVGElement>(null);
  const W = width;
  const H = height;
  const padL = 34;
  const padB = 20;
  const padT = 10;
  const top = nice(Math.max(1, ...data.map((d) => d.values.reduce((s, v) => s + v, 0))));
  const band = (W - padL) / Math.max(1, data.length);
  const bw = Math.min(24, Math.max(2, band * 0.7));
  const y = (v: number) => padT + (H - padB - padT) * (1 - v / top);
  const ticks = [0, top / 2, top];
  const pick = (clientX: number) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const i = Math.floor((((clientX - r.left) / r.width) * W - padL) / band);
    setHover(i >= 0 && i < data.length ? i : null);
  };
  const h = hover !== null ? data[hover] : null;
  return (
    <figure className="viz" aria-label={label}>
      <Legend series={series} />
      <div className="viz-plot">
        <svg
          ref={ref}
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={label}
          onPointerMove={(e) => pick(e.clientX)}
          onPointerDown={(e) => pick(e.clientX)}
          onPointerLeave={(e) => e.pointerType === "mouse" && setHover(null)}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={padL} x2={W} y1={y(t)} y2={y(t)} className={t === 0 ? "viz-base" : "viz-grid"} />
              <text x={padL - 6} y={y(t) + 4} className="viz-axis" textAnchor="end">
                {fmt(t)}
              </text>
            </g>
          ))}
          {data.map((d, i) => {
            const x = padL + i * band + (band - bw) / 2;
            let acc = 0;
            const segs = d.values.map((v, si) => ({ v, si })).filter((s) => s.v > 0);
            return (
              <g key={i} opacity={hover === null || hover === i ? 1 : 0.55}>
                {segs.map(({ v, si }, k) => {
                  const y0 = y(acc);
                  acc += v;
                  const y1 = y(acc);
                  const isTop = k === segs.length - 1;
                  const gap = k > 0 ? 2 : 0;
                  const hgt = Math.max(0, y0 - y1 - gap);
                  if (hgt <= 0) return null;
                  const r = isTop ? Math.min(4, bw / 2, hgt) : 0;
                  const yy = y1;
                  return <path key={si} d={roundTop(x, yy, bw, hgt, r)} fill={series[si]?.color} />;
                })}
                {i % every === 0 && (
                  <text x={padL + i * band + band / 2} y={H - 5} className="viz-axis" textAnchor="middle">
                    {d.label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
        {h && hover !== null && (
          <Tip x={((padL + (hover + 0.5) * band) / W) * 100}>
            <strong>{h.label}</strong>
            {series.map((s, si) => (
              <span key={s.label} className="viz-tip-row">
                {series.length > 1 && <i style={{ background: s.color }} />}
                {series.length > 1 ? `${s.label}: ` : ""}
                {fmt(h.values[si] ?? 0)}
                {unit}
              </span>
            ))}
            {h.note && <span className="viz-tip-row muted">{h.note}</span>}
          </Tip>
        )}
      </div>
      <TableView label={label} head={["", ...series.map((s) => s.label)]} rows={data.map((d) => [d.label, ...series.map((_, si) => fmt(d.values[si] ?? 0) + unit)])} />
    </figure>
  );
}

function roundTop(x: number, y: number, w: number, h: number, r: number) {
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

export function TableView({ label, head, rows }: { label: string; head: string[]; rows: (string | number)[][] }) {
  return (
    <details className="viz-table">
      <summary className="xs muted">Als Tabelle</summary>
      <table aria-label={label}>
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={i}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j} className="tnum">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

/** Kalender: Wochen als Spalten, Wochentage als Zeilen, Stufen einer Farbe nach Anzahl */
export function Heatmap({ days, label }: { days: { key: string; date: Date; total: number }[]; label: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const { cells, weeks, levels } = useMemo(() => {
    const first = days[0]?.date ?? new Date();
    const offset = (first.getDay() + 6) % 7; // Montag = 0
    const max = Math.max(0, ...days.map((d) => d.total));
    const lv = (n: number) => (n === 0 ? 0 : max <= 4 ? Math.min(4, n) : Math.min(4, Math.ceil((n / max) * 4)));
    return {
      cells: days.map((d, i) => ({ ...d, col: Math.floor((i + offset) / 7), row: (i + offset) % 7, level: lv(d.total) })),
      weeks: Math.ceil((days.length + offset) / 7),
      levels: max,
    };
  }, [days]);
  const S = 12;
  const G = 2;
  const W = weeks * (S + G) + 24;
  const H = 7 * (S + G) + 16;
  const h = hover !== null ? cells[hover] : null;
  return (
    <figure className="viz" aria-label={label}>
      <div className="viz-plot viz-scroll">
        <svg viewBox={`0 0 ${W} ${H}`} style={{ minWidth: W }} role="img" aria-label={label} onPointerLeave={(e) => e.pointerType === "mouse" && setHover(null)}>
          {["Mo", "Mi", "Fr"].map((d, i) => (
            <text key={d} x={0} y={16 + i * 2 * (S + G) + S - 2} className="viz-axis">
              {d}
            </text>
          ))}
          {cells.map((c, i) =>
            c.date.getDate() === 1 ? (
              <text key={`m${i}`} x={24 + c.col * (S + G)} y={10} className="viz-axis">
                {c.date.toLocaleDateString("de-DE", { month: "short" })}
              </text>
            ) : null,
          )}
          {cells.map((c, i) => (
            <rect
              key={c.key}
              x={24 + c.col * (S + G)}
              y={16 + c.row * (S + G)}
              width={S}
              height={S}
              rx={2}
              className={`heat-${c.level} ${hover === i ? "is-hover" : ""}`}
              onPointerEnter={() => setHover(i)}
              onPointerDown={() => setHover(i)}
            />
          ))}
        </svg>
      </div>
      <div className="viz-heat-legend xs muted">
        {h ? (
          <span>
            <strong>{h.date.toLocaleDateString("de-DE", { weekday: "short", day: "numeric", month: "long", year: "numeric" })}</strong>: {h.total} {h.total === 1 ? "Wiederholung" : "Wiederholungen"}
          </span>
        ) : (
          <span>Tag antippen für Details</span>
        )}
        <span className="grow" />
        weniger
        {[0, 1, 2, 3, 4].map((l) => (
          <i key={l} className={`heat-${l}`} />
        ))}
        mehr {levels ? `(bis ${levels})` : ""}
      </div>
    </figure>
  );
}

/** Ein hoher, segmentierter Balken mit Legende (Anteile) */
export function SegmentBar({ parts, label }: { parts: { label: string; value: number; color: string }[]; label: string }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  return (
    <figure className="viz" aria-label={label}>
      <div className="viz-segbar" role="img" aria-label={`${label}: ${parts.map((p) => `${p.label} ${p.value}`).join(", ")}`}>
        {parts
          .filter((p) => p.value > 0)
          .map((p) => (
            <span key={p.label} style={{ flexGrow: p.value, background: p.color }} title={`${p.label}: ${p.value}`} />
          ))}
      </div>
      <div className="viz-legend viz-legend-values">
        {parts.map((p) => (
          <span key={p.label}>
            <i style={{ background: p.color }} />
            {p.label} <strong className="tnum">{p.value}</strong>
            <span className="muted tnum"> {total ? `${Math.round((p.value / total) * 100)} %` : ""}</span>
          </span>
        ))}
      </div>
    </figure>
  );
}
