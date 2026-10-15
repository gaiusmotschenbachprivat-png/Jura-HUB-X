import type { Extensions } from "@tiptap/core";
import Highlight from "@tiptap/extension-highlight";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import { TableKit } from "@tiptap/extension-table";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import TextAlign from "@tiptap/extension-text-align";
import { Color, FontFamily, FontSize, TextStyle } from "@tiptap/extension-text-style";
import Typography from "@tiptap/extension-typography";
import { Mathematics } from "@tiptap/extension-mathematics";
import { CharacterCount, Placeholder } from "@tiptap/extensions";
import StarterKit from "@tiptap/starter-kit";

import { AssetImage } from "./AssetImage";
import { Footnote, PageBreak, ParagraphFormat } from "./formatting";
import { SearchReplace } from "./searchReplace";

/** Klick auf eine Formel: der geöffnete Editor reagiert darauf (Bearbeiten-Dialog). */
export const MATH_EDIT_EVENT = "studium:edit-math";
export interface MathEditDetail {
  latex: string;
  pos: number;
  block: boolean;
}

/** Erlaubte Linkziele: Web, E-Mail und interne Verweise (`studium:`). */
export function isAllowedHref(href: string): boolean {
  return /^(https?:\/\/|mailto:|studium:(node|document|knowledge)\/[0-9a-f-]{36}(#page=\d+)?$)/i.test(href);
}

/**
 * Editor-Erweiterungen. Dieselbe Liste wird für Import (HTML → JSON) und
 * Vorschau (JSON → HTML) verwendet, damit das Schema überall gleich ist.
 */
export function editorExtensions(opts: { placeholder?: string } = {}): Extensions {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4] },
      link: {
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        protocols: ["studium", "mailto"],
        defaultProtocol: "https",
        isAllowedUri: (url) => isAllowedHref(url),
        HTMLAttributes: { rel: "noopener noreferrer nofollow", target: null },
      },
    }),
    Highlight.configure({ multicolor: true }),
    TextStyle,
    FontFamily,
    FontSize,
    Color,
    Subscript,
    Superscript,
    ParagraphFormat,
    Footnote,
    PageBreak,
    SearchReplace,
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit.configure({ table: { resizable: true, cellMinWidth: 60 } }),
    TextAlign.configure({ types: ["heading", "paragraph"], alignments: ["left", "center", "right", "justify"] }),
    Typography.configure({
      openDoubleQuote: "„",
      closeDoubleQuote: "“",
      openSingleQuote: "‚",
      closeSingleQuote: "‘",
    }),
    AssetImage,
    Mathematics.configure({
      katexOptions: { throwOnError: false, trust: false, strict: "ignore" },
      inlineOptions: {
        onClick: (node, pos) =>
          window.dispatchEvent(new CustomEvent<MathEditDetail>(MATH_EDIT_EVENT, { detail: { latex: node.attrs.latex as string, pos, block: false } })),
      },
      blockOptions: {
        onClick: (node, pos) =>
          window.dispatchEvent(new CustomEvent<MathEditDetail>(MATH_EDIT_EVENT, { detail: { latex: node.attrs.latex as string, pos, block: true } })),
      },
    }),
    CharacterCount,
    Placeholder.configure({ placeholder: opts.placeholder ?? "Schreiben …" }),
  ];
}
