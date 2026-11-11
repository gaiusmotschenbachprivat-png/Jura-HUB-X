/** Karteninfo: Stand, Kennzahlen (FSRS) und alle bisherigen Bewertungen. */
import { useEffect, useState } from "react";

import { api } from "../../api";
import type { Card, ReviewLogEntry } from "../../api/types";
import { cardQuestion, templateDef } from "../../lib/cardModel";
import { deckOf, SEP } from "../../lib/decks";
import { formatDate } from "../../lib/format";
import { formatInterval, retrievability, STATE_LABEL } from "../../lib/fsrs";
import { reportError } from "../../state/store";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";

const RATING = ["", "Nochmal", "Schwer", "Gut", "Einfach"];
const TYPE = ["Lernen", "Lernen", "Wiederholung", "Neu lernen"];

export function CardInfoDialog({ card, onClose }: { card: Card; onClose: () => void }) {
  const [log, setLog] = useState<ReviewLogEntry[] | null>(null);
  useEffect(() => {
    void api.cardReviewLog(null, "1970-01-01T00:00:00Z").then((l) => setLog(l.filter((x) => x.card_id === card.id).reverse()), reportError);
  }, [card.id]);
  const r = retrievability(card);
  const total = (log ?? []).reduce((s, l) => s + l.duration_ms, 0);
  const rows: [string, string][] = [
    ["Stapel", deckOf(card).split(SEP).join(" › ")],
    ["Kartentyp", templateDef(card.template).label],
    ["Hinzugefügt", formatDate(card.created_at)],
    ["Erste Wiederholung", log?.length ? formatDate(log.at(-1)!.reviewed_at) : "–"],
    ["Letzte Wiederholung", card.last_review ? formatDate(card.last_review) : "–"],
    ["Fällig", card.state === 0 ? "neu" : formatDate(card.due)],
    ["Status", `${STATE_LABEL[card.state] ?? ""}${card.suspended ? " · ausgesetzt" : ""}${card.buried_until && card.buried_until > new Date().toISOString() ? " · zurückgestellt" : ""}`],
    ["Intervall", card.scheduled_days ? formatInterval(card.scheduled_days * 864e5) : "–"],
    ["Stabilität", card.stability ? formatInterval(card.stability * 864e5) : "–"],
    ["Schwierigkeit", card.state ? `${Math.round(((card.difficulty - 1) / 9) * 100)} %` : "–"],
    ["Abrufwahrscheinlichkeit", r == null ? "–" : `${Math.round(r * 100)} %`],
    ["Wiederholungen", String(card.reps)],
    ["Fehlversuche", String(card.lapses)],
    ["Durchschnittliche Zeit", log?.length ? `${Math.round(total / log.length / 1000)} s` : "–"],
    ["Gesamtzeit", log?.length ? formatInterval(Math.max(60000, total)) : "–"],
  ];
  return (
    <Dialog title="Karteninfo" onClose={onClose} width={620} footer={<Button onClick={onClose}>Schließen</Button>}>
      <p className="small ellipsis">
        <strong>{cardQuestion(card)}</strong>
      </p>
      <dl className="card-info">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd className="tnum">{v}</dd>
          </div>
        ))}
      </dl>
      <h3 className="label">Verlauf</h3>
      {log === null ? (
        <p className="xs muted">Lade …</p>
      ) : !log.length ? (
        <p className="xs muted">Noch nicht wiederholt.</p>
      ) : (
        <table className="card-log tnum">
          <thead>
            <tr>
              <th>Datum</th>
              <th>Art</th>
              <th>Bewertung</th>
              <th>Intervall</th>
              <th>Zeit</th>
            </tr>
          </thead>
          <tbody>
            {log.map((l) => (
              <tr key={l.id}>
                <td>{new Date(l.reviewed_at).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })}</td>
                <td>{TYPE[l.state_before] ?? ""}</td>
                <td className={`rating-${l.rating}`}>{RATING[l.rating]}</td>
                <td>{l.scheduled_days ? `${l.scheduled_days} T.` : "<1 T."}</td>
                <td>{l.duration_ms ? `${Math.round(l.duration_ms / 1000)} s` : "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Dialog>
  );
}
