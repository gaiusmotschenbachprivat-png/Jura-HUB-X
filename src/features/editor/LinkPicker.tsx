import { FileText } from "lucide-react";
import { useEffect, useState } from "react";

import { api } from "../../api";
import type { SearchHit } from "../../api/types";
import { highlightHtml, stripHighlight } from "../../lib/format";
import { useApp } from "../../state/store";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { KindIcon } from "../navigation/icons";

export interface PickedTarget {
  href: string;
  title: string;
  type: "node" | "document" | "knowledge";
  id: string;
  page?: number;
}

/** Sucht ein Verknüpfungsziel: Notiz, Strukturelement, Dokument oder Dokumentseite. */
export function LinkPicker({
  title = "Interne Verknüpfung",
  onPick,
  onClose,
  excludeId,
}: {
  title?: string;
  onPick: (t: PickedTarget) => void;
  onClose: () => void;
  excludeId?: string;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [sel, setSel] = useState(0);
  const recent = useApp((s) => s.recent);

  useEffect(() => {
    let alive = true;
    const t = setTimeout(async () => {
      const res = q.trim() ? await api.search(q, null).catch(() => []) : [];
      if (alive) {
        setHits(res.filter((h) => h.entity_id !== excludeId && !["card", "task", "exam"].includes(h.entity_type)));
        setSel(0);
      }
    }, 120);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q, excludeId]);

  const pick = (h: SearchHit) => {
    const base = stripHighlight(h.title);
    if (h.entity_type === "knowledge") {
      return onPick({ type: "knowledge", id: h.entity_id, title: base, href: `studium:knowledge/${h.entity_id}` });
    }
    if (h.entity_type === "annotation" && h.target_id) {
      const pg = h.page ?? 1;
      return onPick({ type: "document", id: h.target_id, page: pg, title: `${base}, S. ${pg}`, href: `studium:document/${h.target_id}#page=${pg}` });
    }
    const isDoc = h.entity_type === "document" || h.entity_type === "page";
    const page = h.entity_type === "page" ? (h.page ?? undefined) : undefined;
    onPick({
      type: isDoc ? "document" : "node",
      id: h.entity_id,
      page,
      title: page ? `${base}, S. ${page}` : base,
      href: isDoc ? `studium:document/${h.entity_id}${page ? `#page=${page}` : ""}` : `studium:node/${h.entity_id}`,
    });
  };

  const recentHits = recent
    .filter((r) => "id" in r.view && r.view.id !== excludeId)
    .slice(0, 6)
    .map((r) => ({
      entity_type: r.view.type === "document" ? "document" : r.view.type === "note" ? "note" : r.view.type === "knowledge" ? "knowledge" : "node",
      entity_id: (r.view as { id: string }).id,
      area_id: null,
      page: null,
      title: r.title,
      snippet: "",
      path: "",
      kind: null,
      target_id: null,
    })) as SearchHit[];
  const list = q.trim() ? hits : recentHits;

  return (
    <Dialog title={title} onClose={onClose} width={560} footer={<Button onClick={onClose}>Abbrechen</Button>}>
      <input
        className="picker-input"
        autoFocus
        placeholder="Notiz, Definition, Schema, Fall, Norm, Dokument oder Text suchen …"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") setSel((s) => Math.min(s + 1, list.length - 1));
          else if (e.key === "ArrowUp") setSel((s) => Math.max(s - 1, 0));
          else if (e.key === "Enter" && list[sel]) pick(list[sel]);
          else return;
          e.preventDefault();
        }}
      />
      {!q.trim() && list.length > 0 && <div className="label picker-label">Zuletzt geöffnet</div>}
      <div className="picker-list">
        {list.map((h, i) => (
          <button key={h.entity_type + h.entity_id + (h.page ?? "")} className={`picker-item ${i === sel ? "is-sel" : ""}`} onClick={() => pick(h)} onMouseEnter={() => setSel(i)}>
            <span className="picker-icon">{h.kind ? <KindIcon kind={h.kind} /> : <FileText size={15} />}</span>
            <span className="grow">
              <span className="picker-title" dangerouslySetInnerHTML={{ __html: highlightHtml(h.title) + (h.page ? ` <span class="muted">· S. ${h.page}</span>` : "") }} />
              {h.path && <span className="picker-path ellipsis">{h.path}</span>}
            </span>
          </button>
        ))}
        {q.trim() && hits.length === 0 && <div className="muted picker-none">Keine Treffer.</div>}
      </div>
    </Dialog>
  );
}
