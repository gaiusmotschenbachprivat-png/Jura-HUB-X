/**
 * Statistik der Karteikarten (wahlweise je Stapel): Heute, Vorhersage,
 * Lernkalender, Wiederholungen, Kartenzählung, Intervalle, Stabilität,
 * Schwierigkeit, Abrufwahrscheinlichkeit, Tageszeiten, Antworttasten,
 * Behaltensquote und Problemkarten.
 */
import { useMemo, useState } from "react";

import type { Card } from "../../api/types";
import { cardQuestion } from "../../lib/cardModel";
import {
  buttons,
  byHour,
  cardCounts,
  COUNT_KINDS,
  difficultyHistogram,
  forecast,
  intervalHistogram,
  retention,
  retrievabilityHistogram,
  REVIEW_KINDS,
  reviewsByDay,
  stabilityHistogram,
  streakInfo,
  today,
} from "../../lib/cardStats";
import { deckOf, inDeck, LEECH_TAG, SEP, tagList } from "../../lib/decks";
import { formatInterval } from "../../lib/fsrs";
import { useApp } from "../../state/store";
import { Button } from "../../ui/Button";
import { allDecks, useCollection, useDeckSettings } from "./collection";
import { ColumnChart, Heatmap, SegmentBar, type Column } from "./charts";

const S = (i: number) => `var(--series-${i})`;
const pct = (r: number | null) => (r == null ? "–" : `${Math.round(r * 100)} %`);
type Range = 30 | 90 | 365;

/** Tage zu Wochen zusammenfassen (für 3 Monate / 1 Jahr) */
function byWeek(cols: { label: string; values: number[]; date: Date }[]): Column[] {
  const out: Column[] = [];
  for (let i = 0; i < cols.length; i += 7) {
    const chunk = cols.slice(i, i + 7);
    out.push({
      label: chunk[0]!.date.toLocaleDateString("de-DE", { day: "numeric", month: "numeric" }),
      values: chunk[0]!.values.map((_, k) => chunk.reduce((s, c) => s + (c.values[k] ?? 0), 0)),
      note: `Woche ab ${chunk[0]!.date.toLocaleDateString("de-DE", { day: "numeric", month: "long" })}`,
    });
  }
  return out;
}

export function CardStatsView({ deck: initialDeck }: { deck?: string }) {
  const open = useApp((s) => s.open);
  const { cards: all, log: allLog } = useCollection(365);
  const settings = useDeckSettings();
  const [deck, setDeck] = useState(initialDeck ?? "");
  const [range, setRange] = useState<Range>(30);
  const now = useMemo(() => new Date(), [all]); // eslint-disable-line react-hooks/exhaustive-deps

  const cards = useMemo(() => (all ?? []).filter((c) => !deck || inDeck(deckOf(c), deck)), [all, deck]);
  const ids = useMemo(() => new Set(cards.map((c) => c.id)), [cards]);
  const log = useMemo(() => allLog.filter((l) => ids.has(l.card_id)), [allLog, ids]);
  const decks = useMemo(() => allDecks(all ?? [], settings), [all, settings]);

  const t = useMemo(() => today(log, now), [log, now]);
  const days365 = useMemo(() => reviewsByDay(log, now, 365), [log, now]);
  const streak = useMemo(() => streakInfo(days365), [days365]);
  if (!all) return <div className="loading">Lade Statistik …</div>;

  const dayLabel = (d: Date) => d.toLocaleDateString("de-DE", { day: "numeric", month: "numeric" });
  // Vorhersage
  const fc = forecast(cards, now, range);
  const fcCols = fc.map((v, i) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    return { label: i === 0 ? "heute" : i === 1 ? "morgen" : dayLabel(d), values: [v], date: d };
  });
  const fcData = range === 30 ? fcCols : byWeek(fcCols);
  // Wiederholungen
  const rd = days365.slice(-range);
  const rdCols = rd.map((d) => ({ label: dayLabel(d.date), values: REVIEW_KINDS.map((k) => d.byKind[k.id]), date: d.date, note: d.ms ? `${formatInterval(Math.max(60000, d.ms))} gelernt` : undefined }));
  const rdData = range === 30 ? rdCols : byWeek(rdCols);
  const rdTotal = rd.reduce((s, d) => s + d.total, 0);
  const rdMs = rd.reduce((s, d) => s + d.ms, 0);
  const counts = cardCounts(cards, now);
  const r = retrievabilityHistogram(cards, now);
  const hours = byHour(log.filter((l) => Date.parse(l.reviewed_at) >= now.getTime() - range * 864e5));
  const btn = buttons(log.filter((l) => Date.parse(l.reviewed_at) >= now.getTime() - range * 864e5));
  const ret = retention(log, now);
  const leeches = cards
    .filter((c) => tagList(c.tags).some((x) => x.toLowerCase() === LEECH_TAG.toLowerCase()) || c.lapses >= 8)
    .sort((a, b) => b.lapses - a.lapses)
    .slice(0, 10);

  return (
    <div className="viz-root card-stats">
      <div className="row wrap stats-filters">
        <select value={deck} onChange={(e) => setDeck(e.target.value)} aria-label="Stapel">
          <option value="">Alle Stapel</option>
          {decks.map((d) => (
            <option key={d} value={d}>
              {d.split(SEP).join(" › ")}
            </option>
          ))}
        </select>
        <div className="seg" role="radiogroup" aria-label="Zeitraum">
          {(
            [
              [30, "1 Monat"],
              [90, "3 Monate"],
              [365, "1 Jahr"],
            ] as const
          ).map(([v, l]) => (
            <button key={v} role="radio" aria-checked={range === v} className={range === v ? "is-active" : ""} onClick={() => setRange(v)}>
              {l}
            </button>
          ))}
        </div>
      </div>

      <section className="card stats-card" aria-label="Heute">
        <h3 className="label">Heute</h3>
        <div className="stat-row">
          <Tile value={t.count} label="Karten gelernt" />
          <Tile value={t.count ? formatInterval(Math.max(60000, t.ms)) : "–"} label="Lernzeit" />
          <Tile value={t.count ? `${Math.round(t.ms / t.count / 1000)} s` : "–"} label="je Karte" />
          <Tile value={t.count ? `${t.again}` : "–"} label={`„Nochmal“${t.count ? ` (${Math.round((t.again / t.count) * 100)} %)` : ""}`} />
          <Tile value={pct(t.matureRate)} label="Ausgereifte gewusst" />
          <Tile value={streak.streak} label={streak.streak === 1 ? "Tag in Folge" : "Tage in Folge"} />
        </div>
        <p className="xs muted">
          {REVIEW_KINDS.map((k) => `${k.label}: ${t.byKind[k.id]}`).join(" · ")}
        </p>
      </section>

      <section className="card stats-card" aria-label="Vorhersage">
        <h3 className="label">Vorhersage</h3>
        <p className="xs muted">
          Fällige Wiederholungen ({range === 30 ? "je Tag" : "je Woche"}) · morgen {fc[1] ?? 0} · Durchschnitt {(fc.reduce((s, v) => s + v, 0) / fc.length).toFixed(1).replace(".", ",")} je Tag
        </p>
        <ColumnChart data={fcData} series={[{ label: "Fällig", color: S(1) }]} label="Vorhersage fälliger Karten" every={range === 30 ? 5 : range === 90 ? 2 : 8} />
      </section>

      <section className="card stats-card" aria-label="Lernkalender">
        <h3 className="label">Lernkalender</h3>
        <p className="xs muted">
          {streak.streak} {streak.streak === 1 ? "Tag" : "Tage"} in Folge · längste Serie {streak.longest} · an {Math.round(streak.activeShare * 100)} % der Tage gelernt · Ø {Math.round(streak.perDay)} Karten an Lerntagen
        </p>
        <Heatmap days={days365} label="Wiederholungen je Tag im letzten Jahr" />
      </section>

      <section className="card stats-card" aria-label="Wiederholungen">
        <h3 className="label">Wiederholungen</h3>
        <p className="xs muted">
          {rdTotal} Wiederholungen · {formatInterval(Math.max(60000, rdMs))} · Ø {(rdTotal / range).toFixed(1).replace(".", ",")} je Tag
        </p>
        <ColumnChart data={rdData} series={REVIEW_KINDS.map((k, i) => ({ label: k.label, color: S(i + 1) }))} label="Wiederholungen nach Art" every={range === 30 ? 5 : range === 90 ? 2 : 8} />
      </section>

      <section className="card stats-card" aria-label="Kartenzählung">
        <h3 className="label">Kartenzählung</h3>
        <SegmentBar label="Karten nach Stand" parts={COUNT_KINDS.map((k, i) => ({ label: k.label, value: counts[k.id], color: S(i + 1) }))} />
      </section>

      <div className="stats-grid">
        <section className="card stats-card" aria-label="Intervalle">
          <h3 className="label">Intervalle</h3>
          <p className="xs muted">Abstand bis zur nächsten Wiederholung</p>
          <ColumnChart data={intervalHistogram(cards).map((b) => ({ label: b.label, values: [b.value] }))} series={[{ label: "Karten", color: S(1) }]} label="Intervalle" every={3} height={150} width={400} />
        </section>
        <section className="card stats-card" aria-label="Stabilität">
          <h3 className="label">Stabilität</h3>
          <p className="xs muted">Nach so vielen Tagen sinkt die Abrufwahrscheinlichkeit auf 90 %</p>
          <ColumnChart data={stabilityHistogram(cards).map((b) => ({ label: b.label, values: [b.value] }))} series={[{ label: "Karten", color: S(1) }]} label="Stabilität" every={3} height={150} width={400} />
        </section>
        <section className="card stats-card" aria-label="Schwierigkeit">
          <h3 className="label">Schwierigkeit</h3>
          <p className="xs muted">Wie schwer dir eine Karte fällt (aus deinen Bewertungen)</p>
          <ColumnChart data={difficultyHistogram(cards).map((b) => ({ label: b.label.replace(" %", ""), values: [b.value] }))} series={[{ label: "Karten", color: S(1) }]} label="Schwierigkeit in Prozent" every={2} height={150} width={400} />
        </section>
        <section className="card stats-card" aria-label="Abrufwahrscheinlichkeit">
          <h3 className="label">Abrufwahrscheinlichkeit</h3>
          <p className="xs muted">Wie sicher du die Karte jetzt noch weißt · Durchschnitt {pct(r.average)}</p>
          <ColumnChart data={r.buckets.map((b) => ({ label: b.label.replace(" %", ""), values: [b.value] }))} series={[{ label: "Karten", color: S(1) }]} label="Abrufwahrscheinlichkeit in Prozent" every={1} height={150} width={400} />
        </section>
      </div>

      <section className="card stats-card" aria-label="Tageszeiten">
        <h3 className="label">Tageszeiten</h3>
        <p className="xs muted">Wiederholungen je Stunde; im Tooltip der Anteil „gewusst“</p>
        <ColumnChart
          data={hours.map((h) => ({ label: `${h.hour}`, values: [h.count], note: h.rate == null ? undefined : `${pct(h.rate)} gewusst` }))}
          series={[{ label: "Wiederholungen", color: S(1) }]}
          label="Wiederholungen nach Uhrzeit"
          every={3}
          height={130}
        />
      </section>

      <div className="stats-grid">
        <section className="card stats-card" aria-label="Antworttasten">
          <h3 className="label">Antworttasten</h3>
          <table className="stats-table tnum">
            <thead>
              <tr>
                <th />
                <th>Nochmal</th>
                <th>Schwer</th>
                <th>Gut</th>
                <th>Einfach</th>
                <th>gewusst</th>
              </tr>
            </thead>
            <tbody>
              {(
                [
                  ["learn", "Lernen"],
                  ["young", "Jung"],
                  ["mature", "Ausgereift"],
                ] as const
              ).map(([k, l]) => {
                const v = btn[k];
                const n = v.reduce((s, x) => s + x, 0);
                return (
                  <tr key={k}>
                    <th>{l}</th>
                    {v.map((x, i) => (
                      <td key={i}>{x}</td>
                    ))}
                    <td>{n ? pct((n - v[0]) / n) : "–"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
        <section className="card stats-card" aria-label="Behaltensquote">
          <h3 className="label">Behaltensquote</h3>
          <table className="stats-table tnum">
            <thead>
              <tr>
                <th />
                <th>Jung</th>
                <th>Ausgereift</th>
                <th>Gesamt</th>
              </tr>
            </thead>
            <tbody>
              {ret.map((row) => (
                <tr key={row.label}>
                  <th>{row.label}</th>
                  <td>{pct(row.young.rate)}</td>
                  <td>{pct(row.mature.rate)}</td>
                  <td>
                    {pct(row.total.rate)} <span className="xs muted">({row.total.n})</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="xs muted">Anteil der Wiederholungen mit „Schwer“, „Gut“ oder „Einfach“. Ziel ist die Zielbehaltensquote der Stapeloptionen (meist 90 %).</p>
        </section>
      </div>

      <section className="card stats-card" aria-label="Problemkarten">
        <h3 className="label">Problemkarten</h3>
        {leeches.length ? (
          <>
            <ul className="leech-list">
              {leeches.map((c: Card) => (
                <li key={c.id}>
                  <span className="ellipsis grow">{cardQuestion(c)}</span>
                  <span className="xs muted tnum">{c.lapses}× vergessen</span>
                </li>
              ))}
            </ul>
            <Button size="sm" onClick={() => open({ type: "cards", tab: "browser", q: `tag:"${LEECH_TAG}"` })}>
              Im Kartenbrowser bearbeiten
            </Button>
          </>
        ) : (
          <p className="xs muted">Keine. Karten, die du oft vergisst, erscheinen hier – umformulieren, aufteilen oder ein Beispiel ergänzen hilft meist.</p>
        )}
      </section>
    </div>
  );
}

function Tile({ value, label }: { value: number | string; label: string }) {
  return (
    <div className="stat">
      <div className="stat-value tnum">{value}</div>
      <div className="xs muted">{label}</div>
    </div>
  );
}
