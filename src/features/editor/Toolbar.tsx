import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import {
  AlignCenter,
  Baseline,
  Asterisk,
  ChevronDown,
  ListIndentDecrease,
  ListIndentIncrease,
  RemoveFormatting,
  SeparatorHorizontal,
  Subscript as SubIcon,
  Superscript as SupIcon,
  UnfoldVertical,
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

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { fontSizePt } from "../../lib/textFormat";
import { IconButton } from "../../ui/Button";
import { useMenu } from "../../ui/Menu";
import { MOD } from "../../ui/misc";
import { FONT_SIZES, FONTS, HIGHLIGHT_COLORS, indent, LINE_HEIGHTS, TEXT_COLORS } from "./formatting";

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
  onFootnote,
}: {
  editor: Editor;
  onExternalLink: () => void;
  onInternalLink: () => void;
  onImage: () => void;
  onMath: () => void;
  onFootnote: () => void;
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
      highlightColor: (e.getAttributes("highlight").color as string | undefined) ?? null,
      sup: e.isActive("superscript"),
      sub: e.isActive("subscript"),
      font: (e.getAttributes("textStyle").fontFamily as string | undefined) ?? "",
      size: (e.getAttributes("textStyle").fontSize as string | undefined) ?? "",
      color: (e.getAttributes("textStyle").color as string | undefined) ?? null,
      lineHeight: ((e.isActive("heading") ? e.getAttributes("heading") : e.getAttributes("paragraph")).lineHeight as string | null) ?? null,
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

  const sizePt = s.size ? fontSizePt(s.size) : null;
  const fontLabel = FONTS.find((f) => f.value === s.font)?.label;
  const clearFormatting = () =>
    c()
      .unsetMark("bold")
      .unsetMark("italic")
      .unsetMark("underline")
      .unsetMark("strike")
      .unsetMark("code")
      .unsetMark("highlight")
      .unsetMark("subscript")
      .unsetMark("superscript")
      .unsetMark("textStyle")
      .resetParagraphFormat()
      .run();

  return (
    <div className="toolbar" role="toolbar" aria-label="Formatierung">
      <div className="tb-group">
        <IconButton label={`Rückgängig (${MOD}+Z)`} disabled={!s.canUndo} onClick={() => c().undo().run()}>
          <Undo2 size={16} />
        </IconButton>
        <IconButton label={`Wiederholen (${MOD}+⇧+Z)`} disabled={!s.canRedo} onClick={() => c().redo().run()}>
          <Redo2 size={16} />
        </IconButton>
      </div>
      <div className="tb-group">
        <select
          className="tb-select tb-style"
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
        <select
          className="tb-select tb-font"
          aria-label="Schriftart"
          title="Schriftart"
          value={fontLabel ? s.font : s.font ? "__other" : ""}
          style={s.font ? { fontFamily: s.font } : undefined}
          onChange={(e) => {
            const v = e.target.value;
            if (!v) c().unsetFontFamily().run();
            else if (v !== "__other") c().setFontFamily(v).run();
          }}
        >
          <option value="">Standardschrift</option>
          {s.font && !fontLabel && <option value="__other">{s.font.split(",")[0]?.replace(/["']/g, "")}</option>}
          {FONTS.map((f) => (
            <option key={f.label} value={f.value} style={{ fontFamily: f.value }}>
              {f.label}
            </option>
          ))}
        </select>
        <select
          className="tb-select tb-size"
          aria-label="Schriftgröße"
          title="Schriftgröße (pt)"
          value={sizePt ? String(sizePt) : ""}
          onChange={(e) => {
            const v = e.target.value;
            if (!v) c().unsetFontSize().run();
            else c().setFontSize(`${v}pt`).run();
          }}
        >
          <option value="">Größe</option>
          {sizePt && !FONT_SIZES.includes(sizePt) && <option value={String(sizePt)}>{String(sizePt).replace(".", ",")}</option>}
          {FONT_SIZES.map((n) => (
            <option key={n} value={String(n)}>
              {String(n).replace(".", ",")}
            </option>
          ))}
        </select>
      </div>
      <div className="tb-group">
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
        <IconButton label={`Hochgestellt (${MOD}+.)`} active={s.sup} onClick={() => c().unsetSubscript().toggleSuperscript().run()}>
          <SupIcon size={16} />
        </IconButton>
        <IconButton label={`Tiefgestellt (${MOD}+,)`} active={s.sub} onClick={() => c().unsetSuperscript().toggleSubscript().run()}>
          <SubIcon size={16} />
        </IconButton>
        <ColorButton
          label="Schriftfarbe"
          icon={<Baseline size={16} />}
          current={s.color}
          colors={TEXT_COLORS}
          clearLabel="Automatisch"
          onPick={(col) => c().setColor(col).run()}
          onClear={() => c().unsetColor().run()}
        />
        <ColorButton
          label={`Hervorheben (${MOD}+⇧+H)`}
          icon={<Highlighter size={16} />}
          current={s.highlight ? (s.highlightColor ?? HIGHLIGHT_COLORS[0]!) : null}
          active={s.highlight}
          colors={HIGHLIGHT_COLORS}
          clearLabel="Keine Hervorhebung"
          onPick={(col) => c().setHighlight({ color: col }).run()}
          onClear={() => c().unsetHighlight().run()}
        />
        <IconButton label="Code / Fachbegriff" active={s.code} onClick={() => c().toggleCode().run()}>
          <Code size={16} />
        </IconButton>
        <IconButton label="Formatierung löschen" onClick={clearFormatting}>
          <RemoveFormatting size={16} />
        </IconButton>
      </div>
      <div className="tb-group">
        <IconButton label="Linksbündig" active={s.align === "left"} onClick={() => c().setTextAlign("left").run()}>
          <AlignLeft size={16} />
        </IconButton>
        <IconButton label="Zentriert" active={s.align === "center"} onClick={() => c().setTextAlign("center").run()}>
          <AlignCenter size={16} />
        </IconButton>
        <IconButton label="Rechtsbündig" active={s.align === "right"} onClick={() => c().setTextAlign("right").run()}>
          <AlignRight size={16} />
        </IconButton>
        <IconButton label="Blocksatz" active={s.align === "justify"} onClick={() => c().setTextAlign("justify").run()}>
          <AlignJustify size={16} />
        </IconButton>
        <IconButton
          label="Zeilenabstand"
          onClick={(e) =>
            menu.openBelow(e.currentTarget, [
              ...LINE_HEIGHTS.map((v) => ({
                label: `${v.replace(".", ",")}${s.lineHeight === v ? "  ✓" : ""}`,
                onSelect: () => c().setParagraphLineHeight(v).run(),
              })),
              { separator: true, label: "" },
              { label: `Standard${!s.lineHeight ? "  ✓" : ""}`, onSelect: () => c().setParagraphLineHeight(null).run() },
            ])
          }
        >
          <UnfoldVertical size={16} />
        </IconButton>
        <IconButton label="Einzug verkleinern (⇧+Tab)" onClick={() => indent(editor, -1)}>
          <ListIndentDecrease size={16} />
        </IconButton>
        <IconButton label="Einzug vergrößern (Tab)" onClick={() => indent(editor, 1)}>
          <ListIndentIncrease size={16} />
        </IconButton>
      </div>
      <div className="tb-group">
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
      </div>
      <div className="tb-group">
        <IconButton label="Fußnote einfügen (⌥+⌘+F)" onClick={onFootnote}>
          <Asterisk size={16} />
        </IconButton>
        <IconButton label="Tabelle" active={s.table} onClick={(e) => tableMenu(e.currentTarget)}>
          <TableIcon size={16} />
        </IconButton>
        <IconButton label="Bild einfügen (oder Screenshot einfügen/hineinziehen)" onClick={onImage}>
          <ImagePlus size={16} />
        </IconButton>
        <IconButton label="Formel (LaTeX)" onClick={onMath}>
          <Sigma size={16} />
        </IconButton>
        <IconButton label="Trennlinie" onClick={() => c().setHorizontalRule().run()}>
          <Minus size={16} />
        </IconButton>
        <IconButton label={`Seitenumbruch (${MOD}+Enter)`} onClick={() => c().insertPageBreak().run()}>
          <SeparatorHorizontal size={16} />
        </IconButton>
        <IconButton label={`Weblink (${MOD}+K im Text)`} active={s.link} onClick={onExternalLink}>
          <Link2 size={16} />
        </IconButton>
        <IconButton label={`Interne Verknüpfung (${MOD}+⇧+L)`} onClick={onInternalLink}>
          <Waypoints size={16} />
        </IconButton>
      </div>
      {menu.el}
    </div>
  );
}

/** Farbknopf mit Farbfeld-Auswahl (Schriftfarbe, Hervorhebung). */
function ColorButton({
  label,
  icon,
  current,
  colors,
  clearLabel,
  active,
  onPick,
  onClear,
}: {
  label: string;
  icon: ReactNode;
  current: string | null;
  colors: string[];
  clearLabel: string;
  active?: boolean;
  onPick: (color: string) => void;
  onClear: () => void;
}) {
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    const w = pop.current?.offsetWidth ?? 200;
    setPos({ x: Math.max(8, Math.min(r.left, window.innerWidth - w - 8)), y: r.bottom + 4 });
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!pop.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", key);
    };
  }, [open]);
  const choose = (fn: () => void) => {
    fn();
    setOpen(false);
  };
  return (
    <span className="tb-color">
      <button
        ref={btn}
        type="button"
        className={`icon-btn tb-color-btn ${active ? "is-active" : ""}`}
        aria-label={label}
        title={label}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {icon}
        <span className="tb-color-bar" style={{ background: current ?? "transparent" }} />
        <ChevronDown size={10} className="tb-caret" />
      </button>
      {open &&
        createPortal(
          <div ref={pop} className="color-pop" style={{ left: pos.x, top: pos.y }} role="dialog" aria-label={label}>
            <div className="color-grid">
              {colors.map((col) => (
                <button
                  key={col}
                  type="button"
                  className={`swatch ${current?.toLowerCase() === col ? "is-active" : ""}`}
                  style={{ background: col }}
                  aria-label={`Farbe ${col}`}
                  title={col}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(() => onPick(col))}
                />
              ))}
            </div>
            <button type="button" className="menu-item" onMouseDown={(e) => e.preventDefault()} onClick={() => choose(onClear)}>
              {clearLabel}
            </button>
          </div>,
          document.body,
        )}
    </span>
  );
}
