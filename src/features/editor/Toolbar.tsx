import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  Braces,
  CheckSquare,
  Code,
  Highlighter,
  ImagePlus,
  Italic,
  Sigma,
  Link2,
  List,
  ListOrdered,
  Minus,
  Quote,
  Redo2,
  Strikethrough,
  Table as TableIcon,
  Underline,
  Undo2,
  Waypoints,
} from "lucide-react";

import { IconButton } from "../../ui/Button";
import { useMenu } from "../../ui/Menu";
import { MOD } from "../../ui/misc";

const STYLES = [
  { value: "p", label: "Fließtext" },
  { value: "h1", label: "Überschrift 1" },
  { value: "h2", label: "Überschrift 2" },
  { value: "h3", label: "Überschrift 3" },
  { value: "h4", label: "Überschrift 4" },
] as const;

export function Toolbar({
  editor,
  onExternalLink,
  onInternalLink,
  onImage,
  onMath,
}: {
  editor: Editor;
  onExternalLink: () => void;
  onInternalLink: () => void;
  onImage: () => void;
  onMath: () => void;
}) {
  const menu = useMenu();
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      style: e.isActive("heading", { level: 1 })
        ? "h1"
        : e.isActive("heading", { level: 2 })
          ? "h2"
          : e.isActive("heading", { level: 3 })
            ? "h3"
            : e.isActive("heading", { level: 4 })
              ? "h4"
              : "p",
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      strike: e.isActive("strike"),
      highlight: e.isActive("highlight"),
      code: e.isActive("code"),
      link: e.isActive("link"),
      bullet: e.isActive("bulletList"),
      ordered: e.isActive("orderedList"),
      task: e.isActive("taskList"),
      quote: e.isActive("blockquote"),
      codeBlock: e.isActive("codeBlock"),
      table: e.isActive("table"),
      align: (["center", "right", "justify"] as const).find((a) => e.isActive({ textAlign: a })) ?? "left",
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });
  const c = () => editor.chain().focus();

  const tableMenu = (el: HTMLElement) =>
    menu.openBelow(
      el,
      s.table
        ? [
            { label: "Zeile darüber", onSelect: () => c().addRowBefore().run() },
            { label: "Zeile darunter", onSelect: () => c().addRowAfter().run() },
            { label: "Spalte links", onSelect: () => c().addColumnBefore().run() },
            { label: "Spalte rechts", onSelect: () => c().addColumnAfter().run() },
            { label: "Kopfzeile umschalten", onSelect: () => c().toggleHeaderRow().run() },
            { label: "Zellen verbinden / teilen", onSelect: () => c().mergeOrSplit().run() },
            { separator: true, label: "" },
            { label: "Zeile löschen", danger: true, onSelect: () => c().deleteRow().run() },
            { label: "Spalte löschen", danger: true, onSelect: () => c().deleteColumn().run() },
            { label: "Tabelle löschen", danger: true, onSelect: () => c().deleteTable().run() },
          ]
        : [2, 3, 4].map((cols) => ({
            label: `Tabelle mit ${cols} Spalten`,
            onSelect: () => c().insertTable({ rows: 3, cols, withHeaderRow: true }).run(),
          })),
    );

  const AlignI = s.align === "center" ? AlignCenter : s.align === "right" ? AlignRight : s.align === "justify" ? AlignJustify : AlignLeft;

  return (
    <div className="toolbar" role="toolbar" aria-label="Formatierung">
      <IconButton label={`Rückgängig (${MOD}+Z)`} disabled={!s.canUndo} onClick={() => c().undo().run()}>
        <Undo2 size={16} />
      </IconButton>
      <IconButton label={`Wiederholen (${MOD}+⇧+Z)`} disabled={!s.canRedo} onClick={() => c().redo().run()}>
        <Redo2 size={16} />
      </IconButton>
      <span className="tb-sep" />
      <select
        className="tb-select"
        aria-label="Absatzformat"
        value={s.style}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "p") c().setParagraph().run();
          else c().setHeading({ level: Number(v.slice(1)) as 1 | 2 | 3 | 4 }).run();
        }}
      >
        {STYLES.map((st) => (
          <option key={st.value} value={st.value}>
            {st.label}
          </option>
        ))}
      </select>
      <span className="tb-sep" />
      <IconButton label={`Fett (${MOD}+B)`} active={s.bold} onClick={() => c().toggleBold().run()}>
        <Bold size={16} />
      </IconButton>
      <IconButton label={`Kursiv (${MOD}+I)`} active={s.italic} onClick={() => c().toggleItalic().run()}>
        <Italic size={16} />
      </IconButton>
      <IconButton label={`Unterstrichen (${MOD}+U)`} active={s.underline} onClick={() => c().toggleUnderline().run()}>
        <Underline size={16} />
      </IconButton>
      <IconButton label="Durchgestrichen" active={s.strike} onClick={() => c().toggleStrike().run()}>
        <Strikethrough size={16} />
      </IconButton>
      <IconButton label={`Hervorheben (${MOD}+⇧+H)`} active={s.highlight} onClick={() => c().toggleHighlight().run()}>
        <Highlighter size={16} />
      </IconButton>
      <IconButton label="Code / Fachbegriff" active={s.code} onClick={() => c().toggleCode().run()}>
        <Code size={16} />
      </IconButton>
      <span className="tb-sep" />
      <IconButton label="Aufzählung" active={s.bullet} onClick={() => c().toggleBulletList().run()}>
        <List size={16} />
      </IconButton>
      <IconButton label="Nummerierte Liste" active={s.ordered} onClick={() => c().toggleOrderedList().run()}>
        <ListOrdered size={16} />
      </IconButton>
      <IconButton label="Checkliste" active={s.task} onClick={() => c().toggleTaskList().run()}>
        <CheckSquare size={16} />
      </IconButton>
      <IconButton label="Zitat / Definition" active={s.quote} onClick={() => c().toggleBlockquote().run()}>
        <Quote size={16} />
      </IconButton>
      <IconButton label="Textblock (Formeln, Schema)" active={s.codeBlock} onClick={() => c().toggleCodeBlock().run()}>
        <Braces size={16} />
      </IconButton>
      <IconButton label="Tabelle" active={s.table} onClick={(e) => tableMenu(e.currentTarget)}>
        <TableIcon size={16} />
      </IconButton>
      <IconButton label="Trennlinie" onClick={() => c().setHorizontalRule().run()}>
        <Minus size={16} />
      </IconButton>
      <IconButton label="Formel (LaTeX)" onClick={onMath}>
        <Sigma size={16} />
      </IconButton>
      <IconButton label="Bild einfügen (oder Screenshot einfügen/hineinziehen)" onClick={onImage}>
        <ImagePlus size={16} />
      </IconButton>
      <IconButton
        label="Ausrichtung"
        onClick={(e) =>
          menu.openBelow(e.currentTarget, [
            { label: "Linksbündig", icon: <AlignLeft size={14} />, onSelect: () => c().setTextAlign("left").run() },
            { label: "Zentriert", icon: <AlignCenter size={14} />, onSelect: () => c().setTextAlign("center").run() },
            { label: "Rechtsbündig", icon: <AlignRight size={14} />, onSelect: () => c().setTextAlign("right").run() },
            { label: "Blocksatz", icon: <AlignJustify size={14} />, onSelect: () => c().setTextAlign("justify").run() },
          ])
        }
      >
        <AlignI size={16} />
      </IconButton>
      <span className="tb-sep" />
      <IconButton label={`Weblink (${MOD}+K im Text)`} active={s.link} onClick={onExternalLink}>
        <Link2 size={16} />
      </IconButton>
      <IconButton label={`Interne Verknüpfung (${MOD}+⇧+L)`} onClick={onInternalLink}>
        <Waypoints size={16} />
      </IconButton>
      {menu.el}
    </div>
  );
}
