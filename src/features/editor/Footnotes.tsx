import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import { useState } from "react";

import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { Field } from "../../ui/misc";
import { footnotesOf, type FootnoteEditDetail } from "./formatting";

/** Fußnotentext eingeben oder bearbeiten. */
export function FootnoteDialog({
  initial,
  number,
  onSave,
  onDelete,
  onClose,
}: {
  initial: string;
  number?: number;
  onSave: (text: string) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(initial);
  const save = () => text.trim() && onSave(text.trim());
  return (
    <Dialog
      title={number ? `Fußnote ${number}` : "Fußnote einfügen"}
      onClose={onClose}
      width={520}
      footer={
        <>
          {onDelete && (
            <Button variant="ghost" onClick={onDelete}>
              Fußnote entfernen
            </Button>
          )}
          <span className="grow" />
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" disabled={!text.trim()} onClick={save}>
            Übernehmen
          </Button>
        </>
      }
    >
      <Field label="Text der Fußnote" hint="Z. B. Fundstelle: „BGH NJW 2020, 123 (125)“ oder „Vgl. MüKoBGB/Armbrüster, § 119 Rn. 5“.">
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
