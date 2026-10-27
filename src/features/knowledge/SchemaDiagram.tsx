/**
 * Prüfungsschema als farbige Grafik: Kopf in der Farbe des Rechtsgebiets,
 * jede Prüfungsstufe (A., B., …) als farbiger Block, darunter die Prüfungspunkte
 * mit Gliederungszeichen. „(P)“-Punkte sind als Klausurproblem hervorgehoben,
 * Normen fett in der Stufenfarbe.
 */
import { Fragment, type ReactNode } from "react";

import type { SchemaItem } from "../../api/types";
import { gliederung } from "../../lib/gliederung";
import { gebietInfo, isProblem, PROBLEM, stageColor, type Rechtsgebiet } from "../../lib/schemaLibrary";

const NORM =
  /((?:§§?|Art\.|Artt\.)\s*\d+[a-z]?(?:\s*(?:[IVX]+|Abs\.\s*\d+|S\.\s*\d+|Nr\.\s*\d+[a-z]?|Alt\.\s*\d+|[,–-]\s*\d+[a-z]?|f+\.))*(?:\s+(?:i\.\s?V\.\s?m\.\s)?[A-ZÄÖÜ][A-Za-zÄÖÜäöü]*[A-ZÄÖÜ][A-Za-zÄÖÜäöü]*)?)/g;

/** Normzitate im Text hervorheben. */
function withNorms(text: string): ReactNode {
  const parts = text.split(NORM);
  return parts.map((p, i) =>
    i % 2 ? (
      <span key={i} className="sd-norm">
        {p}
      </span>
    ) : (
      <Fragment key={i}>{p}</Fragment>
    ),
  );
}

function Point({ item, depth, n }: { item: SchemaItem; depth: number; n: number }) {
  const problem = isProblem(item.text);
  const text = problem ? item.text.replace(PROBLEM, "") : item.text;
  return (
    <li className={`sd-point ${problem ? "is-problem" : ""}`}>
      <div className="sd-line">
        <span className="sd-num">
          {problem ? (
            <span className="sd-p" title="Klausurproblem">
              P
            </span>
          ) : (
            gliederung(depth, n)
          )}
        </span>
        <span className="sd-text">{withNorms(text || "…")}</span>
      </div>
      {item.note && <div className="sd-note">{withNorms(item.note)}</div>}
      {item.children.length > 0 && <Points items={item.children} depth={depth + 1} />}
    </li>
  );
}

function Points({ items, depth }: { items: SchemaItem[]; depth: number }) {
  // (P)-Punkte zählen nicht mit, damit die Gliederung 1., 2., 3. lückenlos bleibt
  let n = 0;
  return (
    <ol className="sd-points">
      {items.map((it) => {
        if (!isProblem(it.text)) n++;
        return <Point key={it.id} item={it} depth={depth} n={Math.max(1, n)} />;
      })}
    </ol>
  );
}

export function SchemaDiagram({
  title,
  norm,
  notes,
  items,
  gebiet,
  compact,
}: {
  title: string;
  norm?: string;
  notes?: string;
  items: SchemaItem[];
  gebiet: Rechtsgebiet | null;
  compact?: boolean;
}) {
  const area = gebiet ? gebietInfo(gebiet) : null;
  let n = 0;
  return (
    <div className={`sd ${compact ? "is-compact" : ""}`} style={{ ["--area" as string]: area?.color ?? "#5b6676" }}>
      <header className="sd-head">
        {area && <span className="sd-area">{area.label}</span>}
        <strong className="sd-title">{title}</strong>
        {norm && <span className="sd-head-norm">{norm}</span>}
      </header>
      <div className="sd-stages">
        {items.map((it) => {
          const problem = isProblem(it.text);
          if (!problem) n++;
          const color = problem ? "#b4471f" : stageColor(gebiet, it.text);
          return (
            <section key={it.id} className={`sd-stage ${problem ? "is-problem" : ""}`} style={{ ["--c" as string]: color }}>
              <div className="sd-stage-head">
                <span className="sd-stage-num">{problem ? "P" : gliederung(0, n)}</span>
                <span>{withNorms((problem ? it.text.replace(PROBLEM, "") : it.text) || "…")}</span>
              </div>
              {it.note && <div className="sd-note">{withNorms(it.note)}</div>}
              {it.children.length > 0 && <Points items={it.children} depth={1} />}
            </section>
          );
        })}
      </div>
      {notes && <p className="sd-foot">{withNorms(notes)}</p>}
    </div>
  );
}
