import { describe, expect, it } from "vitest";

import type { NewLegalChunk, NewLegalSource } from "../api/types";
import { createLegalMock } from "../api/mockLegal";
import { importFile, upgradeTextLaws } from "./sources/importer";
import { chunkText } from "./sources/text";
import { looksLikeLaw, parseLawText } from "./sources/lawText";

// Aufbau wie die PDF-Fassung von gesetze-im-internet.de (gekürzt)
const PAGE = (n: number) => `- Seite ${n} von 9 -\n\nEin Service des Bundesministerium der Justiz und für Verbraucherschutz\nsowie des Bundesamts für Justiz ‒ www.gesetze-im-internet.de`;
const STGB = `Ein Service des Bundesministerium der Justiz und für Verbraucherschutz
sowie des Bundesamts für Justiz ‒ www.gesetze-im-internet.de
Strafgesetzbuch (StGB)
StGB
Ausfertigungsdatum: 15.05.1871
Stand: Neugefasst durch Bek. v. 13.11.1998 I 3322;
zuletzt geändert durch Art. 1 G v. 20.3.2026 I Nr. 95
Inhaltsübersicht
Allgemeiner Teil
E r s t e r A b s c h n i t t
D a s S t r a f g e s e t z
§ 1 Keine Strafe ohne Gesetz
§ 2 Zeitliche Geltung
§ 6 Auslandstaten gegen international geschützte Rechtsgüter
§§ 220 und 220a (weggefallen)
§ 242 Diebstahl
§ 243 Besonders schwerer Fall des Diebstahls
${PAGE(1)}
Allgemeiner Teil
Erster Abschnitt
Das Strafgesetz
§ 1 Keine Strafe ohne Gesetz
Eine Tat kann nur bestraft werden, wenn die Strafbarkeit gesetzlich bestimmt war, bevor die Tat begangen wurde.
§ 2 Zeitliche Geltung
(1) Die Strafe und ihre Nebenfolgen bestimmen sich nach dem Gesetz, das zur Zeit der Tat gilt.
(2) Wird die Strafdrohung während der Begehung der Tat geändert, so ist das Gesetz anzuwenden, das bei
${PAGE(2)}
Beendigung der Tat gilt.
§ 6 Auslandstaten gegen international geschützte Rechtsgüter
Das deutsche Strafrecht gilt für folgende Taten, die im Ausland begangen werden:
1. Straftaten nach den §§ 307 und 308 Abs. 1 bis 4, des
§ 309 Abs. 2 und des § 310;
§§ 7 bis 9 (weggefallen)
§ 220 (weggefallen)
Neunzehnter Abschnitt
Diebstahl und Unterschlagung
§ 242 Diebstahl
(1) Wer eine fremde bewegliche Sache einem anderen in der Absicht wegnimmt, die Sache sich oder einem
Dritten rechtswidrig zuzueignen, wird mit Freiheitsstrafe bis zu fünf Jahren oder mit Geldstrafe bestraft.
(2) Der Versuch ist strafbar.
§ 243 Besonders schwerer Fall des Diebstahls
(1) In besonders schweren Fällen wird der Diebstahl mit Freiheitsstrafe von drei Monaten bis zu zehn Jahren
bestraft.
(2) In den Fällen des Absatzes 1 Satz 2 Nr. 1 bis 6 ist ein besonders schwerer Fall ausgeschlossen, wenn sich die Tat
auf eine geringwertige Sache bezieht.
${PAGE(3)}`;

describe("Gesetz als PDF/Text", () => {
  const law = parseLawText(STGB, { origin: "StGB.pdf" });
  const by = (n: string) => law.chunks.filter((c) => c.norm === n);
  it("erkennt Titel, Abkürzung und Stand", () => {
    expect(law.source).toMatchObject({ kind: "gesetz", title: "Strafgesetzbuch", abbreviation: "StGB" });
    expect(law.source.version).toContain("zuletzt geändert durch Art. 1 G v. 20.3.2026");
  });
  it("Normen ab dem Gesetzestext, Inhaltsübersicht übersprungen", () => {
    expect([...new Set(law.chunks.map((c) => c.norm))]).toEqual(["§ 1", "§ 2", "§ 6", "§ 220", "§ 242", "§ 243"]);
    expect(by("§ 220")[0]!.text).toBe("(weggefallen)");
    expect(by("§ 1")).toHaveLength(1);
  });
  it("Absätze, Seitenumbruch ohne Kopf-/Fußzeile, Gliederung als Überschrift", () => {
    expect(by("§ 242").map((c) => c.absatz)).toEqual([1, 2]);
    expect(by("§ 242")[0]!.text).toBe("(1) Wer eine fremde bewegliche Sache einem anderen in der Absicht wegnimmt, die Sache sich oder einem Dritten rechtswidrig zuzueignen, wird mit Freiheitsstrafe bis zu fünf Jahren oder mit Geldstrafe bestraft.");
    expect(by("§ 242")[0]!.heading).toBe("Diebstahl – Neunzehnter Abschnitt Diebstahl und Unterschlagung");
    expect(by("§ 2")[1]!.text).toBe("(2) Wird die Strafdrohung während der Begehung der Tat geändert, so ist das Gesetz anzuwenden, das bei Beendigung der Tat gilt.");
    expect(law.chunks.some((c) => /Seite \d|Ein Service|gesetze-im-internet/.test(c.text))).toBe(false);
  });
  it("umbrochene Verweise und „§§ … (weggefallen)“ sind keine neuen Normen", () => {
    expect(by("§ 6")[0]!.text).toContain("§ 309 Abs. 2 und des § 310;");
    expect(law.chunks.filter((c) => c.text.includes("weggefallen")).map((c) => c.norm)).toEqual(["§ 220"]);
  });
  it("Erkennung „sieht aus wie ein Gesetz“", () => {
    expect(looksLikeLaw(STGB.replace(/§ /g, "§ ").repeat(2))).toBe(true);
    expect(looksLikeLaw("Urteil des BGH\nTatbestand\nDer Kläger verlangt …")).toBe(false);
  });
  it("Import: auch als „Eigenes Dokument“ gewählt wird ein Gesetz erkannt und normweise gespeichert", async () => {
    let saved: { s: NewLegalSource; c: NewLegalChunk[] } | null = null;
    const backend = { legalSourceSave: async (s: NewLegalSource, c: NewLegalChunk[]) => ((saved = { s, c }), { ...s, id: "x", chunk_count: c.length, imported_at: "" }) as never };
    await importFile(backend, "StGB.txt", new TextEncoder().encode(STGB + "\n" + STGB.slice(STGB.indexOf("§ 1 Keine Strafe ohne Gesetz\nEine"))), { kind: "dokument", title: "" });
    expect(saved!.s).toMatchObject({ kind: "gesetz", abbreviation: "StGB" });
    expect(saved!.c.some((c) => c.norm === "§ 242" && c.absatz === 1)).toBe(true);
  });
  it("Gesetz ohne erkennbare Abkürzung: verständlicher Hinweis", async () => {
    const backend = { legalSourceSave: async () => ({}) as never };
    const text = STGB.replace("Strafgesetzbuch (StGB)", "Strafgesetzbuch");
    await expect(importFile(backend, "gesetz.txt", new TextEncoder().encode(text), { kind: "gesetz", title: "" })).rejects.toThrow(/Abkürzung/);
    await expect(importFile(backend, "gesetz.txt", new TextEncoder().encode(text), { kind: "gesetz", title: "", abbreviation: "StGB" })).resolves.toBeDefined();
  });

  it("früher als Text gespeichertes Gesetz wird einmalig als Gesetz neu aufbereitet", async () => {
    const legal = createLegalMock();
    const settings: Record<string, unknown> = {};
    const backend = { ...legal, settingsAll: async () => ({ ...settings }), settingSet: async (k: string, v: unknown) => void (settings[k] = v) };
    // so hat Version 0.18 eine Gesetz-PDF gespeichert: Textstücke ohne Paragraphen
    const old = await legal.legalSourceSave({ kind: "dokument", title: "StGB", origin: "StGB.pdf" }, chunkText(STGB, 300));
    const urteil = await legal.legalSourceSave({ kind: "urteil", title: "BGH-Urteil", origin: "urteil.pdf" }, ["Leitsatz", "Tatbestand", "Gründe"].map((t) => ({ norm: "", absatz: null, heading: t, text: `${t}: …` })));
    expect(await legal.legalNorm("StGB", "§ 242", null)).toEqual([]);
    const done = await upgradeTextLaws(backend);
    expect(done.map((s) => s.abbreviation)).toEqual(["StGB"]);
    expect((await legal.legalNorm("StGB", "§ 2", 2))[0]?.text).toMatch(/^\(2\) Wird die Strafdrohung.*Beendigung der Tat gilt\.$/);
    const list = await legal.legalSourcesList();
    expect(list.map((s) => s.id)).not.toContain(old.id);
    expect(list.map((s) => s.id)).toContain(urteil.id);
    // zweiter Lauf: nichts mehr zu tun, das Urteil wird nicht erneut geprüft
    expect(await upgradeTextLaws(backend)).toEqual([]);
    expect(settings["ai.lawUpgrade"]).toEqual([urteil.id]);
  });
});
