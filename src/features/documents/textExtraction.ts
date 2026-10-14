/**
 * Liest den Text importierter PDF- und Word-Dateien lokal aus (pdf.js / mammoth)
 * und übergibt ihn seitenweise an den Suchindex. Läuft nacheinander im Hintergrund.
 */
import { api } from "../../api";
import type { DocumentInfo } from "../../api/types";
import { docxToText } from "../../lib/docxImport";
import { useApp } from "../../state/store";

const queue: string[] = [];
let running = false;

export function enqueueExtraction(docs: Pick<DocumentInfo, "id" | "text_status" | "ext">[]) {
  for (const d of docs) {
    if (d.text_status === "pending" && (d.ext === "pdf" || d.ext === "docx") && !queue.includes(d.id)) queue.push(d.id);
  }
  void pump();
}

async function pump() {
  if (running) return;
  running = true;
  try {
    while (queue.length) {
      const id = queue.shift()!;
      await extractOne(id);
      useApp.getState().bump();
    }
  } finally {
    running = false;
  }
}

async function extractOne(id: string) {
  try {
    const { document: d } = await api.documentGet(id);
    if (d.text_status !== "pending") return;
    const bytes = await api.documentBytes(id);
    let pages: string[];
    if (d.ext === "pdf") {
      const { loadPdf, extractPdfText, closePdf } = await import("../../lib/pdf");
      const pdf = await loadPdf(bytes);
      try {
        pages = await extractPdfText(pdf);
      } finally {
        void closePdf(pdf);
      }
    } else {
      pages = [await docxToText(bytes)];
    }
    await api.documentSetText(id, pages);
  } catch (e) {
    console.warn("Text konnte nicht ausgelesen werden:", e instanceof Error ? e.message : e);
    // Fehler beim Auslesen: Dokument bleibt nutzbar, wird aber als „nicht lesbar“ markiert.
    await api.documentTextError(id).catch(() => {});
  }
}

/** Beim Start: Dokumente nachbearbeiten, deren Auslesen unterbrochen wurde. */
export async function resumePendingExtractions() {
  try {
    const all = await api.documentsList({ kind: "all" });
    enqueueExtraction(all);
  } catch {
    /* nicht kritisch */
  }
}
