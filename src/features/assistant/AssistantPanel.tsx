/**
 * KI-Assistent von jeder Seite aus: ein schwebendes Symbol unten rechts öffnet
 * eine Seitenleiste mit dem Chat. Auf Wunsch wird der Inhalt der gerade
 * geöffneten Notiz bzw. PDF einbezogen.
 */
import { Maximize2, RotateCcw, Sparkles, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { create } from "zustand";

import { api } from "../../api";
import type { AiStatus } from "../../api/types";
import { parseDoc, plainText } from "../../lib/pm";
import { reportError, useApp, type View } from "../../state/store";
import { Chat, Consent, KeySetup, type ContextSource } from "./AssistantView";
import { useAssistant } from "./state";

interface PanelState {
  open: boolean;
  toggle(v?: boolean): void;
}
export const useAssistantPanel = create<PanelState>((set, get) => ({
  open: false,
  toggle: (v) => set({ open: v ?? !get().open }),
}));

const MAX_CONTEXT = 40_000;

/** Text der aktuell geöffneten Seite als Kontext (Notiz oder Dokument). */
function contextFor(view: View): ContextSource | null {
  if (view.type === "note") {
    return {
      label: "Aktuelle Notiz",
      load: async () => {
        const n = await api.noteGet(view.id);
        return `Notiz „${n.title}“\n${plainText(parseDoc(n.content_json))}`.slice(0, MAX_CONTEXT);
      },
    };
  }
  if (view.type === "document") {
    return {
      label: "Aktuelles Dokument",
      load: async () => {
        const [{ document: d }, pages] = await Promise.all([api.documentGet(view.id), api.documentPagesText(view.id)]);
        const text = pages.map((p, i) => `[Seite ${i + 1}]\n${p}`).join("\n\n");
        if (!text.trim()) throw new Error("Aus diesem Dokument konnte kein Text gelesen werden.");
        return `Dokument „${d.title}“\n${text}`.slice(0, MAX_CONTEXT);
      },
    };
  }
  return null;
}

export function useAiReady() {
  const [consent, setConsent] = useState<boolean | null>(null);
  const [status, setStatus] = useState<AiStatus | null>(null);
  const reload = useCallback(async () => {
    const s = await api.settingsAll();
    setConsent(s["ai.consent"] === true);
    setStatus(await api.aiStatus());
  }, []);
  useEffect(() => {
    void reload().catch(reportError);
  }, [reload]);
  return { consent, status, reload };
}

export function AssistantFab() {
  const open = useAssistantPanel((s) => s.open);
  const toggle = useAssistantPanel((s) => s.toggle);
  const view = useApp((s) => s.view);
  const busy = useAssistant((s) => s.busy);
  // ⌘/Strg + J öffnet und schließt den Assistenten
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);
  if (api.kind === "mock" && !new URLSearchParams(location.search).has("demo")) return null;
  if (view.type === "assistant") return null;
  return (
    <>
      {!open && (
        <button className={`ai-fab ${busy ? "is-busy" : ""}`} onClick={() => toggle(true)} aria-label="KI-Assistent öffnen" title="KI-Assistent (⌘J)">
          <Sparkles size={22} />
        </button>
      )}
      {open && <AssistantPanel />}
    </>
  );
}

function AssistantPanel() {
  const toggle = useAssistantPanel((s) => s.toggle);
  const view = useApp((s) => s.view);
  const openView = useApp((s) => s.open);
  const reset = useAssistant((s) => s.reset);
  const entries = useAssistant((s) => s.entries.length);
  const busy = useAssistant((s) => s.busy);
  const { consent, status, reload } = useAiReady();
  const context = useMemo(() => contextFor(view), [view]);
  return (
    <aside className="ai-panel" aria-label="KI-Assistent">
      <header className="ai-panel-head">
        <Sparkles size={16} />
        <strong className="grow">KI-Assistent</strong>
        <button className="icon-btn" title="Neue Unterhaltung" aria-label="Neue Unterhaltung" onClick={reset} disabled={busy || !entries}>
          <RotateCcw size={16} />
        </button>
        <button
          className="icon-btn"
          title="Vollansicht mit Rechtsquellen und Einstellungen"
          aria-label="Vollansicht"
          onClick={() => {
            toggle(false);
            openView({ type: "assistant" });
          }}
        >
          <Maximize2 size={16} />
        </button>
        <button className="icon-btn" title="Schließen" aria-label="Schließen" onClick={() => toggle(false)}>
          <X size={18} />
        </button>
      </header>
      <div className="ai-panel-body">
        {consent === null || !status ? (
          <div className="loading">Lade …</div>
        ) : !consent ? (
          <Consent compact onDone={() => void reload()} />
        ) : (
          <>
            {!status.available && <KeySetup status={status} onChange={() => void reload()} />}
            <Chat available={status.available} compact context={context} />
          </>
        )}
      </div>
    </aside>
  );
}
