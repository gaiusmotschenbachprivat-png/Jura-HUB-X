// @vitest-environment node
/**
 * iPad-Statusleiste: Alle Abstände oben laufen über --safe-top (base.css), damit
 * die Mindesthöhe der Home-Bildschirm-App und der Wert aus den Einstellungen
 * überall greifen.
 */
import fs from "node:fs";

import { describe, expect, it } from "vitest";

import { applyTopInset, autoTopInset, isIpadHomeScreenApp, WINDOW_CONTROLS_PX } from "./safeArea";

const dir = new URL("../styles/", import.meta.url);
const css = (f: string) => fs.readFileSync(new URL(f, dir), "utf8");

describe("Abstand oben", () => {
  it("env(safe-area-inset-top) nur in base.css, sonst --safe-top", () => {
    for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".css") && f !== "base.css")) expect(css(f), f).not.toMatch(/safe-area-inset-top/);
    const base = css("base.css");
    expect(base).toMatch(/--safe-top: var\(--safe-top-manual, calc\(env\(safe-area-inset-top, 0px\) \+ var\(--window-controls, 0px\)\)\)/);
    // kein Mindestabstand: sonst entsteht unter der Statusleiste ein leerer Streifen
    expect(base).not.toMatch(/24px\)/);
    // App nicht unter die Statusleiste ziehen – sonst legt iOS einen Weichzeichner darüber
    expect(fs.readFileSync(new URL("../../index.html", import.meta.url), "utf8")).not.toMatch(/viewport-fit=cover/);
  });

  it("Hauptbereich, Seitenleiste und Dialoge nutzen den Abstand", () => {
    expect(css("layout.css")).toMatch(/\.shell-side, \.shell-main[^{]*\{\s*padding-top: var\(--safe-top\)/);
    expect(css("components.css")).toMatch(/\.overlay \{[^}]*padding-top: calc\(24px \+ var\(--safe-top\)\)/);
  });

  it("Einstellung setzt bzw. entfernt den festen Wert", () => {
    const props = new Map<string, string>();
    const root = { style: { setProperty: (k: string, v: string) => props.set(k, v), removeProperty: (k: string) => props.delete(k) } } as unknown as HTMLElement;
    applyTopInset(40, root, false);
    expect(props.get("--safe-top-manual")).toBe("40px");
    applyTopInset(500, root, false);
    expect(props.get("--safe-top-manual")).toBe("96px");
    applyTopInset(-1, root, false);
    expect(props.has("--safe-top-manual")).toBe(false);
    expect(props.has("--window-controls")).toBe(false);
    applyTopInset(-1, root, true);
    expect(props.get("--window-controls")).toBe(`${WINDOW_CONTROLS_PX}px`);
  });

  it("Streifen für die Fenstertasten nur als iPad-App vom Home-Bildschirm", () => {
    const ipadUa = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1";
    expect(isIpadHomeScreenApp({ userAgent: ipadUa, platform: "MacIntel", maxTouchPoints: 5, standalone: true })).toBe(true);
    expect(isIpadHomeScreenApp({ userAgent: ipadUa, platform: "MacIntel", maxTouchPoints: 5, displayStandalone: true })).toBe(true);
    // im Safari-Tab: eigene Leiste von Safari, kein Streifen nötig
    expect(isIpadHomeScreenApp({ userAgent: ipadUa, platform: "MacIntel", maxTouchPoints: 5, standalone: false })).toBe(false);
    // Mac ohne Touch
    expect(isIpadHomeScreenApp({ userAgent: ipadUa, platform: "MacIntel", maxTouchPoints: 0, displayStandalone: true })).toBe(false);
    expect(isIpadHomeScreenApp({ userAgent: "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148", standalone: true })).toBe(true);
    expect(isIpadHomeScreenApp(null)).toBe(false);
    expect(autoTopInset(true)).toBe(WINDOW_CONTROLS_PX);
    expect(autoTopInset(false)).toBe(0);
  });
});
