/**
 * Abstand oben für die iOS-Statusleiste (Uhrzeit, WLAN, Akku). Die CSS-Variable
 * --safe-top (base.css) folgt env(safe-area-inset-top) (ohne viewport-fit=cover
 * normalerweise 0, da iPadOS die App unter die Statusleiste setzt) plus dem
 * Streifen für die Fenstertasten von iPadOS 26 (--window-controls); in den
 * Einstellungen lässt sie sich von Hand festlegen. Für per JS positionierte Menüs/Popups wird sie hier gemessen.
 */

/** Gespeicherter Wert: -1 = automatisch, sonst feste Pixel. */
export const TOP_INSET_AUTO = -1;
export const TOP_INSET_MAX = 96;

/**
 * iPadOS 26 legt bei Apps vom Home-Bildschirm die Fenstertasten (● ● ●) und
 * einen Weichzeichner über einen Streifen am oberen Rand – darunter liegende
 * Knöpfe sind verdeckt und unscharf. Diesen Streifen hält die App frei.
 */
export const WINDOW_CONTROLS_PX = 46;

interface EnvLike {
  userAgent: string;
  platform?: string;
  maxTouchPoints?: number;
  standalone?: boolean;
  displayStandalone?: boolean;
}

function currentEnv(): EnvLike | null {
  if (typeof navigator === "undefined" || typeof window === "undefined") return null;
  const nav = navigator as Navigator & { standalone?: boolean };
  return {
    userAgent: nav.userAgent,
    platform: nav.platform,
    maxTouchPoints: nav.maxTouchPoints,
    standalone: nav.standalone,
    displayStandalone: window.matchMedia?.("(display-mode: standalone)").matches ?? false,
  };
}

/** Läuft die App als Web-App vom Home-Bildschirm eines iPads? */
export function isIpadHomeScreenApp(env: EnvLike | null = currentEnv()): boolean {
  if (!env) return false;
  const ipad = /iPad/.test(env.userAgent) || (env.platform === "MacIntel" && (env.maxTouchPoints ?? 0) > 1);
  return ipad && (env.standalone === true || env.displayStandalone === true);
}

export function applyTopInset(value: number, root: HTMLElement = document.documentElement, band: boolean = isIpadHomeScreenApp()) {
  if (value >= 0) root.style.setProperty("--safe-top-manual", `${Math.min(TOP_INSET_MAX, Math.round(value))}px`);
  else root.style.removeProperty("--safe-top-manual");
  if (band) root.style.setProperty("--window-controls", `${WINDOW_CONTROLS_PX}px`);
  else root.style.removeProperty("--window-controls");
}

/** Abstand, den „Automatisch“ ergibt (für die Anzeige in den Einstellungen) */
export const autoTopInset = (band: boolean = isIpadHomeScreenApp()) => (band ? WINDOW_CONTROLS_PX : 0);

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
