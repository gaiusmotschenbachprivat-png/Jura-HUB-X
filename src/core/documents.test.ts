// @vitest-environment node
/**
 * Port der Rust-Tests (tests/core.rs, tests/phase3.rs) zu Dokumenten,
 * Verknüpfungen, Papierkorb, Dateien und Suche mit Dokumenten.
 */
import { describe, expect, it } from "vitest";

import type { NewNode, NodeKind } from "../api/types";
import type { Ctx } from "./ctx";
import { extensionOf, sanitizeFilename, sniffImage, suggestedFileName } from "./files";
import * as areas from "./repo/areas";
import * as documents from "./repo/documents";
import * as links from "./repo/links";
import * as nodes from "./repo/nodes";
import * as notes from "./repo/notes";
import * as trash from "./repo/trash";
import { HL_START, rebuild, search } from "./search";
import { testCtx } from "./testing";

const enc = new TextEncoder();
const file = (content: string | Uint8Array) => new Blob([typeof content === "string" ? enc.encode(content) : (content as Uint8Array<ArrayBuffer>)]);

function docJson(text: string): string {
  return JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
}

async function setup() {
  const ctx = await testCtx();
  const jura = areas.create(ctx.db, "Rechtswissenschaften", "#1f3f8f").id;
  const rw = areas.create(ctx.db, "Recht & Wirtschaft", "#2b8a3e").id;
  return { ctx, db: ctx.db, blobs: ctx.blobs, jura, rw };
}

function node(area: string, parent: string | null, kind: NodeKind, title: string): NewNode {
  return { area_id: area, parent_id: parent, kind, title };
}

const imp = (ctx: Ctx, name: string, content: string | Uint8Array, nodeId: string | null, docType: string) =>
  documents.importDocument(ctx, name, file(content), nodeId, docType);

describe("Dateien", () => {
  it("macht Dateinamen sicher", () => {
    expect(sanitizeFilename("../../etc/passwd")).toBe("_.._etc_passwd");
    expect(sanitizeFilename("CON")).toBe("_CON");
    expect(sanitizeFilename("  ")).toBe("Unbenannt");
    expect(sanitizeFilename("BGB AT: Termin 3?")).toBe("BGB AT_ Termin 3_");
    expect(sanitizeFilename(".versteckt")).toBe("versteckt");
    expect(suggestedFileName("Folien: BGB", "p/d.f")).toBe("Folien_ BGB.pdf");
  });

  it("erkennt Endungen und Bildtypen", () => {
    expect(extensionOf("Folien.PDF")).toBe("pdf");
    expect(extensionOf(".bashrc")).toBe("");
    expect(extensionOf("a.tar.gz")).toBe("gz");
    expect(sniffImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toEqual(["png", "image/png"]);
    expect(sniffImage(enc.encode("RIFF\0\0\0\0WEBPVP8 "))).toEqual(["webp", "image/webp"]);
    expect(sniffImage(enc.encode("<svg>"))).toBeNull();
  });
});

describe("Papierkorb", () => {
  it("versteckt, stellt wieder her und löscht endgültig", async () => {
    const f = await setup();
    const c = nodes.create(f.db, node(f.jura, null, "course", "Strafrecht AT"));
    const n = nodes.create(f.db, node(f.jura, c.id, "note", "Vorsatz"));
    notes.save(f.db, n.id, docJson("dolus eventualis"), "dolus eventualis");

    trash.trashNode(f.db, c.id);
    expect(nodes.list(f.db, f.jura)).toHaveLength(0);
    expect(search(f.db, "dolus", null, 10)).toHaveLength(0);
    const items = trash.list(f.db);
    expect(items).toHaveLength(1);
    expect(items[0]!.children).toBe(1);
    expect(() => notes.save(f.db, n.id, docJson("x"), "x")).toThrow();

    trash.restoreNode(f.db, c.id);
    expect(nodes.list(f.db, f.jura)).toHaveLength(2);
    expect(search(f.db, "dolus", null, 10)).toHaveLength(1);

    expect(() => trash.purgeNode(f.db, c.id)).toThrow(/nur aus|im Papierkorb/i);
    trash.trashNode(f.db, c.id);
    await trash.purgeAny(f.ctx, "node", c.id);
    expect(() => nodes.get(f.db, n.id)).toThrow();
    expect(trash.list(f.db)).toHaveLength(0);
    expect(() => trash.restoreAny(f.db, "x", c.id)).toThrow("Unbekannter Eintrag.");
  });
});

describe("Dokumente", () => {
  it("importiert, dedupliziert, indexiert Text und verwaltet Zuordnungen", async () => {
    const f = await setup();
    const c1 = nodes.create(f.db, node(f.jura, null, "course", "Gesellschaftsrecht"));
    const c2 = nodes.create(f.db, node(f.rw, null, "course", "Unternehmensfinanzierung"));

    const txt = "Die GmbH haftet mit ihrem Gesellschaftsvermögen.";
    const d1 = await imp(f.ctx, "Skript_GmbH.txt", txt, c1.id, "skript");
    expect(d1.title).toBe("Skript GmbH");
    expect(d1.text_status).toBe("ok");
    expect(d1.page_count).toBe(1);
    expect(d1.size).toBe(enc.encode(txt).length);
    expect(d1.file_present).toBe(true);

    // Ein Dokument, zwei Veranstaltungen, keine Kopie
    documents.addPlacement(f.db, d1.id, c2.id);
    expect(documents.list(f.db, null, { kind: "area", id: f.rw })).toHaveLength(1);
    expect(documents.placements(f.db, d1.id)).toHaveLength(2);
    expect(documents.placementSummary(f.db, d1.id)).toBe("Gesellschaftsrecht · +1 weitere");
    expect(documents.list(f.db, null, { kind: "node", id: c1.id })).toHaveLength(1);
    expect(documents.list(f.db, null, { kind: "subtree", id: c1.id })).toHaveLength(1);

    // Gleiche Datei erneut: zweiter Datensatz, aber nur eine physische Datei
    const d2 = await imp(f.ctx, "Skript_GmbH.txt", txt, null, "skript");
    expect(Number(f.db.value("SELECT COUNT(*) FROM blobs"))).toBe(1);
    expect(f.blobs.list()).toHaveLength(1);
    expect(documents.list(f.db, null, { kind: "unassigned" })[0]!.id).toBe(d2.id);

    // Suche: Text mit Fundstelle, Umlaute ohne Akzent findbar
    const hits = search(f.db, "gesellschaftsvermogen", null, 10);
    expect(hits.some((h) => h.entity_type === "page" && h.page === 1)).toBe(true);
    expect(hits[0]!.snippet).toContain(HL_START);

    // PDF: falsche Signatur wird abgelehnt, Text aus der Oberfläche seitenweise
    await expect(imp(f.ctx, "fake.pdf", "MZ\x90\x00 kein pdf", null, "folien")).rejects.toThrow(
      "Die Datei endet auf .pdf, ist aber keine gültige PDF-Datei.",
    );
    const p = await imp(f.ctx, "Folien BGB AT.pdf", "%PDF-1.7\n% Testinhalt\n", c1.id, "folien");
    expect(p.text_status).toBe("pending");
    expect(p.page_count).toBeNull();
    documents.setText(f.db, p.id, ["Deckblatt", "Die Willenserklärung ist …", ""]);
    const hit = search(f.db, "willenserklarung", f.jura, 10);
    expect(hit).toHaveLength(1);
    expect(hit[0]!.page).toBe(2);
    expect(hit[0]!.path).toBe("Gesellschaftsrecht");
    expect(documents.pagesText(f.db, p.id)).toEqual(["Deckblatt", "Die Willenserklärung ist …", ""]);
    expect(documents.pageText(f.db, p.id, 2)).toBe("Die Willenserklärung ist …");
    expect(documents.pageText(f.db, p.id, 9)).toBeNull();
    const s = await imp(f.ctx, "Scan.pdf", "%PDF-1.4\n%scan\n", null, "skript");
    expect(documents.setText(f.db, s.id, ["", " "]).text_status).toBe("none");

    // Umbenennen ändert auch die Titel der Seitentreffer
    documents.update(f.db, p.id, "BGB AT Folien", "folien");
    expect(search(f.db, "willenserklarung", null, 10)[0]!.title).toContain("Folien");
    expect(() => documents.update(f.db, p.id, "x", "quatsch")).toThrow("Unbekannter Dokumenttyp.");

    // Unerlaubte Typen
    await expect(imp(f.ctx, "setup.exe", "MZ", null, "sonstiges")).rejects.toThrow(
      "Dateityp „.exe“ wird nicht unterstützt. Erlaubt sind PDF, Word, PowerPoint, Excel, Text, Markdown, Bilder und Audioaufnahmen.",
    );
    await expect(imp(f.ctx, "a.txt", "x", null, "unbekannt")).rejects.toThrow("Unbekannter Dokumenttyp.");

    // Mehrfachimport: Fehler je Datei, Rest wird importiert
    const out = await documents.importDocuments(
      f.ctx,
      [
        { name: "gut.md", data: file("# Titel") },
        { name: "böse.exe", data: file("MZ") },
      ],
      null,
      "sonstiges",
    );
    expect(out[0]!.document?.title).toBe("gut");
    expect(out[0]!.error).toBeNull();
    expect(out[1]!.document).toBeNull();
    expect(out[1]!.file_name).toBe("böse.exe");
    expect(out[1]!.error).toContain("„.exe“");
    expect(documents.recent(f.db, f.blobs, null, 2)).toHaveLength(2);
    expect(documents.detail(f.db, f.blobs, d1.id).placements).toHaveLength(2);
  });

  it("Vorlesungsaufnahme: Audio an der Mitschrift, Transkript als durchsuchbarer Text", async () => {
    const f = await setup();
    const c = nodes.create(f.db, node(f.jura, null, "course", "Strafrecht AT"));
    const n = nodes.create(f.db, node(f.jura, c.id, "note", "5. Vorlesung"));
    const a = await imp(f.ctx, "Aufnahme 5. Vorlesung 2026-10-29 10.15.m4a", new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]), n.id, "aufnahme");
    expect(a.ext).toBe("m4a");
    expect(a.mime).toBe("audio/mp4");
    expect(a.doc_type).toBe("aufnahme");
    expect(a.text_status).toBe("none");
    const withText = documents.setText(f.db, a.id, ["[0:05] Der Totschlag nach § 212 StGB setzt voraus, dass ein Mensch getötet wird."]);
    expect(withText.text_status).toBe("ok");
    expect(search(f.db, "Totschlag", null, 10).some((h) => h.entity_id === a.id)).toBe(true);
    for (const ext of ["mp3", "wav", "webm"]) expect((await imp(f.ctx, `x.${ext}`, "RIFF", null, "aufnahme")).text_status).toBe("none");
  });

  it("meldet fehlende Dateien", async () => {
    const f = await setup();
    const d = await imp(f.ctx, "a.txt", "Inhalt", null, "sonstiges");
    const sha = documents.blobSha(f.db, d.id);
    expect(new TextDecoder().decode(await documents.documentBytes(f.ctx, d.id))).toBe("Inhalt");
    await f.blobs.remove(sha);
    expect(documents.get(f.db, f.blobs, d.id).file_present).toBe(false);
    expect(documents.list(f.db, f.blobs, { kind: "all" })[0]!.file_present).toBe(false);
    await expect(documents.documentBytes(f.ctx, d.id)).rejects.toThrow(/fehlt im Dokumentenspeicher/);
  });

  it("behält beim endgültigen Löschen geteilte Dateien", async () => {
    const f = await setup();
    const a = await imp(f.ctx, "x.txt", "geteilt", null, "sonstiges");
    const b = await imp(f.ctx, "x.txt", "geteilt", null, "sonstiges");
    const sha = documents.blobSha(f.db, a.id);
    await expect(trash.purgeDocument(f.ctx, a.id)).rejects.toThrow("Nur Dokumente im Papierkorb können endgültig gelöscht werden.");
    trash.trashDocument(f.db, a.id);
    expect(trash.list(f.db).map((i) => i.item_type)).toEqual(["document"]);
    await trash.purgeDocument(f.ctx, a.id);
    expect(f.blobs.has(sha)).toBe(true);
    trash.trashDocument(f.db, b.id);
    await trash.purgeAny(f.ctx, "document", b.id);
    expect(f.blobs.has(sha)).toBe(false);
    expect(Number(f.db.value("SELECT COUNT(*) FROM blobs"))).toBe(0);
  });
});

describe("Verknüpfungen", () => {
  it("sind in beide Richtungen sichtbar und überstehen Umbenennen", async () => {
    const f = await setup();
    const note = nodes.create(f.db, node(f.jura, null, "note", "Mitschrift Termin 3"));
    const d = await imp(f.ctx, "Folien.pdf", "%PDF-1.7\n", null, "folien");
    const link = { source_type: "node", source_id: note.id, target_type: "document", target_id: d.id, kind: "page", anchor: { page: 12 } };
    const id = links.add(f.db, link);
    expect(links.add(f.db, link)).toBe(id);
    nodes.update(f.db, note.id, { title: "Umbenannt" });
    const back = links.forEntity(f.db, "document", d.id);
    expect(back).toHaveLength(1);
    expect(back[0]!.direction).toBe("incoming");
    expect(back[0]!.other_title).toBe("Umbenannt");
    expect(back[0]!.other_kind).toBe("note");
    expect(back[0]!.anchor?.page).toBe(12);
    const fwd = links.forEntity(f.db, "node", note.id);
    expect(fwd[0]!.direction).toBe("outgoing");
    expect(fwd[0]!.other_path).toBe("Nicht zugeordnet");

    expect(() => links.add(f.db, { ...link, anchor: { page: 0 } })).toThrow("Ungültige Seitenzahl.");
    expect(() => links.add(f.db, { ...link, target_type: "node", target_id: note.id })).toThrow(/mit sich selbst/);
    expect(() => links.add(f.db, { ...link, kind: "x" })).toThrow("Unbekannte Art von Verknüpfung.");
    expect(() => links.add(f.db, { ...link, target_type: "x" })).toThrow("Unbekannter Inhaltstyp für Verknüpfung.");

    // Endgültiges Löschen entfernt die Verknüpfungen
    trash.trashDocument(f.db, d.id);
    expect(links.forEntity(f.db, "node", note.id)[0]!.other_missing).toBe(true);
    await trash.purgeDocument(f.ctx, d.id);
    expect(links.forEntity(f.db, "node", note.id)).toHaveLength(0);
  });

  it("macht interne Links im Text zu Rückverweisen", async () => {
    const f = await setup();
    const def = nodes.create(f.db, node(f.jura, null, "note", "Definition Willenserklärung"));
    const n = nodes.create(f.db, node(f.jura, null, "note", "Mitschrift"));
    const content = JSON.stringify({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "siehe Definition", marks: [{ type: "link", attrs: { href: `studium:node/${def.id}` } }] },
            { type: "text", text: " und tot", marks: [{ type: "link", attrs: { href: "studium:node/01900000-0000-7000-8000-00000000dead" } }] },
          ],
        },
      ],
    });
    notes.save(f.db, n.id, content, "siehe Definition");
    const back = links.forEntity(f.db, "node", def.id);
    expect(back).toHaveLength(1);
    expect(back[0]!.kind).toBe("mention");
    expect(back[0]!.other_id).toBe(n.id);
    notes.save(f.db, n.id, docJson("ohne Link"), "ohne Link");
    expect(links.forEntity(f.db, "node", def.id)).toHaveLength(0);
  });
});

describe("Suche", () => {
  it("verträgt Sonderzeichen und filtert nach Bereich", async () => {
    const f = await setup();
    const a = nodes.create(f.db, node(f.jura, null, "note", "Kaufvertrag § 433 BGB"));
    notes.save(f.db, a.id, docJson("Anspruch auf Übereignung"), "Anspruch auf Übereignung");
    const b = nodes.create(f.db, node(f.rw, null, "note", "Investitionsrechnung"));
    notes.save(f.db, b.id, docJson("Kapitalwert und Anspruch"), "Kapitalwert und Anspruch");

    expect(search(f.db, "§ 433", null, 10)).toHaveLength(1);
    expect(search(f.db, "anspr", null, 10)).toHaveLength(2);
    expect(search(f.db, "anspruch", f.rw, 10)).toHaveLength(1);
    expect(search(f.db, "ubereignung", null, 10)).toHaveLength(1);
    for (const weird of ['"', "(", "NEAR(", "*", "a OR", "AND", "'; DROP TABLE nodes; --"]) {
      expect(() => search(f.db, weird, null, 10)).not.toThrow();
    }
    expect(search(f.db, "   ", null, 10)).toHaveLength(0);
    const c = nodes.create(f.db, node(f.jura, null, "note", "Anspruch"));
    expect(search(f.db, "anspruch", null, 10)[0]!.entity_id).toBe(c.id);

    rebuild(f.db);
    expect(search(f.db, "anspruch", null, 10)).toHaveLength(3);
  });

  it("findet Dokumente nach Neuaufbau, nicht zugeordnete in jedem Bereich", async () => {
    const f = await setup();
    const d = await imp(f.ctx, "Notizen_Sachenrecht.md", "Trennungsprinzip und Abstraktionsprinzip", null, "mitschrift");
    expect(search(f.db, "trennungsprinzip", f.rw, 5)).toHaveLength(1);
    const course = nodes.create(f.db, node(f.jura, null, "course", "Sachenrecht"));
    documents.addPlacement(f.db, d.id, course.id);
    expect(search(f.db, "trennungsprinzip", f.rw, 5)).toHaveLength(0);
    rebuild(f.db);
    const hits = search(f.db, "trennungsprinzip", f.jura, 5);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.path).toBe("Sachenrecht");
    expect(search(f.db, "Notizen", null, 5)[0]!.entity_type).toBe("document");
    trash.trashDocument(f.db, d.id);
    expect(search(f.db, "trennungsprinzip", null, 5)).toHaveLength(0);
  });
});

describe("Bilder in Notizen", () => {
  it("werden gespeichert und beim Löschen eines Dokuments geschützt", async () => {
    const f = await setup();
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
    const sha = await documents.imageStore(f.ctx, png);
    await expect(documents.storeImage(f.ctx, enc.encode("<svg onload=alert(1)>"))).rejects.toThrow(
      "Nur PNG-, JPEG-, GIF- und WebP-Bilder können eingefügt werden.",
    );
    const { bytes, mime } = await documents.imageData(f.ctx, sha);
    expect(bytes).toEqual(png);
    expect(mime).toBe("image/png");
    expect(await documents.imageBytes(f.ctx, sha)).toEqual(png);
    await expect(documents.imageBytes(f.ctx, "a".repeat(64))).rejects.toThrow("Bild nicht gefunden.");

    const note = nodes.create(f.db, node(f.jura, null, "note", "Mit Bild"));
    const content = JSON.stringify({ type: "doc", content: [{ type: "image", attrs: { src: `studium:asset/${sha}` } }] });
    notes.save(f.db, note.id, content, "");

    const d = await imp(f.ctx, "bild.png", png, null, "sonstiges");
    expect(d.text_status).toBe("none");
    expect(d.mime).toBe("image/png");
    trash.trashDocument(f.db, d.id);
    await trash.purgeDocument(f.ctx, d.id);
    expect(f.blobs.has(sha)).toBe(true);
    expect(Number(f.db.value("SELECT COUNT(*) FROM blobs"))).toBe(1);
  });
});
