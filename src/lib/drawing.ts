/**
 * Handzeichnungen (Apple Pencil): Striche als Vektordaten, damit eine Zeichnung
 * später weiter bearbeitet werden kann. Gespeichert kompakt als Text im Bild-
 * knoten der Notiz; angezeigt wird ein daraus erzeugtes PNG.
 */

export type Tool = "pen" | "marker";

export interface Stroke {
  tool: Tool;
  color: string;
  size: number;
  /** x, y, Druck (0–1) */
  points: [number, number, number][];
}

export interface Drawing {
  v: 1;
  width: number;
  height: number;
  strokes: Stroke[];
}

export const CANVAS_WIDTH = 1000;
export const PEN_COLORS = ["#1d2433", "#2f5fb3", "#c0392b", "#2e7d5b"];
export const MARKER_COLORS = ["#ffe066", "#8ce99a", "#74c0fc", "#ffa8d2"];

/** Kompakt: „tool|color|size|x,y,p;x,y,p…“ je Strich, Striche durch Zeilenumbruch getrennt. */
export function encodeDrawing(d: Drawing): string {
  const strokes = d.strokes.map(
    (s) => `${s.tool}|${s.color}|${s.size}|${s.points.map(([x, y, p]) => `${Math.round(x)},${Math.round(y)},${Math.round(p * 100)}`).join(";")}`,
  );
  return [`v1|${Math.round(d.width)}|${Math.round(d.height)}`, ...strokes].join("\n");
}

export function decodeDrawing(s: string | null | undefined): Drawing | null {
  if (!s) return null;
  const [head, ...lines] = s.split("\n");
  const h = /^v1\|(\d+)\|(\d+)$/.exec(head ?? "");
  if (!h) return null;
  const strokes: Stroke[] = [];
  for (const line of lines) {
    const [tool, color, size, pts] = line.split("|");
    if ((tool !== "pen" && tool !== "marker") || !/^#[0-9a-f]{6}$/i.test(color ?? "") || !pts) continue;
    const points = pts
      .split(";")
      .map((t) => t.split(",").map(Number))
      .filter((a) => a.length === 3 && a.every(Number.isFinite))
      .map(([x, y, p]) => [x!, y!, p! / 100] as [number, number, number]);
    if (points.length) strokes.push({ tool, color: color!, size: Math.min(40, Math.max(1, Number(size) || 3)), points });
  }
  return { v: 1, width: Number(h[1]), height: Number(h[2]), strokes };
}

/** Umrandung aller Striche (mit Strichbreite). */
export function bounds(strokes: Stroke[]): { x: number; y: number; w: number; h: number } | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of strokes) {
    const r = s.tool === "marker" ? s.size * 2.5 : s.size;
    for (const [x, y] of s.points) {
      x0 = Math.min(x0, x - r);
      y0 = Math.min(y0, y - r);
      x1 = Math.max(x1, x + r);
      y1 = Math.max(y1, y + r);
    }
  }
  return Number.isFinite(x0) ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

/** Strich zeichnen; Stiftbreite folgt dem Druck. */
export function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke) {
  const pts = s.points;
  if (!pts.length) return;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = s.color;
  ctx.fillStyle = s.color;
  if (s.tool === "marker") {
    ctx.globalAlpha = 0.4;
    ctx.globalCompositeOperation = "multiply";
    ctx.lineWidth = s.size * 5;
    ctx.beginPath();
    ctx.moveTo(pts[0]![0], pts[0]![1]);
    for (const [x, y] of pts.slice(1)) ctx.lineTo(x, y);
    if (pts.length === 1) ctx.lineTo(pts[0]![0] + 0.1, pts[0]![1]);
    ctx.stroke();
  } else if (pts.length === 1) {
    ctx.beginPath();
    ctx.arc(pts[0]![0], pts[0]![1], (s.size * (0.4 + pts[0]![2])) / 2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0, p0] = pts[i - 1]!;
      const [x1, y1, p1] = pts[i]!;
      ctx.lineWidth = s.size * (0.4 + 0.9 * ((p0 + p1) / 2));
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      // Mittelpunkt-Glättung
      const mx = (x0 + x1) / 2;
      const my = (y0 + y1) / 2;
      ctx.quadraticCurveTo(x0, y0, mx, my);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** Strich in der Nähe eines Punktes (zum Radieren)? */
export function hitStroke(s: Stroke, x: number, y: number, radius: number): boolean {
  const r = radius + (s.tool === "marker" ? s.size * 2.5 : s.size / 2);
  const pts = s.points;
  for (let i = 0; i < pts.length; i++) {
    const [ax, ay] = pts[i]!;
    if ((ax - x) ** 2 + (ay - y) ** 2 <= r * r) return true;
    const b = pts[i + 1];
    if (!b) continue;
    // Abstand zum Segment
    const [bx, by] = b;
    const dx = bx - ax, dy = by - ay;
    const len = dx * dx + dy * dy;
    if (!len) continue;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len));
    if ((ax + t * dx - x) ** 2 + (ay + t * dy - y) ** 2 <= r * r) return true;
  }
  return false;
}
