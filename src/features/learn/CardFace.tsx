/**
 * Vorder- und Rückseite einer Karte je Kartentyp: Definition (mit Norm,
 * Beispiel, Abgrenzung, Merke), Prüfungsschema (Punkt für Punkt aufdecken),
 * Begriffserklärung, Lückentext, umgekehrte Karte, Antwort eintippen.
 */
import { useMemo, useState } from "react";

import type { Card } from "../../api/types";
import { clozeParts, parseFields, schemaPoints, templateDef } from "../../lib/cardModel";
import { judgeAnswer } from "../../lib/schemaQuiz";
import { Button } from "../../ui/Button";

const EXTRA_LABEL: Record<string, string> = { norm: "Norm", beispiel: "Beispiel", abgrenzung: "Abgrenzung", merke: "Merke", kontext: "Zusammenhang", quelle: "Quelle" };

export function CardQuestion({ card, typed, onTyped }: { card: Card; typed?: string; onTyped?: (v: string) => void }) {
  const t = card.template;
  if (t === "luecke") return <Cloze text={card.front} ord={card.ord} revealed={false} />;
  const raw = t === "umgekehrt" && card.ord === 1 ? card.back : card.front;
  const prompt = t === "definition" ? "Definiere:" : t === "begriff" ? "Erkläre:" : t === "schema" ? "Prüfungsschema:" : null;
  // ältere Karten aus dem Glossar beginnen schon mit „Definiere:“
  const front = prompt ? raw.replace(/^\s*(definiere|erkläre|erläutere)\s*:?\s*/i, "") || raw : raw;
  return (
    <div className="fc-q">
      {prompt && <div className="fc-prompt xs muted">{prompt}</div>}
      <div className={`fc-front ${t === "definition" || t === "begriff" || t === "schema" ? "is-term" : ""}`}>{front}</div>
      {t === "eingabe" && onTyped && (
        <input
          className="fc-type"
          value={typed ?? ""}
          onChange={(e) => onTyped(e.target.value)}
          placeholder="Antwort eintippen, dann „Antwort zeigen“"
          aria-label="Antwort eintippen"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
      )}
    </div>
  );
}

export function CardAnswer({ card, typed, step, onStep }: { card: Card; typed?: string; step?: number; onStep?: (n: number) => void }) {
  const f = parseFields(card.fields);
  const t = card.template;
  const extras = templateDef(t)
    .extra.map((d) => d.key)
    .filter((k) => f[k]);
  return (
    <div className="fc-a">
      {t === "luecke" ? (
        <>
          <Cloze text={card.front} ord={card.ord} revealed />
          {card.back && card.back !== card.front && <div className="fc-back fc-extra-text">{card.back}</div>}
        </>
      ) : t === "schema" ? (
        <SchemaAnswer text={card.back} step={step} onStep={onStep} />
      ) : (
        <>
          {t === "eingabe" && <TypedCompare typed={typed ?? ""} expected={card.back} />}
          <div className={`fc-back ${t === "definition" ? "is-definition" : ""}`}>{t === "umgekehrt" && card.ord === 1 ? card.front : card.back}</div>
        </>
      )}
      {extras.length > 0 && (
        <dl className="fc-extras">
          {extras.map((k) => (
            <div key={k} className={`fc-extra fc-extra-${k}`}>
              <dt>{EXTRA_LABEL[k] ?? k}</dt>
              <dd>{f[k]}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

function Cloze({ text, ord, revealed }: { text: string; ord: number; revealed: boolean }) {
  return (
    <div className="fc-front fc-cloze">
      {clozeParts(text, ord, revealed).map((p, i) =>
        p.kind === "gap" ? (
          <span key={i} className="cloze-gap">
            [{p.hint ?? "…"}]
          </span>
        ) : p.kind === "answer" ? (
          <span key={i} className="cloze-answer">
            {p.text}
          </span>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </div>
  );
}

/** Prüfungspunkte; mit `step` Punkt für Punkt aufdecken */
function SchemaAnswer({ text, step, onStep }: { text: string; step?: number; onStep?: (n: number) => void }) {
  const pts = useMemo(() => schemaPoints(text), [text]);
  const shown = step === undefined ? pts.length : Math.min(step, pts.length);
  return (
    <div className="fc-schema">
      <ol className="schema-points">
        {pts.slice(0, shown).map((p, i) => (
          <li key={i} style={{ paddingLeft: p.level * 20 }} className={p.level === 0 ? "is-top" : ""}>
            {p.text}
          </li>
        ))}
      </ol>
      {onStep && shown < pts.length && (
        <div className="row">
          <Button size="sm" onClick={() => onStep(shown + 1)}>
            Nächster Punkt ({shown}/{pts.length})
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onStep(pts.length)}>
            Alle zeigen
          </Button>
        </div>
      )}
    </div>
  );
}

function TypedCompare({ typed, expected }: { typed: string; expected: string }) {
  const [v] = useState(() => (typed.trim() ? judgeAnswer(typed, expected) : null));
  if (!v) return <div className="typed-result is-none xs muted">Keine Antwort eingetippt.</div>;
  return (
    <div className={`typed-result is-${v.verdict}`}>
      <span className="xs">{v.verdict === "richtig" ? "Richtig" : v.verdict === "teilweise" ? "Teilweise richtig" : "Nicht richtig"}</span>
      <span className="typed-given">{typed}</span>
    </div>
  );
}
