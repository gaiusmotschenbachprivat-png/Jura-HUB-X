/**
 * Hilfen für das ProseMirror-JSON-Format, in dem Notizen gespeichert werden.
 * Unabhängig vom Editor, daher in Tests und Exporten nutzbar.
 */

export interface PMMark {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface PMNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PMNode[];
  text?: string;
  marks?: PMMark[];
}

export const BLOCK_TYPES = new Set([
  "paragraph",
  "heading",
  "blockquote",
  "codeBlock",
  "listItem",
  "taskItem",
  "tableCell",
  "tableHeader",
  "horizontalRule",
  "image",
]);

/** Alle Bildquellen (`studium:asset/…`) eines Dokuments. */
export function imageSources(doc: PMNode): string[] {
  const out: string[] = [];
  const walk = (n: PMNode) => {
    if (n.type === "image" && typeof n.attrs?.src === "string") out.push(n.attrs.src);
    n.content?.forEach(walk);
  };
  walk(doc);
  return [...new Set(out)];
}

/** Reiner Text für Suche und Wortzählung. Blöcke werden durch Zeilenumbrüche getrennt. */
export function plainText(doc: PMNode): string {
  const out: string[] = [];
  const walk = (n: PMNode) => {
    if (n.type === "text") {
      out.push(n.text ?? "");
      return;
    }
    if (n.type === "hardBreak") {
      out.push("\n");
      return;
    }
    if ((n.type === "inlineMath" || n.type === "blockMath") && typeof n.attrs?.latex === "string") {
      out.push(` ${n.attrs.latex} `);
      if (n.type === "blockMath") out.push("\n");
      return;
    }
    n.content?.forEach(walk);
    if (BLOCK_TYPES.has(n.type)) out.push("\n");
  };
  walk(doc);
  return out
    .join("")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function parseDoc(json: string): PMNode {
  try {
    const v = JSON.parse(json) as PMNode;
    if (v && v.type === "doc") return v;
  } catch {
    /* fällt auf leeres Dokument zurück */
  }
  return { type: "doc", content: [{ type: "paragraph" }] };
}

// ---- Bausteine für Vorlagen ----

export const t = (text: string, marks?: PMMark[]): PMNode => (marks ? { type: "text", text, marks } : { type: "text", text });
export const p = (...parts: (string | PMNode)[]): PMNode => ({
  type: "paragraph",
  content: parts.filter((x) => x !== "").map((x) => (typeof x === "string" ? t(x) : x)),
});
export const empty = (): PMNode => ({ type: "paragraph" });
export const h = (level: 1 | 2 | 3 | 4, text: string): PMNode => ({ type: "heading", attrs: { level }, content: [t(text)] });
export const b = (text: string) => t(text, [{ type: "bold" }]);
export const i = (text: string) => t(text, [{ type: "italic" }]);
export const ul = (...items: (string | PMNode[])[]): PMNode => ({
  type: "bulletList",
  content: items.map((it) => ({ type: "listItem", content: typeof it === "string" ? [p(it)] : it })),
});
export const ol = (...items: (string | PMNode[])[]): PMNode => ({
  type: "orderedList",
  attrs: { start: 1 },
  content: items.map((it) => ({ type: "listItem", content: typeof it === "string" ? [p(it)] : it })),
});
export const tasks = (...items: string[]): PMNode => ({
  type: "taskList",
  content: items.map((it) => ({ type: "taskItem", attrs: { checked: false }, content: [p(it)] })),
});
export const quote = (...content: PMNode[]): PMNode => ({ type: "blockquote", content });
export const hr = (): PMNode => ({ type: "horizontalRule" });
export const table = (header: string[], rows: string[][]): PMNode => ({
  type: "table",
  content: [
    { type: "tableRow", content: header.map((c) => ({ type: "tableHeader", content: [p(c)] })) },
    ...rows.map((r) => ({ type: "tableRow", content: r.map((c) => ({ type: "tableCell", content: [c ? p(c) : empty()] })) })),
  ],
});
export const doc = (...content: PMNode[]): PMNode => ({ type: "doc", content });
