// @vitest-environment node
/**
 * iPad-Statusleiste: Alle Abstände oben laufen über --safe-top (base.css), damit
 * die Mindesthöhe der Home-Bildschirm-App und der Wert aus den Einstellungen
 * überall greifen.
 */
import fs from "node:fs";

import { describe, expect, it } from "vitest";

import { applyTopInset } from "./safeArea";

const dir = new URL("../styles/", import.meta.url);
const css = (f: string) => fs.readFileSync(new URL(f, dir), "utf8");

describe("Abstand oben", () => {
  it("env(safe-area-inset-top) nur in base.css, sonst --safe-top", () => {
    for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".css") && f !== "base.css")) expect(css(f), f).not.toMatch(/safe-area-inset-top/);
    const base = css("base.css");
    expect(base).toMatch(/--safe-top: var\(--safe-top-manual, env\(safe-area-inset-top/);
    expect(base).toMatch(/@media \(display-mode: standalone\) and \(pointer: coarse\)[\s\S]*max\(env\(safe-area-inset-top, 0px\), 24px\)/);
  });

  it("Hauptbereich, Seitenleiste und Dialoge nutzen den Abstand", () => {
    expect(css("layout.css")).toMatch(/\.shell-side, \.shell-main[^{]*\{\s*padding-top: var\(--safe-top\)/);
    expect(css("components.css")).toMatch(/\.overlay \{[^}]*padding-top: calc\(24px \+ var\(--safe-top\)\)/);
  });

  it("Einstellung setzt bzw. entfernt den festen Wert", () => {
    const props = new Map<string, string>();
    const root = { style: { setProperty: (k: string, v: string) => props.set(k, v), removeProperty: (k: string) => props.delete(k) } } as unknown as HTMLElement;
    applyTopInset(40, root);
    expect(props.get("--safe-top-manual")).toBe("40px");
    applyTopInset(500, root);
    expect(props.get("--safe-top-manual")).toBe("64px");
    applyTopInset(-1, root);
    expect(props.has("--safe-top-manual")).toBe(false);
  });
});
