import { AlertCircle, ArrowLeft, ArrowRight, Check, Loader2, PanelLeft, PanelRight } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { api } from "./api";
import { ContextPanel } from "./features/context/ContextPanel";
import { KnowledgeEditor } from "./features/knowledge/KnowledgeEditor";
import { KnowledgeList } from "./features/knowledge/KnowledgeList";
import { CardsView } from "./features/learn/CardsView";
import { LearnSession } from "./features/learn/LearnSession";
import { PlanningView } from "./features/planning/PlanningView";
import { TimetableView } from "./features/planning/TimetableView";
import { AssistantView } from "./features/assistant/AssistantView";
import { AssistantFab } from "./features/assistant/AssistantPanel";
import { Dashboard } from "./features/dashboard/Dashboard";
import { DocumentsView } from "./features/documents/DocumentsView";
import { DocumentViewer } from "./features/documents/DocumentViewer";
import { ImportHost, useImport } from "./features/documents/ImportDialog";
import { resumePendingExtractions } from "./features/documents/textExtraction";
import { NoteEditor } from "./features/editor/NoteEditor";
import { flushAll, hasPending, retry } from "./features/editor/saveQueue";
import { createNode } from "./features/navigation/actions";
import { Sidebar } from "./features/navigation/Sidebar";
import { NodeView } from "./features/node/NodeView";
import { Onboarding } from "./features/onboarding/Onboarding";
import { SearchPalette } from "./features/search/SearchPalette";
import { SettingsView } from "./features/settings/SettingsView";
import { TrashView } from "./features/settings/TrashView";
import { formatRelative } from "./lib/format";
import { ancestors } from "./lib/tree";
import { NARROW_WIDTH, useApp, viewId, type View } from "./state/store";
import { IconButton } from "./ui/Button";
import { MOD, Toasts } from "./ui/misc";
import { Splitter } from "./ui/Splitter";
import { BackupReminder } from "./features/settings/BackupReminder";

export function App() {
  const ready = useApp((s) => s.ready);
  const bootError = useApp((s) => s.bootError);
  const areas = useApp((s) => s.areas);
  const init = useApp((s) => s.init);
  const theme = useApp((s) => s.theme);
  const fontScale = useApp((s) => s.fontScale);

  useEffect(() => {
    void init().then(() => void resumePendingExtractions());
  }, [init]);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
    root.style.setProperty("--font-scale", String(fontScale));
  }, [theme, fontScale]);

  if (!ready) return <div className="boot">Studium OS wird gestartet …</div>;
  if (bootError)
    return (
      <div className="boot">
        <div className="onb-card">
          <h1>Studium OS konnte nicht starten</h1>
          <p>{bootError}</p>
          <p className="small muted">Deine Daten wurden nicht verändert. Starte die App neu. Bleibt der Fehler, hilft das Fehlerprotokoll im Datenordner bei der Ursachensuche.</p>
        </div>
      </div>
    );
  if (areas.length === 0) return <Onboarding />;
  return <Shell />;
}

function Shell() {
  const view = useApp((s) => s.view);
  const secondary = useApp((s) => s.secondary);
  const contextOpen = useApp((s) => s.contextOpen);
  const narrow = useApp((s) => s.narrow);
  const contextOverlay = useApp((s) => s.contextOverlay);
  const setNarrow = useApp((s) => s.setNarrow);
  const sidebarWidth = useApp((s) => s.sidebarWidth);
  const contextWidth = useApp((s) => s.contextWidth);
  const secondaryWidth = useApp((s) => s.secondaryWidth);
  const focusMode = useApp((s) => s.focusMode);
  const setPref = useApp((s) => s.setPref);
  const [dropHover, setDropHover] = useState(false);
  const [workspaceWidth, setWorkspaceWidth] = useState(1200);
  const workspaceRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = workspaceRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWorkspaceWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Die Mitschrift behält mindestens 420 px, die Folie bekommt den Rest.
  const maxSecondary = Math.max(320, workspaceWidth - 420);
  const effSecondary = Math.min(secondaryWidth, maxSecondary);
  const startImport = useImport();

  useGlobalShortcuts();

  // Geöffneten Eintrag im Baum sichtbar machen
  const nodes = useApp((s) => s.nodes);
  const expandPath = useApp((s) => s.expandPath);
  const treeId = view.type === "note" || view.type === "node" ? view.id : null;
  useEffect(() => {
    if (!treeId) return;
    const anc = ancestors(nodes, treeId);
    const expanded = useApp.getState().expanded;
    if (anc.some((id) => !expanded[id])) expandPath(anc);
  }, [treeId, nodes, expandPath]);

  // Dateien ins Fenster ziehen → Import
  useEffect(() => api.onFileDrop((paths) => void startImport({ paths }), setDropHover), [startImport]);

  // Vor dem Schließen alles speichern
  useEffect(() => {
    const onBefore = (e: BeforeUnloadEvent) => {
      if (hasPending()) {
        void flushAll();
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", onBefore);
    let unlisten: (() => void) | undefined;
    if (api.kind === "tauri") {
      void import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
        const w = getCurrentWindow();
        void w
          .onCloseRequested(async (ev) => {
            if (hasPending()) {
              ev.preventDefault();
              await flushAll();
              await w.destroy();
            }
          })
          .then((u) => (unlisten = u));
      });
    }
    return () => {
      window.removeEventListener("beforeunload", onBefore);
      unlisten?.();
    };
  }, []);

  const showSecondary = view.type === "note" && secondary;
  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < NARROW_WIDTH);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [setNarrow]);
  const showContext = (narrow ? contextOverlay : contextOpen) && !focusMode && ["note", "node", "document", "knowledge"].includes(view.type);

  return (
    <div className={`shell ${focusMode ? "is-focus" : ""}`}>
      {!focusMode && (
        <>
          <div className="shell-side" style={{ width: sidebarWidth }}>
            <Sidebar />
          </div>
          <Splitter value={sidebarWidth} min={220} max={460} side="left" label="Breite der Seitenleiste" onChange={(v) => setPref("sidebarWidth", v)} />
        </>
      )}
      <div className="shell-main">
        <Topbar />
        <div className="workspace" ref={workspaceRef}>
          <main className="primary" key={viewId(view) ?? (view.type === "knowledge-list" ? `kl-${view.kind}` : view.type)}>
            <ViewSwitch view={view} />
          </main>
          {showSecondary && (
            <>
              <Splitter value={effSecondary} min={320} max={maxSecondary} side="right" label="Breite der geteilten Ansicht" onChange={(v) => setPref("secondaryWidth", v)} />
              <section className="secondary" style={{ width: effSecondary }} aria-label="Geteilte Ansicht">
                {secondary.type === "document" ? (
                  <DocumentViewer key={secondary.id} id={secondary.id} page={secondary.page} compact linkTargetNoteId={view.id} />
                ) : (
                  <NoteEditor key={secondary.id} id={secondary.id} compact />
                )}
              </section>
            </>
          )}
        </div>
      </div>
      {showContext && narrow && (
        <div className="shell-context is-overlay" style={{ width: Math.min(contextWidth, 380) }}>
          <ContextPanel />
        </div>
      )}
      {showContext && !narrow && (
        <>
          <Splitter value={contextWidth} min={240} max={480} side="right" label="Breite des Kontextbereichs" onChange={(v) => setPref("contextWidth", v)} />
          <div className="shell-context" style={{ width: contextWidth }}>
            <ContextPanel />
          </div>
        </>
      )}
      {dropHover && (
        <div className="drop-overlay">
          <div>Dateien loslassen, um sie zu importieren</div>
        </div>
      )}
      <SearchPalette />
      <AssistantFab />
      {api.kind === "web" && <BackupReminder />}
      <ImportHost />
      <Toasts />
    </div>
  );
}

function ViewSwitch({ view }: { view: View }) {
  switch (view.type) {
    case "dashboard":
      return <Dashboard />;
    case "note":
      return <NoteEditor id={view.id} />;
    case "node":
      return <NodeView id={view.id} />;
    case "document":
      return <DocumentViewer id={view.id} page={view.page} />;
    case "documents":
      return <DocumentsView />;
    case "trash":
      return <TrashView />;
    case "settings":
      return <SettingsView tab={view.tab} />;
    case "search":
      return <Dashboard />;
    case "knowledge":
      return <KnowledgeEditor id={view.id} />;
    case "knowledge-list":
      return <KnowledgeList type={view.kind} />;
    case "cards":
      return <CardsView focusId={view.id} />;
    case "learn":
      return <LearnSession />;
    case "planning":
      return <PlanningView />;
    case "timetable":
      return <TimetableView />;
    case "assistant":
      return <AssistantView />;
  }
}

function Topbar() {
  const back = useApp((s) => s.back);
  const forward = useApp((s) => s.forward);
  const historyIndex = useApp((s) => s.historyIndex);
  const historyLen = useApp((s) => s.history.length);
  const view = useApp((s) => s.view);
  const saveStatus = useApp((s) => s.saveStatus);
  const saveError = useApp((s) => s.saveError);
  const lastSavedAt = useApp((s) => (viewId(s.view) && s.lastSavedId === viewId(s.view) ? s.lastSavedAt : null));
  const contextOpen = useApp((s) => (s.narrow ? s.contextOverlay : s.contextOpen));
  const toggleContext = useApp((s) => s.toggleContext);
  const focusMode = useApp((s) => s.focusMode);
  const setPref = useApp((s) => s.setPref);
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 30000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="topbar">
      <IconButton label={`Seitenleiste ${focusMode ? "einblenden" : "ausblenden"} (${MOD}+\\)`} onClick={() => setPref("focusMode", !focusMode)}>
        <PanelLeft size={16} />
      </IconButton>
      <IconButton label={`Zurück (${MOD}+[)`} disabled={historyIndex === 0} onClick={back}>
        <ArrowLeft size={16} />
      </IconButton>
      <IconButton label={`Vorwärts (${MOD}+])`} disabled={historyIndex >= historyLen - 1} onClick={forward}>
        <ArrowRight size={16} />
      </IconButton>
      <span className="grow" />
      {view.type === "note" && (
        <span className={`save-status is-${saveStatus}`} role="status" aria-live="polite" title={saveError ?? undefined}>
          {saveStatus === "saving" && (
            <>
              <Loader2 size={13} className="spin" /> Speichert …
            </>
          )}
          {saveStatus === "dirty" && <>Änderungen …</>}
          {saveStatus === "saved" && (
            <>
              <Check size={13} /> Gespeichert{lastSavedAt ? ` · ${formatRelative(lastSavedAt)}` : ""}
            </>
          )}
          {saveStatus === "error" && (
            <>
              <AlertCircle size={13} /> Nicht gespeichert: {saveError}
              <button className="link-btn" onClick={() => view.type === "note" && void retry(view.id)}>
                Erneut versuchen
              </button>
            </>
          )}
        </span>
      )}
      {["note", "node", "document", "knowledge"].includes(view.type) && !focusMode && (
        <IconButton label={`Kontextbereich (${MOD}+.)`} active={contextOpen} onClick={toggleContext}>
          <PanelRight size={16} />
        </IconButton>
      )}
    </div>
  );
}

function useGlobalShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = useApp.getState();
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const inEditor = (e.target as HTMLElement)?.closest?.(".ProseMirror");
      const k = e.key.toLowerCase();
      if (k === "k" && !inEditor) {
        e.preventDefault();
        st.setPalette(!st.paletteOpen);
      } else if (k === "n" && !e.shiftKey) {
        e.preventDefault();
        const v = st.view;
        const parent = v.type === "node" ? st.nodes.find((n) => n.id === v.id) : undefined;
        const areaId = parent?.area_id ?? (st.areaId !== "all" ? st.areaId : st.areas[0]?.id);
        if (areaId) void createNode({ areaId, parentId: parent?.id ?? null, kind: "note", title: "Neue Notiz" });
      } else if (k === "." && !inEditor) {
        e.preventDefault();
        st.toggleContext();
      } else if (k === "\\") {
        e.preventDefault();
        st.setPref("focusMode", !st.focusMode);
      } else if (k === "[" || (e.altKey && e.key === "ArrowLeft")) {
        e.preventDefault();
        st.back();
      } else if (k === "]" || (e.altKey && e.key === "ArrowRight")) {
        e.preventDefault();
        st.forward();
      } else if (/^[0-9]$/.test(k) && !e.altKey && !inEditor) {
        e.preventDefault();
        const i = Number(k);
        const visible = st.areas.filter((a) => !a.archived_at);
        if (i === 0) void st.selectArea("all");
        else if (visible[i - 1]) void st.selectArea(visible[i - 1]!.id);
      } else if (k === "s" && !inEditor) {
        e.preventDefault();
        void flushAll();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
