/**
 * Abstand oben für die iOS-Statusleiste (Uhrzeit, WLAN, Akku). Die CSS-Variable
 * --safe-top (base.css) kombiniert env(safe-area-inset-top) mit einer Mindesthöhe
 * für die iPad-App vom Home-Bildschirm; in den Einstellungen lässt sie sich von
 * Hand festlegen. Für per JS positionierte Menüs/Popups wird sie hier gemessen.
 */

/** Gespeicherter Wert: -1 = automatisch, sonst feste Pixel. */
export const TOP_INSET_AUTO = -1;
export const TOP_INSET_MAX = 64;

export function applyTopInset(value: number, root: HTMLElement = document.documentElement) {
  if (value >= 0) root.style.setProperty("--safe-top-manual", `${Math.min(TOP_INSET_MAX, Math.round(value))}px`);
  else root.style.removeProperty("--safe-top-manual");
}

/** Aktuelle Höhe von --safe-top in Pixeln. */
export function safeTop(): number {
  if (typeof document === "undefined" || !document.body) return 0;
  const probe = document.createElement("div");
  probe.style.cssText = "position:fixed;top:0;left:0;width:0;visibility:hidden;pointer-events:none;height:var(--safe-top,0px)";
  document.body.appendChild(probe);
  const h = probe.getBoundingClientRect().height;
  probe.remove();
  return Number.isFinite(h) ? h : 0;
}
