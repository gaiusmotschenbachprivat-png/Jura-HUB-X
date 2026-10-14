import { EditorContent, useEditor } from "@tiptap/react";
import { ExternalLink, History, MoreHorizontal, Unlink } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

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
import { exportNote } from "./exportImport";
import { editorExtensions, isAllowedHref } from "./extensions";
import { LinkPicker } from "./LinkPicker";
import { freezeAndFlush, scheduleSave } from "./saveQueue";
import { Toolbar } from "./Toolbar";
import { VersionHistory } from "./VersionHistory";

/** Öffnet einen Link aus einer Notiz: intern in der App, Weblinks im Browser. */
export function followHref(href: string) {
  const st = useApp.getState();
  const m = /^studium:(node|document)\/([0-9a-f-]{36})(?:#page=(\d+))?$/.exec(href);
  if (m) {
    if (m[1] === "document") {
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

  if (!editor) return null;

  const insertLink = (href: string, text: string) => {
    const { empty } = editor.state.selection;
    if (empty) {
      editor.chain().focus().insertContent({ type: "text", text, marks: [{ type: "link", attrs: { href } }] }).insertContent(" ").run();
    } else {
      editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
    }
  };

  const moreMenu = (el: HTMLElement) =>
    menu.openBelow(el, [
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
      <Toolbar editor={editor} onExternalLink={() => setLinkDialog("external")} onInternalLink={() => setLinkDialog("internal")} />
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
