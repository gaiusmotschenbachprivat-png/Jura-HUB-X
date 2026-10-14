/**
 * Ablauf einer Anfrage an den juristischen Assistenten:
 *
 *   Frage ─► anonymisieren ─► Quellen abrufen [Q1…] ─► Claude (mit Werkzeugen)
 *         ─► Zitate prüfen ─► ggf. eine Überarbeitungsrunde ─► zurückübersetzen
 *
 * Der Verlauf wird nur angehängt (nie nachträglich verändert), damit
 * Denkblöcke gültig bleiben und der Prompt-Cache greift.
 */
import type {
  BetaContentBlock,
  BetaMessage,
  BetaMessageParam,
  BetaToolResultBlockParam,
  BetaToolUseBlock,
  MessageCreateParamsNonStreaming,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";

import systemPrompt from "../../prompts/system.md?raw";
import recherche from "../../prompts/aufgaben/recherche.md?raw";
import schriftsatz from "../../prompts/aufgaben/schriftsatz.md?raw";
import vertrag from "../../prompts/aufgaben/vertrag.md?raw";
import type { LlmClient } from "./client";
import { DISCLAIMER, EFFORT, FALLBACK_BETA, MAX_REVISIONS, MAX_TOKENS, MAX_TOOL_ROUNDS, MODEL, RETRIEVAL_LIMIT } from "./config";
import { Anonymizer } from "./privacy/anonymize";
import { LegalRetriever, type Retriever } from "./retrieval";
import { formatSources, SourceRegistry, type RegisteredSource } from "./sources/registry";
import { toolsFor, type AssistantTool, type ToolContext } from "./tools";
import { revisionRequest, verifyAnswer, type VerifyReport, type VerifyStore } from "./verify";

export type Task = "recherche" | "vertrag" | "schriftsatz";
export const TASK_PROMPTS: Record<Task, string> = { recherche, vertrag, schriftsatz };
export const DEFAULT_SYSTEM_PROMPT = systemPrompt.trim();

export interface AssistantOptions {
  llm: LlmClient;
  store: VerifyStore;
  task: Task;
  /** eigener System-Prompt (aus den Einstellungen); sonst prompts/system.md */
  systemPrompt?: string;
  anonymizer?: Anonymizer;
  retriever?: Retriever;
  /** Suche in eigenen Notizen/Dokumenten (nur mit Zustimmung) */
  ownDocuments?: ToolContext["ownDocuments"];
  model?: string;
}

export interface AskResult {
  /** Antwort mit wieder eingesetzten Originalangaben */
  text: string;
  /** Antwort, wie Claude sie geschrieben hat (anonymisiert) */
  anonymizedText: string;
  report: VerifyReport;
  /** alle Quellen dieser Unterhaltung */
  sources: readonly RegisteredSource[];
  revised: boolean;
  stopReason: string | null;
  toolCalls: { name: string; input: unknown }[];
  /** Was in dieser Runde an Anthropic ging (nur die Nutzernachricht, anonymisiert) */
  sentPreview: string;
  usage: { input: number; output: number; cacheRead: number; requests: number };
  /** Modell, das geantwortet hat (bei Ausweichen ggf. ein anderes) */
  model: string;
}

export class LegalAssistant {
  readonly registry = new SourceRegistry();
  readonly anonymizer: Anonymizer;
  private messages: BetaMessageParam[] = [];
  private tools: AssistantTool[];
  private retriever: Retriever;
  private system: string;

  constructor(private opts: AssistantOptions) {
    this.anonymizer = opts.anonymizer ?? new Anonymizer();
    this.tools = toolsFor({ ownDocuments: !!opts.ownDocuments });
    this.retriever = opts.retriever ?? new LegalRetriever(opts.store);
    this.system = (opts.systemPrompt?.trim() || DEFAULT_SYSTEM_PROMPT).trim();
  }

  get history(): readonly BetaMessageParam[] {
    return this.messages;
  }

  private params(): MessageCreateParamsNonStreaming {
    return {
      model: this.opts.model ?? MODEL,
      max_tokens: MAX_TOKENS,
      // Stabiler Anfang (Prompt + Aufgabe + Werkzeuge) wird zwischengespeichert
      system: [
        { type: "text", text: this.system },
        { type: "text", text: TASK_PROMPTS[this.opts.task].trim(), cache_control: { type: "ephemeral" } },
      ],
      tools: this.tools.map((t) => t.definition),
      messages: this.messages,
      output_config: { effort: EFFORT },
      // Lehnt ein Sicherheitsfilter ab, beantwortet Anthropics empfohlenes Ausweichmodell die Anfrage
      betas: [FALLBACK_BETA],
      fallbacks: "default",
    };
  }

  /** Stellt eine Frage (bei Vertragsprüfung: `document` = Vertragstext). */
  async ask(question: string, document?: string): Promise<AskResult> {
    const usage = { input: 0, output: 0, cacheRead: 0, requests: 0 };
    const toolCalls: AskResult["toolCalls"] = [];
    const q = this.anonymizer.anonymize(question.trim());
    const doc = document?.trim() ? this.anonymizer.anonymize(document.trim()) : "";
    const hits = await this.retriever.retrieve(`${q}\n${doc.slice(0, 2000)}`, { limit: RETRIEVAL_LIMIT });
    const fresh = this.registry.register(hits);
    const parts = [
      fresh.length
        ? `<quellen>\n${formatSources(fresh)}\n</quellen>`
        : "<quellen>\n(Für diese Frage wurden keine passenden Quellen gefunden. Nutze die Werkzeuge oder weise auf fehlende Quellen hin.)\n</quellen>",
      doc ? `<dokument>\n${doc}\n</dokument>` : "",
      `<frage>\n${q}\n</frage>`,
    ].filter(Boolean);
    const userText = parts.join("\n\n");
    this.messages.push({ role: "user", content: userText });

    const ctx: ToolContext = { store: this.opts.store, registry: this.registry, anonymizer: this.anonymizer, ownDocuments: this.opts.ownDocuments };
    let revisions = 0;
    let final: BetaMessage | null = null;
    let report: VerifyReport | null = null;
    for (let round = 0; round < MAX_TOOL_ROUNDS + MAX_REVISIONS + 1; round++) {
      const res = await this.opts.llm.create(this.params());
      usage.requests++;
      usage.input += res.usage.input_tokens ?? 0;
      usage.output += res.usage.output_tokens ?? 0;
      usage.cacheRead += res.usage.cache_read_input_tokens ?? 0;
      // Vollständigen Inhalt anhängen (Denk- und Ausweichblöcke bleiben erhalten)
      this.messages.push({ role: "assistant", content: res.content as BetaMessageParam["content"] });
      final = res;
      if (res.stop_reason === "refusal") break;
      const uses = res.content.filter((b: BetaContentBlock): b is BetaToolUseBlock => b.type === "tool_use");
      if (res.stop_reason === "tool_use" && uses.length) {
        if (res.stop_reason === "tool_use" && round >= MAX_TOOL_ROUNDS) {
          this.messages.push({ role: "user", content: this.toolResults(uses, null) });
          continue;
        }
        const results: BetaToolResultBlockParam[] = [];
        for (const u of uses) {
          toolCalls.push({ name: u.name, input: u.input });
          const tool = this.tools.find((t) => t.definition.name === u.name);
          const input = u.input && typeof u.input === "object" ? (u.input as Record<string, unknown>) : {};
          const out = tool ? await tool.run(input, ctx) : { content: `Unbekanntes Werkzeug: ${u.name}`, isError: true };
          results.push({ type: "tool_result", tool_use_id: u.id, content: out.content, ...(out.isError ? { is_error: true } : {}) });
        }
        // alle Ergebnisse gemeinsam in einer Nachricht
        this.messages.push({ role: "user", content: results });
        continue;
      }
      // Antwort fertig: Zitate prüfen
      report = await verifyAnswer(textOf(res), this.registry, this.opts.store);
      if (!report.ok && revisions < MAX_REVISIONS && res.stop_reason === "end_turn") {
        revisions++;
        this.messages.push({ role: "user", content: revisionRequest(report) });
        continue;
      }
      break;
    }
    const msg = final!;
    let anonymizedText = textOf(msg);
    if (msg.stop_reason === "refusal") {
      anonymizedText = "Die Anfrage wurde von den Sicherheitsfiltern der Claude API abgelehnt. Bitte formuliere sie anders.";
    } else if (msg.stop_reason === "max_tokens") {
      anonymizedText += "\n\n(Die Antwort wurde wegen ihrer Länge abgeschnitten.)";
    }
    if (!report) report = await verifyAnswer(anonymizedText, this.registry, this.opts.store);
    if (!anonymizedText.includes(DISCLAIMER)) anonymizedText = `${anonymizedText.trim()}\n\n${DISCLAIMER}`;
    return {
      text: this.anonymizer.deanonymize(anonymizedText),
      anonymizedText,
      report,
      sources: this.registry.all,
      revised: revisions > 0,
      stopReason: msg.stop_reason,
      toolCalls,
      sentPreview: userText,
      usage,
      model: msg.model,
    };
  }

  private toolResults(uses: BetaToolUseBlock[], _: null): BetaToolResultBlockParam[] {
    return uses.map((u) => ({
      type: "tool_result",
      tool_use_id: u.id,
      is_error: true,
      content: "Höchstzahl an Werkzeugaufrufen erreicht. Antworte jetzt mit den vorliegenden Quellen.",
    }));
  }
}

export function textOf(m: BetaMessage): string {
  return m.content
    .filter((b): b is Extract<BetaContentBlock, { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}
