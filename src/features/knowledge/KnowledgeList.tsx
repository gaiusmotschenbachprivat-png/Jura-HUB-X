import { Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { api } from "../../api";
import type { CaseData, Knowledge, KnowledgeType } from "../../api/types";
import { formatRelative } from "../../lib/format";
import { areaById, reportError, useApp } from "../../state/store";
import { Button } from "../../ui/Button";
import { AreaDot, EmptyState } from "../../ui/misc";
import { KindIcon } from "../navigation/icons";
import { CASE_STATUS, DIFFICULTY, TYPE_HINT, TYPE_LABEL, TYPE_LABEL_PLURAL, UNVERIFIED } from "./meta";
import { SchemaLibrary } from "./SchemaLibrary";
import { gebietOf } from "../../lib/schemaLibrary";

export async function createKnowledge(type: KnowledgeType, opts: { title?: string; nodeId?: string | null; data?: Record<string, unknown> } = {}) {
  const st = useApp.getState();
  const areaId = st.areaId === "all" ? null : st.areaId;
  const defaults: Record<KnowledgeType, string> = { definition: "Neuer Begriff", schema: "Neues Prüfungsschema", case: "Neuer Fall", citation: "", quelle: "Neue Quelle" };
  try {
    const data =
      opts.data ??
      (type === "citation"
        ? { prefix: "§", number: "1", law: "" }
        : type === "quelle"
          ? { art: "kommentar" }
        : type === "case"
          ? { status: "offen", difficulty: 0 }
          : type === "schema"
            ? { items: [{ id: "", text: "", note: "", children: [] }] }
            : {});
    const k = await api.knowledgeCreate({ type, area_id: areaId, node_id: opts.nodeId ?? null, title: opts.title ?? defaults[type], data });
    st.open({ type: "knowledge", id: k.id }, { title: k.title });
    st.bump();
    return k;
  } catch (e) {
    reportError(e);
    return null;
  }
}

export function KnowledgeList({ type }: { type: KnowledgeType }) {
  const areaId = useApp((s) => s.areaId);
  const dataVersion = useApp((s) => s.dataVersion);
  const open = useApp((s) => s.open);
  const [items, setItems] = useState<Knowledge[]>([]);
  const [fields, setFields] = useState<string[]>([]);
  const [field, setField] = useState("");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"title" | "updated" | "difficulty">("title");
  const areaName = useApp((s) => s.areas.find((a) => a.id === s.areaId)?.name ?? "");

  useEffect(() => {
    api
      .knowledgeList({ type, area_id: areaId === "all" ? null : areaId })
      .then(setItems)
      .catch(reportError);
    api.knowledgeFields().then(setFields).catch(() => {});
  }, [type, areaId, dataVersion]);

  const shown = useMemo(() => {
    const f = q.trim().toLowerCase();
    const list = items.filter(
      (k) =>
        (!field || k.field === field) &&
        (!f || k.title.toLowerCase().includes(f) || JSON.stringify(k.data).toLowerCase().includes(f)),
    );
    if (sort === "updated") list.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    if (sort === "difficulty") list.sort((a, b) => ((b.data as unknown as CaseData).difficulty ?? 0) - ((a.data as unknown as CaseData).difficulty ?? 0));
    return list;
  }, [items, field, q, sort]);

  return (
    <div className="page">
      <header className="page-head">
        <div className="small muted row">
          <KindIcon kind={type} size={14} /> Wissen
        </div>
        <h1 className="page-title-static">{TYPE_LABEL_PLURAL[type]}</h1>
        <p className="small muted" style={{ margin: 0, maxWidth: 720 }}>
          {TYPE_HINT[type]}
        </p>
        <div className="row wrap">
          <Button variant="primary" icon={<Plus size={15} />} onClick={() => void createKnowledge(type)}>
            {type === "citation" ? "Neue Fundstelle" : `${TYPE_LABEL[type]} anlegen`}
          </Button>
        </div>
      </header>
      {type === "schema" && (
        <section className="card schema-lib-card">
          <h2 className="section-title">Vorlagen nach Rechtsgebiet</h2>
          <SchemaLibrary initial={gebietOf(areaName) ?? "zivil"} />
        </section>
      )}
      {type === "schema" && items.length > 0 && <h2 className="section-title">Meine Prüfungsschemata</h2>}
      <div className="filters row wrap">
        <input className="filter-input" placeholder="Filtern …" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={field} onChange={(e) => setField(e.target.value)} aria-label="Rechtsgebiet">
          <option value="">Alle Gebiete</option>
          {fields.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sortierung">
          <option value="title">Alphabetisch</option>
          <option value="updated">Zuletzt bearbeitet</option>
          {type === "case" && <option value="difficulty">Schwierigkeit</option>}
        </select>
        <span className="muted small grow" style={{ textAlign: "right" }}>
          {shown.length} Einträge
        </span>
      </div>
      {items.length === 0 ? (
        <EmptyState title={`Noch keine ${TYPE_LABEL_PLURAL[type]}`} action={<Button variant="primary" onClick={() => void createKnowledge(type)}>Ersten Eintrag anlegen</Button>}>
          {TYPE_HINT[type]}
        </EmptyState>
      ) : (
        <div className="list" style={{ maxWidth: 1100 }}>
          {shown.map((k) => {
            const area = areaById(k.area_id);
            const cd = k.data as unknown as CaseData;
            return (
              <button key={k.id} className="list-row" onClick={() => open({ type: "knowledge", id: k.id }, { title: k.title })}>
                <KindIcon kind={k.type} />
                <span className="grow" style={{ minWidth: 0 }}>
                  <span className="ellipsis block">{k.title}</span>
                  {k.type === "definition" && (k.data as { text?: string }).text && (
                    <span className="xs muted ellipsis block">{(k.data as { text?: string }).text}</span>
                  )}
                  {k.type === "case" && (cd.claim_basis || cd.facts) && <span className="xs muted ellipsis block">{cd.claim_basis || cd.facts}</span>}
                </span>
                {UNVERIFIED.includes(k.source_kind) && <span className="status-pill is-warn">ungeprüft</span>}
                {k.type === "case" && cd.status && <span className={`status-pill ${cd.status === "bearbeitet" ? "is-ok" : cd.status === "wiederholen" ? "is-warn" : "is-pending"}`}>{CASE_STATUS[cd.status]}</span>}
                {k.type === "case" && cd.difficulty > 0 && <span className="pill">{DIFFICULTY[cd.difficulty]}</span>}
                {k.field && <span className="pill">{k.field}</span>}
                {area && <AreaDot color={area.color} size={6} />}
                <span className="xs muted doc-date">{formatRelative(k.updated_at)}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
