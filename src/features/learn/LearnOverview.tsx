/** Lernstand je Fach, Lernmodi und Schemata zum Üben (auf der Karteikarten-Seite). */
import { BookOpen, GraduationCap, ListTree, Scale } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { api } from "../../api";
import type { Card, Knowledge } from "../../api/types";
import { formatRelative } from "../../lib/format";
import { statsByFach } from "../../lib/learnStats";
import { useApp } from "../../state/store";
import { Button } from "../../ui/Button";
import type { SchemaResult } from "./SchemaTrainer";

/**
 * Zahl fälliger Karten am App-Symbol: iPadOS erlaubt das Web-Apps auf dem
 * Home-Bildschirm nur mit Mitteilungs-Erlaubnis. Es werden keine Mitteilungen verschickt.
 */
export function BadgePermission() {
  const [state, setState] = useState(() => (typeof Notification !== "undefined" && "setAppBadge" in navigator ? Notification.permission : "unsupported"));
  if (state !== "default") return null;
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={() => {
        void Notification.requestPermission()
          .then((p) => setState(p))
          .catch(() => setState("denied"));
      }}
      title="Zeigt die Zahl fälliger Karten am App-Symbol. Es werden keine Mitteilungen verschickt."
    >
      Zahl am App-Symbol zeigen
    </Button>
  );
}

export function FachProgress({ cards }: { cards: Card[] }) {
  const nodes = useApp((s) => s.nodes);
  const open = useApp((s) => s.open);
  const rows = useMemo(() => statsByFach(cards, nodes), [cards, nodes]);
  const kinds = useMemo(() => {
    const t = new Date().toISOString();
    const due = cards.filter((c) => !c.suspended && !c.deleted_at && c.due <= t);
    return { definition: due.filter((c) => c.kind === "definition").length, norm: due.filter((c) => c.kind === "norm").length };
  }, [cards]);
  if (!rows.length) return null;
  return (
    <section className="learn-section">
      <div className="row wrap">
        <h2 className="section-title grow">Lernstand nach Fach</h2>
        <Button size="sm" icon={<BookOpen size={14} />} onClick={() => open({ type: "learn", kind: "definition", label: "Definitionen" })}>
          Nur Definitionen{kinds.definition ? ` (${kinds.definition})` : ""}
        </Button>
        <Button size="sm" icon={<Scale size={14} />} onClick={() => open({ type: "learn", kind: "norm", label: "Normen" })}>
          Nur Normen{kinds.norm ? ` (${kinds.norm})` : ""}
        </Button>
      </div>
      <div className="fach-list">
        {rows.map((r) => {
          const pct = (n: number) => `${(n / Math.max(1, r.total)) * 100}%`;
          return (
            <div key={r.nodeId ?? "ohne"} className="fach-row">
              <div className="fach-head">
                <strong className="ellipsis">{r.title}</strong>
                <span className="xs muted tnum">
                  {r.mastered} von {r.total} sitzen · {r.due} fällig{r.difficult ? ` · ${r.difficult} schwierig` : ""}
                </span>
              </div>
              <div className="fach-bar" role="img" aria-label={`${r.title}: ${r.mastered} sitzen, ${r.learning} im Lernen, ${r.fresh} neu`}>
                <span className="is-mastered" style={{ width: pct(r.mastered) }} />
                <span className="is-learning" style={{ width: pct(r.learning) }} />
                <span className="is-new" style={{ width: pct(r.fresh) }} />
              </div>
              <div className="row fach-actions">
                <span className="xs muted grow">
                  {r.byKind.definition} Definitionen · {r.byKind.norm} Normen · {r.byKind.frage} Fragen
                </span>
                {r.nodeId && (
                  <Button size="sm" variant={r.due ? "primary" : "secondary"} icon={<GraduationCap size={14} />} onClick={() => open({ type: "learn", node: r.nodeId!, label: r.title })}>
                    {r.due ? `${r.due} lernen` : "Üben"}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <p className="xs muted">„Sitzt“: Karte wird voraussichtlich auch in drei Wochen noch gewusst (FSRS-Stabilität ab 21 Tagen).</p>
    </section>
  );
}

export function SchemaPractice() {
  const open = useApp((s) => s.open);
  const areaId = useApp((s) => s.areaId);
  const dataVersion = useApp((s) => s.dataVersion);
  const [schemas, setSchemas] = useState<Knowledge[]>([]);
  const [results, setResults] = useState<Record<string, SchemaResult>>({});
  useEffect(() => {
    api
      .knowledgeList({ type: "schema", area_id: areaId === "all" ? null : areaId })
      .then((l) => setSchemas(l.filter((k) => !k.deleted_at && ((k.data as { items?: unknown[] }).items?.length ?? 0) > 0)))
      .catch(() => {});
    api
      .settingsAll()
      .then((s) => {
        const out: Record<string, SchemaResult> = {};
        for (const [k, v] of Object.entries(s)) if (k.startsWith("learn.schema.") && v && typeof v === "object") out[k.slice("learn.schema.".length)] = v as SchemaResult;
        setResults(out);
      })
      .catch(() => {});
  }, [areaId, dataVersion]);
  if (!schemas.length) return null;
  // Nie geübte und schwache zuerst
  const sorted = [...schemas].sort((a, b) => score(results[a.id]) - score(results[b.id]) || a.title.localeCompare(b.title, "de"));
  return (
    <section className="learn-section">
      <h2 className="section-title">Schemata üben</h2>
      <div className="list">
        {sorted.map((k) => {
          const r = results[k.id];
          return (
            <button key={k.id} className="list-row" onClick={() => open({ type: "schema-train", id: k.id }, { title: `${k.title} üben` })}>
              <ListTree size={15} />
              <span className="grow ellipsis">{k.title}</span>
              {k.field && <span className="pill">{k.field}</span>}
              <span className="xs muted tnum">{r ? `${Math.round((r.known / Math.max(1, r.total)) * 100)} % · ${formatRelative(r.at)}` : "noch nicht geübt"}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

const score = (r: SchemaResult | undefined) => (r ? r.known / Math.max(1, r.total) : -1);
