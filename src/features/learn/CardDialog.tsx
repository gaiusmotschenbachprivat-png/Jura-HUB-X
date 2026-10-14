import { useState } from "react";

import { api, errorMessage } from "../../api";
import type { Card, CardKind, NewCard } from "../../api/types";
import { useApp } from "../../state/store";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { Field } from "../../ui/misc";

export const CARD_KIND_LABEL: Record<CardKind, string> = {
  frage: "Frage – Antwort",
  definition: "Begriff – Definition",
  norm: "Gesetzesfundstelle",
};

/** Karteikarte anlegen (initial) oder bearbeiten (card). */
export function CardDialog({
  initial,
  card,
  onClose,
  onSaved,
}: {
  initial?: Partial<NewCard>;
  card?: Card;
  onClose: () => void;
  onSaved?: (c: Card) => void;
}) {
  const areas = useApp((s) => s.areas);
  const currentArea = useApp((s) => s.areaId);
  const toast = useApp((s) => s.toast);
  const bump = useApp((s) => s.bump);
  const [front, setFront] = useState(card?.front ?? initial?.front ?? "");
  const [back, setBack] = useState(card?.back ?? initial?.back ?? "");
  const [kind, setKind] = useState<CardKind>(card?.kind ?? initial?.kind ?? "frage");
  const [tags, setTags] = useState(card?.tags ?? initial?.tags ?? "");
  const [areaId, setAreaId] = useState<string>(card?.area_id ?? initial?.area_id ?? (currentArea === "all" ? "" : currentArea));
  const [error, setError] = useState<string | null>(null);
  const [another, setAnother] = useState(false);

  const save = async () => {
    try {
      const saved = card
        ? await api.cardUpdate(card.id, { front, back, kind, tags, area_id: areaId || null })
        : await api.cardCreate({ ...initial, front, back, kind, tags, area_id: areaId || null });
      bump();
      onSaved?.(saved);
      if (!card && another) {
        toast("Karte gespeichert.", "success");
        setFront("");
        setBack("");
        setError(null);
        return;
      }
      toast(card ? "Karte gespeichert." : "Karteikarte angelegt.", "success");
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const labels = kind === "definition" ? ["Begriff", "Definition"] : kind === "norm" ? ["Norm / Frage", "Inhalt, Voraussetzungen, Rechtsfolge"] : ["Frage", "Antwort"];

  return (
    <Dialog
      title={card ? "Karteikarte bearbeiten" : "Neue Karteikarte"}
      onClose={onClose}
      width={620}
      footer={
        <>
          {!card && (
            <label className="row small grow">
              <input type="checkbox" checked={another} onChange={(e) => setAnother(e.target.checked)} /> danach weitere Karte anlegen
            </label>
          )}
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" onClick={save} disabled={!front.trim() || !back.trim()}>
            Speichern
          </Button>
        </>
      }
    >
      <div className="stack">
        <div className="row2">
          <Field label="Art">
            <select value={kind} onChange={(e) => setKind(e.target.value as CardKind)}>
              {Object.entries(CARD_KIND_LABEL).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Studienbereich">
            <select value={areaId} onChange={(e) => setAreaId(e.target.value)}>
              <option value="">Alle Bereiche</option>
              {areas.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label={`Vorderseite: ${labels[0]}`}>
          <textarea rows={3} autoFocus value={front} onChange={(e) => setFront(e.target.value)} />
        </Field>
        <Field label={`Rückseite: ${labels[1]}`}>
          <textarea rows={6} value={back} onChange={(e) => setBack(e.target.value)} />
        </Field>
        <Field label="Schlagwörter" hint="Mit Komma trennen, z. B. „BGB AT, Anfechtung“">
          <input value={tags} onChange={(e) => setTags(e.target.value)} />
        </Field>
        {error && <p className="error-text small">{error}</p>}
      </div>
    </Dialog>
  );
}
