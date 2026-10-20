/**
 * Prüfungsschema lernen.
 *  - „Reihenfolge“: Die Prüfungspunkte liegen gemischt da und werden in der
 *    richtigen Reihenfolge angetippt (iPad-freundlich, ohne Tippen).
 *  - „Abfragen“: Punkt für Punkt aus dem Gedächtnis (Lückentext). Eine Eingabe
 *    ist freiwillig; die App vergleicht grob, entscheidet aber nicht – „gewusst“
 *    oder „nicht gewusst“ wählt man selbst.
 * Das letzte Ergebnis wird je Schema gemerkt (Einstellung `learn.schema.<id>`).
 */
import { ArrowLeft, Check, Eye, RotateCcw, Shuffle, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { api, errorMessage } from "../../api";
import type { Knowledge, SchemaData } from "../../api/types";
import { judgeAnswer, quizPoints, quizSummary, shuffled, type QuizPoint, type Verdict } from "../../lib/schemaQuiz";
import { useApp } from "../../state/store";
import { Button } from "../../ui/Button";
import { EmptyState } from "../../ui/misc";

type Mode = "reihenfolge" | "abfragen";

export interface SchemaResult {
  at: string;
  mode: Mode;
  known: number;
  total: number;
}

export const schemaResultKey = (id: string) => `learn.schema.${id}`;

async function saveResult(id: string, r: SchemaResult) {
  await api.settingSet(schemaResultKey(id), r).catch(() => {});
}

export function SchemaTrainer({ id }: { id: string }) {
  const open = useApp((s) => s.open);
  const [k, setK] = useState<Knowledge | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("reihenfolge");
  const [onlyMain, setOnlyMain] = useState(false);
  const [round, setRound] = useState(0);
  const [only, setOnly] = useState<string[] | null>(null);

  useEffect(() => {
    api
      .knowledgeGet(id)
      .then(setK)
      .catch((e) => setError(errorMessage(e)));
  }, [id]);

  const all = useMemo(() => (k ? quizPoints((k.data as unknown as SchemaData).items ?? []) : []), [k]);
  const points = useMemo(() => {
    let p = onlyMain ? all.filter((x) => x.depth === 0) : all;
    if (only) p = p.filter((x) => only.includes(x.id));
    return p;
  }, [all, onlyMain, only]);

  if (error) return <EmptyState title="Schema nicht verfügbar">{error}</EmptyState>;
  if (!k) return <div className="loading">Lade Schema …</div>;
  const norm = (k.data as unknown as SchemaData).norm;
  const restart = (opts: { only?: string[] | null } = {}) => {
    setOnly(opts.only ?? null);
    setRound((r) => r + 1);
  };

  return (
    <div className="page schema-train">
      <header className="page-head">
        <div className="small muted row">
          <button className="link-btn" onClick={() => open({ type: "knowledge", id: k.id }, { title: k.title })}>
            <ArrowLeft size={12} /> zum Schema
          </button>
        </div>
        <h1 className="page-title-static">{k.title} üben</h1>
        {norm && <div className="small muted">{norm}</div>}
        <div className="row wrap">
          <div className="seg" role="tablist" aria-label="Übungsart">
            <button role="tab" aria-selected={mode === "reihenfolge"} className={mode === "reihenfolge" ? "is-active" : ""} onClick={() => (setMode("reihenfolge"), restart())}>
              <Shuffle size={14} /> Reihenfolge
            </button>
            <button role="tab" aria-selected={mode === "abfragen"} className={mode === "abfragen" ? "is-active" : ""} onClick={() => (setMode("abfragen"), restart())}>
              <Eye size={14} /> Abfragen
            </button>
          </div>
          {all.some((p) => p.depth > 0) && (
            <label className="row small">
              <input type="checkbox" checked={onlyMain} onChange={(e) => (setOnlyMain(e.target.checked), restart())} /> nur Hauptpunkte
            </label>
          )}
          <span className="grow" />
          <Button variant="ghost" icon={<RotateCcw size={14} />} onClick={() => restart()}>
            Neu beginnen
          </Button>
        </div>
      </header>
      {points.length < 2 ? (
        <EmptyState title="Zu wenige Prüfungspunkte" action={<Button onClick={() => open({ type: "knowledge", id: k.id })}>Schema bearbeiten</Button>}>
          Zum Üben braucht das Schema mindestens zwei ausgefüllte Prüfungspunkte.
        </EmptyState>
      ) : mode === "reihenfolge" ? (
        <OrderGame key={`o${round}`} points={points} onDone={(r) => void saveResult(k.id, r)} />
      ) : (
        <RecallGame key={`r${round}`} points={points} onDone={(r) => void saveResult(k.id, r)} onRetry={(missed) => restart({ only: missed })} />
      )}
      <p className="xs muted schema-train-hint">Ein Schema ist eine Arbeitshilfe und keine allgemeingültige Vorgabe. Geübt wird dein eigenes Schema.</p>
    </div>
  );
}

/** Punkte in der richtigen Reihenfolge antippen. */
function OrderGame({ points, onDone }: { points: QuizPoint[]; onDone: (r: SchemaResult) => void }) {
  const [pool, setPool] = useState(() => shuffled(points));
  const [placed, setPlaced] = useState<QuizPoint[]>([]);
  const [wrong, setWrong] = useState<string | null>(null);
  const [mistakes, setMistakes] = useState(0);
  const [missedIds, setMissedIds] = useState<Set<string>>(new Set());
  const done = placed.length === points.length;
  const next = points[placed.length];

  useEffect(() => {
    if (done) onDone({ at: new Date().toISOString(), mode: "reihenfolge", known: points.length - missedIds.size, total: points.length });
    // nur beim Abschluss
  }, [done]);

  const tap = (p: QuizPoint) => {
    if (!next) return;
    // Gleichlautende Punkte (z. B. zweimal „Rechtsfolge“) sind austauschbar
    if (p.id === next.id || p.text === next.text) {
      setPlaced((l) => [...l, next]);
      setPool((l) => {
        const i = l.findIndex((x) => x.id === p.id);
        return l.filter((_, k) => k !== i);
      });
      setWrong(null);
    } else {
      setWrong(p.id);
      setMistakes((m) => m + 1);
      setMissedIds((s) => new Set(s).add(next.id));
      setTimeout(() => setWrong((w) => (w === p.id ? null : w)), 600);
    }
  };

  return (
    <div className="quiz">
      <div className="quiz-outline" aria-label="Gelegte Reihenfolge">
        {placed.map((p) => (
          <div key={p.id} className="quiz-line is-placed" style={{ paddingLeft: p.depth * 22 }}>
            <span className="schema-num tnum">{p.label}</span> {p.text}
          </div>
        ))}
        {!done && next && (
          <div className="quiz-line is-next" style={{ paddingLeft: next.depth * 22 }}>
            <span className="schema-num tnum">{next.label}</span> <span className="muted">Welcher Punkt kommt jetzt?</span>
          </div>
        )}
      </div>
      {done ? (
        <div className="quiz-result">
          <Check size={18} /> <strong>Reihenfolge vollständig.</strong> {mistakes === 0 ? "Ohne Fehler!" : `${mistakes} Fehlversuch${mistakes === 1 ? "" : "e"}.`}
        </div>
      ) : (
        <div className="quiz-pool" aria-label="Prüfungspunkte zur Auswahl">
          {pool.map((p) => (
            <button key={p.id} className={`quiz-chip ${wrong === p.id ? "is-wrong" : ""}`} onClick={() => tap(p)}>
              {p.text}
            </button>
          ))}
        </div>
      )}
      <div className="xs muted tnum">
        {placed.length} / {points.length} gelegt · {mistakes} Fehlversuche
      </div>
    </div>
  );
}

/** Punkt für Punkt aus dem Gedächtnis. */
function RecallGame({ points, onDone, onRetry }: { points: QuizPoint[]; onDone: (r: SchemaResult) => void; onRetry: (missed: string[]) => void }) {
  const [i, setI] = useState(0);
  const [answer, setAnswer] = useState("");
  const [shown, setShown] = useState(false);
  const [results, setResults] = useState<Record<string, boolean>>({});
  const input = useRef<HTMLInputElement>(null);
  const cur = points[i];
  const done = i >= points.length;
  const verdict: { verdict: Verdict; score: number } | null = shown && cur && answer.trim() ? judgeAnswer(answer, cur.text) : null;
  const known = Object.values(results).filter(Boolean).length;

  useEffect(() => {
    if (!shown) input.current?.focus();
  }, [i, shown]);
  useEffect(() => {
    if (done) onDone({ at: new Date().toISOString(), mode: "abfragen", known, total: points.length });
  }, [done]);

  const rate = (ok: boolean) => {
    if (!cur) return;
    setResults((r) => ({ ...r, [cur.id]: ok }));
    setI((n) => n + 1);
    setAnswer("");
    setShown(false);
  };

  return (
    <div className="quiz">
      <div className="quiz-outline">
        {points.slice(0, i).map((p) => (
          <div key={p.id} className={`quiz-line ${results[p.id] ? "is-known" : "is-missed"}`} style={{ paddingLeft: p.depth * 22 }}>
            <span className="schema-num tnum">{p.label}</span> {p.text} {results[p.id] ? <Check size={13} className="ok-icon" aria-label="gewusst" /> : <X size={13} className="miss-icon" aria-label="nicht gewusst" />}
          </div>
        ))}
      </div>
      {cur ? (
        <div className="quiz-card">
          <div className="xs muted">{cur.path.length ? cur.path.join(" › ") : "Oberste Ebene"}</div>
          <div className="quiz-slot" style={{ paddingLeft: cur.depth * 22 }}>
            <span className="schema-num tnum">{cur.label}</span>
            {shown ? <strong>{cur.text}</strong> : <span className="quiz-blank">?</span>}
          </div>
          {!shown ? (
            <form
              className="row"
              onSubmit={(e) => {
                e.preventDefault();
                setShown(true);
              }}
            >
              <input ref={input} className="grow" value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Prüfungspunkt eingeben (freiwillig) …" aria-label="Deine Antwort" autoComplete="off" />
              <Button type="submit" variant="primary" icon={<Eye size={14} />}>
                Aufdecken
              </Button>
            </form>
          ) : (
            <>
              {verdict && (
                <div className={`quiz-verdict is-${verdict.verdict}`}>
                  Deine Antwort: „{answer.trim()}“ – {verdict.verdict === "richtig" ? "passt" : verdict.verdict === "teilweise" ? "teilweise" : "passt eher nicht"}
                </div>
              )}
              {cur.note && <div className="small muted">{cur.note}</div>}
              <div className="row">
                <Button variant={verdict && verdict.verdict !== "richtig" ? "primary" : "secondary"} icon={<X size={14} />} onClick={() => rate(false)}>
                  Nicht gewusst
                </Button>
                <Button variant={!verdict || verdict.verdict === "richtig" ? "primary" : "secondary"} icon={<Check size={14} />} onClick={() => rate(true)}>
                  Gewusst
                </Button>
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="quiz-result stack">
          <div>
            <strong>{quizSummary(known, points.length)}</strong>
          </div>
          {known < points.length && (
            <div className="row">
              <Button variant="primary" icon={<RotateCcw size={14} />} onClick={() => onRetry(points.filter((p) => !results[p.id]).map((p) => p.id))}>
                Nur die verpassten wiederholen
              </Button>
            </div>
          )}
        </div>
      )}
      <div className="xs muted tnum">
        {Math.min(i, points.length)} / {points.length} · {known} gewusst
      </div>
    </div>
  );
}
