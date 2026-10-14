import { api, errorMessage } from "../../api";
import type { DocumentInfo } from "../../api/types";
import { reportError, useApp } from "../../state/store";
import { confirmDialog } from "../../ui/Dialog";

export async function openExternally(d: Pick<DocumentInfo, "id" | "title">) {
  try {
    await api.documentOpenExternal(d.id);
    useApp
      .getState()
      .toast("Eine Kopie wurde im Standardprogramm geöffnet. Änderungen daran wirken sich nicht auf das Original in Studium OS aus.", "info");
  } catch (e) {
    reportError(e);
  }
}

export async function saveCopyAs(d: Pick<DocumentInfo, "id" | "title" | "ext">) {
  try {
    const path = await api.pickSavePath(`${d.title}.${d.ext}`, d.ext);
    if (!path) return;
    await api.documentExportCopy(d.id, path);
    useApp.getState().toast("Kopie gespeichert.", "success");
  } catch (e) {
    useApp.getState().toast(`Speichern fehlgeschlagen: ${errorMessage(e)}`, "error");
  }
}

export async function trashDocument(d: Pick<DocumentInfo, "id" | "title">) {
  const ok = await confirmDialog({
    title: "Dokument in den Papierkorb?",
    message: `„${d.title}“ wird aus allen Zuordnungen entfernt. Im Papierkorb kannst du es wiederherstellen.`,
    confirm: "In den Papierkorb",
    danger: true,
  });
  if (!ok) return false;
  try {
    await api.documentTrash(d.id);
    useApp.getState().bump();
    return true;
  } catch (e) {
    reportError(e);
    return false;
  }
}
