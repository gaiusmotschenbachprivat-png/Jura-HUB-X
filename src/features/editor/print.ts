/**
 * HTML und CSS für die Druckansicht (Paged.js): echte A4-Seiten mit
 * Seitenzahlen, Fußnoten unten auf der Seite, optional Inhaltsverzeichnis mit
 * Seitenangaben und Korrekturrand (Hausarbeit).
 */
import { generateHTML } from "@tiptap/core";
import katex from "katex";

import type { PMNode } from "../../lib/pm";
import { editorExtensions } from "./extensions";

export interface PrintOptions {
  title: string;
  toc: boolean;
  /** „normal“: 2,5 cm; „korrektur“: 7 cm Rand rechts für Korrekturen (Hausarbeit). */
  margins: "normal" | "korrektur";
  /** „notiz“: wie im Editor; „hausarbeit“: Times New Roman 12 pt, 1,5-zeilig, Blocksatz. */
  style: "notiz" | "hausarbeit";
  pageNumbers: boolean;
}

/** Baut das druckfertige HTML. Bilder (studium:asset/…) werden über `imageUrl` aufgelöst. */
export function buildPrintHtml(doc: PMNode, o: PrintOptions, imageUrl: (src: string) => string | undefined): string {
  const html = generateHTML(doc as never, editorExtensions());
  const root = new DOMParser().parseFromString(`<body><div id="print-root">${html}</div></body>`, "text/html");
  const body = root.getElementById("print-root")!;

  // Fußnoten: Text an die Stelle des Verweises (Paged.js setzt ihn unten auf die Seite)
  body.querySelectorAll("sup[data-footnote]").forEach((sup) => {
    const fn = root.createElement("span");
    fn.className = "footnote";
    fn.textContent = sup.getAttribute("data-footnote") ?? "";
    sup.replaceWith(fn);
  });
  // Formeln mit KaTeX setzen
  body.querySelectorAll("[data-latex]").forEach((el) => {
    const block = el.getAttribute("data-type") === "block-math";
    try {
      el.innerHTML = katex.renderToString(el.getAttribute("data-latex") ?? "", { throwOnError: false, displayMode: block, trust: false });
    } catch {
      el.textContent = el.getAttribute("data-latex") ?? "";
    }
  });
  body.querySelectorAll("img").forEach((img) => {
    const url = imageUrl(img.getAttribute("src") ?? "");
    if (url) img.setAttribute("src", url);
    else img.replaceWith(Object.assign(root.createElement("em"), { textContent: "[Bild]" }));
  });
  body.querySelectorAll("[data-page-break]").forEach((el) => {
    el.removeAttribute("contenteditable");
    el.className = "pb";
  });
  // Links nicht anklickbar drucken
  body.querySelectorAll("a").forEach((a) => a.removeAttribute("href"));

  let toc = "";
  if (o.toc) {
    const items: string[] = [];
    body.querySelectorAll("h1, h2, h3, h4").forEach((h, i) => {
      h.id = `h-${i}`;
      const lvl = Number(h.tagName.slice(1));
      // Fußnotentext gehört nicht ins Verzeichnis
      const clean = h.cloneNode(true) as Element;
      clean.querySelectorAll(".footnote").forEach((f) => f.remove());
      items.push(`<li class="toc-l${lvl}"><a href="#h-${i}">${escapeHtml(clean.textContent ?? "")}</a></li>`);
    });
    if (items.length) toc = `<nav class="toc"><h2 class="toc-title">Inhaltsverzeichnis</h2><ol>${items.join("")}</ol></nav>`;
  }
  return `<header class="doc-title"><h1>${escapeHtml(o.title)}</h1></header>${toc}<main class="doc-body">${body.innerHTML}</main>`;
}

export function printCss(o: PrintOptions): string {
  const margin = o.margins === "korrektur" ? "2.5cm 7cm 2cm 2cm" : "2.5cm 2cm 2cm 2.5cm";
  const font =
    o.style === "hausarbeit"
      ? `font-family: "Times New Roman", Times, serif; font-size: 12pt; line-height: 1.5; text-align: justify;`
      : `font-family: Georgia, "Times New Roman", serif; font-size: 11pt; line-height: 1.45;`;
  return `
@page {
  size: A4;
  margin: ${margin};
  ${o.pageNumbers ? `@bottom-center { content: counter(page); font: 10pt "Times New Roman", serif; color: #333; }` : ""}
  @footnote { border-top: 0.5pt solid #000; padding-top: 4pt; margin-top: 10pt; }
}
.pagedjs_page_content { ${font} color: #000; }
.doc-title h1 { font-size: 18pt; margin: 0 0 14pt; font-family: inherit; }
h1, h2, h3, h4 { font-family: inherit; break-after: avoid; color: #000; }
h1 { font-size: 16pt; margin: 14pt 0 6pt; }
h2 { font-size: 14pt; margin: 12pt 0 5pt; border: 0; }
h3 { font-size: 12.5pt; margin: 10pt 0 4pt; }
h4 { font-size: 12pt; margin: 8pt 0 3pt; font-style: italic; }
p { margin: 0 0 6pt; orphans: 2; widows: 2; }
ul, ol { margin: 0 0 6pt; padding-left: 1.4em; }
blockquote { margin: 6pt 0 6pt 1em; padding-left: 0.8em; border-left: 2pt solid #999; }
pre, code { font-family: "Courier New", monospace; font-size: 0.9em; }
pre { white-space: pre-wrap; border: 0.5pt solid #bbb; padding: 4pt 6pt; }
table { border-collapse: collapse; width: 100%; margin: 6pt 0; break-inside: avoid; }
td, th { border: 0.5pt solid #777; padding: 3pt 5pt; vertical-align: top; }
img { max-width: 100%; }
mark { padding: 0 1pt; }
ul[data-type="taskList"] { list-style: none; padding-left: 0.2em; }
ul[data-type="taskList"] li { display: flex; gap: 0.4em; }
ul[data-type="taskList"] li > label input { margin: 0.25em 0 0; }
hr { border: 0; border-top: 0.5pt solid #777; }
.pb { break-after: page; height: 0; border: 0; }
.footnote { float: footnote; font-size: 9pt; line-height: 1.25; text-align: left; font-style: normal; font-weight: normal; }
::footnote-call { content: counter(footnote); vertical-align: super; font-size: 65%; line-height: 0; }
::footnote-marker { content: counter(footnote) " "; }
.toc { break-after: page; }
.toc-title { font-size: 14pt; }
.toc ol { list-style: none; padding: 0; margin: 0; }
.toc li { margin: 2pt 0; }
.toc li a { color: #000; text-decoration: none; display: flex; align-items: baseline; }
.toc li a::after { content: target-counter(attr(href url), page); margin-left: auto; padding-left: 8pt; }
.toc-l2 { padding-left: 0; } .toc-l3 { padding-left: 1.2em; } .toc-l4 { padding-left: 2.4em; }
`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}
