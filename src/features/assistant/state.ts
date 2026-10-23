/** Zustand des KI-Assistenten (nur im Arbeitsspeicher; Unterhaltungen werden nicht gespeichert). */
import { create } from "zustand";

import { api } from "../../api";
import { LegalAssistant, type AskResult, type Task } from "../../ai/assistant";
import { aiErrorMessage, appClient } from "../../ai/client";
import { Anonymizer, configFromSettings } from "../../ai/privacy/anonymize";
import { PROFILE_SETTING, profileFromSettings } from "../../ai/config";
import { addSpend } from "./AiProfile";

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
  setTask(t: Task): void;
  setOwnDocs(v: boolean): void;
  reset(): void;
  ask(question: string, document?: string): Promise<void>;
}

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
  entries: [],
  busy: false,
  assistant: null,
  setTask: (task) => set({ task, entries: [], assistant: null }),
  setOwnDocs: (ownDocs) => set({ ownDocs, assistant: null, entries: [] }),
  reset: () => set({ entries: [], assistant: null }),
  async ask(question, document) {
    if (get().busy || !question.trim()) return;
    set({ busy: true, entries: [...get().entries, { role: "user", text: question, document }] });
    try {
      let a = get().assistant;
      if (!a) {
        const settings = await api.settingsAll();
        const systemPrompt = typeof settings["ai.systemPrompt"] === "string" ? (settings["ai.systemPrompt"] as string) : undefined;
        a = new LegalAssistant({
          llm: await appClient(api),
          store: api,
          task: get().task,
          systemPrompt,
          anonymizer: new Anonymizer(configFromSettings(settings["ai.anonymize"])),
          ownDocuments: get().ownDocs ? ownDocuments : undefined,
        });
        set({ assistant: a });
      }
      // Modellwahl bei jeder Frage neu lesen (kann zwischendurch geändert werden)
      a.setProfile(profileFromSettings((await api.settingsAll())[PROFILE_SETTING]));
      const result = await a.ask(question, document);
      void addSpend(result.usage.costUsd, result.usage.requests);
      set({ entries: [...get().entries, { role: "assistant", result }] });
    } catch (e) {
      set({ entries: [...get().entries, { role: "error", text: aiErrorMessage(e) }] });
    } finally {
      set({ busy: false });
    }
  },
}));
