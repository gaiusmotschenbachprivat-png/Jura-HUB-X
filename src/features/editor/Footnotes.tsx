import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import { Plus } from "lucide-react";
import { useEffect, useState } from "react";

import { api } from "../../api";
import type { Knowledge, QuelleData } from "../../api/types";
import type { PMNode } from "../../lib/pm";
import { ART_LABEL, emptyQuelle, footnoteText, PIN_HINT, quelleTitle } from "../../lib/zitieren";
import { reportError } from "../../state/store";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { Field } from "../../ui/misc";
import { QuelleForm } from "../knowledge/QuelleForm";
import { footnotesOf, type FootnoteEditDetail } from "./formatting";

/** Fußnote: freier Text oder Quelle zitieren (mit Fundstelle). */
export function FootnoteDialog({
  initial,
  initialCite,
  number,
  onSave,
  onDelete,
  onClose,
}: {
  initial: string;
  initialCite?: { source: string; pin: string } | null;
  number?: number;
  onSave: (text: string, cite: { source: string; pin: string } | null) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(initial);
  const [quellen, setQuellen] = useState<Knowledge<QuelleData>[] | null>(null);
  const [mode, setMode] = useState<"cite" | "text">(initialCite ? "cite" : "text");
  const [sel, setSel] = useState<string | null>(initialCite?.source ?? null);
  const [pin, setPin] = useState(initialCite?.pin ?? "");
  const [vgl, setVgl] = useState(/^vgl\./i.test(initial));
  const [q, setQ] = useState("");
  const [draft, setDraft] = useState<QuelleData | null>(null);

  useEffect(() => {
    api
      .knowledgeList({ type: "quelle" })
      .then((l) => {
        const list = l as unknown as Knowledge<QuelleData>[];
        setQuellen(list);
        // Neue Fußnote: direkt zitieren, wenn es schon Quellen gibt
        if (!initial && !initialCite && list.length) setMode("cite");
      })
      .catch(reportError);
  }, []);

  const chosen = quellen?.find((k) => k.id === sel) ?? null;
  const citeText = chosen ? `${vgl ? "Vgl. " : ""}${footnoteText(chosen.data, pin)}` : "";
  const shown = (quellen ?? []).filter((k) => !q.trim() || `${k.title} ${k.data.autoren} ${k.data.titel} ${k.data.az}`.toLowerCase().includes(q.trim().toLowerCase()));

  const save = () => {
    if (mode === "cite") {
      if (chosen) onSave(citeText, { source: chosen.id, pin: pin.trim() });
    } else if (text.trim()) onSave(text.trim(), null);
  };
  const createSource = async () => {
    if (!draft) return;
    try {
      const k = (await api.knowledgeCreate({ type: "quelle", title: quelleTitle(draft), data: draft as unknown as Record<string, unknown> })) as unknown as Knowledge<QuelleData>;
      setQuellen((l) => [k, ...(l ?? [])]);
      setSel(k.id);
      setDraft(null);
    } catch (e) {
      reportError(e);
    }
  };

  return (
    <Dialog
      title={number ? `Fußnote ${number}` : "Fußnote einfügen"}
      onClose={onClose}
      width={620}
      footer={
        <>
          {onDelete && (
            <Button variant="ghost" onClick={onDelete}>
              Fußnote entfernen
            </Button>
          )}
          <span className="grow" />
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" disabled={mode === "cite" ? !chosen || !!draft : !text.trim()} onClick={save}>
            Übernehmen
          </Button>
        </>
      }
    >
      <div className="stack">
        <div className="seg" role="tablist" aria-label="Art der Fußnote">
          <button role="tab" aria-selected={mode === "cite"} className={mode === "cite" ? "is-active" : ""} onClick={() => setMode("cite")}>
            Quelle zitieren
          </button>
          <button
            role="tab"
            aria-selected={mode === "text"}
            className={mode === "text" ? "is-active" : ""}
            onClick={() => {
              if (mode === "cite" && citeText) setText(citeText);
              setMode("text");
            }}
          >
            Freier Text
          </button>
        </div>
        {mode === "text" ? (
          <Field label="Text der Fußnote" hint="Z. B. „Vgl. BGH NJW 2020, 123 (125)“. Über „Quelle zitieren“ entsteht der Text automatisch und die Quelle kommt ins Literaturverzeichnis.">
            <textarea
              autoFocus
              rows={4}
              value={text}
              maxLength={5000}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  save();
                }
              }}
            />
          </Field>
        ) : draft ? (
          <div className="stack">
            <QuelleForm d={draft} set={(p) => setDraft({ ...draft, ...p })} compact />
            <div className="row">
              <span className="grow" />
              <Button size="sm" onClick={() => setDraft(null)}>
                Abbrechen
              </Button>
              <Button size="sm" variant="primary" onClick={() => void createSource()}>
                Quelle anlegen
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="row">
              <input className="grow" value={q} placeholder="Quelle suchen (Verfasser, Titel, Aktenzeichen)" aria-label="Quelle suchen" onChange={(e) => setQ(e.target.value)} />
              <Button size="sm" icon={<Plus size={14} />} onClick={() => setDraft(emptyQuelle())}>
                Neue Quelle
              </Button>
            </div>
            {quellen === null ? (
              <div className="loading">Lade …</div>
            ) : shown.length === 0 ? (
              <p className="small muted">{quellen.length ? "Keine Quelle passt zur Suche." : "Noch keine Quellen. Lege mit „Neue Quelle“ einen Kommentar, ein Lehrbuch, einen Aufsatz oder ein Urteil an."}</p>
            ) : (
              <div className="list pick-list" role="listbox" aria-label="Quellen">
                {shown.map((k) => (
                  <button key={k.id} role="option" aria-selected={sel === k.id} className={`list-row ${sel === k.id ? "is-active" : ""}`} onClick={() => setSel(k.id)}>
                    <span className="grow ellipsis">{k.title}</span>
                    <span className="xs muted">{ART_LABEL[k.data.art] ?? ""}</span>
                  </button>
                ))}
              </div>
            )}
            {chosen && (
              <>
                <div className="row wrap">
                  <label className="field grow">
                    <span className="field-label">Zitierte Stelle (Seite, Rn.)</span>
                    <input autoFocus value={pin} placeholder={PIN_HINT[chosen.data.art] || "–"} aria-label="Zitierte Stelle" onChange={(e) => setPin(e.target.value)} />
                  </label>
                  <label className="row small" style={{ alignSelf: "flex-end", paddingBottom: 6 }}>
                    <input type="checkbox" checked={vgl} onChange={(e) => setVgl(e.target.checked)} /> „Vgl.“ voranstellen
                  </label>
                </div>
                <div className="quelle-preview small">
                  <span className="muted">Fußnote: </span>
                  {citeText}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}

/** Fußnotenliste unter dem Text (wie am Seitenende in Word). */
export function FootnoteList({ editor, onEdit }: { editor: Editor; onEdit: (d: FootnoteEditDetail) => void }) {
  const notes = useEditorState({ editor, selector: ({ editor: e }) => footnotesOf(e), equalityFn: (a, b) => JSON.stringify(a) === JSON.stringify(b) });
  if (!notes.length) return null;
  return (
    <section className="footnotes" aria-label="Fußnoten">
      <ol>
        {notes.map((n, i) => (
          <li key={`${n.pos}-${i}`}>
            <button type="button" className="footnote-item" onClick={() => onEdit(n)} title="Fußnote bearbeiten">
              <span className="footnote-num">{i + 1}</span>
              <span className={n.text ? "" : "muted"}>{n.text || "(leer)"}</span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Literaturverzeichnis der Notiz ansehen, kopieren oder als Abschnitt einfügen. */
export function BibliographyDialog({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const [list, setList] = useState<string[] | null>(null);
  useEffect(() => {
    void import("./exportImport").then(({ loadBibliography }) => loadBibliography(editor.getJSON() as PMNode).then(setList));
  }, [editor]);
  return (
    <Dialog
      title="Literaturverzeichnis"
      onClose={onClose}
      width={640}
      footer={
        <>
          <span className="grow xs muted">Erscheint automatisch in Druckansicht und Word-Export.</span>
          <Button disabled={!list?.length} onClick={() => void navigator.clipboard?.writeText((list ?? []).join("\n"))}>
            Kopieren
          </Button>
          <Button
            variant="primary"
            disabled={!list?.length}
            onClick={() => {
              editor
                .chain()
                .focus()
                .insertContent([{ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Literaturverzeichnis" }] }, ...(list ?? []).map((e) => ({ type: "paragraph", content: [{ type: "text", text: e }] }))])
                .run();
              onClose();
            }}
          >
            In die Notiz einfügen
          </Button>
        </>
      }
    >
      {list === null ? (
        <div className="loading">Lade …</div>
      ) : list.length === 0 ? (
        <p className="small muted">Noch keine Literatur zitiert. Füge eine Fußnote ein und wähle „Quelle zitieren“ – Rechtsprechung erscheint nur in den Fußnoten.</p>
      ) : (
        <div className="stack bib-list">
          {list.map((e, i) => (
            <p key={i} className="bib-entry small">
              {e}
            </p>
          ))}
        </div>
      )}
    </Dialog>
  );
}
