// @vitest-environment jsdom
/** Mitgelieferte Gesetze: vollständig, sauber zerlegt, richtig eingerichtet. */
import fs from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createLegalMock } from "../api/mockLegal";
import type { NewLegalChunk, NewLegalSource } from "../api/types";

const read = (f: string) => JSON.parse(fs.readFileSync(`public/gesetze/${f}`, "utf8"));
const index = read("index.json") as { abbreviation: string; file: string; chunks: number; norms: number }[];
const law = (abbr: string) => read(index.find((l) => l.abbreviation === abbr)!.file) as { source: NewLegalSource; chunks: NewLegalChunk[] };

describe("Mitgelieferte Gesetze", () => {
  for (const [abbr, last] of [["StGB", 358], ["BGB", 2385]] as const) {
    it(`${abbr}: jeder Paragraph von § 1 bis § ${last} vorhanden, ohne Seitenkopf und Fußnoten`, () => {
      const l = law(abbr);
      expect(l.source).toMatchObject({ kind: "gesetz", abbreviation: abbr });
      expect(l.source.version).toMatch(/zuletzt geändert/);
      const norms = new Set(l.chunks.map((c) => c.norm));
      const missing = Array.from({ length: last }, (_, i) => `§ ${i + 1}`).filter((n) => !norms.has(n));
      expect(missing).toEqual([]);
      expect(norms.size).toBe(index.find((i) => i.abbreviation === abbr)!.norms);
      expect(l.chunks.filter((c) => /Seite \d+ von \d+|Ein Service des Bundes|^Fußnote|\(\+\+\+/.test(c.text)).map((c) => c.norm)).toEqual([]);
      expect(l.chunks.every((c) => c.text.trim().length > 0)).toBe(true);
    });
  }

  it("Stichproben: Wortlaut und Absätze", () => {
    const by = (abbr: string, n: string) => law(abbr).chunks.filter((c) => c.norm === n);
    expect(by("BGB", "§ 433").map((c) => c.absatz)).toEqual([1, 2]);
    expect(by("BGB", "§ 33")[0]!.text).toMatch(/^\(1\) Zu einem Beschluss, der eine Änderung der Satzung enthält/);
    expect(by("BGB", "§ 34")[0]!.heading).toMatch(/^Ausschluss vom Stimmrecht/);
    expect(by("BGB", "§ 823").map((c) => c.absatz)).toEqual([1, 2]);
    expect(by("StGB", "§ 23").map((c) => c.absatz)).toEqual([1, 2, 3]);
    expect(by("StGB", "§ 242")[0]!.text).toMatch(/^\(1\) Wer eine fremde bewegliche Sache/);
    expect(by("StGB", "§ 43a")[0]!.text).toBe("(weggefallen)");
  });
});

describe("Einrichtung beim Start", () => {
  afterEach(() => vi.unstubAllGlobals());

  async function setup() {
    vi.stubGlobal("fetch", async (u: URL | string) => {
      const name = String(u).split("/").pop()!;
      if (!fs.existsSync(`public/gesetze/${name}`)) return new Response("", { status: 404 });
      return new Response(fs.readFileSync(`public/gesetze/${name}`, "utf8"), { status: 200 });
    });
    vi.resetModules();
    const mod = await import("./sources/bundled");
    const legal = createLegalMock();
    const settings: Record<string, unknown> = {};
    const backend = { ...legal, settingsAll: async () => ({ ...settings }), settingSet: async (k: string, v: unknown) => void (settings[k] = v) };
    return { mod, legal, backend, settings };
  }

  it("richtet fehlende Gesetze ein und ersetzt unvollständige; gelöschte kommen nicht zurück", async () => {
    const { mod, legal, backend } = await setup();
    // ein unvollständiges BGB aus einer älteren Version (nur 20 Abschnitte)
    await legal.legalSourceSave({ kind: "gesetz", title: "BGB", abbreviation: "BGB" }, Array.from({ length: 20 }, (_, i) => ({ norm: `§ ${558 + i}`, absatz: null, heading: "", text: "…" })));
    const done = await mod.ensureBundledLaws(backend);
    expect(done.map((d) => `${d.law.abbreviation}:${d.reason}`).sort()).toEqual(["BGB:vervollständigt", "StGB:neu"]);
    const list = await legal.legalSourcesList();
    expect(list.filter((s) => s.abbreviation === "BGB")).toHaveLength(1);
    expect((await legal.legalNorm("BGB", "§ 34", null))[0]?.text).toMatch(/^Ein Mitglied ist nicht stimmberechtigt/);
    // zweiter Start: nichts zu tun
    expect(await mod.ensureBundledLaws(backend)).toEqual([]);
    // StGB bewusst gelöscht → bleibt gelöscht
    await legal.legalSourceDelete(list.find((s) => s.abbreviation === "StGB")!.id);
    expect(await mod.ensureBundledLaws(backend)).toEqual([]);
  });

  it("ohne mitgelieferte Gesetze (Desktop) passiert nichts", async () => {
    vi.stubGlobal("fetch", async () => new Response("", { status: 404 }));
    vi.resetModules();
    const mod = await import("./sources/bundled");
    const legal = createLegalMock();
    expect(await mod.ensureBundledLaws({ ...legal, settingsAll: async () => ({}), settingSet: async () => {} })).toEqual([]);
  });
});
