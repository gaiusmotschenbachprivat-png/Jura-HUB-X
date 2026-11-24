/**
 * iPad: von der Tastatur verschobene Rahmen werden zurückgesetzt, der
 * eigentliche Textbereich (.note-scroll) nicht.
 */
import { afterEach, describe, expect, it } from "vitest";

import { FIXED_FRAMES, installViewportGuard, keyboardOpen, resetShift } from "./viewportGuard";

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

function frame(cls: string) {
  const el = document.createElement("div");
  el.className = cls;
  let top = 0;
  Object.defineProperty(el, "scrollTop", { get: () => top, set: (v: number) => (top = v), configurable: true });
  return el;
}

describe("Verschobene Ansicht zurücksetzen", () => {
  let off: (() => void) | null = null;
  afterEach(() => {
    off?.();
    off = null;
    document.body.innerHTML = "";
  });

  it("Rahmen der App gelten als fest, der Textbereich nicht", () => {
    for (const c of ["shell-main", "primary", "workspace", "note"]) expect(frame(c).matches(FIXED_FRAMES), c).toBe(true);
    expect(frame("note-scroll").matches(FIXED_FRAMES)).toBe(false);
  });

  it("setzt einen verschobenen Rahmen beim Scroll-Ereignis sofort zurück", async () => {
    off = installViewportGuard(document);
    const primary = frame("primary");
    const text = frame("note-scroll");
    primary.appendChild(text);
    document.body.appendChild(primary);
    primary.scrollTop = 300;
    primary.dispatchEvent(new Event("scroll"));
    text.scrollTop = 500;
    text.dispatchEvent(new Event("scroll"));
    await tick();
    expect(primary.scrollTop).toBe(0);
    expect(text.scrollTop).toBe(500);
  });

  it("räumt beim Zurückkehren in die App auf", async () => {
    off = installViewportGuard(document);
    const main = frame("shell-main");
    document.body.appendChild(main);
    main.scrollTop = 120; // ohne Ereignis verschoben (z. B. im Hintergrund)
    window.dispatchEvent(new Event("pageshow"));
    expect(main.scrollTop).toBe(0);
    main.scrollTop = 80;
    expect(resetShift(document)).toBe(true);
    expect(resetShift(document)).toBe(false);
  });

  it("erkennt die offene Bildschirmtastatur", () => {
    const win = (h: number, vv: number | null) => ({ innerHeight: h, visualViewport: vv === null ? null : { height: vv } }) as unknown as Window;
    expect(keyboardOpen(win(820, 820))).toBe(false);
    // Kurzbefehlsleiste der Hardware-Tastatur: keine Bildschirmtastatur
    expect(keyboardOpen(win(820, 750))).toBe(false);
    expect(keyboardOpen(win(820, 430))).toBe(true);
    expect(keyboardOpen(win(820, null))).toBe(false);
  });
});
