// @vitest-environment node
import { describe, expect, it } from "vitest";

import { configure } from "./db";
import { mergeDatabases } from "./merge";
import * as aiChats from "./repo/aiChats";
import { dbFromBytes, dbToBytes, type Sqlite3Like } from "./sqliteBytes";
import { openTestDb, sqlite3 } from "./testing";
import { newId } from "./util";

const input = (over: Partial<Parameters<typeof aiChats.save>[1]> = {}) => ({ id: null, title: "Was ist Diebstahl?", task: "recherche" as const, own_docs: false, entries: "[]", state: "{}", ...over });
const tick = () => new Promise((r) => setTimeout(r, 5));

describe("KI-Verlauf", () => {
  it("speichert, listet (neueste zuerst), lädt und löscht Unterhaltungen", async () => {
    const db = await openTestDb();
    const a = aiChats.save(db, input({ title: "  Erste\nFrage " }));
    expect(a.title).toBe("Erste Frage");
    expect(a.own_docs).toBe(false);
    await tick();
    const b = aiChats.save(db, input({ title: "", task: "vertrag", own_docs: true }));
    expect(b.title).toBe("Unterhaltung");
    expect(aiChats.list(db).map((c) => c.id)).toEqual([b.id, a.id]);
    await tick();
    aiChats.save(db, input({ id: a.id, title: "Erste Frage", entries: '[{"role":"user","text":"x"}]' }));
    expect(aiChats.list(db)[0]!.id).toBe(a.id);
    const full = aiChats.get(db, a.id);
    expect(JSON.parse(full.entries)).toEqual([{ role: "user", text: "x" }]);
    expect(aiChats.get(db, b.id).own_docs).toBe(true);
    aiChats.remove(db, a.id);
    expect(aiChats.list(db).map((c) => c.id)).toEqual([b.id]);
    aiChats.clear(db);
    expect(aiChats.list(db)).toEqual([]);
  });

  it("prüft Eingaben", async () => {
    const db = await openTestDb();
    expect(() => aiChats.save(db, input({ task: "anders" as never }))).toThrow(/Aufgabe/);
    expect(() => aiChats.save(db, input({ state: "{kaputt" }))).toThrow(/ungültig/);
    expect(() => aiChats.save(db, input({ id: newId() }))).toThrow(/nicht gefunden/);
    expect(() => aiChats.get(db, "../etc")).toThrow();
    expect(() => aiChats.save(db, input({ entries: JSON.stringify("x".repeat(aiChats.MAX_CHAT_BYTES)) }))).toThrow(/zu lang/);
  });

  it("wird mit dem zweiten Gerät abgeglichen (zuletzt fortgesetzte Fassung gilt)", async () => {
    const s = (await sqlite3()) as unknown as Sqlite3Like;
    const a = await openTestDb();
    const shared = aiChats.save(a, input());
    const b = dbFromBytes(s, dbToBytes(s, a));
    configure(b);
    await tick();
    aiChats.save(b, input({ id: shared.id, entries: '["auf B fortgesetzt"]' }));
    const neu = aiChats.save(b, input({ title: "Nur auf B" }));
    const rep = mergeDatabases(a, b);
    expect(rep.added.ai_chats).toBe(1);
    expect(rep.updated.ai_chats).toBe(1);
    expect(aiChats.get(a, shared.id).entries).toContain("auf B");
    expect(aiChats.get(a, neu.id).title).toBe("Nur auf B");
  });
});
