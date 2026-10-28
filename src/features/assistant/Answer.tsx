/**
 * Darstellung einer Antwort: einfaches Markdown (Überschriften, Listen, Fett)
 * ohne HTML-Einschleusung, Quellenkennungen [Qn] als anklickbare Marken und
 * nicht belegte Zitate farbig markiert.
 */
import { AlertTriangle, CheckCircle2, ChevronDown, Copy, FileDown, Info } from "lucide-react";
import { Fragment, useMemo, useState, type ReactNode } from "react";

import type { AskResult } from "../../ai/assistant";
import { BRIDGE_MODEL } from "../../ai/bridge";
import { formatCost } from "../../ai/cost";
import { hitLabel } from "../../ai/retrieval";
import type { RegisteredSource } from "../../ai/sources/registry";
import type { CitationCheck } from "../../ai/verify";
import { useApp } from "../../state/store";
import { Button } from "../../ui/Button";

const BAD: CitationCheck["status"][] = ["nicht_belegt", "existiert_nicht", "absatz_nicht_belegt"];
const STATUS_TEXT: Record<CitationCheck["status"], string> = {
  belegt: "belegt",
  absatz_nicht_belegt: "Absatz nicht belegt",
  nicht_belegt: "nicht belegt",
  existiert_nicht: "existiert nicht",
  verweis: "nur als Verweis genannt",
  ohne_gesetz: "ohne Gesetzesangabe",
};

function Inline({ text, bad, onSource }: { text: string; bad: CitationCheck[]; onSource: (id: string) => void }) {
  // Marken: [Qn], **fett**, nicht belegte Zitate
  const raws = bad.map((b) => b.raw).filter((r) => r.length > 2);
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(\\[Q\\d+\\]|\\*\\*[^*]+\\*\\*${raws.length ? "|" + raws.map(esc).join("|") : ""})`, "g");
  const parts = text.split(re);
  return (
    <>
      {parts.map((p, i) => {
        if (/^\[Q\d+\]$/.test(p)) {
          const id = p.slice(1, -1);
          return (
            <button key={i} className="src-chip" onClick={() => onSource(id)} title="Quelle anzeigen">
              {id}
            </button>
          );
        }
        if (/^\*\*[^*]+\*\*$/.test(p)) return <strong key={i}>{p.slice(2, -2)}</strong>;
        const b = bad.find((x) => x.raw === p);
        if (b)
          return (
            <mark key={i} className="cite-bad" title={`${STATUS_TEXT[b.status]}: ${b.detail}`}>
              {p}
            </mark>
          );
        return <Fragment key={i}>{p}</Fragment>;
      })}
    </>
  );
}

const MODEL_LABEL: Record<string, string> = { "claude-opus-5-5": "Opus 5.5", "claude-sonnet-5-5": "Sonnet 5.5", "claude-haiku-5-5": "Haiku 5.5" };
const modelLabel = (m: string) => MODEL_LABEL[m] ?? m;

export function Markdown({ text, bad = [], onSource }: { text: string; bad?: CitationCheck[]; onSource: (id: string) => void }) {
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const items = list.items.map((it, i) => (
      <li key={i}>
        <Inline text={it} bad={bad} onSource={onSource} />
      </li>
    ));
    blocks.push(list.ordered ? <ol key={blocks.length}>{items}</ol> : <ul key={blocks.length}>{items}</ul>);
    list = null;
  };
  for (const raw of text.split(/\n/)) {
    const line = raw.trimEnd();
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    const ul = /^\s*[-*•]\s+(.*)$/.exec(line);
    const ol = /^\s*(\d+)[.)]\s+(.*)$/.exec(line);
    if (h) {
      flush();
      const level = Math.min(4, h[1]!.length + 2);
      const Tag = `h${level}` as "h3" | "h4" | "h5" | "h6";
      blocks.push(
        <Tag key={blocks.length}>
          <Inline text={h[2]!} bad={bad} onSource={onSource} />
        </Tag>,
      );
    } else if (ul || ol) {
      const ordered = !!ol;
      if (list && list.ordered !== ordered) flush();
      list ??= { ordered, items: [] };
      list.items.push(ul ? ul[1]! : ol![2]!);
    } else if (!line.trim()) {
      flush();
    } else {
      flush();
      blocks.push(
        <p key={blocks.length}>
          <Inline text={line} bad={bad} onSource={onSource} />
        </p>,
      );
    }
  }
  flush();
  return <div className="ai-answer prose-ui">{blocks}</div>;
}

export function AnswerCard({ result, onSaveNote }: { result: AskResult; onSaveNote: (text: string) => void }) {
  const [source, setSource] = useState<RegisteredSource | null>(null);
  const [showSent, setShowSent] = useState(false);
  const toast = useApp((s) => s.toast);
  const bad = result.report.checks.filter((c) => BAD.includes(c.status));
  const used = useMemo(() => {
    const ids = new Set([...result.anonymizedText.matchAll(/\[(Q\d+)\]/g)].map((m) => m[1]!));
    return result.sources.filter((s) => ids.has(s.id));
  }, [result]);
  const open = (id: string) => setSource(result.sources.find((s) => s.id === id) ?? null);
  const c = result.report.counts;
  return (
    <div className="card ai-card">
      <Markdown text={result.text} bad={bad} onSource={open} />
      {source && (
        <div className="ai-source">
          <div className="row">
            <strong>
              [{source.id}] {hitLabel(source.hit)}
            </strong>
            <span className="grow" />
            <button className="link-button xs" onClick={() => setSource(null)}>
              schließen
            </button>
          </div>
          <div className="xs muted">
            {source.hit.title}
            {source.hit.version ? ` · Fassung: ${source.hit.version}` : ""}
          </div>
          <p className="small pre-wrap">{source.hit.text}</p>
        </div>
      )}
      <div className={`ai-check ${result.report.ok ? "is-ok" : "is-warn"}`}>
        {result.report.ok ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
        <span>
          Zitatprüfung: {c.belegt} belegt
          {c.nicht_belegt + c.absatz_nicht_belegt ? ` · ${c.nicht_belegt + c.absatz_nicht_belegt} nicht belegt` : ""}
          {c.existiert_nicht ? ` · ${c.existiert_nicht} existieren nicht` : ""}
          {c.verweis ? ` · ${c.verweis} als Verweis genannt` : ""}
          {c.ohne_gesetz ? ` · ${c.ohne_gesetz} ohne Gesetz` : ""}
          {result.report.unknownSourceIds.length ? ` · unbekannte Quellen: ${result.report.unknownSourceIds.join(", ")}` : ""}
          {result.revised ? " · nach automatischer Überarbeitung" : ""}
        </span>
      </div>
      {bad.length > 0 && (
        <ul className="xs ai-bad-list">
          {bad.map((b, i) => (
            <li key={i}>
              <mark className="cite-bad">{b.label}</mark> – {STATUS_TEXT[b.status]}: {b.detail}
            </li>
          ))}
        </ul>
      )}
      {used.length > 0 && (
        <details className="ai-details">
          <summary className="xs">Verwendete Quellen ({used.length})</summary>
          <ul className="xs">
            {used.map((s) => (
              <li key={s.id}>
                <button className="src-chip" onClick={() => setSource(s)}>
                  {s.id}
                </button>{" "}
                {hitLabel(s.hit)} – {s.hit.title}
              </li>
            ))}
          </ul>
        </details>
      )}
      <details className="ai-details" open={showSent} onToggle={(e) => setShowSent((e.target as HTMLDetailsElement).open)}>
        <summary className="xs">
          <Info size={12} /> {result.model === BRIDGE_MODEL ? "Für die Claude-App vorbereitet (anonymisiert)" : "An Anthropic gesendet (anonymisiert)"}
        </summary>
        {showSent && <pre className="xs ai-sent">{result.sentPreview}</pre>}
      </details>
      <div className="row wrap ai-actions">
        <Button size="sm" icon={<FileDown size={13} />} onClick={() => onSaveNote(result.text)}>
          Als Notiz speichern
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon={<Copy size={13} />}
          onClick={() => void navigator.clipboard?.writeText(result.text).then(() => toast("Kopiert.", "success"))}
        >
          Kopieren
        </Button>
        <span className="grow" />
        <span
          className="xs muted ai-cost"
          title={`${result.usage.requests} Anfrage(n) · Tokens: ${result.usage.input.toLocaleString("de-DE")} Eingabe / ${result.usage.output.toLocaleString("de-DE")} Ausgabe${result.usage.cacheRead ? ` / ${result.usage.cacheRead.toLocaleString("de-DE")} aus Zwischenspeicher` : ""}. Geschätzt; genau abgerechnet wird in der Anthropic-Konsole.`}
        >
          {result.model === BRIDGE_MODEL ? "Über die Claude-App · ohne API-Kosten" : `${modelLabel(result.model)} · ${formatCost(result.usage.costUsd)}`}
        </span>
      </div>
      <ChevronDown size={0} />
    </div>
  );
}
