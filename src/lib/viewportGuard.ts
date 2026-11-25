/**
 * iPad: Beim Tippen schiebt iPadOS Bereiche nach oben, damit die
 * Schreibstelle über der Tastatur bleibt – auch Bereiche, die gar nicht
 * scrollen sollen (overflow: hidden) und die man deshalb nicht von Hand
 * zurückschieben kann. Nach dem Schließen der Tastatur oder dem Zurückkehren in
 * die App blieb die Ansicht dann verschoben (oben abgeschnitten, unten leer),
 * und mit jedem Mal schlimmer. Diese Wache setzt solche Verschiebungen zurück.
 */

/** Rahmen der App, die nie verschoben sein dürfen (gescrollt wird in ihren Inhalten) */
export const FIXED_FRAMES = "html, body, #root, .shell, .shell-side, .shell-main, .shell-context, .workspace, .primary, .secondary, .note";

/** Höhe des Fensters ohne Tastatur (100lvh), unabhängig von einer fälschlich verkleinerten Fensterhöhe */
let fullCache = 0;
export function fullHeight(doc: Document = document): number {
  if (fullCache) return fullCache;
  const win = doc.defaultView;
  if (!win || !doc.body) return win?.innerHeight ?? 0;
  const probe = doc.createElement("div");
  probe.style.cssText = "position:fixed;top:0;left:0;width:0;visibility:hidden;pointer-events:none;height:100vh;height:100lvh";
  doc.body.appendChild(probe);
  const h = probe.getBoundingClientRect().height;
  probe.remove();
  fullCache = Math.max(h || 0, win.innerHeight);
  return fullCache;
}

/** Steht gerade ein Eingabefeld im Fokus (sonst kann keine Bildschirmtastatur offen sein)? */
function editing(doc: Document): boolean {
  const a = doc.activeElement as HTMLElement | null;
  return !!a && a !== doc.body && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName));
}

/** Ist gerade die Bildschirmtastatur offen? (dann darf iPadOS die Ansicht verschieben) */
export function keyboardOpen(win: Window = window): boolean {
  const vv = win.visualViewport;
  if (!vv) return false;
  const doc = win.document;
  if (doc && !editing(doc)) return false;
  const ref = doc ? Math.max(win.innerHeight, fullHeight(doc)) : win.innerHeight;
  return vv.height < ref - 120;
}

/** Läuft die App als Web-App vom Home-Bildschirm (ohne Safari-Leisten)? */
function standalone(win: Window): boolean {
  return (win.navigator as Navigator & { standalone?: boolean }).standalone === true || !!win.matchMedia?.("(display-mode: standalone)").matches;
}

/**
 * Höhe der App: bei offener Tastatur nur der sichtbare Bereich; sonst die
 * volle Fensterhöhe – auch wenn iPadOS (Home-Bildschirm-App) nach dem
 * Schließen der Tastatur eine zu kleine Fensterhöhe meldet (unten leer).
 */
export function updateAppHeight(doc: Document = document): void {
  const win = doc.defaultView;
  if (!win) return;
  const root = doc.documentElement;
  const vv = win.visualViewport;
  if (vv && keyboardOpen(win)) {
    root.style.setProperty("--app-h", `${Math.round(vv.height)}px`);
    root.style.removeProperty("--full-h");
    return;
  }
  root.style.removeProperty("--app-h");
  const full = fullHeight(doc);
  if (standalone(win) && full > win.innerHeight + 40) root.style.setProperty("--full-h", `${Math.round(full)}px`);
  else root.style.removeProperty("--full-h");
}

function fix(el: Element) {
  if (el.scrollTop) el.scrollTop = 0;
  if (el.scrollLeft) el.scrollLeft = 0;
}

/** Setzt alle verschobenen Rahmen und das Fenster zurück; liefert, ob etwas verschoben war. */
export function resetShift(doc: Document = document): boolean {
  let moved = false;
  for (const el of Array.from(doc.querySelectorAll(FIXED_FRAMES))) {
    if (el.scrollTop || el.scrollLeft) {
      moved = true;
      fix(el);
    }
  }
  const win = doc.defaultView;
  if (win && (win.scrollY || win.scrollX) && !keyboardOpen(win)) {
    moved = true;
    win.scrollTo(0, 0);
  }
  return moved;
}

export function installViewportGuard(doc: Document = document): () => void {
  const win = doc.defaultView;
  if (!win) return () => {};
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const later = (ms: number) => {
    const t = setTimeout(() => {
      timers.delete(t);
      updateAppHeight(doc);
      resetShift(doc);
    }, ms);
    timers.add(t);
  };
  // nach dem Schließen der Tastatur kommen die Bewegungen verzögert
  const settle = () => {
    updateAppHeight(doc);
    resetShift(doc);
    later(120);
    later(450);
    later(1000);
  };
  const onScroll = (e: Event) => {
    const t = e.target;
    if (t === doc || t === doc.documentElement || t === doc.body) {
      if (!keyboardOpen(win) && (win.scrollY || win.scrollX)) win.scrollTo(0, 0);
      if (t !== doc) fix(t as Element);
    } else if (t instanceof Element && t.matches(FIXED_FRAMES)) {
      // Rahmen (z. B. .primary) sind nie zum Scrollen da: sofort zurück.
      // Die Schreibstelle bleibt sichtbar, weil iPadOS dann den eigentlichen
      // Textbereich bzw. das Fenster verschiebt.
      fix(t);
    }
  };
  // Bildschirmtastatur offen: App auf den sichtbaren Bereich verkleinern, damit
  // iPadOS nichts verschieben muss; der Text scrollt dann in seinem Bereich.
  const onViewport = () => {
    updateAppHeight(doc);
    if (!keyboardOpen(win)) settle();
  };
  const onResize = () => {
    fullCache = 0; // Fenstergröße geändert (geteilte Ansicht, Drehen)
    settle();
  };
  // beim Antippen prüfen: bleibt sonst eine falsche Höhe stehen, ist sie spätestens dann weg
  const onPointer = () => {
    if (!editing(doc) || !keyboardOpen(win)) updateAppHeight(doc);
  };
  const onFocusOut = () => {
    later(300);
    later(800);
  };
  const onVisible = () => {
    if (doc.visibilityState === "visible") settle();
  };
  doc.addEventListener("scroll", onScroll, { capture: true, passive: true });
  win.visualViewport?.addEventListener("resize", onViewport);
  win.addEventListener("resize", onResize);
  win.addEventListener("orientationchange", onResize);
  doc.addEventListener("pointerdown", onPointer, { capture: true, passive: true });
  win.addEventListener("pageshow", settle);
  win.addEventListener("focus", settle);
  doc.addEventListener("focusout", onFocusOut);
  doc.addEventListener("visibilitychange", onVisible);
  return () => {
    doc.removeEventListener("scroll", onScroll, { capture: true });
    win.visualViewport?.removeEventListener("resize", onViewport);
    win.removeEventListener("resize", onResize);
    win.removeEventListener("orientationchange", onResize);
    doc.removeEventListener("pointerdown", onPointer, { capture: true });
    win.removeEventListener("pageshow", settle);
    win.removeEventListener("focus", settle);
    doc.removeEventListener("focusout", onFocusOut);
    doc.removeEventListener("visibilitychange", onVisible);
    timers.forEach(clearTimeout);
    doc.documentElement.style.removeProperty("--app-h");
    doc.documentElement.style.removeProperty("--full-h");
  };
}
