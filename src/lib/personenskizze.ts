/**
 * Personenskizze zum Sachverhalt: Personen (Kürzel, Rolle) und Beziehungen
 * zwischen ihnen – Ansprüche (Pfeil mit Norm), Verträge (Linie), Handlungen
 * (gestrichelter Pfeil) und sonstige Beziehungen (gepunktet). Aus der
 * üblichen Kurzschreibweise („A —§ 433 I BGB→ G“) lässt sich eine Skizze
 * erzeugen; gezeichnet wird als SVG (auch für Druck und Vorschau).
 */

export type RelationKind = "anspruch" | "vertrag" | "handlung" | "beziehung";
export type Direction = "vor" | "zurueck" | "beide" | "keine";

export interface Person {
  id: string;
  /** Kürzel bzw. Name, z. B. „A“ oder „V GmbH“ */
  name: string;
  /** Rolle, z. B. „Käufer“ */
  role: string;
  x: number;
  y: number;
}

export interface Relation {
  id: string;
  from: string;
  to: string;
  kind: RelationKind;
  dir: Direction;
  label: string;
}

export interface Sketch {
  persons: Person[];
  relations: Relation[];
}

export const KIND_LABEL: Record<RelationKind, string> = {
  anspruch: "Anspruch (Pfeil)",
  vertrag: "Vertrag (Linie)",
  handlung: "Handlung / Leistung (gestrichelt)",
  beziehung: "Sonstige Beziehung (gepunktet)",
};
export const DIR_LABEL: Record<Direction, string> = { vor: "von → nach", zurueck: "nach → von", beide: "in beide Richtungen", keine: "ohne Pfeil" };

export const W = 640;
export const H = 360;
let seq = 0;
export const uid = (p: string) => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`;

export const emptySketch = (): Sketch => ({ persons: [], relations: [] });

/** gespeicherte Skizze prüfen (unbekannte Werte fallen weg) */
export function parseSketch(v: unknown): Sketch {
  const o = typeof v === "string" ? safeJson(v) : v;
  if (!o || typeof o !== "object") return emptySketch();
  const s = o as Partial<Sketch>;
  const num = (x: unknown, d: number, max: number) => (typeof x === "number" && Number.isFinite(x) ? Math.min(max, Math.max(0, x)) : d);
  const str = (x: unknown, max: number) => (typeof x === "string" ? x.slice(0, max) : "");
  const persons = (Array.isArray(s.persons) ? s.persons : [])
    .filter((p): p is Person => !!p && typeof p === "object" && typeof (p as Person).id === "string")
    .slice(0, 30)
    .map((p) => ({ id: p.id.slice(0, 40), name: str(p.name, 40) || "?", role: str(p.role, 60), x: num(p.x, W / 2, W), y: num(p.y, H / 2, H) }));
  const ids = new Set(persons.map((p) => p.id));
  const kinds = Object.keys(KIND_LABEL);
  const dirs = Object.keys(DIR_LABEL);
  const relations = (Array.isArray(s.relations) ? s.relations : [])
    .filter((r): r is Relation => !!r && typeof r === "object" && ids.has((r as Relation).from) && ids.has((r as Relation).to) && (r as Relation).from !== (r as Relation).to)
    .slice(0, 60)
    .map((r) => ({
      id: String(r.id).slice(0, 40),
      from: r.from,
      to: r.to,
      kind: (kinds.includes(r.kind) ? r.kind : "anspruch") as RelationKind,
      dir: (dirs.includes(r.dir) ? r.dir : "vor") as Direction,
      label: str(r.label, 80),
    }));
  return { persons, relations };
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

// ---------- Kurzschreibweise ----------

/** „$ 433“ → „§ 433“, „§433“ → „§ 433“ */
export const fixNorm = (s: string) => s.replace(/\$\s*(?=\d)/g, "§ ").replace(/§(?=\d)/g, "§ ").replace(/\s+/g, " ").trim();

const LINE = /^\s*([^—–\-←→<>]+?)\s*([←<]?)\s*[—–-]*\s*(.*?)\s*[—–-]*\s*([→>]?)\s*([^—–\-←→<>]+?)\s*$/;
const SHORT = /^\s*([^—–\-←→<>]+?)\s*(←|→|↔|<->|<-|->)\s*([^—–\-←→<>]+?)\s*$/;

/**
 * Zeilen der Kurzschreibweise erkennen:
 *   A —§ 433 I BGB→ G      (Anspruch von A gegen G)
 *   A ←§ 433 II BGB— G     (Anspruch von G gegen A)
 *   A —Kaufvertrag— G      (Vertrag)
 *   A → G, A ↔ B
 * Personen ergeben sich aus den Namen; Zeilen ohne Muster werden übergangen.
 */
export function sketchFromText(text: string): Sketch {
  const persons: Person[] = [];
  const relations: Relation[] = [];
  const person = (raw: string) => {
    const name = raw.trim().replace(/[.:,;]+$/, "");
    let p = persons.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (!p) {
      p = { id: uid("p"), name: name.slice(0, 40), role: "", x: 0, y: 0 };
      persons.push(p);
    }
    return p;
  };
  for (const raw of text.split(/\n+/)) {
    const line = raw.replace(/\s+/g, " ").trim();
    if (!line || line.length > 160) continue;
    let left: string, right: string, label: string, back: boolean, fwd: boolean;
    const s = SHORT.exec(line);
    if (s) {
      [left, right, label] = [s[1]!, s[3]!, ""];
      back = /←|<-|↔|<->/.test(s[2]!);
      fwd = /→|->|↔|<->/.test(s[2]!);
    } else {
      const m = LINE.exec(line);
      if (!m || !/[—–\-←→]/.test(line)) continue;
      [left, right, label] = [m[1]!, m[5]!, m[3]!];
      back = !!m[2];
      fwd = !!m[4];
    }
    if (!isName(left) || !isName(right)) continue;
    const a = person(left);
    const b = person(right);
    if (a.id === b.id) continue;
    const text = fixNorm(label);
    const isContract = /vertrag|\bkv\b|\bdv\b|\bmv\b|\bwv\b/i.test(text);
    const kind: RelationKind = isContract && !fwd && !back ? "vertrag" : fwd || back ? (/§|art\.|anspruch/i.test(text) || !text ? "anspruch" : "handlung") : isContract ? "vertrag" : "beziehung";
    relations.push({ id: uid("r"), from: a.id, to: b.id, kind, dir: fwd && back ? "beide" : fwd ? "vor" : back ? "zurueck" : "keine", label: text });
  }
  return { persons: autoLayout(persons), relations };
}

/** Name einer Person: kurz, ohne Satzzeichen-Salat */
const isName = (s: string) => {
  const t = s.trim();
  return t.length > 0 && t.length <= 30 && !/[§$]/.test(t) && t.split(/\s+/).length <= 4;
};

/** Personen verteilen: 2 nebeneinander, 3 im Dreieck, 4 im Viereck, mehr im Kreis */
export function autoLayout(ps: Person[]): Person[] {
  const n = ps.length;
  const pos = (i: number): [number, number] => {
    if (n === 1) return [W / 2, H / 2];
    if (n === 2) return [i === 0 ? 150 : W - 150, H / 2];
    if (n === 3) return ([[W / 2, 70], [150, H - 70], [W - 150, H - 70]] as [number, number][])[i]!;
    if (n === 4) return ([[150, 80], [W - 150, 80], [W - 150, H - 80], [150, H - 80]] as [number, number][])[i]!;
    const a = -Math.PI / 2 + (i / n) * 2 * Math.PI;
    return [W / 2 + Math.cos(a) * (W / 2 - 90), H / 2 + Math.sin(a) * (H / 2 - 50)];
  };
  return ps.map((p, i) => {
    const [x, y] = pos(i);
    return { ...p, x: Math.round(x), y: Math.round(y) };
  });
}

/** Skizze als Kurzschreibweise (für Markdown, Word, Suche) */
export function sketchText(s: Sketch): string[] {
  const name = (id: string) => s.persons.find((p) => p.id === id)?.name ?? "?";
  return s.relations.map((r) => {
    const l = ` ${r.label} `;
    const [a, b] = [name(r.from), name(r.to)];
    if (!r.label) return `${a} ${r.dir === "vor" ? "→" : r.dir === "zurueck" ? "←" : r.dir === "beide" ? "↔" : "—"} ${b}`;
    if (r.dir === "vor") return `${a} —${l}→ ${b}`;
    if (r.dir === "zurueck") return `${a} ←${l}— ${b}`;
    if (r.dir === "beide") return `${a} ←${l}→ ${b}`;
    return `${a} —${l}— ${b}`;
  });
}

// ---------- Zeichnung ----------

export const boxSize = (p: Pick<Person, "name" | "role">) => ({ w: Math.max(56, Math.min(170, Math.max(p.name.length * 11, p.role.length * 7.2) + 26)), h: p.role ? 50 : 38 });

/** Schnittpunkt der Linie Mitte→Ziel mit dem Rand des Kästchens */
function edgePoint(p: Person, tx: number, ty: number, pad = 4) {
  const { w, h } = boxSize(p);
  const dx = tx - p.x;
  const dy = ty - p.y;
  if (!dx && !dy) return { x: p.x, y: p.y };
  const sx = (w / 2 + pad) / Math.abs(dx || 1e-9);
  const sy = (h / 2 + pad) / Math.abs(dy || 1e-9);
  const t = Math.min(sx, sy);
  return { x: p.x + dx * t, y: p.y + dy * t };
}

export interface EdgeGeom {
  id: string;
  d: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  lx: number;
  ly: number;
  angle: number;
}

/** Linien zwischen Personen; mehrere Beziehungen desselben Paars werden nebeneinander gelegt */
export function edges(s: Sketch): EdgeGeom[] {
  const byId = new Map(s.persons.map((p) => [p.id, p]));
  const pairKey = (r: Relation) => [r.from, r.to].sort().join("|");
  const groups = new Map<string, Relation[]>();
  for (const r of s.relations) groups.set(pairKey(r), [...(groups.get(pairKey(r)) ?? []), r]);
  const out: EdgeGeom[] = [];
  for (const rs of groups.values()) {
    rs.forEach((r, i) => {
      const a = byId.get(r.from);
      const b = byId.get(r.to);
      if (!a || !b) return;
      // senkrecht versetzen (bezogen auf die sortierte Richtung, damit Hin- und Rückweg nicht übereinanderliegen)
      const [p, q] = [a, b].sort((u, v) => u.id.localeCompare(v.id));
      const len = Math.hypot(q!.x - p!.x, q!.y - p!.y) || 1;
      const nx = -(q!.y - p!.y) / len;
      const ny = (q!.x - p!.x) / len;
      const off = (i - (rs.length - 1) / 2) * 30;
      const ax = a.x + nx * off;
      const ay = a.y + ny * off;
      const bx = b.x + nx * off;
      const by = b.y + ny * off;
      const s1 = edgePoint({ ...a, x: ax, y: ay }, bx, by);
      const s2 = edgePoint({ ...b, x: bx, y: by }, ax, ay);
      const angle = (Math.atan2(s2.y - s1.y, s2.x - s1.x) * 180) / Math.PI;
      // Beschriftung auf die Außenseite der Linie (bei einer einzelnen Linie oberhalb)
      const side = off === 0 ? (ny > 0 ? -1 : 1) : Math.sign(off);
      const lx = (s1.x + s2.x) / 2 + nx * side * 11;
      const ly = (s1.y + s2.y) / 2 + ny * side * 11;
      out.push({ id: r.id, d: `M${s1.x.toFixed(1)},${s1.y.toFixed(1)} L${s2.x.toFixed(1)},${s2.y.toFixed(1)}`, x1: s1.x, y1: s1.y, x2: s2.x, y2: s2.y, lx, ly, angle });
    });
  }
  return out;
}

type Spec = [string, Record<string, string>, ...(Spec | string)[]];
const SVG = "http://www.w3.org/2000/svg";

/** Zeichnung als DOM-Beschreibung (für Editor, Vorschau und Druck – gleiches Bild überall) */
export function sketchSpec(s: Sketch, opts: { selected?: string | null } = {}): Spec {
  const el = (tag: string, attrs: Record<string, string | number>, ...kids: (Spec | string)[]): Spec => [`${SVG} ${tag}`, Object.fromEntries(Object.entries(attrs).map(([k, v]) => [k, String(v)])), ...kids];
  const geo = edges(s);
  const rel = new Map(s.relations.map((r) => [r.id, r]));
  const xs = s.persons.flatMap((p) => [p.x - boxSize(p).w / 2, p.x + boxSize(p).w / 2]);
  const ys = s.persons.flatMap((p) => [p.y - boxSize(p).h / 2, p.y + boxSize(p).h / 2]);
  const minX = Math.max(0, Math.min(...xs, W) - 30);
  const maxX = Math.min(W, Math.max(...xs, 0) + 30);
  const minY = Math.max(0, Math.min(...ys, H) - 30);
  const maxY = Math.min(H, Math.max(...ys, 0) + 30);
  const vb = s.persons.length ? `${minX} ${minY} ${Math.max(120, maxX - minX)} ${Math.max(80, maxY - minY)}` : `0 0 ${W} ${H}`;
  const marker = (id: string, start: boolean) =>
    el("marker", { id, viewBox: "0 0 10 10", refX: start ? 1 : 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse", markerUnits: "strokeWidth" }, el("path", { d: "M0,0 L10,5 L0,10 z", class: "ps-head" }));
  const uidBase = `ps${Math.abs(hash(JSON.stringify(s))).toString(36)}`;
  return el(
    "svg",
    { viewBox: vb, class: "ps-svg", role: "img", "aria-label": `Personenskizze: ${sketchText(s).join("; ") || "leer"}`, preserveAspectRatio: "xMidYMid meet" },
    el("defs", {}, marker(`${uidBase}-e`, false), marker(`${uidBase}-s`, true)),
    ...geo.map((g) => {
      const r = rel.get(g.id)!;
      const attrs: Record<string, string | number> = { d: g.d, class: `ps-edge ps-${r.kind}${opts.selected === r.id ? " is-selected" : ""}`, "data-rel": r.id };
      if (r.dir === "vor" || r.dir === "beide") attrs["marker-end"] = `url(#${uidBase}-e)`;
      if (r.dir === "zurueck" || r.dir === "beide") attrs["marker-start"] = `url(#${uidBase}-s)`;
      return el("path", attrs);
    }),
    ...geo.flatMap((g) => {
      const r = rel.get(g.id)!;
      if (!r.label) return [];
      const a = g.angle > 90 || g.angle < -90 ? g.angle + 180 : g.angle;
      return [el("text", { x: g.lx.toFixed(1), y: (g.ly + 4.5).toFixed(1), class: "ps-label", "text-anchor": "middle", transform: `rotate(${a.toFixed(1)} ${g.lx.toFixed(1)} ${g.ly.toFixed(1)})`, "data-rel": r.id }, r.label)];
    }),
    ...s.persons.map((p) => {
      const { w, h } = boxSize(p);
      return el(
        "g",
        { class: `ps-person${opts.selected === p.id ? " is-selected" : ""}`, "data-person": p.id, transform: `translate(${p.x} ${p.y})` },
        el("rect", { x: -w / 2, y: -h / 2, width: w, height: h, rx: 8 }),
        el("text", { x: 0, y: p.role ? -3 : 5, "text-anchor": "middle", class: "ps-name" }, p.name),
        ...(p.role ? [el("text", { x: 0, y: 14, "text-anchor": "middle", class: "ps-role" }, p.role)] : []),
      );
    }),
  );
}

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

/** Vorlagen für den Start */
export function preset(kind: "zwei" | "drei" | "kette"): Sketch {
  const P = (name: string, role: string): Person => ({ id: uid("p"), name, role, x: 0, y: 0 });
  if (kind === "zwei") {
    const [a, b] = [P("K", "Käufer"), P("V", "Verkäufer")];
    return { persons: autoLayout([a, b]), relations: [{ id: uid("r"), from: a.id, to: b.id, kind: "vertrag", dir: "keine", label: "Kaufvertrag" }] };
  }
  if (kind === "drei") {
    const [a, b, c] = [P("A", ""), P("B", ""), P("C", "")];
    return { persons: autoLayout([a, b, c]), relations: [] };
  }
  const [a, b, c] = [P("E", "Eigentümer"), P("V", "Veräußerer"), P("D", "Dritter")];
  return {
    persons: autoLayout([a, b, c]),
    relations: [
      { id: uid("r"), from: a.id, to: b.id, kind: "handlung", dir: "vor", label: "leiht" },
      { id: uid("r"), from: b.id, to: c.id, kind: "handlung", dir: "vor", label: "veräußert" },
      { id: uid("r"), from: a.id, to: c.id, kind: "anspruch", dir: "vor", label: "§ 985 BGB" },
    ],
  };
}
