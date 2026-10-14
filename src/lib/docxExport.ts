/**
 * Export einer Notiz (ProseMirror-JSON) als Word-Datei (.docx).
 * Unterstützt: Überschriften, Absätze, Ausrichtung, fett/kursiv/unterstrichen/
 * durchgestrichen/markiert/Code, Links, Aufzählungen, nummerierte Listen,
 * Checklisten, Zitate, Code-/Formelblöcke, Tabellen, Trennlinien.
 * Interne Links (studium:…) werden als normaler Text exportiert.
 */
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  LevelFormat,
  Packer,
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

const HEADINGS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4] as const;
const ALIGN: Record<string, (typeof AlignmentType)[keyof typeof AlignmentType]> = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
  justify: AlignmentType.JUSTIFIED,
};

interface Ctx {
  listInstance: number;
}

function hasMark(marks: PMMark[] | undefined, type: string) {
  return marks?.some((m) => m.type === type) ?? false;
}

function runs(nodes: PMNode[] | undefined, extra: { italics?: boolean; font?: string } = {}): ParagraphChild[] {
  const out: ParagraphChild[] = [];
  for (const n of nodes ?? []) {
    if (n.type === "hardBreak") {
      out.push(new TextRun({ text: "", break: 1 }));
      continue;
    }
    if (n.type !== "text") continue;
    const m = n.marks;
    const code = hasMark(m, "code");
    const run = new TextRun({
      text: n.text ?? "",
      bold: hasMark(m, "bold"),
      italics: hasMark(m, "italic") || extra.italics,
      underline: hasMark(m, "underline") ? {} : undefined,
      strike: hasMark(m, "strike"),
      highlight: hasMark(m, "highlight") ? "yellow" : undefined,
      font: code ? "Consolas" : extra.font,
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

type Block = Paragraph | Table;

/** `depth`: aktuelle Listentiefe (-1 = außerhalb einer Liste). */
function blocks(nodes: PMNode[] | undefined, ctx: Ctx, depth = -1): Block[] {
  const out: Block[] = [];
  const contIndent = depth >= 0 ? { left: 720 * (depth + 1) } : undefined;
  for (const n of nodes ?? []) {
    switch (n.type) {
      case "paragraph":
        out.push(new Paragraph({ children: runs(n.content), alignment: alignment(n), indent: contIndent }));
        break;
      case "heading": {
        const level = Math.min(4, Math.max(1, Number(n.attrs?.level ?? 1)));
        out.push(new Paragraph({ heading: HEADINGS[level - 1], children: runs(n.content), alignment: alignment(n) }));
        break;
      }
      case "bulletList":
      case "orderedList": {
        const level = Math.min(depth + 1, 8);
        const instance = ++ctx.listInstance;
        for (const item of n.content ?? []) {
          const [first, ...rest] = item.content ?? [];
          if (first?.type === "paragraph") {
            out.push(
              new Paragraph({
                children: runs(first.content),
                alignment: alignment(first),
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
              children: [new TextRun({ text: checked ? "☒ " : "☐ " }), ...runs(first?.content)],
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
                children: runs(child.content, { italics: true }),
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

export function buildDocx(docNode: PMNode, meta: { title: string }): Document {
  const ctx: Ctx = { listInstance: 0 };
  const children = blocks(docNode.content, ctx);
  return new Document({
    creator: "Studium OS",
    title: meta.title,
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

export async function exportDocx(docNode: PMNode, meta: { title: string }): Promise<Uint8Array> {
  const buf = await Packer.toArrayBuffer(buildDocx(docNode, meta));
  return new Uint8Array(buf);
}
