import { useEffect, useMemo, useState } from "react";
import { create } from "zustand";

import { api, errorMessage } from "../../api";
import type { ImportOutcome } from "../../api/types";
import { DOC_TYPE_LABEL, KIND_LABEL } from "../../lib/kinds";
import { buildTree, type TreeItem } from "../../lib/tree";
import { reportError, useApp } from "../../state/store";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { Field } from "../../ui/misc";
import { enqueueExtraction } from "./textExtraction";

const IMPORT_EXT = ["pdf", "docx", "doc", "pptx", "xlsx", "odt", "txt", "md", "markdown", "png", "jpg", "jpeg", "gif", "webp"];

interface ImportState {
  paths: string[] | null;
  nodeId: string | null;
  set(p: Partial<ImportState>): void;
}
const useImportStore = create<ImportState>((set) => ({ paths: null, nodeId: null, set: (p) => set(p) }));

/** Startet einen Import: Dateiauswahl (falls keine Pfade übergeben) und danach den Zuordnungsdialog. */
export async function startImport(opts: { nodeId?: string | null; paths?: string[] } = {}) {
  {
    try {
      const paths = opts.paths ?? (await api.pickFiles({ multiple: true, extensions: IMPORT_EXT, title: "Dokumente importieren" }));
      if (!paths?.length) return;
      const view = useApp.getState().view;
      const fallback = view.type === "node" || view.type === "note" ? view.id : null;
      useImportStore.getState().set({ paths, nodeId: opts.nodeId ?? fallback });
    } catch (e) {
      reportError(e);
    }
  }
}

/** Stabile Referenz auf `startImport` (für Effekte und Handler). */
export function useImport() {
  return startImport;
}

function guessType(name: string): string {
  const n = name.toLowerCase();
  if (/folie|slides|vorlesung|vl[\s_-]?\d/.test(n)) return "folien";
  if (/skript|script/.test(n)) return "skript";
  if (/l(ö|oe)sung|solution/.test(n)) return "loesung";
  if (/(ü|ue)bung|blatt|aufgabe|exercise/.test(n)) return "uebungsblatt";
  if (/klausur|exam/.test(n)) return "klausur";
  if (/urteil|bgh|bverfg|olg/.test(n)) return "urteil";
  return "sonstiges";
}

function flatten(items: TreeItem[], out: { id: string; label: string }[] = []) {
  for (const it of items) {
    if (it.node.kind !== "note") out.push({ id: it.node.id, label: `${" ".repeat(it.depth)}${it.node.title} (${KIND_LABEL[it.node.kind]})` });
    flatten(it.children, out);
  }
  return out;
}

export function ImportHost() {
  const { paths, nodeId, set } = useImportStore();
  if (!paths) return null;
  return <ImportDialog paths={paths} initialNode={nodeId} onClose={() => set({ paths: null, nodeId: null })} />;
}

function ImportDialog({ paths, initialNode, onClose }: { paths: string[]; initialNode: string | null; onClose: () => void }) {
  const areas = useApp((s) => s.areas);
  const currentArea = useApp((s) => s.areaId);
  const toast = useApp((s) => s.toast);
  const bump = useApp((s) => s.bump);
  const [allNodes, setAllNodes] = useState<Awaited<ReturnType<typeof api.nodesList>>>([]);
  const [areaId, setAreaId] = useState<string>("");
  const [nodeId, setNodeId] = useState<string>(initialNode ?? "");
  const [docType, setDocType] = useState(() => guessType(paths[0] ?? ""));
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<ImportOutcome[] | null>(null);

  useEffect(() => {
    void api.nodesList(null).then((ns) => {
      setAllNodes(ns);
      const start = ns.find((n) => n.id === initialNode);
      setAreaId(start?.area_id ?? (currentArea !== "all" ? currentArea : (areas[0]?.id ?? "")));
    });
  }, [initialNode, currentArea, areas]);

  const options = useMemo(() => flatten(buildTree(allNodes.filter((n) => n.area_id === areaId))), [allNodes, areaId]);
  const names = paths.map((p) => p.split(/[\\/]/).pop() ?? p);

  const run = async () => {
    setBusy(true);
    try {
      const res = await api.documentsImport(paths, nodeId || null, docType);
      setResults(res);
      enqueueExtraction(res.flatMap((r) => (r.document ? [r.document] : [])));
      bump();
      const ok = res.filter((r) => r.document).length;
      if (ok === res.length) {
        toast(ok === 1 ? `„${names[0]}“ importiert.` : `${ok} Dokumente importiert.`, "success");
        onClose();
      }
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };

  if (results) {
    return (
      <Dialog title="Import abgeschlossen" onClose={onClose} footer={<Button variant="primary" onClick={onClose}>Schließen</Button>}>
        <ul className="import-results">
          {results.map((r, i) => (
            <li key={i} className={r.error ? "is-error" : ""}>
              <strong>{r.file_name}</strong>
              <span className="small">{r.error ?? "importiert"}</span>
            </li>
          ))}
        </ul>
      </Dialog>
    );
  }

  return (
    <Dialog
      title={paths.length === 1 ? "Dokument importieren" : `${paths.length} Dokumente importieren`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" onClick={run} disabled={busy}>
            {busy ? "Importiere …" : "Importieren"}
          </Button>
        </>
      }
    >
      <div className="stack">
        <div className="import-files small">
          {names.slice(0, 6).map((n) => (
            <div key={n} className="ellipsis">
              {n}
            </div>
          ))}
          {names.length > 6 && <div className="muted">… und {names.length - 6} weitere</div>}
        </div>
        <Field label="Dokumenttyp">
          <select value={docType} onChange={(e) => setDocType(e.target.value)}>
            {Object.entries(DOC_TYPE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Studienbereich">
          <select
            value={areaId}
            onChange={(e) => {
              setAreaId(e.target.value);
              setNodeId("");
            }}
          >
            {areas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Zuordnen zu" hint="Kann später jederzeit geändert oder ergänzt werden. Ein Dokument kann mehreren Stellen zugeordnet sein.">
          <select value={nodeId} onChange={(e) => setNodeId(e.target.value)}>
            <option value="">– noch nicht zuordnen –</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
        <p className="xs muted">
          Die Dateien werden in den lokalen Dokumentenspeicher kopiert. Deine Originale bleiben unverändert an ihrem Ort.
        </p>
      </div>
    </Dialog>
  );
}
