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

/** Ist gerade die Bildschirmtastatur offen? (dann darf iPadOS die Ansicht verschieben) */
export function keyboardOpen(win: Window = window): boolean {
  const vv = win.visualViewport;
  return !!vv && vv.height < win.innerHeight - 120;
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
      resetShift(doc);
    }, ms);
    timers.add(t);
  };
  // nach dem Schließen der Tastatur kommen die Bewegungen verzögert
  const settle = () => {
    resetShift(doc);
    later(120);
    later(450);
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
  const root = doc.documentElement;
  const onViewport = () => {
    const vv = win.visualViewport;
    if (vv && keyboardOpen(win)) {
      root.style.setProperty("--app-h", `${Math.round(vv.height)}px`);
    } else {
      root.style.removeProperty("--app-h");
      settle();
    }
  };
  const onFocusOut = () => later(300);
  const onVisible = () => {
    if (doc.visibilityState === "visible") settle();
  };
  doc.addEventListener("scroll", onScroll, { capture: true, passive: true });
  win.visualViewport?.addEventListener("resize", onViewport);
  win.addEventListener("resize", settle);
  win.addEventListener("orientationchange", settle);
  win.addEventListener("pageshow", settle);
  win.addEventListener("focus", settle);
  doc.addEventListener("focusout", onFocusOut);
  doc.addEventListener("visibilitychange", onVisible);
  return () => {
    doc.removeEventListener("scroll", onScroll, { capture: true });
    win.visualViewport?.removeEventListener("resize", onViewport);
    win.removeEventListener("resize", settle);
    win.removeEventListener("orientationchange", settle);
    win.removeEventListener("pageshow", settle);
    win.removeEventListener("focus", settle);
    doc.removeEventListener("focusout", onFocusOut);
    doc.removeEventListener("visibilitychange", onVisible);
    timers.forEach(clearTimeout);
    root.style.removeProperty("--app-h");
  };
}
