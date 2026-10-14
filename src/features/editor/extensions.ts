import type { Extensions } from "@tiptap/core";
import Highlight from "@tiptap/extension-highlight";
import { TableKit } from "@tiptap/extension-table";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import TextAlign from "@tiptap/extension-text-align";
import Typography from "@tiptap/extension-typography";
import { CharacterCount, Placeholder } from "@tiptap/extensions";
import StarterKit from "@tiptap/starter-kit";

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
    Highlight.configure({ multicolor: false }),
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
    CharacterCount,
    Placeholder.configure({ placeholder: opts.placeholder ?? "Schreiben …" }),
  ];
}
