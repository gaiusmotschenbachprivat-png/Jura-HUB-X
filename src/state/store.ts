import { create } from "zustand";

import { api, errorMessage } from "../api";
import type { Area, KnowledgeType, StudyNode } from "../api/types";

export type View =
  | { type: "dashboard" }
  | { type: "note"; id: string }
  | { type: "node"; id: string }
  | { type: "document"; id: string; page?: number }
  | { type: "documents" }
  | { type: "search"; q: string }
  | { type: "trash" }
  | { type: "knowledge"; id: string }
  | { type: "knowledge-list"; kind: KnowledgeType }
  | { type: "cards"; id?: string }
  | { type: "learn" }
  | { type: "planning" }
  | { type: "assistant" }
  | { type: "settings"; tab?: "allgemein" | "backup" | "daten" | "bereiche" };

export type Secondary = { type: "document"; id: string; page?: number } | { type: "note"; id: string } | null;

export type SaveStatus = "saved" | "dirty" | "saving" | "error";
export type Theme = "system" | "light" | "dark";

export interface Toast {
  id: number;
  text: string;
  kind: "info" | "error" | "success";
}

interface RecentEntry {
  key: string;
  view: View;
  title: string;
  at: number;
}

/** ID des geöffneten Inhalts (falls die Ansicht einen hat). */
export function viewId(v: View): string | null {
  return "id" in v && typeof v.id === "string" ? v.id : null;
}

const viewKey = (v: View) => (viewId(v) ? `${v.type}:${viewId(v)}` : v.type === "knowledge-list" ? `${v.type}:${v.kind}` : v.type);

interface State {
  ready: boolean;
  bootError: string | null;
  areas: Area[];
  /** ID des aktiven Studienbereichs oder "all" für die Gesamtansicht */
  areaId: string | "all";
  nodes: StudyNode[];
  areaRefs: StudyNode[];
  expanded: Record<string, boolean>;
  showArchived: boolean;

  view: View;
  history: View[];
  historyIndex: number;
  recent: RecentEntry[];
  secondary: Secondary;

  contextOpen: boolean;
  sidebarWidth: number;
  contextWidth: number;
  secondaryWidth: number;
  paletteOpen: boolean;

  saveStatus: SaveStatus;
  saveError: string | null;
  lastSavedAt: string | null;
  lastSavedId: string | null;

  theme: Theme;
  fontScale: number;
  editorFont: "serif" | "sans";
  focusMode: boolean;

  /** Wird erhöht, wenn sich Dokumente/Verknüpfungen geändert haben. */
  dataVersion: number;
  toasts: Toast[];

  init(): Promise<void>;
  reloadAreas(): Promise<void>;
  reloadNodes(): Promise<void>;
  selectArea(id: string | "all"): Promise<void>;
  open(view: View, opts?: { title?: string }): void;
  back(): void;
  forward(): void;
  rememberTitle(view: View, title: string): void;
  openSecondary(s: Secondary): void;
  setExpanded(id: string, open: boolean): void;
  expandPath(ids: string[]): void;
  toggleContext(): void;
  setPalette(open: boolean): void;
  setSaveStatus(s: SaveStatus, err?: string | null, savedAt?: string | null, id?: string): void;
  setPref<K extends "theme" | "fontScale" | "editorFont" | "sidebarWidth" | "contextWidth" | "secondaryWidth" | "showArchived" | "focusMode">(
    key: K,
    value: State[K],
  ): void;
  bump(): void;
  toast(text: string, kind?: Toast["kind"]): void;
  dismissToast(id: number): void;
}

const PREF_KEYS: Record<string, string> = {
  theme: "ui.theme",
  fontScale: "ui.fontScale",
  editorFont: "ui.editorFont",
  sidebarWidth: "ui.sidebarWidth",
  contextWidth: "ui.contextWidth",
  secondaryWidth: "ui.secondaryWidth",
  showArchived: "ui.showArchived",
  contextOpen: "ui.contextOpen",
  areaId: "ui.lastArea",
  expanded: "ui.expanded",
};

const pending = new Map<string, unknown>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
function persist(key: string, value: unknown) {
  pending.set(key, value);
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    for (const [k, v] of pending) void api.settingSet(k, v).catch(() => {});
    pending.clear();
  }, 400);
}

let toastId = 0;

export const useApp = create<State>((set, get) => ({
  ready: false,
  bootError: null,
  areas: [],
  areaId: "all",
  nodes: [],
  areaRefs: [],
  expanded: {},
  showArchived: false,
  view: { type: "dashboard" },
  history: [{ type: "dashboard" }],
  historyIndex: 0,
  recent: [],
  secondary: null,
  contextOpen: true,
  sidebarWidth: 280,
  contextWidth: 300,
  secondaryWidth: 560,
  paletteOpen: false,
  saveStatus: "saved",
  saveError: null,
  lastSavedAt: null,
  lastSavedId: null,
  theme: "system",
  fontScale: 1,
  editorFont: "serif",
  focusMode: false,
  dataVersion: 0,
  toasts: [],

  async init() {
    try {
      const [areas, settings] = await Promise.all([api.areasList(), api.settingsAll()]);
      const s = settings as Record<string, unknown>;
      const lastArea = typeof s["ui.lastArea"] === "string" ? (s["ui.lastArea"] as string) : "all";
      const areaId = lastArea === "all" || areas.some((a) => a.id === lastArea) ? lastArea : "all";
      set({
        areas,
        areaId,
        theme: (s["ui.theme"] as Theme) ?? "system",
        fontScale: typeof s["ui.fontScale"] === "number" ? (s["ui.fontScale"] as number) : 1,
        editorFont: s["ui.editorFont"] === "sans" ? "sans" : "serif",
        sidebarWidth: typeof s["ui.sidebarWidth"] === "number" ? (s["ui.sidebarWidth"] as number) : 280,
        contextWidth: typeof s["ui.contextWidth"] === "number" ? (s["ui.contextWidth"] as number) : 300,
        secondaryWidth: typeof s["ui.secondaryWidth"] === "number" ? (s["ui.secondaryWidth"] as number) : 560,
        contextOpen: s["ui.contextOpen"] !== false,
        showArchived: s["ui.showArchived"] === true,
        expanded: (s["ui.expanded"] as Record<string, boolean>) ?? {},
      });
      await get().reloadNodes();
      set({ ready: true });
    } catch (e) {
      set({ bootError: errorMessage(e), ready: true });
    }
  },

  async reloadAreas() {
    set({ areas: await api.areasList() });
  },

  async reloadNodes() {
    const { areaId } = get();
    const id = areaId === "all" ? null : areaId;
    const [nodes, areaRefs] = await Promise.all([api.nodesList(id), id ? api.areaRefsList(id) : Promise.resolve([])]);
    set({ nodes, areaRefs });
  },

  async selectArea(id) {
    set({ areaId: id });
    persist(PREF_KEYS.areaId!, id);
    await get().reloadNodes();
  },

  open(view, opts) {
    const { history, historyIndex, view: cur } = get();
    if (viewKey(cur) === viewKey(view) && JSON.stringify(cur) === JSON.stringify(view)) return;
    const h = history.slice(0, historyIndex + 1);
    h.push(view);
    while (h.length > 100) h.shift();
    set({ view, history: h, historyIndex: h.length - 1 });
    if (opts?.title) get().rememberTitle(view, opts.title);
  },

  back() {
    const { history, historyIndex } = get();
    if (historyIndex > 0) set({ historyIndex: historyIndex - 1, view: history[historyIndex - 1]! });
  },

  forward() {
    const { history, historyIndex } = get();
    if (historyIndex < history.length - 1) set({ historyIndex: historyIndex + 1, view: history[historyIndex + 1]! });
  },

  rememberTitle(view, title) {
    if (!viewId(view)) return;
    const key = viewKey(view);
    const recent = [{ key, view, title, at: Date.now() }, ...get().recent.filter((r) => r.key !== key)].slice(0, 20);
    set({ recent });
  },

  openSecondary(s) {
    set({ secondary: s });
  },

  setExpanded(id, open) {
    const expanded = { ...get().expanded, [id]: open };
    if (!open) delete expanded[id];
    set({ expanded });
    persist(PREF_KEYS.expanded!, expanded);
  },

  expandPath(ids) {
    const expanded = { ...get().expanded };
    for (const id of ids) expanded[id] = true;
    set({ expanded });
    persist(PREF_KEYS.expanded!, expanded);
  },

  toggleContext() {
    const v = !get().contextOpen;
    set({ contextOpen: v });
    persist(PREF_KEYS.contextOpen!, v);
  },

  setPalette(open) {
    set({ paletteOpen: open });
  },

  setSaveStatus(s, err = null, savedAt, id) {
    set({ saveStatus: s, saveError: err, ...(savedAt ? { lastSavedAt: savedAt, lastSavedId: id ?? null } : {}) });
  },

  setPref(key, value) {
    set({ [key]: value } as Partial<State>);
    const k = PREF_KEYS[key];
    if (k) persist(k, value);
  },

  bump() {
    set({ dataVersion: get().dataVersion + 1 });
  },

  toast(text, kind = "info") {
    const id = ++toastId;
    set({ toasts: [...get().toasts, { id, text, kind }] });
    setTimeout(() => get().dismissToast(id), kind === "error" ? 8000 : 3500);
  },

  dismissToast(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },
}));

/** Kurzform für Fehler-Toasts. */
export function reportError(e: unknown) {
  useApp.getState().toast(errorMessage(e), "error");
}

export function areaById(id: string | null | undefined): Area | undefined {
  return useApp.getState().areas.find((a) => a.id === id);
}
