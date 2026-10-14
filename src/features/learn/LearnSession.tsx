/**
 * Lernsitzung: fällige Karten nacheinander. Leertaste deckt auf, 1–4 bewertet.
 * Die nächste Fälligkeit berechnet FSRS (ts-fsrs); gespeichert wird im Kern.
 */
import { Pencil, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { api } from "../../api";
import type { Card } from "../../api/types";
import { previewIntervals, RATINGS, schedule, STATE_LABEL } from "../../lib/fsrs";
import { reportError, useApp } from "../../state/store";
import { Button, IconButton } from "../../ui/Button";
import { EmptyState } from "../../ui/misc";
import { CardDialog } from "./CardDialog";

export function LearnSession() {
  const areaId = useApp((s) => s.areaId);
  const open = useApp((s) => s.open);
  const bump = useApp((s) => s.bump);
  const [queue, setQueue] = useState<Card[] | null>(null);
  const [shown, setShown] = useState(false);
  const [done, setDone] = useState(0);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Card | null>(null);
  const [onlyDifficult, setOnlyDifficult] = useState(false);

  const load = useCallback(() => {
    api
      .cardsList({ area_id: areaId === "all" ? null : areaId, due_only: !onlyDifficult, difficult_only: onlyDifficult, limit: 500 })
      .then((cs) => setQueue(cs.filter((c) => !c.suspended)))
      .catch(reportError);
  }, [areaId, onlyDifficult]);
  useEffect(load, [load]);

  const card = queue?.[0];
  const preview = useMemo(() => (card ? previewIntervals(card) : null), [card]);

  const rate = useCallback(
    async (rating: 1 | 2 | 3 | 4) => {
      if (!card || busy) return;
      setBusy(true);
      try {
        const updated = await api.cardReview(card.id, schedule(card, rating));
        setDone((d) => d + 1);
        setShown(false);
        setQueue((q) => {
          const rest = (q ?? []).slice(1);
          // In der Lernphase kurz darauf erneut zeigen (wenn heute noch fällig)
          if (!onlyDifficult && Date.parse(updated.due) - Date.now() < 20 * 60000) return [...rest, updated];
          return rest;
        });
        bump();
      } catch (e) {
        reportError(e);
      } finally {
        setBusy(false);
      }
    },
    [card, busy, bump, onlyDifficult],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editing || (e.target as HTMLElement).closest("input, textarea, select")) return;
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        setShown(true);
      } else if (shown && ["1", "2", "3", "4"].includes(e.key)) {
        e.preventDefault();
        void rate(Number(e.key) as 1 | 2 | 3 | 4);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shown, rate, editing]);

  if (!queue) return <div className="loading">Lade Karten …</div>;

  return (
    <div className="page learn">
      <header className="page-head learn-head">
        <div className="row">
          <h1 className="page-title-static grow">Lernen</h1>
          <label className="small row">
            <input type="checkbox" checked={onlyDifficult} onChange={(e) => setOnlyDifficult(e.target.checked)} /> nur schwierige Karten üben
          </label>
          <IconButton label="Sitzung beenden" onClick={() => open({ type: "cards" })}>
            <X size={16} />
          </IconButton>
        </div>
        <div className="learn-progress">
          <div className="learn-bar" style={{ width: `${(done / Math.max(1, done + queue.length)) * 100}%` }} />
        </div>
        <div className="xs muted tnum">
          {done} erledigt · {queue.length} offen
        </div>
      </header>

      {!card ? (
        <EmptyState
          title={done ? "Für heute geschafft" : "Keine Karten fällig"}
          action={
            <div className="row" style={{ justifyContent: "center" }}>
              <Button onClick={() => open({ type: "cards" })}>Zu den Karteikarten</Button>
              {!onlyDifficult && <Button onClick={() => setOnlyDifficult(true)}>Schwierige Karten üben</Button>}
            </div>
          }
        >
          {done ? `${done} Wiederholungen erledigt. Die nächsten Karten werden fällig, wenn es für das Behalten sinnvoll ist.` : "Neue Karten legst du über „Karteikarten“, aus Definitionen oder aus markiertem Text an."}
        </EmptyState>
      ) : (
        <div className="flashcard-wrap">
          <div className="flashcard">
            <div className="fc-meta xs muted row">
              <span>{STATE_LABEL[card.state] ?? ""}</span>
              {card.tags && <span>· {card.tags}</span>}
              {card.difficult && <span className="status-pill is-warn">schwierig</span>}
              <span className="grow" />
              <IconButton label="Karte bearbeiten" onClick={() => setEditing(card)}>
                <Pencil size={14} />
              </IconButton>
            </div>
            <div className="fc-front">{card.front}</div>
            {shown ? (
              <>
                <hr />
                <div className="fc-back">{card.back}</div>
              </>
            ) : (
              <Button variant="primary" className="fc-reveal" onClick={() => setShown(true)}>
                Antwort zeigen <kbd className="kbd">Leertaste</kbd>
              </Button>
            )}
          </div>
          {shown && preview && (
            <div className="fc-ratings">
              {RATINGS.map((r) => (
                <button key={r.rating} className={`fc-rate r${r.rating}`} onClick={() => void rate(r.rating)} disabled={busy}>
                  <strong>{r.label}</strong>
                  <span className="xs">{preview[r.rating]}</span>
                  <kbd className="kbd">{r.key}</kbd>
                </button>
              ))}
            </div>
          )}
          <p className="xs muted" style={{ textAlign: "center" }}>
            Ehrlich bewerten: „Nochmal“, wenn du die Antwort nicht wusstest. Die Planung folgt dem FSRS-Verfahren mit 90 % Zielbehaltensquote.
          </p>
        </div>
      )}
      {editing && (
        <CardDialog
          card={editing}
          onClose={() => setEditing(null)}
          onSaved={(c) => setQueue((q) => (q ?? []).map((x) => (x.id === c.id ? c : x)))}
        />
      )}
    </div>
  );
}
