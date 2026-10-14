import { FileText, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { api } from "../../api";
import type { TrashItem } from "../../api/types";
import { formatDateTime } from "../../lib/format";
import { reportError, useApp } from "../../state/store";
import { Button } from "../../ui/Button";
import { confirmDialog } from "../../ui/Dialog";
import { EmptyState } from "../../ui/misc";
import { KindIcon } from "../navigation/icons";

export function TrashView() {
  const [items, setItems] = useState<TrashItem[]>([]);
  const reloadNodes = useApp((s) => s.reloadNodes);
  const bump = useApp((s) => s.bump);
  const toast = useApp((s) => s.toast);
  const load = () => api.trashList().then(setItems).catch(reportError);
  useEffect(() => {
    void load();
  }, []);

  const restore = async (it: TrashItem) => {
    try {
      await api.trashRestore(it.item_type, it.id);
      await reloadNodes();
      bump();
      toast(`„${it.title}“ wiederhergestellt.`, "success");
      void load();
    } catch (e) {
      reportError(e);
    }
  };
  const purge = async (it: TrashItem) => {
    const ok = await confirmDialog({
      title: "Endgültig löschen?",
      message: `„${it.title}“${it.children ? ` und ${it.children} Unterelemente` : ""} werden dauerhaft gelöscht. Das lässt sich nur über ein Backup rückgängig machen.`,
      confirm: "Endgültig löschen",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.trashPurge(it.item_type, it.id);
      void load();
    } catch (e) {
      reportError(e);
    }
  };

  return (
    <div className="page">
      <header className="page-head">
        <h1 className="page-title-static">Papierkorb</h1>
        <p className="small muted">Gelöschte Inhalte bleiben hier, bis du sie endgültig löschst. Unterelemente werden mit wiederhergestellt.</p>
      </header>
      {items.length === 0 ? (
        <EmptyState title="Der Papierkorb ist leer" />
      ) : (
        <div className="list">
          {items.map((it) => (
            <div key={it.item_type + it.id} className="list-row">
              {it.kind ? <KindIcon kind={it.kind} /> : <FileText size={16} />}
              <span className="grow" style={{ minWidth: 0 }}>
                <span className="ellipsis block">{it.title}</span>
                <span className="xs muted ellipsis block">
                  gelöscht {formatDateTime(it.deleted_at)}
                  {it.children ? ` · mit ${it.children} Unterelementen` : ""}
                  {it.path ? ` · ${it.path}` : ""}
                </span>
              </span>
              <Button size="sm" icon={<RotateCcw size={13} />} onClick={() => void restore(it)}>
                Wiederherstellen
              </Button>
              <Button size="sm" variant="ghost" icon={<Trash2 size={13} />} onClick={() => void purge(it)}>
                Endgültig löschen
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
