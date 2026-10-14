import { FileUp } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { api } from "../../api";
import type { DocumentInfo } from "../../api/types";
import { DOC_TYPE_LABEL } from "../../lib/kinds";
import { reportError, useApp } from "../../state/store";
import { Button } from "../../ui/Button";
import { EmptyState } from "../../ui/misc";
import { DocumentList } from "./DocumentList";
import { useImport } from "./ImportDialog";

export function DocumentsView() {
  const areaId = useApp((s) => s.areaId);
  const areas = useApp((s) => s.areas);
  const dataVersion = useApp((s) => s.dataVersion);
  const startImport = useImport();
  const [docs, setDocs] = useState<DocumentInfo[]>([]);
  const [filter, setFilter] = useState("");
  const [type, setType] = useState("");
  const [onlyUnassigned, setOnlyUnassigned] = useState(false);

  useEffect(() => {
    const scope = onlyUnassigned ? { kind: "unassigned" as const } : areaId === "all" ? { kind: "all" as const } : { kind: "area" as const, id: areaId };
    api.documentsList(scope).then(setDocs).catch(reportError);
  }, [areaId, onlyUnassigned, dataVersion]);

  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return docs.filter((d) => (!type || d.doc_type === type) && (!f || d.title.toLowerCase().includes(f) || d.original_name.toLowerCase().includes(f)));
  }, [docs, filter, type]);

  const areaName = areaId === "all" ? "allen Bereichen" : areas.find((a) => a.id === areaId)?.name;

  return (
    <div className="page">
      <header className="page-head">
        <div className="small muted">Dokumentenspeicher</div>
        <h1 className="page-title-static">Dokumente</h1>
        <div className="row wrap">
          <Button variant="primary" icon={<FileUp size={15} />} onClick={() => void startImport({})}>
            Dokumente importieren
          </Button>
          <span className="muted small">oder Dateien ins Fenster ziehen</span>
        </div>
      </header>
      <div className="filters row wrap">
        <input className="filter-input" placeholder="Nach Titel filtern …" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Dokumenttyp">
          <option value="">Alle Typen</option>
          {Object.entries(DOC_TYPE_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <label className="small row">
          <input type="checkbox" checked={onlyUnassigned} onChange={(e) => setOnlyUnassigned(e.target.checked)} /> nur nicht zugeordnete
        </label>
        <span className="muted small grow" style={{ textAlign: "right" }}>
          {shown.length} {shown.length === 1 ? "Dokument" : "Dokumente"} {onlyUnassigned ? "ohne Zuordnung" : `in ${areaName}`}
        </span>
      </div>
      {docs.length === 0 && !onlyUnassigned ? (
        <EmptyState
          title="Noch keine Dokumente"
          action={
            <Button variant="primary" onClick={() => void startImport({})}>
              Erste Unterlagen importieren
            </Button>
          }
        >
          Importiere Vorlesungsfolien, Skripte, Übungsblätter oder Word-Dokumente. Sie werden lokal gespeichert und durchsuchbar gemacht.
        </EmptyState>
      ) : (
        <DocumentList docs={shown} emptyText="Keine Dokumente für diesen Filter." />
      )}
    </div>
  );
}
