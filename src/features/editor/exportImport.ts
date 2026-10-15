import { generateJSON } from "@tiptap/core";

import { api, errorMessage } from "../../api";
import { docxToHtml, markdownToHtml, textToHtml } from "../../lib/docxImport";
import { exportDocx, type ExportAsset } from "../../lib/docxExport";
import { toMarkdown } from "../../lib/markdownExport";
import { imageSources, plainText, type PMNode } from "../../lib/pm";
import { bibliography, citedSources } from "../../lib/zitieren";
import type { QuelleData } from "../../api/types";
import { reportError, useApp } from "../../state/store";
import { createNode } from "../navigation/actions";
import { editorExtensions } from "./extensions";

function safeName(title: string) {
  return title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim().slice(0, 120) || "Notiz";
}

export async function exportNote(doc: PMNode, title: string, format: "docx" | "md") {
  const st = useApp.getState();
  try {
    const path = await api.pickSavePath(`${safeName(title)}.${format}`, format);
    if (!path) return;
    const data =
      format === "docx" ? await exportDocx(doc, { title, bibliography: await loadBibliography(doc) }, await loadAssets(doc)) : new TextEncoder().encode(toMarkdown(doc));
    await api.exportWrite(path, data);
    st.toast(`Exportiert: ${path.split(/[\\/]/).pop()}`, "success");
  } catch (e) {
    st.toast(`Export fehlgeschlagen: ${errorMessage(e)}`, "error");
  }
}

/** Literaturverzeichnis aus den zitierten Quellen der Notiz (aktuelle Angaben der Quellen). */
export async function loadBibliography(doc: PMNode): Promise<string[]> {
  const list: QuelleData[] = [];
  for (const id of citedSources(doc)) {
    const k = await api.knowledgeGet(id).catch(() => null);
    if (k && k.type === "quelle" && !k.deleted_at) list.push(k.data as unknown as QuelleData);
  }
  return bibliography(list);
}

/** Lädt die Bilder einer Notiz für den Word-Export (PNG, JPEG, GIF; WebP wird als Hinweis exportiert). */
async function loadAssets(doc: PMNode): Promise<Map<string, ExportAsset>> {
  const out = new Map<string, ExportAsset>();
  for (const src of imageSources(doc)) {
    const m = /^studium:asset\/([0-9a-f]{64})$/.exec(src);
    if (!m) continue;
    try {
      const data = await api.imageBytes(m[1]!);
      const type = data[0] === 0x89 ? "png" : data[0] === 0xff ? "jpg" : data[0] === 0x47 ? "gif" : null;
      if (!type) continue;
      const bmp = await createImageBitmap(new Blob([data.slice().buffer as ArrayBuffer]));
      out.set(src, { data, width: bmp.width, height: bmp.height, type });
      bmp.close();
    } catch {
      /* Bild fehlt: wird als Hinweis exportiert */
    }
  }
  return out;
}

/** Wandelt HTML mit dem Schema des Editors in ProseMirror-JSON um (unbekannte Elemente fallen weg). */
export function htmlToDoc(html: string): PMNode {
  return generateJSON(html || "<p></p>", editorExtensions()) as PMNode;
}

/** Importiert eine Word-, Markdown- oder Textdatei als neue Notiz. */
export async function importFileAsNote(target: { areaId: string; parentId: string | null }) {
  const st = useApp.getState();
  try {
    const picked = await api.pickFiles({ multiple: false, extensions: ["docx", "md", "markdown", "txt"], title: "Datei als Notiz importieren" });
    const path = picked?.[0];
    if (!path) return;
    const bytes = await api.readExternalFile(path);
    const name = path.split(/[\\/]/).pop() ?? "Import";
    const ext = name.split(".").pop()?.toLowerCase();
    let html: string;
    let warnings: string[] = [];
    if (ext === "docx") ({ html, warnings } = await docxToHtml(bytes));
    else if (ext === "md" || ext === "markdown") html = markdownToHtml(new TextDecoder().decode(bytes));
    else html = textToHtml(new TextDecoder().decode(bytes));
    const doc = htmlToDoc(html);
    const node = await createNode({
      areaId: target.areaId,
      parentId: target.parentId,
      kind: "note",
      title: name.replace(/\.[^.]+$/, ""),
      contentJson: JSON.stringify(doc),
    });
    if (node) {
      // Suchtext sofort setzen
      await api.noteSave(node.id, JSON.stringify(doc), plainText(doc)).catch(() => {});
      st.toast(warnings.length ? `Importiert mit Hinweisen: ${warnings.slice(0, 2).join(" ")}` : `„${node.title}“ importiert.`, warnings.length ? "info" : "success");
    }
  } catch (e) {
    reportError(e);
  }
}
