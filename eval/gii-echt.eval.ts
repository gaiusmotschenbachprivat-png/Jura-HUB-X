/**
 * Prüft den Gesetzesimport gegen die echten Dateien von gesetze-im-internet.de
 * (läuft im GitHub-Workflow; lokal: RUN_GII_REAL=1 npm run eval).
 * Kein API-Schlüssel nötig.
 */
import fs from "node:fs";
import path from "node:path";

import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

import { verifyAnswer } from "../src/ai/verify";
import { SourceRegistry } from "../src/ai/sources/registry";
import { parseGiiArchive } from "../src/ai/sources/gii";
import * as legal from "../src/core/repo/legal";
import { openTestDb } from "../src/core/testing";

const RUN = process.env.RUN_GII_REAL === "1";

async function load(abbr: string) {
  // Vorab geladene Datei (z. B. per curl im Workflow) bevorzugen
  const cached = path.join(import.meta.dirname, ".cache", `${abbr}.zip`);
  if (fs.existsSync(cached)) return parseGiiArchive(new Uint8Array(fs.readFileSync(cached)), abbr);
  let res: Response;
  try {
    res = await fetch(`https://www.gesetze-im-internet.de/${abbr}/xml.zip`);
  } catch (e) {
    throw new Error(`Abruf ${abbr} fehlgeschlagen: ${String((e as { cause?: unknown }).cause ?? e)}`);
  }
  expect(res.status, abbr).toBe(200);
  return parseGiiArchive(new Uint8Array(await res.arrayBuffer()), abbr);
}

describe.skipIf(!RUN)("Import echter Gesetze", () => {
  it("BGB, GG, StGB, KSchG", async () => {
    (globalThis as { DOMParser?: unknown }).DOMParser = new JSDOM().window.DOMParser;
    const db = await openTestDb();
    const laws = await Promise.all(["bgb", "gg", "stgb", "kschg"].map(load));
    for (const l of laws) {
      const s = legal.save(db, l.source, l.chunks);
      console.log(`${s.abbreviation}: ${s.chunk_count} Abschnitte · ${s.title} · ${s.version.slice(0, 100)}`);
      expect(s.version.length).toBeGreaterThan(0);
    }
    const n433 = legal.norm(db, "BGB", "§ 433", null);
    expect(n433.map((h) => h.absatz)).toEqual([1, 2]);
    expect(n433[0]!.text).toContain("Kaufvertrag");
    expect(n433[0]!.heading).toContain("Kaufvertrag");
    expect(legal.norm(db, "BGB", "§ 312g", null).length).toBeGreaterThan(0);
    expect(legal.norm(db, "GG", "Art. 1", 1)[0]!.text).toContain("Würde des Menschen ist unantastbar");
    expect(legal.norm(db, "StGB", "§ 242", 1)[0]!.text).toContain("fremde bewegliche Sache");
    expect(legal.norm(db, "KSchG", "§ 4", null).map((h) => h.text).join(" ")).toContain("drei Wochen");
    // Listen (Nummern) bleiben lesbar
    expect(legal.norm(db, "BGB", "§ 309", null).map((h) => h.text).join("\n")).toMatch(/\n7\. /);
    // Suche über echte Texte
    expect(legal.search(db, ["kaufvertrag", "verkäuf"], ["gesetz"], 5).length).toBeGreaterThan(0);
    // Zitatprüfung erkennt erfundene Absätze und Normen
    const reg = new SourceRegistry();
    reg.register(n433);
    const store = {
      legalSearch: async (t: string[], k: null, l: number) => legal.search(db, t, k, l),
      legalNorm: async (a: string, n: string, abs: number | null) => legal.norm(db, a, n, abs),
      legalSourcesList: async () => legal.list(db),
    };
    const r = await verifyAnswer("§ 433 Abs. 1 BGB; § 433 Abs. 5 BGB; § 999 StGB; § 242 StGB", reg, store);
    const by = Object.fromEntries(r.checks.map((c) => [c.label, c.status]));
    expect(by).toEqual({ "§ 433 Abs. 1 BGB": "belegt", "§ 433 Abs. 5 BGB": "existiert_nicht", "§ 999 StGB": "existiert_nicht", "§ 242 StGB": "nicht_belegt" });
  });
});
