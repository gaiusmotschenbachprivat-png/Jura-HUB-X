/**
 * Zustand des KI-Assistenten. Unterhaltungen werden nach jeder Antwort lokal
 * gespeichert (Verlauf, abschaltbar unter „ai.history“) und lassen sich später
 * fortsetzen – gesendet wird dabei nur, was auch ohne Speichern ginge.
 */
import { create } from "zustand";

import { api } from "../../api";
import type { AiChatMeta } from "../../api/types";
import { LegalAssistant, type AskResult, type AssistantSnapshot, type Task } from "../../ai/assistant";
import { aiErrorMessage, appClient, type LlmClient } from "../../ai/client";
import { Anonymizer, configFromSettings } from "../../ai/privacy/anonymize";
import { PROFILE_SETTING, profileFromSettings } from "../../ai/config";
import { reportError, useApp } from "../../state/store";
import { upgradeTextLaws } from "../../ai/sources/importer";
import { addSpend, checkBudget } from "./AiProfile";

export const HISTORY_SETTING = "ai.history";

let upgradeRun: Promise<void> | null = null;
/** Einmal je Sitzung: früher als Text importierte Gesetze in Paragraphen zerlegen. */
export function upgradeOldLaws(): Promise<void> {
  upgradeRun ??= upgradeTextLaws(api)
    .then((done) => {
      for (const s of done)
        useApp.getState().toast(`„${s.abbreviation}“ war als einfacher Text gespeichert und wurde jetzt als Gesetz mit ${s.chunk_count.toLocaleString("de-DE")} Abschnitten aufbereitet.`, "success");
    })
    .catch(reportError);
  return upgradeRun;
}

export type Entry =
  | { role: "user"; text: string; document?: string }
  | { role: "assistant"; result: AskResult }
  | { role: "error"; text: string };

interface AssistantState {
  task: Task;
  ownDocs: boolean;
  entries: Entry[];
  busy: boolean;
  assistant: LegalAssistant | null;
  /** gespeicherte Unterhaltung, die gerade offen ist */
  chatId: string | null;
  /** Stand einer geladenen Unterhaltung, bis der Assistent dafür erzeugt wird */
  restore: AssistantSnapshot | null;
  chats: AiChatMeta[];
  setTask(t: Task): void;
  setOwnDocs(v: boolean): void;
  reset(): void;
  ask(question: string, document?: string): Promise<void>;
  /** Claude-App-Brücke: Anfrage zum Kopieren (ohne API-Kosten) */
  bridgePrepare(question: string, document?: string): Promise<{ prompt: string; userText: string }>;
  /** Claude-App-Brücke: eingefügte Antwort prüfen und in die Unterhaltung übernehmen */
  bridgeAccept(question: string, document: string | undefined, userText: string, answer: string): Promise<void>;
  loadChats(): Promise<void>;
  openChat(id: string): Promise<void>;
  deleteChat(id: string): Promise<void>;
  clearChats(): Promise<void>;
}

const FRESH = { entries: [] as Entry[], assistant: null, chatId: null, restore: null };

/** Für die Anzeige gespeichert; Quellen stehen einmal im Verlauf statt in jeder Antwort. */
function storedEntries(entries: Entry[]) {
  return entries.map((e) => (e.role === "assistant" ? { ...e, result: { ...e.result, sources: [] } } : e));
}

function loadedEntries(raw: unknown, snapshot: AssistantSnapshot | null): Entry[] {
  if (!Array.isArray(raw)) return [];
  const sources = snapshot?.sources ?? [];
  return raw.filter((e): e is Entry => !!e && typeof e === "object" && ["user", "assistant", "error"].includes((e as Entry).role)).map((e) => (e.role === "assistant" ? { ...e, result: { ...e.result, sources } } : e));
}

const parse = (s: string): unknown => {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};

const stripMarks = (s: string) => s.replace(/[\u0002\u0003]/g, "");

async function ownDocuments(query: string) {
  const hits = await api.search(query, null);
  return hits
    .filter((h) => ["note", "page", "document", "knowledge"].includes(h.entity_type))
    .slice(0, 6)
    .map((h) => ({ title: stripMarks(h.title), path: h.path, snippet: stripMarks(h.snippet) }));
}

export const useAssistant = create<AssistantState>((set, get) => ({
  task: "recherche",
  ownDocs: false,
  busy: false,
  chats: [],
  ...FRESH,
  setTask: (task) => set({ task, ...FRESH }),
  setOwnDocs: (ownDocs) => set({ ownDocs, ...FRESH }),
  reset: () => set({ ...FRESH }),
  async ask(question, document) {
    if (get().busy || !question.trim()) return;
    set({ busy: true, entries: [...get().entries, { role: "user", text: question, document }] });
    try {
      await checkBudget();
      const a = await ensureAssistant();
      // Modellwahl bei jeder Frage neu lesen (kann zwischendurch geändert werden)
      a.setProfile(profileFromSettings((await api.settingsAll())[PROFILE_SETTING]));
      const result = await a.ask(question, document);
      void addSpend(result.usage.costUsd, result.usage.requests);
      set({ entries: [...get().entries, { role: "assistant", result }] });
    } catch (e) {
      set({ entries: [...get().entries, { role: "error", text: aiErrorMessage(e) }] });
    }
    // Gespeichert wird, solange `busy` gilt – so ändert sich der Verlauf währenddessen nicht
    await save().catch(reportError);
    set({ busy: false });
  },
  async bridgePrepare(question, document) {
    const a = await ensureAssistant();
    return a.prepareExternal(question, document);
  },
  async bridgeAccept(question, document, userText, answer) {
    if (get().busy || !answer.trim()) return;
    set({ busy: true });
    try {
      const a = await ensureAssistant();
      const result = await a.acceptExternal(userText, answer);
      set({ entries: [...get().entries, { role: "user", text: question, document }, { role: "assistant", result }] });
      await save().catch(reportError);
    } finally {
      set({ busy: false });
    }
  },
  async loadChats() {
    set({ chats: await api.aiChatsList() });
  },
  async openChat(id) {
    if (get().busy) return;
    const chat = await api.aiChatGet(id);
    const st = parse(chat.state) as AssistantSnapshot | null;
    const snapshot = st && st.v === 1 && Array.isArray(st.messages) ? st : null;
    set({ task: chat.task, ownDocs: chat.own_docs, entries: loadedEntries(parse(chat.entries), snapshot), assistant: null, chatId: chat.id, restore: snapshot });
  },
  async deleteChat(id) {
    await api.aiChatDelete(id);
    if (get().chatId === id) set({ chatId: null });
    await get().loadChats();
  },
  async clearChats() {
    await api.aiChatsClear();
    set({ chatId: null, chats: [] });
  },
}));

/**
 * Assistent der laufenden Unterhaltung (bei Bedarf neu). Der API-Zugang wird
 * erst bei der ersten bezahlten Anfrage geholt – die Claude-App-Brücke
 * funktioniert so auch ohne API-Schlüssel.
 */
async function ensureAssistant(): Promise<LegalAssistant> {
  const st = useAssistant.getState();
  if (st.assistant) return st.assistant;
  await upgradeOldLaws();
  const settings = await api.settingsAll();
  const systemPrompt = typeof settings["ai.systemPrompt"] === "string" ? (settings["ai.systemPrompt"] as string) : undefined;
  let client: Promise<LlmClient> | null = null;
  const a = new LegalAssistant({
    llm: { create: async (p) => (await (client ??= appClient(api))).create(p) },
    store: api,
    task: st.task,
    systemPrompt,
    anonymizer: new Anonymizer(configFromSettings(settings["ai.anonymize"])),
    ownDocuments: st.ownDocs ? ownDocuments : undefined,
    restore: st.restore ?? undefined,
  });
  useAssistant.setState({ assistant: a, restore: null });
  return a;
}

/** Nach jeder Frage: Unterhaltung lokal sichern (sofern der Verlauf eingeschaltet ist). */
async function save() {
  const st = useAssistant.getState();
  if (!st.entries.some((e) => e.role === "assistant")) return;
  if ((await api.settingsAll())[HISTORY_SETTING] === false) return;
  const snapshot = st.assistant?.snapshot() ?? st.restore;
  if (!snapshot) return;
  const first = st.entries.find((e) => e.role === "user");
  const meta = await api.aiChatSave({
    id: st.chatId,
    title: first?.role === "user" ? first.text.slice(0, 200) : "Unterhaltung",
    task: st.task,
    own_docs: st.ownDocs,
    entries: JSON.stringify(storedEntries(st.entries)),
    state: JSON.stringify(snapshot),
  });
  useAssistant.setState({ chatId: meta.id });
}
