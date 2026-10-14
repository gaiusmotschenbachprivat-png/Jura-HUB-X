/**
 * pdf.js lokal gebündelt (kein CDN). Skripte in PDFs werden nicht ausgeführt.
 * Die „legacy“-Ausgabe enthält Ergänzungen für ältere Browser-Engines
 * (z. B. Safari auf älteren iPads); Funktionsumfang wie die Standardausgabe.
 */
import "./streamPolyfill";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

// Eigener Worker-Einstieg, damit die Safari-Ergänzung auch dort geladen ist.
if (typeof Worker !== "undefined") pdfjs.GlobalWorkerOptions.workerPort = new Worker(new URL("./pdfWorker.ts", import.meta.url), { type: "module", name: "pdf" });

export type PdfDoc = pdfjs.PDFDocumentProxy;

const tasks = new WeakMap<PdfDoc, pdfjs.PDFDocumentLoadingTask>();

/**
 * Öffnet eine PDF aus dem Speicher. pdf.js 6 führt keinen PDF-JavaScript-Code
 * aus und wertet keine Ausdrücke per `eval` aus.
 */
export async function loadPdf(data: Uint8Array): Promise<PdfDoc> {
  // pdf.js übernimmt den Puffer; daher eine Kopie übergeben.
  const task = pdfjs.getDocument({ data: data.slice(), enableXfa: false, disableAutoFetch: true });
  const doc = await task.promise;
  tasks.set(doc, task);
  return doc;
}

/** Gibt Speicher und Worker-Ressourcen frei. */
export async function closePdf(doc: PdfDoc | null | undefined): Promise<void> {
  if (!doc) return;
  await tasks.get(doc)?.destroy();
}

/** Text je Seite. Leere Seiten liefern einen leeren Text. */
export async function extractPdfText(pdf: PdfDoc, onProgress?: (done: number, total: number) => void): Promise<string[]> {
  const pages: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    let text = "";
    for (const item of content.items) {
      if ("str" in item) {
        text += item.str;
        text += item.hasEOL ? "\n" : " ";
      }
    }
    pages.push(text.replace(/[ \t]+/g, " ").replace(/\n\s+/g, "\n").trim());
    page.cleanup();
    onProgress?.(i, pdf.numPages);
  }
  return pages;
}
