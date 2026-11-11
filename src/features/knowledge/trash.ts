/** Wissenseintrag (Schema, Definition, Fall …) nach Rückfrage in den Papierkorb legen. */
import { api } from "../../api";
import type { Knowledge } from "../../api/types";
import { reportError, useApp } from "../../state/store";
import { confirmDialog } from "../../ui/Dialog";

export async function trashKnowledge(k: Pick<Knowledge, "id" | "title">): Promise<boolean> {
  const ok = await confirmDialog({ title: `„${k.title}“ löschen?`, message: "Der Eintrag kommt in den Papierkorb und lässt sich dort wiederherstellen.", confirm: "In den Papierkorb", danger: true });
  if (!ok) return false;
  try {
    await api.knowledgeTrash(k.id);
    useApp.getState().bump();
    useApp.getState().toast(`„${k.title}“ liegt im Papierkorb.`, "info");
    return true;
  } catch (e) {
    reportError(e);
    return false;
  }
}
