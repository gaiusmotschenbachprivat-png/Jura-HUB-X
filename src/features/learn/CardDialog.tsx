/**
 * Karte hinzufügen bzw. bearbeiten: Kartentyp, Stapel, Felder des Typs,
 * Schlagwörter. Beim Hinzufügen bleibt der Dialog offen (Stapel, Typ und
 * Schlagwörter bleiben stehen) – so lassen sich viele Definitionen
 * nacheinander erfassen. Zusammengehörige Karten (umgekehrt, Lücken) werden
 * beim Bearbeiten gemeinsam angepasst.
 */
import { Brackets, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { api, errorMessage } from "../../api";
import type { Card, CardKind, CardTemplate, NewCard } from "../../api/types";
import { cardsForNote, clozeNumbers, noteProblem, parseFields, TEMPLATES, templateDef } from "../../lib/cardModel";
import { DEFAULT_DECK, normDeck, tagList } from "../../lib/decks";
import { newId } from "../../lib/ids";
import { reportError, useApp } from "../../state/store";
import { Button } from "../../ui/Button";
import { confirmDialog, Dialog } from "../../ui/Dialog";
import { Field, MOD } from "../../ui/misc";
import { allDecks, deckForNode, lastDeck, rememberDeck, useDeckSettings } from "./collection";

export const CARD_KIND_LABEL: Record<CardKind, string> = {
  frage: "Frage – Antwort",
  definition: "Begriff – Definition",
  norm: "Gesetzesfundstelle",
};

const templateFromKind = (k?: CardKind): CardTemplate => (k === "definition" ? "definition" : "basis");

export function CardDialog({
  initial,
  card,
  onClose,
  onSaved,
  deck: presetDeck,
}: {
  initial?: Partial<NewCard>;
  card?: Card;
  onClose: () => void;
  onSaved?: (c: Card) => void;
  /** Stapel vorbelegen (z. B. aus der Stapelübersicht) */
  deck?: string;
}) {
  const areas = useApp((s) => s.areas);
  const currentArea = useApp((s) => s.areaId);
  const toast = useApp((s) => s.toast);
  const bump = useApp((s) => s.bump);
  const settings = useDeckSettings();
  const [known, setKnown] = useState<Card[]>([]);
  useEffect(() => {
    void api.cardsList({ limit: 20000 }).then(setKnown, () => {});
  }, []);
  const decks = useMemo(() => allDecks(known, settings), [known, settings]);
  const tags = useMemo(() => [...new Set(known.flatMap((c) => tagList(c.tags)))].sort((a, b) => a.localeCompare(b, "de")), [known]);

  const [template, setTemplate] = useState<CardTemplate>(card?.template ?? initial?.template ?? templateFromKind(card?.kind ?? initial?.kind));
  const [front, setFront] = useState(card?.front ?? initial?.front ?? "");
  const [back, setBack] = useState(card?.template === "luecke" && card.back === card.front ? "" : (card?.back ?? initial?.back ?? ""));
  const [fields, setFields] = useState<Record<string, string>>(() => parseFields(card?.fields ?? initial?.fields));
  const nodes = useApp((s) => s.nodes);
  const [deck, setDeck] = useState(() => card?.deck ?? initial?.deck ?? presetDeck ?? (initial?.node_id ? deckForNode(nodes, initial.node_id) : null) ?? lastDeck());
  const [tagText, setTagText] = useState(card?.tags ?? initial?.tags ?? "");
  const [areaId, setAreaId] = useState<string>(card?.area_id ?? initial?.area_id ?? (currentArea === "all" ? "" : currentArea));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState(0);
  const frontRef = useRef<HTMLTextAreaElement>(null);
  const def = templateDef(template);

  /** Auswahl im Lückentext zur nächsten Lücke machen */
  const makeGap = () => {
    const el = frontRef.current;
    if (!el) return;
    const [a, b] = [el.selectionStart, el.selectionEnd];
    const n = Math.max(0, ...clozeNumbers(front)) + 1;
    const inner = front.slice(a, b) || "…";
    const next = `${front.slice(0, a)}{{c${n}::${inner}}}${front.slice(b)}`;
    setFront(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = a + `{{c${n}::`.length;
      el.setSelectionRange(pos, pos + inner.length);
    });
  };

  const save = async () => {
    const problem = noteProblem({ template, front, back });
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);
    const deckPath = normDeck(deck) || "";
    const note = { template, front, back, fields, deck: deckPath, tags: tagList(tagText).join(", "), area_id: areaId || null };
    try {
      if (card) {
        const saved = await saveEdit(card, note);
        toast("Karte gespeichert.", "success");
        bump();
        onSaved?.(saved);
        onClose();
      } else {
        const made = cardsForNote({ ...note, node_id: initial?.node_id ?? null, source_type: initial?.source_type ?? null, source_id: initial?.source_id ?? null }, newId);
        let last: Card | null = null;
        for (const c of made) last = await api.cardCreate(c);
        rememberDeck(deckPath);
        bump();
        if (last) onSaved?.(last);
        setAdded((n) => n + made.length);
        toast(made.length > 1 ? `${made.length} Karten hinzugefügt.` : "Karte hinzugefügt.", "success");
        if (initial?.front) onClose();
        else {
          // nächste Karte: Stapel, Typ und Schlagwörter bleiben
          setFront("");
          setBack("");
          setFields({});
          frontRef.current?.focus();
        }
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!card) return;
    const sib = card.note_key ? known.filter((c) => c.note_key === card.note_key && !c.deleted_at) : [card];
    if (!(await confirmDialog({ title: "Karte löschen?", message: sib.length > 1 ? `Der Eintrag hat ${sib.length} zusammengehörige Karten. Alle kommen in den Papierkorb.` : "Die Karte kommt in den Papierkorb.", confirm: "In den Papierkorb", danger: true }))) return;
    try {
      for (const c of sib) await api.cardTrash(c.id);
      bump();
      onClose();
    } catch (e) {
      reportError(e);
    }
  };

  return (
    <Dialog
      title={card ? "Karte bearbeiten" : "Karten hinzufügen"}
      onClose={onClose}
      width={680}
      footer={
        <>
          {card && (
            <Button variant="ghost" icon={<Trash2 size={14} />} onClick={() => void remove()}>
              Löschen
            </Button>
          )}
          <span className="grow xs muted">{added ? `${added} hinzugefügt` : ""}</span>
          <Button onClick={onClose}>{card || !added ? "Abbrechen" : "Fertig"}</Button>
          <Button variant="primary" disabled={busy} onClick={() => void save()} title={`${MOD}+Enter`}>
            {card ? "Speichern" : "Hinzufügen"}
          </Button>
        </>
      }
    >
      <div
        className="card-editor"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void save();
          }
        }}
      >
        <div className="row wrap card-editor-top">
          <Field label="Kartentyp">
            <select value={template} onChange={(e) => setTemplate(e.target.value as CardTemplate)} aria-label="Kartentyp">
              {TEMPLATES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Stapel" hint="Unterstapel mit „::“, z. B. Zivilrecht::BGB AT">
            <input list="deck-list" value={deck} onChange={(e) => setDeck(e.target.value)} placeholder={DEFAULT_DECK} aria-label="Stapel" />
            <datalist id="deck-list">
              {decks.map((d) => (
                <option key={d} value={d} />
              ))}
            </datalist>
          </Field>
        </div>
        <p className="xs muted">{def.hint}</p>
        <Field label={def.front}>
          <div className="card-editor-field">
            <textarea ref={frontRef} rows={template === "luecke" ? 4 : 2} value={front} onChange={(e) => setFront(e.target.value)} aria-label={def.front} autoFocus />
            {template === "luecke" && (
              <Button size="sm" icon={<Brackets size={13} />} onMouseDown={(e) => e.preventDefault()} onClick={makeGap} title="Markierten Text zur Lücke machen">
                Lücke {Math.max(0, ...clozeNumbers(front)) + 1}
              </Button>
            )}
          </div>
        </Field>
        <Field label={def.back}>
          <textarea rows={template === "schema" ? 8 : 3} value={back} onChange={(e) => setBack(e.target.value)} aria-label={def.back} placeholder={template === "schema" ? "I. Tatbestand\n  1. Objektiver Tatbestand\n    - Handlung\n  2. Subjektiver Tatbestand\nII. Rechtswidrigkeit" : ""} />
        </Field>
        {def.extra.map((x) => (
          <Field key={x.key} label={x.label}>
            {x.multiline ? (
              <textarea rows={2} value={fields[x.key] ?? ""} placeholder={x.placeholder} aria-label={x.label} onChange={(e) => setFields({ ...fields, [x.key]: e.target.value })} />
            ) : (
              <input value={fields[x.key] ?? ""} placeholder={x.placeholder} aria-label={x.label} onChange={(e) => setFields({ ...fields, [x.key]: e.target.value })} />
            )}
          </Field>
        ))}
        <div className="row wrap card-editor-top">
          <Field label="Schlagwörter" hint="Mit Komma trennen, z. B. „Anfechtung, Irrtum“">
            <input list="tag-list" value={tagText} onChange={(e) => setTagText(e.target.value)} aria-label="Schlagwörter" />
            <datalist id="tag-list">
              {tags.map((t) => (
                <option key={t} value={tagText.trim() ? `${tagText.replace(/[^,;]*$/, "").trim()} ${t}`.trim() : t} />
              ))}
            </datalist>
          </Field>
          <Field label="Studienbereich">
            <select value={areaId} onChange={(e) => setAreaId(e.target.value)} aria-label="Studienbereich">
              <option value="">Ohne Bereich</option>
              {areas.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {error && <p className="small notice notice-warn">{error}</p>}
      </div>
    </Dialog>
  );
}

/** Bearbeiten: diese Karte und ihre Geschwister anpassen; neue Lücken ergänzen, entfallene entfernen */
async function saveEdit(card: Card, n: { template: CardTemplate; front: string; back: string; fields: Record<string, string>; deck: string; tags: string; area_id: string | null }): Promise<Card> {
  const def = templateDef(n.template);
  const fieldsJson = JSON.stringify(Object.fromEntries(Object.entries(n.fields).filter(([, v]) => v.trim()).map(([k, v]) => [k, v.trim()])));
  const all = await api.cardsList({ limit: 20000 });
  const sib = card.note_key ? all.filter((c) => c.note_key === card.note_key) : [card];
  const patch = { template: n.template, kind: def.kind, front: n.front.trim(), back: n.back.trim(), fields: fieldsJson, deck: n.deck, tags: n.tags, area_id: n.area_id };
  if (n.template === "luecke") {
    const nums = clozeNumbers(n.front);
    const back = n.back.trim() || n.front.replace(/\{\{c\d{1,2}::([\s\S]*?)(?:::[\s\S]*?)?\}\}/g, "$1").trim();
    const key = card.note_key ?? (nums.length > 1 ? newId() : null);
    let mine: Card = card;
    // vorhandene Lücken anpassen
    for (const c of sib) {
      if (nums.includes(c.ord)) {
        const u = await api.cardUpdate(c.id, { ...patch, back });
        if (c.id === card.id) mine = u;
      }
    }
    // neue Lücken als neue Karten
    for (const ord of nums.filter((o) => !sib.some((c) => c.ord === o))) {
      const made = await api.cardCreate({ ...patch, back, note_key: key, ord, node_id: card.node_id, source_type: (card.source_type as NewCard["source_type"]) ?? null, source_id: card.source_id });
      if (card.template !== "luecke" && ord === nums[0]) mine = made;
    }
    // entfallene Lücken
    for (const c of sib.filter((c) => !nums.includes(c.ord))) await api.cardTrash(c.id);
    return mine;
  }
  let mine = card;
  for (const c of sib) {
    const u = await api.cardUpdate(c.id, patch);
    if (c.id === card.id) mine = u;
  }
  return mine;
}
