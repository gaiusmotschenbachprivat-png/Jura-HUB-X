import { AlertTriangle, File, FileImage, FileSpreadsheet, FileText, MoreHorizontal, Presentation } from "lucide-react";

import { api } from "../../api";
import type { DocumentInfo } from "../../api/types";
import { formatBytes, formatRelative } from "../../lib/format";
import { DOC_TYPE_LABEL, TEXT_STATUS_LABEL } from "../../lib/kinds";
import { reportError, useApp } from "../../state/store";
import { IconButton } from "../../ui/Button";
import { useMenu } from "../../ui/Menu";
import { openExternally, saveCopyAs, trashDocument } from "./docActions";

export function DocIcon({ ext, size = 16 }: { ext: string; size?: number }) {
  const p = { size, strokeWidth: 1.75, "aria-hidden": true } as const;
  if (ext === "pdf" || ext === "docx" || ext === "doc" || ext === "odt" || ext === "txt" || ext === "md") return <FileText {...p} />;
  if (["png", "jpg", "jpeg", "gif", "webp"].includes(ext)) return <FileImage {...p} />;
  if (ext === "pptx") return <Presentation {...p} />;
  if (ext === "xlsx") return <FileSpreadsheet {...p} />;
  return <File {...p} />;
}

export function TextStatus({ status }: { status: string }) {
  const cls = status === "ok" ? "ok" : status === "pending" ? "pending" : "warn";
  return <span className={`status-pill is-${cls}`} title={TEXT_STATUS_LABEL[status]}>{status === "ok" ? "durchsuchbar" : status === "pending" ? "wird gelesen" : "ohne Text"}</span>;
}

export function DocumentList({
  docs,
  placementNodeId,
  emptyText,
  onOpen,
}: {
  docs: DocumentInfo[];
  /** Wenn gesetzt: Menüeintrag „Zuordnung entfernen“ für diesen Knoten */
  placementNodeId?: string;
  emptyText: string;
  onOpen?: (d: DocumentInfo) => void;
}) {
  const open = useApp((s) => s.open);
  const bump = useApp((s) => s.bump);
  const menu = useMenu();
  if (!docs.length) return <p className="muted small">{emptyText}</p>;
  const doOpen = (d: DocumentInfo) => (onOpen ? onOpen(d) : open({ type: "document", id: d.id }, { title: d.title }));
  return (
    <div className="list">
      {docs.map((d) => (
        <div key={d.id} className="list-row doc-row" role="button" tabIndex={0} onClick={() => doOpen(d)} onKeyDown={(e) => e.key === "Enter" && doOpen(d)}>
          <DocIcon ext={d.ext} />
          <span className="grow ellipsis">
            {d.title}
            <span className="muted xs"> · {d.ext.toUpperCase()}</span>
          </span>
          {!d.file_present && (
            <span className="status-pill is-danger" title="Die Datei fehlt im Dokumentenspeicher.">
              <AlertTriangle size={12} /> Datei fehlt
            </span>
          )}
          <span className="muted xs doc-type">{DOC_TYPE_LABEL[d.doc_type] ?? d.doc_type}</span>
          <TextStatus status={d.text_status} />
          <span className="muted xs tnum doc-size">{formatBytes(d.size)}</span>
          <span className="muted xs doc-date">{formatRelative(d.created_at)}</span>
          <IconButton
            label="Aktionen"
            onClick={(e) => {
              e.stopPropagation();
              menu.openBelow(e.currentTarget, [
                { label: "Öffnen", onSelect: () => doOpen(d) },
                { label: "Mit Standardprogramm öffnen (Kopie)", onSelect: () => void openExternally(d) },
                { label: "Kopie speichern unter …", onSelect: () => void saveCopyAs(d) },
                ...(placementNodeId
                  ? [
                      {
                        label: "Zuordnung hier entfernen",
                        onSelect: async () => {
                          await api.documentRemovePlacement(d.id, placementNodeId).catch(reportError);
                          bump();
                        },
                      },
                    ]
                  : []),
                { separator: true, label: "" },
                { label: "In den Papierkorb", danger: true, onSelect: () => void trashDocument(d) },
              ]);
            }}
          >
            <MoreHorizontal size={15} />
          </IconButton>
        </div>
      ))}
      {menu.el}
    </div>
  );
}
