/**
 * „Stapel wiederholen“: einen Stapel durchgehen, auch wenn die Karten erst
 * später fällig wären. Standard ist eine Übungsrunde, die die Planung nicht
 * verändert; wahlweise zählen die Antworten wie beim normalen Lernen.
 */
import { useMemo, useState } from "react";

import type { Card } from "../../api/types";
import { DEFAULT_REPEAT, deckOf, inDeck, repeatList, SEP, type RepeatOptions } from "../../lib/decks";
import { useApp } from "../../state/store";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";

export function RepeatDialog({ deck, cards, onClose, initial }: { deck: string; cards: Card[]; onClose: () => void; initial?: Partial<RepeatOptions> }) {
  const open = useApp((s) => s.open);
  const [r, setR] = useState<RepeatOptions>({ ...DEFAULT_REPEAT, ...initial });
  const mine = useMemo(() => cards.filter((c) => inDeck(deckOf(c), deck)), [cards, deck]);
  const count = useMemo(() => repeatList(mine, r, new Date(), () => 0).length, [mine, r]);
  const set = <K extends keyof RepeatOptions>(k: K, v: RepeatOptions[K]) => setR((o) => ({ ...o, [k]: v }));
  const start = () => {
    onClose();
    open({ type: "learn", deck, custom: { mode: "repeat", ...r } });
  };
  const WHICH: [RepeatOptions["which"], string][] = [
    ["all", "Alle Karten des Stapels (auch neue)"],
    ["learned", "Nur schon gelernte Karten"],
    ["soon", "Nur Karten, die bald fällig werden"],
  ];
  return (
    <Dialog
      title="Stapel wiederholen"
      onClose={onClose}
      width={520}
      footer={
        <>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" onClick={start} disabled={!count}>
            {count ? `${count} ${count === 1 ? "Karte" : "Karten"} wiederholen` : "Keine Karten"}
          </Button>
        </>
      }
    >
      <p className="xs muted">
        Stapel „{deck.split(SEP).join(" › ")}“ – unabhängig davon, wann die Karten eigentlich wieder dran wären. Ausgesetzte und zurückgestellte Karten bleiben außen vor.
      </p>
      <fieldset className="repeat-group">
        <legend className="label">Welche Karten?</legend>
        {WHICH.map(([w, l]) => (
          <label key={w} className="row small">
            <input type="radio" name="repeat-which" checked={r.which === w} onChange={() => set("which", w)} /> {l}
          </label>
        ))}
        {r.which === "soon" && (
          <label className="row small repeat-days">
            fällig in den nächsten
            <input type="number" inputMode="numeric" min={1} max={3650} value={r.days} onChange={(e) => set("days", Math.max(1, Number(e.target.value) || 1))} aria-label="Tage" />
            Tagen
          </label>
        )}
      </fieldset>
      <fieldset className="repeat-group">
        <legend className="label">Reihenfolge</legend>
        <label className="row small">
          <input type="radio" name="repeat-order" checked={r.order === "random"} onChange={() => set("order", "random")} /> Gemischt
        </label>
        <label className="row small">
          <input type="radio" name="repeat-order" checked={r.order === "due"} onChange={() => set("order", "due")} /> Bald fällige zuerst
        </label>
      </fieldset>
      <fieldset className="repeat-group">
        <legend className="label">Planung</legend>
        <label className="row small">
          <input type="radio" name="repeat-plan" checked={r.practice} onChange={() => set("practice", true)} /> Nur üben – die Planung bleibt, wie sie ist
        </label>
        <label className="row small">
          <input type="radio" name="repeat-plan" checked={!r.practice} onChange={() => set("practice", false)} /> Antworten zählen – die nächsten Termine werden neu berechnet
        </label>
        <p className="xs muted">
          {r.practice
            ? "„Nochmal“ bringt die Karte nach drei Karten wieder, „Schwer“ am Ende der Runde, „Gut“ und „Einfach“ nehmen sie heraus. Die Statistik bleibt unberührt."
            : "Wie beim normalen Lernen: FSRS berücksichtigt, dass die Karte früher als geplant wiederholt wurde. Vor einer Klausur sinnvoll, sonst lieber nur üben."}
        </p>
      </fieldset>
    </Dialog>
  );
}
