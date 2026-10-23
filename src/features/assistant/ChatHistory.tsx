/**
 * Verlauf des KI-Assistenten: gespeicherte Unterhaltungen ansehen, fortsetzen
 * und löschen. Alles bleibt auf diesem Gerät (und in den Backups).
 */
import { History, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { api } from "../../api";
import { formatRelative } from "../../lib/format";
import { reportError } from "../../state/store";
import { Button, IconButton } from "../../ui/Button";
import { confirmDialog, Dialog } from "../../ui/Dialog";
import { HISTORY_SETTING, useAssistant } from "./state";

const TASK_LABEL: Record<string, string> = { recherche: "Recherche", vertrag: "Vertragsprüfung", schriftsatz: "Schriftsatz" };

export function HistoryButton({ disabled }: { disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <IconButton label="Verlauf" onClick={() => setOpen(true)} disabled={disabled}>
        <History size={16} />
      </IconButton>
      {open && <ChatHistory onClose={() => setOpen(false)} />}
    </>
  );
}

export function ChatHistory({ onClose }: { onClose: () => void }) {
  const { chats, chatId, loadChats, openChat, deleteChat, clearChats } = useAssistant();
  const [q, setQ] = useState("");
  const [keep, setKeep] = useState<boolean | null>(null);
  useEffect(() => {
    void loadChats().catch(reportError);
    void api
      .settingsAll()
      .then((s) => setKeep(s[HISTORY_SETTING] !== false))
      .catch(reportError);
  }, [loadChats]);
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? chats.filter((c) => c.title.toLowerCase().includes(t)) : chats;
  }, [chats, q]);

  const toggleKeep = async (v: boolean) => {
    setKeep(v);
    await api.settingSet(HISTORY_SETTING, v).catch(reportError);
  };
  const remove = async (id: string, title: string) => {
    if (!(await confirmDialog({ title: "Unterhaltung löschen?", message: `„${title}“ wird von diesem Gerät gelöscht.`, confirm: "Löschen", danger: true }))) return;
    await deleteChat(id).catch(reportError);
  };
  const removeAll = async () => {
    if (!(await confirmDialog({ title: "Ganzen Verlauf löschen?", message: `Alle ${chats.length} gespeicherten Unterhaltungen werden von diesem Gerät gelöscht.`, confirm: "Alle löschen", danger: true }))) return;
    await clearChats().catch(reportError);
  };

  return (
    <Dialog
      title="Verlauf"
      onClose={onClose}
      width={560}
      footer={
        <>
          {chats.length > 0 && (
            <Button variant="ghost" icon={<Trash2 size={14} />} onClick={() => void removeAll()}>
              Alle löschen
            </Button>
          )}
          <span className="grow" />
          <Button onClick={onClose}>Schließen</Button>
        </>
      }
    >
      <div className="stack">
        {chats.length > 4 && (
          <label className="slide-search">
            <Search size={14} />
            <input placeholder="Unterhaltung suchen …" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Unterhaltung suchen" />
          </label>
        )}
        <div className="slide-list ai-history" role="list">
          {shown.map((c) => (
            <div key={c.id} role="listitem" className={`ai-history-row ${c.id === chatId ? "is-current" : ""}`}>
              <button
                className="slide-pick grow"
                onClick={() =>
                  void openChat(c.id)
                    .then(onClose)
                    .catch(reportError)
                }
                aria-current={c.id === chatId || undefined}
              >
                <span className="grow ellipsis">{c.title}</span>
                <span className="xs muted nowrap">
                  {TASK_LABEL[c.task] ?? c.task} · {formatRelative(c.updated_at)}
                </span>
              </button>
              <IconButton label={`„${c.title}“ löschen`} onClick={() => void remove(c.id, c.title)}>
                <Trash2 size={14} />
              </IconButton>
            </div>
          ))}
          {!shown.length && (
            <p className="small muted">{q.trim() ? "Kein Treffer." : keep === false ? "Der Verlauf ist ausgeschaltet." : "Noch keine gespeicherten Unterhaltungen. Nach der ersten Antwort erscheint die Unterhaltung hier."}</p>
          )}
        </div>
        <label className="row small">
          <input type="checkbox" checked={keep ?? true} disabled={keep === null} onChange={(e) => void toggleKeep(e.target.checked)} />
          Unterhaltungen speichern
        </label>
        <p className="xs muted">
          Gespeichert wird nur auf diesem Gerät (auch in deinen Backups und beim Abgleich mit dem zweiten Gerät) – mit den Originalangaben, die vor dem Senden anonymisiert
          wurden. Beim Fortsetzen geht wie immer nur die anonymisierte Unterhaltung an Anthropic.
        </p>
      </div>
    </Dialog>
  );
}
