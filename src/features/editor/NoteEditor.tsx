import { EditorContent, useEditor } from "@tiptap/react";
import { ExternalLink, History, MoreHorizontal, Unlink } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

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
import { storeImageFile } from "./AssetImage";
import { exportNote } from "./exportImport";
import { editorExtensions, isAllowedHref, MATH_EDIT_EVENT, type MathEditDetail } from "./extensions";
import { MathDialog } from "./MathDialog";
import { LinkPicker } from "./LinkPicker";
import { freezeAndFlush, scheduleSave } from "./saveQueue";
import { Toolbar } from "./Toolbar";
import { VersionHistory } from "./VersionHistory";
import { CardDialog } from "../learn/CardDialog";

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
  const fileInput = useRef<HTMLInputElement>(null);
  const menu = useMenu();
  const area = areaById(note.area_id);
  const nodeTitle = nodes.find((n) => n.id === note.node_id)?.title;

  const editor = useEditor({
    extensions: editorExtensions({ placeholder: "Mitschrift beginnen … Überschriften mit # , Listen mit - , Checklisten mit [ ]" }),
    content: parseDoc(note.content_json),
    autofocus: false,
    editorProps: {
      attributes: { class: `prose prose-${editorFont}`, spellcheck: "true", lang: "de" },
      handleClick(_view, _pos, event) {
        const a = (event.target as HTMLElement).closest("a");
        if (a && (event.metaKey || event.ctrlKey)) {
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
    window.addEventListener(MATH_EDIT_EVENT, onMath);
    return () => window.removeEventListener(MATH_EDIT_EVENT, onMath);
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

  const moreMenu = (el: HTMLElement) =>
    menu.openBelow(el, [
      { label: "Karteikarte aus Auswahl", disabled: !selectedText(), onSelect: () => void fromSelection("card") },
      { label: "Definition aus Auswahl anlegen", disabled: !selectedText(), onSelect: () => void fromSelection("definition") },
      { label: "Offene Frage aus Auswahl", disabled: !selectedText(), onSelect: () => void fromSelection("question") },
      { separator: true, label: "" },
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
    <div className={`note ${compact ? "is-compact" : ""}`}>
      <div className="note-head">
        <div className="note-crumb small muted ellipsis">
          {area && <span className="crumb-area" style={{ color: area.color }}>{area.name}</span>}
          {note.path && <span> › {note.path}</span>}
        </div>
        <div className="row">
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
          <IconButton label="Versionshistorie" onClick={() => setShowHistory(true)}>
            <History size={16} />
          </IconButton>
          <IconButton label="Weitere Aktionen" onClick={(e) => moreMenu(e.currentTarget)}>
            <MoreHorizontal size={16} />
          </IconButton>
        </div>
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
      />
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
        <EditorContent editor={editor} className="note-body" />
      </div>
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
