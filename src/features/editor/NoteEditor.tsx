import { EditorContent, useEditor } from "@tiptap/react";
import { ArrowLeftRight, BookOpen, Columns2, ExternalLink, GraduationCap, History, ListTree, Maximize2, MoreHorizontal, PencilLine, Printer, Rows2, Unlink, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api, errorMessage } from "../../api";
import type { Note } from "../../api/types";
import { formatRelative } from "../../lib/format";
import { parseDoc, plainText, type PMNode } from "../../lib/pm";
import { areaById, reportError, useApp } from "../../state/store";
import { Button, IconButton } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { useMenu } from "../../ui/Menu";
import { EmptyState, Field, MOD } from "../../ui/misc";
import { renameNode, trashNode } from "../navigation/actions";
import { DRAWING_EDIT_EVENT, INSERT_SLIDE_EVENT, storeImageFile, type DrawingEditDetail, type InsertSlideDetail } from "./AssetImage";
import { DrawingDialog, type DrawingResult } from "./DrawingDialog";
import { decodeDrawing, encodeDrawing } from "../../lib/drawing";
import { exportNote } from "./exportImport";
import { editorExtensions, isAllowedHref, MATH_EDIT_EVENT, type MathEditDetail } from "./extensions";
import { MathDialog } from "./MathDialog";
import { BibliographyDialog, FootnoteDialog, FootnoteList } from "./Footnotes";
import { FOOTNOTE_EDIT_EVENT, footnotesOf, type FootnoteEditDetail } from "./formatting";
import { LinkPicker } from "./LinkPicker";
import { freezeAndFlush, scheduleSave } from "./saveQueue";
import { FindBar } from "./FindBar";
import { SchemaPickerDialog } from "./Gutachten";
import { NoteMetaBar } from "./NoteMetaBar";
import { SlidesButton } from "../documents/Slides";
import { DictationButton, insertTimestamp } from "./Dictation";
import { SecondNoteButton, swapNotes, useSplitLayoutToggle } from "./SplitNotes";
import { OUTLINE_JUMP_EVENT, type OutlineJumpDetail } from "./outlineJump";
import { CALLOUT_EDIT_EVENT, type CalloutEditDetail } from "./callout";
import { CALLOUTS, calloutInfo } from "../../lib/callouts";
import { PrintView } from "./PrintView";
import { NormPopover } from "./NormPopover";
import { normRefOf, setDefaultLaws, type NormRef } from "./normLinks";
import { defaultLaws } from "../../lib/lawContext";
import { ancestors } from "../../lib/tree";
import { StudyDialog, type StudyMode } from "../assistant/StudyTools";
import { Toolbar } from "./Toolbar";
import { VersionHistory } from "./VersionHistory";
import { CardDialog } from "../learn/CardDialog";
import { DefinitionHarvest } from "../knowledge/DefinitionHarvest";

/** Öffnet einen Link aus einer Notiz: intern in der App, Weblinks im Browser. */
export function followHref(href: string) {
  const st = useApp.getState();
  const m = /^studium:(node|document|knowledge)\/([0-9a-f-]{36})(?:#page=(\d+))?$/.exec(href);
  if (m) {
    if (m[1] === "knowledge") {
      st.open({ type: "knowledge", id: m[2]! });
    } else if (m[1] === "document") {
      // Dokumente öffnen sich neben der Notiz, damit beides sichtbar bleibt.
      const page = m[3] ? Number(m[3]) : undefined;
      if (st.view.type === "note") st.openSecondary({ type: "document", id: m[2]!, page });
      else st.open({ type: "document", id: m[2]!, page });
    } else {
      api
        .nodeGet(m[2]!)
        .then((d) => st.open(d.node.kind === "note" ? { type: "note", id: d.node.id } : { type: "node", id: d.node.id }, { title: d.node.title }))
        .catch(reportError);
    }
  } else if (/^(https?:|mailto:)/.test(href)) {
    void api.openUrl(href).catch(reportError);
  }
}

async function insertImages(view: import("@tiptap/pm/view").EditorView, files: File[], pos: number) {
  for (const f of files) {
    try {
      const src = await storeImageFile(f);
      const node = view.state.schema.nodes.image?.create({ src, alt: f.name });
      if (node) view.dispatch(view.state.tr.insert(Math.min(pos, view.state.doc.content.size), node));
    } catch (e) {
      reportError(e);
    }
  }
}

export function NoteEditor({ id, compact = false }: { id: string; compact?: boolean }) {
  const [note, setNote] = useState<Note | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    setNote(null);
    setError(null);
    api
      .noteGet(id)
      .then((n) => alive && setNote(n))
      .catch((e) => alive && setError(errorMessage(e)));
    return () => {
      alive = false;
    };
  }, [id, reloadKey]);

  if (error) return <EmptyState title="Notiz nicht verfügbar">{error}</EmptyState>;
  if (!note) return <div className="loading">Lade Notiz …</div>;
  return <LoadedEditor key={`${note.node_id}:${reloadKey}`} note={note} compact={compact} onReload={() => setReloadKey((k) => k + 1)} />;
}

function LoadedEditor({ note, compact, onReload }: { note: Note; compact: boolean; onReload: () => void }) {
  const editorFont = useApp((s) => s.editorFont);
  const lastSavedAt = useApp((s) => (s.lastSavedId === note.node_id ? s.lastSavedAt : null));
  const rememberTitle = useApp((s) => s.rememberTitle);
  const nodes = useApp((s) => s.nodes);
  const [title, setTitle] = useState(note.title);
  const [words, setWords] = useState(note.word_count);
  const [linkDialog, setLinkDialog] = useState<null | "external" | "internal">(null);
  const [showHistory, setShowHistory] = useState(false);
  const [linkHref, setLinkHref] = useState<string | null>(null);
  const [cardFrom, setCardFrom] = useState<string | null>(null);
  const [math, setMath] = useState<(MathEditDetail & { isNew?: boolean }) | null>(null);
  const [footnote, setFootnote] = useState<(FootnoteEditDetail & { isNew?: boolean }) | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [drawing, setDrawing] = useState<{ pos: number | null; data: string | null } | null>(null);
  const [schemaOpen, setSchemaOpen] = useState(false);
  const [printDoc, setPrintDoc] = useState<PMNode | null>(null);
  const [study, setStudy] = useState<StudyMode | null>(null);
  const [bibOpen, setBibOpen] = useState(false);
  const [harvest, setHarvest] = useState(false);
  const [reading, setReading] = useState(false);
  const [backTo, setBackTo] = useState<OutlineJumpDetail | null>(null);
  const [calloutTitle, setCalloutTitle] = useState<{ pos: number; title: string; label: string } | null>(null);
  const focusBefore = useRef(false);
  const [normPop, setNormPop] = useState<{ ref: NormRef; rect: DOMRect } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const menu = useMenu();
  const area = areaById(note.area_id);
  const treeNode = nodes.find((n) => n.id === note.node_id);
  const nodeTitle = treeNode?.title;

  const editor = useEditor({
    extensions: editorExtensions({ placeholder: "Mitschrift beginnen … Überschriften mit # , Listen mit - , Checklisten mit [ ]" }),
    content: parseDoc(note.content_json),
    autofocus: false,
    editorProps: {
      attributes: { class: `prose prose-${editorFont}`, spellcheck: "true", lang: "de" },
      handleClick(view, _pos, event) {
        // Norm antippen → Wortlaut (nicht beim Markieren)
        const nr = normRefOf(event.target as Element);
        if (nr && view.state.selection.empty) {
          const el = (event.target as Element).closest(".norm-ref")!;
          setNormPop({ ref: nr, rect: el.getBoundingClientRect() });
        }
        const a = (event.target as HTMLElement).closest("a");
        // Im Lesemodus öffnen Links direkt beim Antippen
        if (a && (event.metaKey || event.ctrlKey || !view.editable)) {
          const href = a.getAttribute("href") ?? "";
          event.preventDefault();
          followHref(href);
          return true;
        }
        return false;
      },
      handlePaste(view, event) {
        const files = [...(event.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
        if (!files.length) return false;
        event.preventDefault();
        void insertImages(view, files, view.state.selection.from);
        return true;
      },
      handleDrop(view, event) {
        const files = [...((event as DragEvent).dataTransfer?.files ?? [])].filter((f) => f.type.startsWith("image/"));
        if (!files.length) return false;
        event.preventDefault();
        const pos = view.posAtCoords({ left: (event as DragEvent).clientX, top: (event as DragEvent).clientY })?.pos ?? view.state.selection.from;
        void insertImages(view, files, pos);
        return true;
      },
      // Fremde Bilder aus eingefügtem HTML nicht übernehmen (würden ohnehin nicht geladen)
      transformPastedHTML(html) {
        return html.replace(/<img\b[^>]*>/gi, "");
      },
      handleKeyDown(_view, event) {
        const mod = event.metaKey || event.ctrlKey;
        if (mod && event.shiftKey && event.key.toLowerCase() === "l") {
          setLinkDialog("internal");
          return true;
        }
        if (mod && !event.shiftKey && event.key.toLowerCase() === "k") {
          // Im Text: Weblink; die globale Suche liegt auf ⌘K außerhalb des Editors.
          setLinkDialog("external");
          return true;
        }
        if (mod && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "f") {
          event.preventDefault();
          setFindOpen(true);
          return true;
        }
        if (mod && event.altKey && event.code === "KeyF") {
          // Wie in Word: Fußnote einfügen
          event.preventDefault();
          setFootnote({ text: "", pos: -1, isNew: true });
          return true;
        }
        if (mod && event.key.toLowerCase() === "s") {
          event.preventDefault();
          void freezeAndFlush(note.node_id);
          return true;
        }
        return false;
      },
    },
    onUpdate({ editor: e }) {
      setWords(e.storage.characterCount?.words?.() ?? 0);
      scheduleSave(note.node_id, () => {
        const json = e.getJSON() as PMNode;
        return { json: JSON.stringify(json), text: plainText(json) };
      });
    },
    onSelectionUpdate({ editor: e }) {
      setLinkHref(e.isActive("link") ? ((e.getAttributes("link").href as string) ?? null) : null);
    },
  });

  useEffect(() => {
    rememberTitle({ type: "note", id: note.node_id }, note.title);
    return () => {
      void freezeAndFlush(note.node_id);
    };
  }, [note.node_id, note.title, rememberTitle]);

  // Zitate ohne Gesetz („§ 433 I“): Gesetz aus Notiz-/Veranstaltungstitel bzw. den importierten Gesetzen ergänzen
  const dataVersion = useApp((s) => s.dataVersion);
  const contextTitles = useMemo(() => {
    const chain = [note.node_id, ...ancestors(nodes, note.node_id)];
    return [title, ...chain.slice(1).map((id) => nodes.find((n) => n.id === id)?.title ?? ""), area?.name ?? ""].filter(Boolean);
  }, [nodes, note.node_id, title, area?.name]);
  useEffect(() => {
    if (!editor) return;
    let alive = true;
    void api
      .legalSourcesList()
      .then((list) => {
        if (alive) setDefaultLaws(editor, defaultLaws(contextTitles, list.filter((s) => s.kind === "gesetz").map((s) => s.abbreviation)));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [editor, contextTitles, dataVersion]);

  // Titel aus dem Baum übernehmen (Umbenennen in der Seitenleiste)
  useEffect(() => {
    if (nodeTitle && nodeTitle !== title && document.activeElement?.id !== "note-title") setTitle(nodeTitle);
  }, [nodeTitle]);

  useEffect(() => {
    if (editor) editor.setOptions({ editorProps: { ...editor.options.editorProps, attributes: { class: `prose prose-${editorFont}`, spellcheck: "true", lang: "de" } } });
  }, [editor, editorFont]);

  const saveTitle = useCallback(async () => {
    const t = title.trim();
    if (!t) return setTitle(note.title);
    if (t !== (nodeTitle ?? note.title)) await renameNode(note.node_id, t);
  }, [title, note, nodeTitle]);

  useEffect(() => {
    if (!editor) return;
    const onMath = (e: Event) => {
      const d = (e as CustomEvent<MathEditDetail>).detail;
      const node = editor.state.doc.nodeAt(d.pos);
      // Nur der Editor, in dem die Formel liegt, reagiert
      if (!node || node.attrs.latex !== d.latex || !editor.view.dom.isConnected) return;
      if (!editor.view.dom.contains(document.activeElement) && !editor.view.dom.querySelector(":hover")) return;
      setMath(d);
    };
    const onFootnote = (e: Event) => {
      const d = (e as CustomEvent<FootnoteEditDetail>).detail;
      const fn = editor.state.doc.nodeAt(d.pos);
      if (fn?.type.name !== "footnote" || !editor.view.dom.isConnected) return;
      if (!editor.view.dom.contains(document.activeElement) && !editor.view.dom.querySelector(":hover")) return;
      setFootnote({ ...d, source: (fn.attrs.source as string | null) ?? null, pin: (fn.attrs.pin as string | null) ?? null });
    };
    const onDrawing = (e: Event) => {
      const d = (e as CustomEvent<DrawingEditDetail>).detail;
      if (editor.state.doc.nodeAt(d.pos)?.type.name !== "image" || !editor.view.dom.isConnected) return;
      if (!editor.view.dom.contains(document.activeElement) && !editor.view.dom.querySelector(":hover")) return;
      setDrawing({ pos: d.pos, data: d.drawing });
    };
    // Folie aus der geteilten Ansicht: Bild + Verweis auf die Seite, dann weiterschreiben
    const onSlide = (e: Event) => {
      const d = (e as CustomEvent<InsertSlideDetail>).detail;
      if (compact || d.noteId !== note.node_id || !editor.view.dom.isConnected) return;
      // page 0: Bild-Folie (ganze Datei statt einer PDF-Seite)
      const href = d.page ? `studium:document/${d.documentId}#page=${d.page}` : `studium:document/${d.documentId}`;
      const label = d.page ? `Folie ${d.page} · ${d.title}` : d.title;
      editor
        .chain()
        .focus()
        .insertContent([
          { type: "image", attrs: { src: d.src, alt: d.page ? `Folie ${d.page} – ${d.title}` : d.title } },
          { type: "paragraph", content: [{ type: "text", text: label, marks: [{ type: "link", attrs: { href } }, { type: "italic" }] }] },
          { type: "paragraph" },
        ])
        .run();
      useApp.getState().toast(d.page ? `Folie ${d.page} übernommen.` : "Folie übernommen.", "success");
    };
    window.addEventListener(INSERT_SLIDE_EVENT, onSlide);
    window.addEventListener(MATH_EDIT_EVENT, onMath);
    window.addEventListener(FOOTNOTE_EDIT_EVENT, onFootnote);
    window.addEventListener(DRAWING_EDIT_EVENT, onDrawing);
    return () => {
      window.removeEventListener(INSERT_SLIDE_EVENT, onSlide);
      window.removeEventListener(DRAWING_EDIT_EVENT, onDrawing);
      window.removeEventListener(MATH_EDIT_EVENT, onMath);
      window.removeEventListener(FOOTNOTE_EDIT_EVENT, onFootnote);
    };
  }, [editor, compact, note.node_id]);

  // Lesemodus: nur lesen, ohne Werkzeugleiste, größere Schrift, Seitenleiste aus
  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!reading);
    const st = useApp.getState();
    if (reading) {
      focusBefore.current = st.focusMode;
      st.setPref("focusMode", true);
    } else if (!focusBefore.current && st.focusMode) st.setPref("focusMode", false);
    if (!reading) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setReading(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editor, reading]);
  useEffect(
    () => () => {
      if (reading && !focusBefore.current) useApp.getState().setPref("focusMode", false);
    },
    [reading],
  );

  // Nach einem Sprung aus der Gliederung: „zurück zur Gliederung“ anbieten
  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onJump = (e: Event) => {
      setBackTo((e as CustomEvent<OutlineJumpDetail>).detail);
      clearTimeout(timer);
      timer = setTimeout(() => setBackTo(null), 15000);
    };
    dom.addEventListener(OUTLINE_JUMP_EVENT, onJump);
    // Beschriftung eines Kastens angetippt: Art ändern, Überschrift, auflösen
    const onCallout = (e: Event) => {
      const d = (e as CustomEvent<CalloutEditDetail>).detail;
      const node = editor.state.doc.nodeAt(d.pos);
      if (node?.type.name !== "callout" || !editor.isEditable) return;
      const setAttrs = (attrs: Record<string, unknown>) =>
        editor
          .chain()
          .command(({ tr }) => {
            tr.setNodeMarkup(d.pos, undefined, { ...node.attrs, ...attrs });
            return true;
          })
          .run();
      menu.openAt({ clientX: d.x, clientY: d.y }, [
        ...CALLOUTS.map((k) => ({
          label: k.kind === node.attrs.kind ? `✓ ${k.label}` : k.label,
          icon: <span className="callout-dot" style={{ background: k.color }} />,
          onSelect: () => setAttrs({ kind: k.kind }),
        })),
        { separator: true, label: "" },
        { label: node.attrs.title ? "Überschrift ändern …" : "Überschrift ergänzen (z. B. § 433 BGB) …", onSelect: () => setCalloutTitle({ pos: d.pos, title: String(node.attrs.title ?? ""), label: calloutInfo(node.attrs.kind).label }) },
        {
          label: "Kasten auflösen (Text bleibt)",
          onSelect: () => editor.chain().focus().setTextSelection(d.pos + 2).unsetCallout().run(),
        },
      ]);
    };
    dom.addEventListener(CALLOUT_EDIT_EVENT, onCallout);
    return () => {
      clearTimeout(timer);
      dom.removeEventListener(OUTLINE_JUMP_EVENT, onJump);
      dom.removeEventListener(CALLOUT_EDIT_EVENT, onCallout);
    };
  }, [editor]);

  if (!editor) return null;

  const insertLink = (href: string, text: string) => {
    const { empty } = editor.state.selection;
    if (empty) {
      editor.chain().focus().insertContent({ type: "text", text, marks: [{ type: "link", attrs: { href } }] }).insertContent(" ").run();
    } else {
      editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
    }
  };

  const selectedText = () => {
    const { from, to } = editor.state.selection;
    return editor.state.doc.textBetween(from, to, "\n").trim();
  };
  const fromSelection = async (what: "card" | "definition" | "question") => {
    const text = selectedText();
    const nodeRow = useApp.getState().nodes.find((n) => n.id === note.node_id);
    if (what === "card") return setCardFrom(text);
    try {
      if (what === "question") {
        await api.taskCreate({ node_id: nodeRow?.parent_id ?? null, area_id: nodeRow?.parent_id ? null : note.area_id, kind: "frage", title: text.slice(0, 500) || "Offene Frage" });
        useApp.getState().toast("Als offene Frage gespeichert.", "success");
        useApp.getState().bump();
      } else {
        const [term, ...rest] = text.split(/[:\n–-]/);
        const k = await api.knowledgeCreate({
          type: "definition",
          area_id: note.area_id,
          node_id: nodeRow?.parent_id ?? null,
          title: (term ?? "").trim().slice(0, 300) || "Neuer Begriff",
          data: { text: rest.join(" ").trim() || text },
        });
        // Markierten Text gleich mit der Definition verlinken
        if (!editor.state.selection.empty) editor.chain().focus().setLink({ href: `studium:knowledge/${k.id}` }).run();
        useApp.getState().toast(`Definition „${k.title}“ angelegt und verlinkt.`, "success");
      }
    } catch (e) {
      reportError(e);
    }
  };

  /** Überschriften der Notiz – Antippen springt hin. */
  const tocMenu = (el: HTMLElement) => {
    const heads: { pos: number; level: number; text: string }[] = [];
    editor.state.doc.descendants((n, pos) => {
      if (n.type.name === "heading") heads.push({ pos, level: Number(n.attrs.level) || 1, text: n.textContent });
      return !n.isTextblock;
    });
    menu.openBelow(
      el,
      heads.length
        ? heads.map((h) => ({
            label: `${"\u2003".repeat(h.level - 1)}${h.text || "(ohne Text)"}`,
            onSelect: () => {
              editor.chain().focus().setTextSelection(h.pos + 1).run();
              const dom = editor.view.nodeDOM(h.pos) as HTMLElement | null;
              dom?.scrollIntoView({ block: "start", behavior: "smooth" });
            },
          }))
        : [{ label: "Noch keine Überschriften – Absatzformat „Überschrift“ wählen.", disabled: true }],
    );
  };

  const studyItems = () => [
    { label: "Mitschrift aufbereiten …", onSelect: () => setStudy("aufbereiten" as const) },
    { label: "Karteikarten vorschlagen …", onSelect: () => setStudy("karteikarten" as const) },
    { label: "Übungsfall erstellen …", onSelect: () => setStudy("uebungsfall" as const) },
    ...(treeNode?.meta?.training ? [{ label: "Lösung besprechen …", onSelect: () => setStudy("korrektur" as const) }] : []),
  ];

  const moreMenu = (el: HTMLElement) =>
    menu.openBelow(el, [
      { label: "Karteikarte aus Auswahl", disabled: !selectedText(), onSelect: () => void fromSelection("card") },
      { label: "Definition aus Auswahl anlegen", disabled: !selectedText(), onSelect: () => void fromSelection("definition") },
      { label: "Definitionen ins Glossar übernehmen …", disabled: !treeNode, onSelect: () => setHarvest(true) },
      { label: "Zeitstempel einfügen", onSelect: () => insertTimestamp(editor) },
      { label: "Offene Frage aus Auswahl", disabled: !selectedText(), onSelect: () => void fromSelection("question") },
      { separator: true, label: "" },
      { label: "Drucken / als PDF …", icon: <Printer size={14} />, onSelect: () => setPrintDoc(editor.getJSON() as PMNode) },
      { label: "Literaturverzeichnis …", onSelect: () => setBibOpen(true) },
      { label: "Als Word-Datei exportieren (.docx)", onSelect: () => void exportNote(editor.getJSON() as PMNode, title, "docx") },
      { label: "Als Markdown exportieren (.md)", onSelect: () => void exportNote(editor.getJSON() as PMNode, title, "md") },
      { separator: true, label: "" },
      { label: "Versionshistorie", icon: <History size={14} />, onSelect: () => setShowHistory(true) },
      { separator: true, label: "" },
      {
        label: "In den Papierkorb",
        danger: true,
        onSelect: () => {
          const n = useApp.getState().nodes.find((x) => x.id === note.node_id);
          if (n) void trashNode(n);
        },
      },
    ]);

  return (
    <div className={`note ${compact ? "is-compact" : ""} ${reading ? "is-reading" : ""}`}>
      <div className="note-head">
        <div className="note-crumb small muted ellipsis">
          {area && <span className="crumb-area" style={{ color: area.color }}>{area.name}</span>}
          {note.path && <span> › {note.path}</span>}
        </div>
        <div className="row note-title-row">
          <input
            id="note-title"
            className="note-title"
            value={title}
            maxLength={300}
            aria-label="Titel der Notiz"
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => void saveTitle()}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void saveTitle();
                editor.commands.focus("start");
              }
            }}
          />
          <div className="note-actions">
            {!compact && treeNode && !reading && <SlidesButton node={treeNode} />}
            {!compact && (
              <IconButton label={reading ? "Bearbeiten" : "Lesemodus"} active={reading} onClick={() => setReading(!reading)}>
                {reading ? <PencilLine size={16} /> : <BookOpen size={16} />}
              </IconButton>
            )}
            {!compact && !reading && <DictationButton editor={editor} />}
            {!compact && !reading && treeNode && <SecondNoteButton node={treeNode} />}
            {compact && <SecondaryNoteControls noteId={note.node_id} />}
            <IconButton label="KI-Lernhilfen" onClick={(e) => menu.openBelow(e.currentTarget, studyItems())}>
              <GraduationCap size={16} />
            </IconButton>
            <IconButton label="Inhaltsverzeichnis" onClick={(e) => tocMenu(e.currentTarget)}>
              <ListTree size={16} />
            </IconButton>
            <IconButton className="hide-narrow" label="Drucken / als PDF" onClick={() => setPrintDoc(editor.getJSON() as PMNode)}>
              <Printer size={16} />
            </IconButton>
            <IconButton className="hide-narrow" label="Versionshistorie" onClick={() => setShowHistory(true)}>
              <History size={16} />
            </IconButton>
            <IconButton label="Weitere Aktionen" onClick={(e) => moreMenu(e.currentTarget)}>
              <MoreHorizontal size={16} />
            </IconButton>
          </div>
        </div>
        {treeNode && <NoteMetaBar node={treeNode} />}
      </div>
      <Toolbar
        editor={editor}
        onExternalLink={() => setLinkDialog("external")}
        onInternalLink={() => setLinkDialog("internal")}
        onImage={() => fileInput.current?.click()}
        onMath={() => {
          const { from, to } = editor.state.selection;
          setMath({ latex: editor.state.doc.textBetween(from, to), pos: from, block: false, isNew: true });
        }}
        onFootnote={() => setFootnote({ text: "", pos: -1, isNew: true })}
        onSchema={() => setSchemaOpen(true)}
        onFind={() => setFindOpen(true)}
        onDraw={() => setDrawing({ pos: null, data: null })}
      />
      {findOpen && <FindBar editor={editor} onClose={() => setFindOpen(false)} />}
      <input
        ref={fileInput}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          void insertImages(editor.view, files, editor.state.selection.from);
        }}
      />
      {linkHref && (
        <div className="link-bar small">
          <span className="ellipsis grow">
            {linkHref.startsWith("studium:") ? "Interne Verknüpfung" : linkHref}
          </span>
          <Button size="sm" variant="ghost" icon={<ExternalLink size={13} />} onClick={() => followHref(linkHref)}>
            Öffnen
          </Button>
          <Button size="sm" variant="ghost" icon={<Unlink size={13} />} onClick={() => editor.chain().focus().extendMarkRange("link").unsetLink().run()}>
            Entfernen
          </Button>
          <span className="muted xs">{MOD}+Klick öffnet Links direkt</span>
        </div>
      )}
      <div className="note-scroll">
        <div className="note-body">
          <EditorContent editor={editor} />
          <FootnoteList editor={editor} onEdit={setFootnote} />
        </div>
      </div>
      {calloutTitle && (
        <CalloutTitleDialog
          initial={calloutTitle.title}
          label={calloutTitle.label}
          onClose={() => setCalloutTitle(null)}
          onSave={(title) => {
            const node = editor.state.doc.nodeAt(calloutTitle.pos);
            if (node?.type.name === "callout")
              editor
                .chain()
                .command(({ tr }) => {
                  tr.setNodeMarkup(calloutTitle.pos, undefined, { ...node.attrs, title: title.trim().slice(0, 120) });
                  return true;
                })
                .run();
            setCalloutTitle(null);
            // Schreibmarke ans Ende des Kastens – erst nach dem Schließen des Dialogs,
            // sonst gibt der Dialog den Fokus an den angetippten Knopf zurück
            const end = calloutTitle.pos + (node?.nodeSize ?? 2) - 2;
            setTimeout(() => editor.chain().focus(Math.min(end, editor.state.doc.content.size)).run(), 30);
          }}
        />
      )}
      {backTo && (
        <button
          className="outline-back"
          onClick={() => {
            const pos = Math.min(backTo.from + 2, editor.state.doc.content.size);
            editor.chain().setTextSelection(pos).scrollIntoView().run();
            (editor.view.nodeDOM(backTo.from) as HTMLElement | null)?.scrollIntoView({ block: "center", behavior: "smooth" });
            setBackTo(null);
          }}
        >
          ↑ Zurück zur Gliederung
        </button>
      )}
      <div className="note-foot xs muted tnum">
        <span>{words} Wörter</span>
        <span>Zuletzt gespeichert {formatRelative(lastSavedAt ?? note.updated_at)}</span>
      </div>

      {linkDialog === "internal" && (
        <LinkPicker
          excludeId={note.node_id}
          onClose={() => setLinkDialog(null)}
          onPick={(t) => {
            setLinkDialog(null);
            insertLink(t.href, t.title);
          }}
        />
      )}
      {linkDialog === "external" && (
        <ExternalLinkDialog
          initial={(editor.getAttributes("link").href as string) ?? ""}
          onClose={() => setLinkDialog(null)}
          onSave={(href) => {
            setLinkDialog(null);
            if (!href) editor.chain().focus().extendMarkRange("link").unsetLink().run();
            else insertLink(href, href);
          }}
        />
      )}
      {math && (
        <MathDialog
          initial={math.latex}
          block={math.block}
          onClose={() => setMath(null)}
          onDelete={
            math.isNew
              ? undefined
              : () => {
                  editor.chain().focus().command(({ tr }) => {
                    const n = tr.doc.nodeAt(math.pos);
                    if (n) tr.delete(math.pos, math.pos + n.nodeSize);
                    return true;
                  }).run();
                  setMath(null);
                }
          }
          onSave={(latex, block) => {
            const chain = editor.chain().focus();
            if (!math.isNew) {
              chain.command(({ tr }) => {
                const n = tr.doc.nodeAt(math.pos);
                if (n) tr.delete(math.pos, math.pos + n.nodeSize);
                return true;
              });
            } else if (!editor.state.selection.empty) {
              chain.deleteSelection();
            }
            if (block) chain.insertBlockMath({ latex, pos: math.isNew ? undefined : math.pos });
            else chain.insertInlineMath({ latex, pos: math.isNew ? undefined : math.pos });
            chain.run();
            setMath(null);
          }}
        />
      )}
      {drawing && (
        <DrawingDialog
          initial={decodeDrawing(drawing.data)}
          onClose={() => setDrawing(null)}
          onDelete={
            drawing.pos === null
              ? undefined
              : () => {
                  const at = drawing.pos!;
                  editor.chain().focus().command(({ tr }) => {
                    const n = tr.doc.nodeAt(at);
                    if (n?.type.name === "image") tr.delete(at, at + n.nodeSize);
                    return true;
                  }).run();
                  setDrawing(null);
                }
          }
          onSave={(r: DrawingResult) => {
            const at = drawing.pos;
            setDrawing(null);
            void storeImageFile(r.png)
              .then((src) => {
                const attrs = { src, alt: "Zeichnung", width: r.width, drawing: encodeDrawing(r.drawing) };
                if (at === null) {
                  editor.chain().focus().insertContent({ type: "image", attrs }).run();
                } else {
                  editor.chain().focus().command(({ tr }) => {
                    const n = tr.doc.nodeAt(at);
                    if (n?.type.name === "image") tr.setNodeMarkup(at, undefined, { ...n.attrs, ...attrs });
                    return true;
                  }).run();
                }
              })
              .catch(reportError);
          }}
        />
      )}
      {study && treeNode && (
        <StudyDialog mode={study} node={treeNode} text={plainText(editor.getJSON() as PMNode)} editor={editor} onClose={() => setStudy(null)} />
      )}
      {normPop && (
        <NormPopover
          refInfo={normPop.ref}
          anchor={normPop.rect}
          onClose={() => setNormPop(null)}
          onInsert={
            editor?.isEditable
              ? (t) => {
                  // als Gesetzestext-Kasten hinter den Absatz mit dem Zitat
                  const { $from } = editor.state.selection;
                  const pos = $from.depth >= 1 ? $from.after(1) : editor.state.doc.content.size;
                  const paras = [...t.paragraphs, ...(t.source ? [`(${t.source})`] : [])].map((x) => ({ type: "paragraph", content: [{ type: "text", text: x }] }));
                  editor
                    .chain()
                    .focus()
                    .insertContentAt(pos, { type: "callout", attrs: { kind: "gesetz", title: t.title }, content: paras })
                    .run();
                }
              : undefined
          }
        />
      )}
      {bibOpen && <BibliographyDialog editor={editor} onClose={() => setBibOpen(false)} />}
      {schemaOpen && <SchemaPickerDialog editor={editor} onClose={() => setSchemaOpen(false)} />}
      {printDoc && <PrintView doc={printDoc} title={title} onClose={() => setPrintDoc(null)} />}
      {footnote && (
        <FootnoteDialog
          initial={footnote.text}
          number={footnote.isNew ? undefined : footnotesOf(editor).findIndex((f) => f.pos === footnote.pos) + 1 || undefined}
          onClose={() => {
            if (!footnote.isNew && editor.state.doc.nodeAt(footnote.pos)?.type.name === "footnote") editor.chain().focus().setTextSelection(footnote.pos + 1).run();
            else editor.commands.focus();
            setFootnote(null);
          }}
          onDelete={
            footnote.isNew
              ? undefined
              : () => {
                  editor.chain().focus().command(({ tr }) => {
                    const n = tr.doc.nodeAt(footnote.pos);
                    if (n?.type.name === "footnote") tr.delete(footnote.pos, footnote.pos + n.nodeSize);
                    return true;
                  }).run();
                  setFootnote(null);
                }
          }
          initialCite={footnote.source ? { source: footnote.source, pin: footnote.pin ?? "" } : null}
          onSave={(text, cite) => {
            if (footnote.isNew) {
              editor.chain().focus().insertFootnote(text, cite).run();
            } else {
              editor
                .chain()
                .focus()
                .command(({ tr }) => {
                  const n = tr.doc.nodeAt(footnote.pos);
                  if (n?.type.name === "footnote") tr.setNodeMarkup(footnote.pos, undefined, { ...n.attrs, text, source: cite?.source ?? null, pin: cite?.pin ?? null });
                  return true;
                })
                // Cursor hinter die Fußnote, damit weitergeschrieben werden kann
                .setTextSelection(footnote.pos + 1)
                .run();
            }
            setFootnote(null);
          }}
        />
      )}
      {harvest && treeNode && <DefinitionHarvest editor={editor} node={treeNode} onClose={() => setHarvest(false)} />}
      {cardFrom !== null && (
        <CardDialog
          initial={{ front: cardFrom.length < 160 ? cardFrom : "", back: cardFrom.length < 160 ? "" : cardFrom, area_id: note.area_id, source_type: "node", source_id: note.node_id }}
          onClose={() => setCardFrom(null)}
        />
      )}
      {showHistory && <VersionHistory noteId={note.node_id} onClose={() => setShowHistory(false)} onRestored={onReload} />}
      {menu.el}
    </div>
  );
}


function ExternalLinkDialog({ initial, onSave, onClose }: { initial: string; onSave: (href: string | null) => void; onClose: () => void }) {
  const [v, setV] = useState(initial.startsWith("studium:") ? "" : initial);
  const normalized = v && !/^[a-z]+:/i.test(v) ? `https://${v}` : v;
  const valid = !v || isAllowedHref(normalized);
  return (
    <Dialog
      title="Weblink"
      onClose={onClose}
      width={460}
      footer={
        <>
          {initial && <Button onClick={() => onSave(null)}>Link entfernen</Button>}
          <span className="grow" />
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" disabled={!v || !valid} onClick={() => onSave(normalized)}>
            Übernehmen
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (v && valid) onSave(normalized);
        }}
      >
        <Field label="Adresse" hint={valid ? "Weblinks öffnen sich im Standardbrowser, nie in der App." : "Nur http(s)- und mailto-Links sind erlaubt."}>
          <input autoFocus value={v} placeholder="https://…" onChange={(e) => setV(e.target.value)} />
        </Field>
      </form>
    </Dialog>
  );
}

/** Steuerung der zweiten Notiz: tauschen, Anordnung, als Hauptansicht, schließen. */
function SecondaryNoteControls({ noteId }: { noteId: string }) {
  const { stacked, toggle } = useSplitLayoutToggle();
  const open = useApp((s) => s.open);
  return (
    <>
      <IconButton label="Notizen tauschen" onClick={swapNotes}>
        <ArrowLeftRight size={15} />
      </IconButton>
      <IconButton label={stacked ? "Nebeneinander anzeigen" : "Untereinander anzeigen"} onClick={toggle}>
        {stacked ? <Columns2 size={15} /> : <Rows2 size={15} />}
      </IconButton>
      <IconButton
        label="Als Hauptansicht öffnen"
        onClick={() => {
          useApp.getState().openSecondary(null);
          open({ type: "note", id: noteId });
        }}
      >
        <Maximize2 size={15} />
      </IconButton>
      <IconButton label="Zweite Notiz schließen" onClick={() => useApp.getState().openSecondary(null)}>
        <X size={16} />
      </IconButton>
    </>
  );
}

function CalloutTitleDialog({ initial, label, onSave, onClose }: { initial: string; label: string; onSave: (t: string) => void; onClose: () => void }) {
  const [t, setT] = useState(initial);
  return (
    <Dialog
      title={`Überschrift für „${label}“`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" onClick={() => onSave(t)}>
            Übernehmen
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave(t);
        }}
      >
        <Field label="Überschrift (leer = nur die Art)" hint="z. B. „§ 433 BGB“, „Trierer Weinversteigerung“ oder „Fall 3“">
          <input autoFocus value={t} maxLength={120} onChange={(e) => setT(e.target.value)} />
        </Field>
      </form>
    </Dialog>
  );
}
