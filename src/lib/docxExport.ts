/**
 * Export einer Notiz (ProseMirror-JSON) als Word-Datei (.docx).
 * Unterstützt: Überschriften, Absätze, Ausrichtung, fett/kursiv/unterstrichen/
 * durchgestrichen/markiert/Code, Links, Aufzählungen, nummerierte Listen,
 * Checklisten, Zitate, Code-/Formelblöcke, Tabellen, Trennlinien, Schriftart,
 * Schriftgröße, Schriftfarbe, farbige Hervorhebung, hoch-/tiefgestellt,
 * Zeilenabstand, Einzug, Fußnoten und Seitenumbrüche.
 * Interne Links (studium:…) werden als normaler Text exportiert.
 */
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  FootnoteReferenceRun,
  ImageRun,
  HeadingLevel,
  LevelFormat,
  Packer,
  PageBreak,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type ParagraphChild,
} from "docx";

import type { PMMark, PMNode } from "./pm";
import { fontSizePt, primaryFont } from "./textFormat";

const HEADINGS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4] as const;
const ALIGN: Record<string, (typeof AlignmentType)[keyof typeof AlignmentType]> = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
  justify: AlignmentType.JUSTIFIED,
};

/** Bilddaten für den Export, vorab aus dem Speicher geladen. */
export interface ExportAsset {
  data: Uint8Array;
  width: number;
  height: number;
  type: "png" | "jpg" | "gif";
}

interface Ctx {
  listInstance: number;
  assets: Map<string, ExportAsset>;
  footnotes: Record<number, { children: Paragraph[] }>;
  nextFootnote: number;
}

const MATH_FONT = "Cambria Math";

function hasMark(marks: PMMark[] | undefined, type: string) {
  return marks?.some((m) => m.type === type) ?? false;
}

/** "#rrggbb"/"#rgb"/"rgb(r, g, b)" → "RRGGBB" für Word. */
export function hexColor(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  let m = /^#([0-9a-f]{6})$/i.exec(s);
  if (m) return m[1]!.toUpperCase();
  m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(s);
  if (m) return (m[1]! + m[1]! + m[2]! + m[2]! + m[3]! + m[3]!).toUpperCase();
  const r = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(s);
  if (r) return [r[1], r[2], r[3]].map((x) => Math.min(255, Number(x)).toString(16).padStart(2, "0")).join("").toUpperCase();
  return undefined;
}

function markAttr(marks: PMMark[] | undefined, type: string, attr: string): unknown {
  return marks?.find((m) => m.type === type)?.attrs?.[attr];
}

function runs(nodes: PMNode[] | undefined, ctx: Ctx, extra: { italics?: boolean; font?: string } = {}): ParagraphChild[] {
  const out: ParagraphChild[] = [];
  for (const n of nodes ?? []) {
    if (n.type === "footnote") {
      const id = ctx.nextFootnote++;
      ctx.footnotes[id] = { children: [new Paragraph({ children: [new TextRun(String(n.attrs?.text ?? ""))] })] };
      out.push(new FootnoteReferenceRun(id));
      continue;
    }
    if (n.type === "hardBreak") {
      out.push(new TextRun({ text: "", break: 1 }));
      continue;
    }
    if (n.type === "inlineMath") {
      // Formeln als LaTeX-Quelltext in Formelschrift (Word-Formelobjekte: Phase 4)
      out.push(new TextRun({ text: String(n.attrs?.latex ?? ""), font: MATH_FONT, italics: true }));
      continue;
    }
    if (n.type !== "text") continue;
    const m = n.marks;
    const code = hasMark(m, "code");
    const family = markAttr(m, "textStyle", "fontFamily");
    const size = markAttr(m, "textStyle", "fontSize");
    const pt = typeof size === "string" ? fontSizePt(size) : null;
    const hl = hasMark(m, "highlight") ? (hexColor(markAttr(m, "highlight", "color")) ?? "FFF59D") : undefined;
    const run = new TextRun({
      text: n.text ?? "",
      bold: hasMark(m, "bold"),
      italics: hasMark(m, "italic") || extra.italics,
      underline: hasMark(m, "underline") ? {} : undefined,
      strike: hasMark(m, "strike"),
      superScript: hasMark(m, "superscript") || undefined,
      subScript: hasMark(m, "subscript") || undefined,
      shading: hl ? { type: ShadingType.CLEAR, fill: hl, color: "auto" } : undefined,
      color: hexColor(markAttr(m, "textStyle", "color")),
      size: pt ? Math.round(pt * 2) : undefined,
      font: code ? "Consolas" : typeof family === "string" && family ? primaryFont(family) : extra.font,
    });
    const link = m?.find((x) => x.type === "link");
    const href = typeof link?.attrs?.href === "string" ? link.attrs.href : null;
    if (href && /^(https?:|mailto:)/.test(href)) {
      out.push(
        new ExternalHyperlink({
          link: href,
          children: [new TextRun({ text: n.text ?? "", style: "Hyperlink", bold: hasMark(m, "bold"), italics: hasMark(m, "italic") })],
        }),
      );
    } else {
      out.push(run);
    }
  }
  return out;
}

function alignment(n: PMNode) {
  const a = n.attrs?.textAlign;
  return typeof a === "string" ? ALIGN[a] : undefined;
}

/** Zeilenabstand (z. B. "1.5") als Word-Abstand in 240stel. */
function spacing(n: PMNode) {
  const lh = Number(n.attrs?.lineHeight);
  return lh > 0 && lh <= 5 ? { line: Math.round(lh * 240) } : undefined;
}

/** Absatzeinzug: 720 Twips (1,27 cm) je Stufe. */
function indentOf(n: PMNode, base?: { left: number }) {
  const lvl = Math.max(0, Math.min(8, Number(n.attrs?.indent) || 0));
  const left = (base?.left ?? 0) + lvl * 720;
  return left > 0 ? { left } : undefined;
}

type Block = Paragraph | Table;

/** `depth`: aktuelle Listentiefe (-1 = außerhalb einer Liste). */
function blocks(nodes: PMNode[] | undefined, ctx: Ctx, depth = -1): Block[] {
  const out: Block[] = [];
  const contIndent = depth >= 0 ? { left: 720 * (depth + 1) } : undefined;
  for (const n of nodes ?? []) {
    switch (n.type) {
      case "paragraph":
        out.push(new Paragraph({ children: runs(n.content, ctx), alignment: alignment(n), indent: indentOf(n, contIndent), spacing: spacing(n) }));
        break;
      case "heading": {
        const level = Math.min(4, Math.max(1, Number(n.attrs?.level ?? 1)));
        out.push(new Paragraph({ heading: HEADINGS[level - 1], children: runs(n.content, ctx), alignment: alignment(n), indent: indentOf(n), spacing: spacing(n) }));
        break;
      }
      case "pageBreak":
        out.push(new Paragraph({ children: [new PageBreak()] }));
        break;
      case "bulletList":
      case "orderedList": {
        const level = Math.min(depth + 1, 8);
        const instance = ++ctx.listInstance;
        for (const item of n.content ?? []) {
          const [first, ...rest] = item.content ?? [];
          if (first?.type === "paragraph") {
            out.push(
              new Paragraph({
                children: runs(first.content, ctx),
                alignment: alignment(first),
                spacing: spacing(first),
                ...(n.type === "bulletList"
                  ? { bullet: { level } }
                  : { numbering: { reference: "ordered", level, instance } }),
              }),
            );
            out.push(...blocks(rest, ctx, level));
          } else {
            out.push(...blocks(item.content, ctx, level));
          }
        }
        break;
      }
      case "taskList": {
        const level = Math.min(depth + 1, 8);
        for (const item of n.content ?? []) {
          const checked = Boolean(item.attrs?.checked);
          const [first, ...rest] = item.content ?? [];
          out.push(
            new Paragraph({
              indent: { left: 720 * level + 360 },
              children: [new TextRun({ text: checked ? "☒ " : "☐ " }), ...runs(first?.content, ctx)],
            }),
          );
          out.push(...blocks(rest, ctx, level));
        }
        break;
      }
      case "blockquote":
        for (const child of n.content ?? []) {
          if (child.type === "paragraph") {
            out.push(
              new Paragraph({
                children: runs(child.content, ctx, { italics: true }),
                indent: { left: 567 + (contIndent?.left ?? 0) },
                border: { left: { style: BorderStyle.SINGLE, size: 12, color: "9AA3B2", space: 8 } },
              }),
            );
          } else out.push(...blocks([child], ctx, depth));
        }
        break;
      case "codeBlock": {
        const text = (n.content ?? []).map((c) => c.text ?? "").join("");
        out.push(
          new Paragraph({
            indent: contIndent,
            shading: { type: ShadingType.CLEAR, fill: "F1F3F6", color: "auto" },
            children: text.split("\n").map((line, idx) => new TextRun({ text: line, font: "Consolas", break: idx > 0 ? 1 : undefined })),
          }),
        );
        break;
      }
      case "blockMath":
        out.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: String(n.attrs?.latex ?? ""), font: MATH_FONT, italics: true })],
          }),
        );
        break;
      case "image": {
        const a = ctx.assets.get(String(n.attrs?.src ?? ""));
        if (a) {
          const maxW = 600;
          const scale = Math.min(1, maxW / Math.max(1, a.width));
          out.push(
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [new ImageRun({ type: a.type, data: a.data, transformation: { width: Math.round(a.width * scale), height: Math.round(a.height * scale) } })],
            }),
          );
        } else {
          out.push(new Paragraph({ children: [new TextRun({ text: "[Bild]", italics: true, color: "888888" })] }));
        }
        break;
      }
      case "horizontalRule":
        out.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "B0B6C2", space: 1 } }, children: [] }));
        break;
      case "table": {
        const rows = (n.content ?? []).map(
          (row) =>
            new TableRow({
              tableHeader: row.content?.every((c) => c.type === "tableHeader"),
              children: (row.content ?? []).map((cell) => {
                const inner = blocks(cell.content, ctx).filter((x): x is Paragraph => x instanceof Paragraph);
                return new TableCell({
                  columnSpan: Number(cell.attrs?.colspan ?? 1),
                  rowSpan: Number(cell.attrs?.rowspan ?? 1),
                  shading: cell.type === "tableHeader" ? { type: ShadingType.CLEAR, fill: "EEF1F5", color: "auto" } : undefined,
                  children: inner.length ? inner : [new Paragraph({ children: [] })],
                });
              }),
            }),
        );
        out.push(new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } }));
        out.push(new Paragraph({ children: [] }));
        break;
      }
      default:
        if (n.content) out.push(...blocks(n.content, ctx, depth));
    }
  }
  return out;
}

export function buildDocx(docNode: PMNode, meta: { title: string; bibliography?: string[] }, assets: Map<string, ExportAsset> = new Map()): Document {
  const ctx: Ctx = { listInstance: 0, assets, footnotes: {}, nextFootnote: 1 };
  const children: Block[] = [];
  // Literaturverzeichnis vor dem Text (wie in Haus- und Seminararbeiten)
  if (meta.bibliography?.length) {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Literaturverzeichnis")] }));
    for (const e of meta.bibliography) children.push(new Paragraph({ indent: { left: 567, hanging: 567 }, spacing: { after: 100 }, children: [new TextRun(e)] }));
    children.push(new Paragraph({ children: [new PageBreak()] }));
  }
  children.push(...blocks(docNode.content, ctx));
  return new Document({
    creator: "Studium OS",
    title: meta.title,
    footnotes: ctx.footnotes,
    styles: {
      default: { document: { run: { font: "Calibri", size: 23 }, paragraph: { spacing: { after: 120, line: 300 } } } },
    },
    numbering: {
      config: [
        {
          reference: "ordered",
          levels: Array.from({ length: 9 }, (_, level) => ({
            level,
            format: [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN][level % 3]!,
            text: `%${level + 1}.`,
            alignment: AlignmentType.START,
            style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
          })),
        },
      ],
    },
    sections: [{ children: children.length ? children : [new Paragraph({ children: [] })] }],
  });
}

export async function exportDocx(docNode: PMNode, meta: { title: string; bibliography?: string[] }, assets?: Map<string, ExportAsset>): Promise<Uint8Array> {
  const buf = await Packer.toArrayBuffer(buildDocx(docNode, meta, assets));
  return new Uint8Array(buf);
}
