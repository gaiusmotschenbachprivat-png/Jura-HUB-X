/**
 * Import von Word-Dateien in eine Notiz. mammoth liest nur Text und
 * Formatierung; Makros und eingebettete Objekte werden nie ausgeführt.
 */
import mammoth from "mammoth";

export interface DocxImportResult {
  html: string;
  warnings: string[];
}

export async function docxToHtml(data: Uint8Array): Promise<DocxImportResult> {
  const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  const res = await mammoth.convertToHtml(
    { arrayBuffer: buf },
    {
      // Bilder vorerst nicht übernehmen (Phase 3), statt sie stillschweigend zu verlieren:
      convertImage: mammoth.images.imgElement(async () => ({ src: "" })),
      styleMap: ["p[style-name='Title'] => h1:fresh", "p[style-name='Quote'] => blockquote > p:fresh"],
    },
  );
  const warnings = res.messages.filter((m) => m.type === "warning").map((m) => m.message);
  const hadImages = /<img\b/.test(res.value);
  if (hadImages) warnings.unshift("Bilder aus der Word-Datei wurden nicht übernommen.");
  return { html: res.value.replace(/<img\b[^>]*>/g, ""), warnings };
}

export async function docxToText(data: Uint8Array): Promise<string> {
  const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  const res = await mammoth.extractRawText({ arrayBuffer: buf });
  return res.value;
}

/** Sehr einfache Markdown-Umsetzung für den Import (Überschriften, Listen, Absätze). */
export function markdownToHtml(md: string): string {
  const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
  const inline = (s: string) =>
    esc(s)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(/`(.+?)`/g, "<code>$1</code>");
  const out: string[] = [];
  let list: "ul" | "ol" | null = null;
  const close = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const hm = /^(#{1,4})\s+(.*)$/.exec(line);
    const ul = /^\s*[-*+]\s+(.*)$/.exec(line);
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (hm) {
      close();
      out.push(`<h${hm[1]!.length}>${inline(hm[2]!)}</h${hm[1]!.length}>`);
    } else if (ul || ol) {
      const kind = ul ? "ul" : "ol";
      if (list !== kind) {
        close();
        out.push(`<${kind}>`);
        list = kind;
      }
      out.push(`<li><p>${inline((ul ?? ol)![1]!)}</p></li>`);
    } else if (line.trim() === "") {
      close();
    } else {
      close();
      out.push(`<p>${inline(line)}</p>`);
    }
  }
  close();
  return out.join("");
}

export function textToHtml(text: string): string {
  const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
  return text
    .split(/\r?\n\s*\r?\n/)
    .map((para) => `<p>${esc(para).replace(/\r?\n/g, "<br>")}</p>`)
    .join("");
}
