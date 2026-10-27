/**
 * Mitgelieferte Prüfungsschemata nach Rechtsgebiet: auswählen, als farbige
 * Grafik ansehen, in die eigenen Schemata übernehmen (dann bearbeitbar und
 * übbar) oder direkt in die Mitschrift einfügen.
 */
import { Copy, Search } from "lucide-react";
import { useMemo, useState } from "react";

import { api } from "../../api";
import { cloneItems, gebietInfo, RECHTSGEBIETE, SCHEMA_LIBRARY, type LibrarySchema, type Rechtsgebiet } from "../../lib/schemaLibrary";
import { reportError, useApp } from "../../state/store";
import { Button } from "../../ui/Button";
import { SchemaDiagram } from "./SchemaDiagram";

const count = (items: LibrarySchema["items"]): number => items.reduce((n, i) => n + 1 + count(i.children), 0);

/** Bibliotheksschema als eigenes Prüfungsschema anlegen (Fachgebiet = Rechtsgebiet). */
export async function adoptSchema(s: LibrarySchema, open = true) {
  const st = useApp.getState();
  try {
    const k = await api.knowledgeCreate({
      type: "schema",
      area_id: st.areaId === "all" ? null : st.areaId,
      node_id: null,
      title: s.title,
      field: gebietInfo(s.gebiet).label,
      data: { norm: s.norm, items: cloneItems(s.items), notes: s.notes },
    });
    st.toast(`„${s.title}“ in deine Prüfungsschemata übernommen – jetzt anpassbar und übbar.`, "success");
    st.bump();
    if (open) st.open({ type: "knowledge", id: k.id }, { title: k.title });
    return k;
  } catch (e) {
    reportError(e);
    return null;
  }
}

export function SchemaLibrary({ initial = "zivil", onInsert, compact }: { initial?: Rechtsgebiet; onInsert?: (s: LibrarySchema) => void; compact?: boolean }) {
  const [gebiet, setGebiet] = useState<Rechtsgebiet>(initial);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return SCHEMA_LIBRARY.filter((s) => (t ? `${s.title} ${s.norm}`.toLowerCase().includes(t) : s.gebiet === gebiet));
  }, [gebiet, q]);
  const chosen = SCHEMA_LIBRARY.find((s) => s.id === sel) ?? null;
  return (
    <div className="schema-lib">
      <div className="row wrap">
        <div className="schema-lib-tabs" role="tablist" aria-label="Rechtsgebiet">
          {RECHTSGEBIETE.map((g) => (
            <button
              key={g.id}
              role="tab"
              aria-selected={!q.trim() && gebiet === g.id}
              className={`schema-lib-tab ${!q.trim() && gebiet === g.id ? "is-active" : ""}`}
              style={{ ["--g" as string]: g.color }}
              onClick={() => {
                setGebiet(g.id);
                setQ("");
                setSel(null);
              }}
            >
              {g.label}
            </button>
          ))}
        </div>
        <label className="slide-search grow" style={{ minWidth: 180 }}>
          <Search size={14} />
          <input placeholder="Schema suchen, z. B. Betrug, § 433, Klage" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Schema suchen" />
        </label>
      </div>
      <div className={`schema-lib-split ${chosen ? "has-preview" : ""}`}>
        <div className="schema-lib-grid" role="list">
          {list.map((s) => (
            <button
              key={s.id}
              role="listitem"
              className={`schema-card ${sel === s.id ? "is-active" : ""}`}
              style={{ ["--g" as string]: gebietInfo(s.gebiet).color }}
              onClick={() => setSel(sel === s.id ? null : s.id)}
              aria-pressed={sel === s.id}
            >
              <strong>{s.title}</strong>
              {s.norm && <span className="schema-card-norm">{s.norm}</span>}
              <span className="schema-card-meta">
                {q.trim() ? `${gebietInfo(s.gebiet).label} · ` : ""}
                {count(s.items)} Prüfungspunkte
              </span>
            </button>
          ))}
          {!list.length && <p className="small muted">Kein Schema gefunden.</p>}
        </div>
        {chosen && (
          <div className="schema-lib-preview">
            <SchemaDiagram title={chosen.title} norm={chosen.norm} notes={chosen.notes} items={chosen.items} gebiet={chosen.gebiet} compact={compact} />
            <div className="row wrap">
              {onInsert && (
                <Button variant="primary" onClick={() => onInsert(chosen)}>
                  In die Mitschrift einfügen
                </Button>
              )}
              <Button variant={onInsert ? "secondary" : "primary"} icon={<Copy size={14} />} onClick={() => void adoptSchema(chosen, !onInsert)}>
                In meine Schemata übernehmen
              </Button>
            </div>
            <p className="xs muted">
              Standardaufbau zur Orientierung – Aufbau und Schwerpunkte können je nach Lehrbuch und Lehrstuhl abweichen. (P) = klassisches Klausurproblem.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
