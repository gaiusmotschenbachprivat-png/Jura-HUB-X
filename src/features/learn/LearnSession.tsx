/**
 * Lernsitzung eines Stapels: zuerst fällige Lernkarten, dann Wiederholungen
 * und neue Karten bis zum Tageslimit. Leertaste deckt auf (und bewertet danach
 * mit „Gut“), 1–4 bewertet, E bearbeitet, Z macht rückgängig, „-“ stellt
 * zurück, „@“ setzt aus, I zeigt die Karteninfo. Die nächste Fälligkeit
 * berechnet FSRS mit den Optionen des Stapels; gespeichert wird im Kern.
 */
import { Flag, Info, MoreHorizontal, Pencil, Undo2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api } from "../../api";
import type { Card, CardKind } from "../../api/types";
import {
  addTag,
  applyLimits,
  becameLeech,
  buildQueue,
  cardStatus,
  deckName,
  deckOf,
  inDeck,
  LEECH_TAG,
  nextCard,
  optionsFor,
  SEP,
  staysToday,
  todayUsage,
  tomorrow,
  type CustomStudy,
  type DeckSettings,
} from "../../lib/decks";
import { formatInterval, previewIntervals, RATINGS, schedule, startOfToday } from "../../lib/fsrs";
import { descendantIds } from "../../lib/learnStats";
import { reportError, useApp } from "../../state/store";
import { Button, IconButton } from "../../ui/Button";
import { useMenu } from "../../ui/Menu";
import { EmptyState } from "../../ui/misc";
import { CardDialog } from "./CardDialog";
import { CardAnswer, CardQuestion } from "./CardFace";
import { CardInfoDialog } from "./CardInfo";
import { loadDeckSettings } from "./collection";
import { DeckOptionsDialog } from "./DeckOptions";
import { FLAGS } from "./flags";

type Step =
  | { type: "review"; before: Card; after: Card; buried: Card[]; leech: boolean }
  | { type: "bury" | "suspend"; cards: Card[] };

const MAX_ANSWER_MS = 60_000;

export function LearnSession({
  deck,
  kind,
  node,
  label,
  minutes,
  custom,
}: { deck?: string; kind?: CardKind; node?: string; label?: string; minutes?: number; custom?: CustomStudy } = {}) {
  const areaId = useApp((s) => s.areaId);
  const nodes = useApp((s) => s.nodes);
  const open = useApp((s) => s.open);
  const bump = useApp((s) => s.bump);
  const toast = useApp((s) => s.toast);
  const menu = useMenu();
  const [settings, setSettings] = useState<DeckSettings | null>(null);
  const [learning, setLearning] = useState<Card[] | null>(null);
  const [main, setMain] = useState<Card[]>([]);
  const [revealed, setRevealed] = useState(false);
  const [typed, setTyped] = useState("");
  const [step, setStep] = useState<number | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<Step[]>([]);
  const [done, setDone] = useState({ n: 0, ok: 0, ms: 0 });
  const [editing, setEditing] = useState<Card | null>(null);
  const [info, setInfo] = useState<Card | null>(null);
  const [options, setOptions] = useState<string | null>(null);
  const [ahead, setAhead] = useState(false);
  const shownAt = useRef(Date.now());
  const scope = useMemo(() => (node ? descendantIds(nodes, node) : null), [nodes, node]);

  const load = useCallback(async () => {
    try {
      const s = await loadDeckSettings();
      setSettings(s);
      const area = areaId === "all" || node ? null : areaId;
      const now = new Date();
      const all = (await api.cardsList({ area_id: area, limit: 20000 })).filter(
        (c) => !c.suspended && (!deck || inDeck(deckOf(c), deck)) && (!kind || c.kind === kind) && (!scope || (c.node_id != null && scope.has(c.node_id))),
      );
      if (custom || ahead) {
        let list: Card[] = [];
        const nowIso = now.toISOString();
        const notBuried = all.filter((c) => cardStatus(c, nowIso) !== "buried");
        const m = ahead ? ({ mode: "ahead", days: 7 } as CustomStudy) : custom!;
        if (m.mode === "new") list = notBuried.filter((c) => c.state === 0).sort((a, b) => a.created_at.localeCompare(b.created_at) || a.ord - b.ord).slice(0, m.count);
        else if (m.mode === "ahead") {
          const until = new Date(now.getTime() + m.days * 864e5).toISOString();
          list = notBuried.filter((c) => c.state !== 0 && c.due <= until).sort((a, b) => a.due.localeCompare(b.due)).slice(0, 200);
        } else if (m.mode === "forgotten") {
          const log = await api.cardReviewLog(area, new Date(now.getTime() - m.days * 864e5).toISOString());
          const ids = new Set(log.filter((l) => l.rating === 1).map((l) => l.card_id));
          list = notBuried.filter((c) => ids.has(c.id));
        } else if (m.mode === "tag") list = notBuried.filter((c) => c.tags.toLowerCase().split(/[,;]/).some((t) => t.trim() === m.tag.toLowerCase()));
        else if (m.mode === "flag") list = notBuried.filter((c) => c.flag === m.flag);
        else if (m.mode === "difficult") list = notBuried.filter((c) => c.difficult);
        else list = notBuried;
        setLearning([]);
        setMain(list.sort((a, b) => a.due.localeCompare(b.due)));
        return;
      }
      const log = await api.cardReviewLog(area, startOfToday());
      const usage = todayUsage(log, new Map(all.map((c) => [c.id, c])), startOfToday());
      const nowIso = now.toISOString();
      const end = tomorrow(now);
      const fresh = applyLimits(
        all.filter((c) => cardStatus(c, nowIso) === "new").sort((a, b) => a.created_at.localeCompare(b.created_at) || a.ord - b.ord),
        "new",
        s,
        usage,
        deck,
      );
      const reviews = applyLimits(
        all.filter((c) => cardStatus(c, nowIso) === "review" && c.due <= end).sort((a, b) => a.due.localeCompare(b.due)),
        "review",
        s,
        usage,
        deck,
      );
      const opts = optionsFor(s, deck ?? "");
      const q = buildQueue([...fresh, ...reviews, ...all.filter((c) => cardStatus(c, nowIso) === "learn")], now, { newLeft: Infinity, reviewsLeft: Infinity }, opts);
      setLearning(q.learning);
      setMain(q.main);
    } catch (e) {
      reportError(e);
    }
  }, [areaId, node, deck, kind, scope, custom, ahead]);
  useEffect(() => {
    void load();
  }, [load]);

  // Lernkarten werden mit der Zeit fällig: regelmäßig neu wählen
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 15000);
    return () => clearInterval(t);
  }, []);

  // Lernrunde mit Zeitlimit
  const [endAt] = useState(() => (minutes ? Date.now() + minutes * 60000 : null));
  useEffect(() => {
    if (!endAt) return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [endAt]);
  const left = endAt ? Math.max(0, endAt - Date.now()) : null;
  const timeUp = left === 0;

  const current = useMemo(() => (learning && !timeUp ? nextCard(learning, main, new Date()) : null), [learning, main, timeUp, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const card = current?.card;
  const opts = useMemo(() => (settings && card ? optionsFor(settings, deckOf(card)) : null), [settings, card]);
  const preview = useMemo(() => (card && opts ? previewIntervals(card, new Date(), opts) : null), [card, opts]);
  useEffect(() => {
    shownAt.current = Date.now();
    setRevealed(false);
    setTyped("");
    setStep(card?.template === "schema" ? 0 : undefined);
  }, [card?.id, card?.reps]);
  useEffect(() => {
    if (minutes && learning && !learning.length && !main.length && !ahead && !done.n) setAhead(true);
  }, [minutes, learning, main, ahead, done.n]);

  const remove = (ids: Set<string>) => {
    setMain((m) => m.filter((c) => !ids.has(c.id)));
    setLearning((l) => (l ?? []).filter((c) => !ids.has(c.id)));
  };

  const rate = useCallback(
    async (rating: 1 | 2 | 3 | 4) => {
      if (!card || busy || !opts) return;
      setBusy(true);
      const now = new Date();
      const duration = Math.min(MAX_ANSWER_MS, Date.now() - shownAt.current);
      try {
        let updated = await api.cardReview(card.id, { ...schedule(card, rating, now, opts), duration_ms: duration });
        // Problemkarte
        let leech = false;
        if (becameLeech(card, updated, opts.leechThreshold)) {
          leech = true;
          updated = await api.cardUpdate(card.id, { tags: addTag(updated.tags, LEECH_TAG), ...(opts.leechAction === "suspend" ? { suspended: true } : {}) });
          toast(`Problemkarte: schon ${updated.lapses}-mal vergessen. Am besten umformulieren, aufteilen oder mit einem Beispiel ergänzen.`, "info");
        }
        // zusammengehörige Karten auf morgen
        let buried: Card[] = [];
        if (opts.burySiblings && card.note_key) {
          buried = main.filter((c) => c.note_key === card.note_key && c.id !== card.id);
          for (const b of buried) await api.cardUpdate(b.id, { buried_until: tomorrow(now) });
        }
        const gone = new Set([card.id, ...buried.map((b) => b.id)]);
        setMain((m) => m.filter((c) => !gone.has(c.id)));
        setLearning((l) => {
          const rest = (l ?? []).filter((c) => !gone.has(c.id));
          return staysToday(updated, now) && !updated.suspended ? [...rest, updated] : rest;
        });
        setHistory((h) => [...h, { type: "review", before: card, after: updated, buried, leech }]);
        setDone((d) => ({ n: d.n + 1, ok: d.ok + (rating > 1 ? 1 : 0), ms: d.ms + duration }));
        bump();
      } catch (e) {
        reportError(e);
      } finally {
        setBusy(false);
      }
    },
    [card, busy, opts, main, bump, toast],
  );

  const undo = useCallback(async () => {
    const last = history.at(-1);
    if (!last || busy) return;
    setBusy(true);
    try {
      if (last.type === "review") {
        let restored = await api.cardUndoReview(last.before.id);
        if (last.leech) restored = await api.cardUpdate(restored.id, { tags: last.before.tags, suspended: last.before.suspended });
        for (const b of last.buried) await api.cardUpdate(b.id, { buried_until: null });
        setLearning((l) => (l ?? []).filter((c) => c.id !== restored.id));
        setMain((m) => [restored, ...last.buried, ...m.filter((c) => c.id !== restored.id)]);
        setDone((d) => ({ n: Math.max(0, d.n - 1), ok: d.ok, ms: d.ms }));
      } else {
        const back: Card[] = [];
        for (const c of last.cards) back.push(await api.cardUpdate(c.id, last.type === "bury" ? { buried_until: null } : { suspended: false }));
        setMain((m) => [...back, ...m]);
      }
      setHistory((h) => h.slice(0, -1));
      toast("Rückgängig gemacht.", "info");
      bump();
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(false);
    }
  }, [history, busy, bump, toast]);

  const bury = useCallback(
    async (whole: boolean) => {
      if (!card) return;
      const list = whole && card.note_key ? [card, ...main.filter((c) => c.note_key === card.note_key && c.id !== card.id)] : [card];
      try {
        for (const c of list) await api.cardUpdate(c.id, { buried_until: tomorrow(new Date()) });
        remove(new Set(list.map((c) => c.id)));
        setHistory((h) => [...h, { type: "bury", cards: list }]);
        toast(list.length > 1 ? "Eintrag bis morgen zurückgestellt." : "Karte bis morgen zurückgestellt.", "info");
        bump();
      } catch (e) {
        reportError(e);
      }
    },
    [card, main, bump, toast],
  );
  const suspend = useCallback(async () => {
    if (!card) return;
    try {
      await api.cardUpdate(card.id, { suspended: true });
      remove(new Set([card.id]));
      setHistory((h) => [...h, { type: "suspend", cards: [card] }]);
      toast("Karte ausgesetzt – sie kommt erst wieder, wenn du sie im Kartenbrowser fortsetzt.", "info");
      bump();
    } catch (e) {
      reportError(e);
    }
  }, [card, bump, toast]);
  const setFlag = useCallback(
    async (flag: number) => {
      if (!card) return;
      try {
        const u = await api.cardUpdate(card.id, { flag: card.flag === flag ? 0 : flag });
        const swap = (l: Card[]) => l.map((c) => (c.id === u.id ? u : c));
        setMain(swap);
        setLearning((l) => swap(l ?? []));
        bump();
      } catch (e) {
        reportError(e);
      }
    },
    [card, bump],
  );

  const cardMenu = (el: HTMLElement) =>
    card &&
    menu.openBelow(el, [
      { label: "Karte bearbeiten (E)", onSelect: () => setEditing(card) },
      { label: "Karteninfo (I)", onSelect: () => setInfo(card) },
      { separator: true, label: "" },
      { label: "Karte zurückstellen (−)", onSelect: () => void bury(false) },
      ...(card.note_key ? [{ label: "Eintrag zurückstellen (=)", onSelect: () => void bury(true) }] : []),
      { label: "Karte aussetzen (@)", onSelect: () => void suspend() },
      { separator: true, label: "" },
      { label: `Optionen für „${deckName(deckOf(card))}“ …`, onSelect: () => setOptions(deckOf(card)) },
    ]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editing || info || options || (e.target as HTMLElement).closest("input, textarea, select, [contenteditable]")) return;
      const k = e.key;
      if ((e.metaKey || e.ctrlKey) && k.toLowerCase() === "z") {
        e.preventDefault();
        void undo();
      } else if ((e.metaKey || e.ctrlKey) && /^[1-7]$/.test(k)) {
        e.preventDefault();
        void setFlag(Number(k));
      } else if (k === " " || k === "Enter") {
        e.preventDefault();
        if (!revealed) setRevealed(true);
        else void rate(3);
      } else if (revealed && ["1", "2", "3", "4"].includes(k)) {
        e.preventDefault();
        void rate(Number(k) as 1 | 2 | 3 | 4);
      } else if (k === "z") void undo();
      else if (k === "e" && card) setEditing(card);
      else if (k === "i" && card) setInfo(card);
      else if (k === "-") void bury(false);
      else if (k === "=") void bury(true);
      else if (k === "@") void suspend();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [revealed, rate, undo, bury, suspend, setFlag, editing, info, options, card]);

  if (!learning) return <div className="loading">Lade Karten …</div>;

  const nowIso = new Date().toISOString();
  const counts = {
    new: main.filter((c) => c.state === 0).length,
    learn: learning.length,
    review: main.filter((c) => c.state !== 0).length,
  };
  const which = !card ? null : current?.from === "learning" ? "learn" : card.state === 0 ? "new" : "review";
  const nextLearn = learning.filter((c) => c.due > nowIso).sort((a, b) => a.due.localeCompare(b.due))[0];
  const title = deck ? deck.split(SEP).join(" › ") : (label ?? "Alle Stapel");
  const flag = card ? FLAGS.find((f) => f.id === card.flag) : undefined;

  return (
    <div className="page learn">
      <header className="page-head learn-head">
        <div className="row">
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="small muted">Lernen{custom ? " · benutzerdefiniert" : ahead ? " · vorziehen" : ""}</div>
            <h1 className="page-title-static ellipsis">{title}</h1>
          </div>
          <IconButton label="Rückgängig (Z)" disabled={!history.length || busy} onClick={() => void undo()}>
            <Undo2 size={16} />
          </IconButton>
          <IconButton label="Sitzung beenden" onClick={() => open({ type: "cards", deck })}>
            <X size={16} />
          </IconButton>
        </div>
        <div className="learn-counts tnum" aria-label="Noch anstehend">
          <span className={`cnt-new ${which === "new" ? "is-current" : ""}`} title="Neu">
            {counts.new}
          </span>
          <span className={`cnt-learn ${which === "learn" ? "is-current" : ""}`} title="Lernen">
            {counts.learn}
          </span>
          <span className={`cnt-review ${which === "review" ? "is-current" : ""}`} title="Fällig">
            {counts.review}
          </span>
          {left !== null && <span className="xs muted">noch {Math.floor(left / 60000)}:{String(Math.floor((left % 60000) / 1000)).padStart(2, "0")} Min.</span>}
          <span className="grow" />
          <span className="xs muted">{done.n ? `${done.n} heute in dieser Sitzung` : ""}</span>
        </div>
        <div className="learn-progress">
          <div className="learn-bar" style={{ width: `${(done.n / Math.max(1, done.n + counts.new + counts.learn + counts.review)) * 100}%` }} />
        </div>
      </header>

      {!card ? (
        <EmptyState
          title={timeUp ? `${minutes} Minuten geschafft` : done.n || history.length ? "Glückwunsch – für heute geschafft!" : "Gerade nichts zu lernen"}
          action={
            <div className="row wrap" style={{ justifyContent: "center" }}>
              <Button variant="primary" onClick={() => open({ type: "cards", deck })}>
                Zur Stapelübersicht
              </Button>
              {!custom && !ahead && (
                <Button onClick={() => setAhead(true)}>Karten der nächsten 7 Tage vorziehen</Button>
              )}
            </div>
          }
        >
          {done.n > 0 && (
            <>
              {done.n} {done.n === 1 ? "Karte" : "Karten"} in {formatInterval(Math.max(60000, done.ms))} · {Math.round((done.ok / done.n) * 100)} % gewusst.{" "}
            </>
          )}
          {nextLearn
            ? `Lernkarten sind in ${formatInterval(Date.parse(nextLearn.due) - Date.now())} wieder dran – lass die App einfach offen oder komm später zurück.`
            : "Die nächsten Karten werden fällig, wenn es für das Behalten sinnvoll ist."}
        </EmptyState>
      ) : (
        <div className="flashcard-wrap">
          <div className={`flashcard tpl-${card.template}`} style={flag ? { ["--flag" as string]: flag.color } : undefined}>
            <div className="fc-meta xs muted row">
              <span className="ellipsis">{deckOf(card).split(SEP).join(" › ")}</span>
              {card.tags && <span className="ellipsis">· {card.tags}</span>}
              <span className="grow" />
              {flag && <Flag size={14} className="fc-flag" aria-label={`Flagge ${flag.label}`} fill={flag.color} color={flag.color} />}
              <IconButton
                label="Flagge"
                onClick={(e) =>
                  menu.openBelow(e.currentTarget, [
                    ...FLAGS.filter((f) => f.id).map((f) => ({ label: `${card.flag === f.id ? "✓ " : ""}${f.label} (${f.id})`, icon: <span className="flag-dot" style={{ background: f.color }} />, onSelect: () => void setFlag(f.id) })),
                    ...(card.flag ? [{ separator: true, label: "" }, { label: "Flagge entfernen", onSelect: () => void setFlag(card.flag) }] : []),
                  ])
                }
              >
                <Flag size={14} />
              </IconButton>
              <IconButton label="Karteninfo (I)" onClick={() => setInfo(card)}>
                <Info size={14} />
              </IconButton>
              <IconButton label="Karte bearbeiten (E)" onClick={() => setEditing(card)}>
                <Pencil size={14} />
              </IconButton>
              <IconButton label="Mehr" onClick={(e) => cardMenu(e.currentTarget)}>
                <MoreHorizontal size={14} />
              </IconButton>
            </div>
            <CardQuestion card={card} typed={typed} onTyped={revealed ? undefined : setTyped} />
            {revealed ? (
              <>
                <hr />
                <CardAnswer card={card} typed={typed} step={step} onStep={setStep} />
              </>
            ) : (
              <div className="row fc-reveal-row">
                {card.template === "schema" && (
                  <Button
                    onClick={() => {
                      setStep(1);
                      setRevealed(true);
                    }}
                  >
                    Punkt für Punkt
                  </Button>
                )}
                <Button
                  variant="primary"
                  className="fc-reveal"
                  onClick={() => {
                    setStep(undefined);
                    setRevealed(true);
                  }}
                >
                  Antwort zeigen <kbd className="kbd">Leertaste</kbd>
                </Button>
              </div>
            )}
          </div>
          {revealed && preview && (
            <div className="fc-ratings">
              {RATINGS.map((r) => (
                <button key={r.rating} className={`fc-rate r${r.rating}`} onClick={() => void rate(r.rating)} disabled={busy}>
                  <span className="xs fc-ivl">{preview[r.rating]}</span>
                  <strong>{r.label}</strong>
                  <kbd className="kbd">{r.key}</kbd>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {editing && (
        <CardDialog
          card={editing}
          onClose={() => setEditing(null)}
          onSaved={(c) => {
            const swap = (l: Card[]) => l.map((x) => (x.id === c.id ? c : x));
            setMain(swap);
            setLearning((l) => swap(l ?? []));
          }}
        />
      )}
      {info && <CardInfoDialog card={info} onClose={() => setInfo(null)} />}
      {options && <DeckOptionsDialog deck={options} onClose={() => setOptions(null)} onSaved={(s) => setSettings(s)} />}
      {menu.el}
    </div>
  );
}
