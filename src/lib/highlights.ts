/**
 * Markerfarben im Text: feste Plätze (1–7 mitgeliefert, bis zu 3 eigene) mit
 * Farbe und optionaler Bedeutung („Gelb = Definition“). Eine Markierung merkt
 * sich ihren Platz; ändert man die Farbe eines Platzes, ändern sich alle
 * Markierungen mit ihm. Ältere Markierungen ohne Platz werden über die
 * ursprüngliche Farbe zugeordnet. Gespeichert in `editor.highlights`.
 */

export interface HighlightSlot {
  /** Platz: "1" … "10" */
  slot: string;
  color: string;
  label: string;
}

export const DEFAULT_HIGHLIGHTS: HighlightSlot[] = [
  { slot: "1", color: "#fff59d", label: "Gelb" },
  { slot: "2", color: "#c5f5c1", label: "Grün" },
  { slot: "3", color: "#b3ecff", label: "Blau" },
  { slot: "4", color: "#ffc9de", label: "Rosa" },
  { slot: "5", color: "#ffd8a8", label: "Orange" },
  { slot: "6", color: "#d7c8ff", label: "Lila" },
  { slot: "7", color: "#e2e5ea", label: "Grau" },
];
export const MAX_SLOTS = 10;
export const HIGHLIGHT_SETTING = "editor.highlights";
export const HIGHLIGHTS_CHANGED = "studium:highlights-changed";

/** Vorschläge für eigene Farben: kräftige Marker, auch im dunklen Modus erkennbar */
export const HIGHLIGHT_PALETTE = ["#ffe066", "#8ce99a", "#74c0fc", "#faa2c1", "#ffc078", "#b197fc", "#63e6be", "#ff8787", "#ced4da", "#e599f7"];

const HEX = /^#[0-9a-f]{6}$/i;

export function parseHighlightConfig(v: unknown): HighlightSlot[] {
  const list = v && typeof v === "object" && Array.isArray((v as { slots?: unknown }).slots) ? ((v as { slots: unknown[] }).slots) : [];
  const out: HighlightSlot[] = DEFAULT_HIGHLIGHTS.map((d) => ({ ...d }));
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Partial<HighlightSlot>;
    const slot = String(r.slot ?? "");
    const n = Number(slot);
    if (!Number.isInteger(n) || n < 1 || n > MAX_SLOTS) continue;
    const color = typeof r.color === "string" && HEX.test(r.color) ? r.color.toLowerCase() : null;
    const label = typeof r.label === "string" ? r.label.trim().slice(0, 30) : "";
    const i = out.findIndex((x) => x.slot === slot);
    if (i >= 0) out[i] = { slot, color: color ?? out[i]!.color, label: label || out[i]!.label };
    else if (color) out.push({ slot, color, label: label || "Eigene Farbe" });
  }
  return out.sort((a, b) => Number(a.slot) - Number(b.slot));
}

let slots: HighlightSlot[] = parseHighlightConfig(null);

export const highlightSlots = () => slots;

export function setHighlightConfig(s: HighlightSlot[]) {
  slots = s;
  if (typeof window !== "undefined") {
    applyHighlightStyles();
    window.dispatchEvent(new CustomEvent(HIGHLIGHTS_CHANGED));
  }
}

/** Gespeicherte Form: nur Abweichungen von den Vorgaben und eigene Plätze */
export function highlightConfigOf(s: HighlightSlot[]): { slots: HighlightSlot[] } {
  return {
    slots: s.filter((x) => {
      const d = DEFAULT_HIGHLIGHTS.find((y) => y.slot === x.slot);
      return !d || d.color !== x.color.toLowerCase() || d.label !== x.label;
    }),
  };
}

/** Platz einer Markierung: gespeichert oder über die ursprüngliche Farbe */
export function slotOf(color: unknown, slot?: unknown): string | null {
  if (typeof slot === "string" && slot && slots.some((s) => s.slot === slot)) return slot;
  const c = typeof color === "string" ? color.toLowerCase() : "";
  // ohne Farbe (⌘⇧H, ältere Notizen): erster Platz
  if (!c) return "1";
  return DEFAULT_HIGHLIGHTS.find((d) => d.color === c)?.slot ?? null;
}

/** Farbe, mit der eine Markierung jetzt erscheint */
export function highlightColor(color: unknown, slot?: unknown): string {
  const s = slotOf(color, slot);
  const hit = s ? slots.find((x) => x.slot === s) : undefined;
  if (hit) return hit.color;
  return typeof color === "string" && /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\))$/i.test(color.trim()) ? color.trim() : DEFAULT_HIGHLIGHTS[0]!.color;
}

/** Bedeutung (für Tooltips), falls umbenannt */
export function highlightLabel(color: unknown, slot?: unknown): string {
  const s = slotOf(color, slot);
  return (s && slots.find((x) => x.slot === s)?.label) || "";
}

/** Sofort sichtbar im geöffneten Editor: Plätze als Stilregeln (überschreiben die gespeicherte Farbe) */
export function applyHighlightStyles() {
  if (typeof document === "undefined") return;
  let el = document.getElementById("hl-slots") as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = "hl-slots";
    document.head.appendChild(el);
  }
  el.textContent = slots.map((s) => `mark[data-hl="${s.slot}"] { --hl: ${s.color} !important; }`).join("\n");
}

export function nextFreeSlot(s: HighlightSlot[]): string | null {
  for (let i = 1; i <= MAX_SLOTS; i++) if (!s.some((x) => x.slot === String(i))) return String(i);
  return null;
}
