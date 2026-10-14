import { describe, expect, it } from "vitest";

import { api } from "../../api";
import { useApp } from "../../state/store";
import { flush, flushAll, scheduleSave } from "./saveQueue";

const docOf = (t: string) => JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: t }] }] });

describe("Automatisches Speichern", () => {
  it("speichert den letzten Stand nach mehreren schnellen Änderungen", async () => {
    expect(api.kind).toBe("mock");
    const area = await api.areaCreate("Test", "#123456");
    const note = await api.nodeCreate({ area_id: area.id, parent_id: null, kind: "note", title: "N" });
    for (const t of ["a", "ab", "abc", "abcd"]) scheduleSave(note.id, () => ({ json: docOf(t), text: t }));
    expect(useApp.getState().saveStatus).toBe("dirty");
    await flush(note.id);
    expect(useApp.getState().saveStatus).toBe("saved");
    expect((await api.noteGet(note.id)).content_json).toBe(docOf("abcd"));
  });

  it("meldet Fehler und speichert beim nächsten Versuch", async () => {
    const area = await api.areaCreate("Test2", "#123456");
    const note = await api.nodeCreate({ area_id: area.id, parent_id: null, kind: "note", title: "N" });
    await api.nodeTrash(note.id); // gelöschte Notizen lehnt das Backend ab
    scheduleSave(note.id, () => ({ json: docOf("x"), text: "x" }));
    await flush(note.id).catch(() => {});
    expect(useApp.getState().saveStatus).toBe("error");
    await api.trashRestore("node", note.id);
    await flushAll();
    expect(useApp.getState().saveStatus).toBe("saved");
    expect((await api.noteGet(note.id)).content_json).toBe(docOf("x"));
  });
});
