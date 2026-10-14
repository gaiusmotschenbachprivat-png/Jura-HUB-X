/**
 * Evaluation des juristischen Assistenten gegen eval/fragen.yaml.
 *
 *   ANTHROPIC_API_KEY=… npm run eval                 (alle Fragen)
 *   EVAL_LABEL=prompt-v2 EVAL_FILTER=^ar- npm run eval   (Name des Laufs, nur Arbeitsrecht)
 *
 * Lädt die benötigten Gesetze einmalig von gesetze-im-internet.de (Zwischenspeicher
 * eval/.cache), baut eine Datenbank im Arbeitsspeicher, stellt jede Frage mit dem
 * echten Ablauf (Abruf, Werkzeuge, Zitatprüfung) und schreibt die Ergebnisse nach
 * eval/ergebnisse/. Vergleich zweier Läufe: npm run eval:vergleich
 *
 * Kosten: Jede Frage kostet echte API-Nutzung (Schätzung steht im Ergebnis).
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import Anthropic from "@anthropic-ai/sdk";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import YAML from "yaml";

import { DEFAULT_SYSTEM_PROMPT, LegalAssistant, TASK_PROMPTS } from "../src/ai/assistant";
import { sdkClient } from "../src/ai/client";
import { EFFORT, MAX_REVISIONS, MODEL, RETRIEVAL_LIMIT } from "../src/ai/config";
import { scoreAnswer, summarize, type EvalQuestion, type EvalScore } from "../src/ai/evalScore";
import { parseGiiArchive } from "../src/ai/sources/gii";
import * as legal from "../src/core/repo/legal";
import { openTestDb } from "../src/core/testing";

const RUN = process.env.RUN_EVAL === "1";
const ROOT = path.resolve(import.meta.dirname, "..");
const CACHE = path.join(ROOT, "eval/.cache");
const OUT = path.join(ROOT, "eval/ergebnisse");

async function lawZip(abbr: string): Promise<Uint8Array> {
  const file = path.join(CACHE, `${abbr}.zip`);
  if (fs.existsSync(file)) return new Uint8Array(fs.readFileSync(file));
  const res = await fetch(`https://www.gesetze-im-internet.de/${abbr}/xml.zip`);
  if (!res.ok) throw new Error(`${abbr}: HTTP ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(file, bytes);
  return bytes;
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!);
      }
    }),
  );
  return out;
}

describe.skipIf(!RUN)("Evaluation", () => {
  it("beantwortet die Testsammlung", async () => {
    // DOMParser für den XML-Import unter Node
    (globalThis as { DOMParser?: unknown }).DOMParser = new JSDOM().window.DOMParser;
    const spec = YAML.parse(fs.readFileSync(path.join(ROOT, "eval/fragen.yaml"), "utf8")) as { gesetze: string[]; fragen: EvalQuestion[] };
    const filter = process.env.EVAL_FILTER ? new RegExp(process.env.EVAL_FILTER) : null;
    const fragen = spec.fragen.filter((f) => !filter || filter.test(f.id));
    expect(fragen.length).toBeGreaterThan(0);

    const db = await openTestDb();
    for (const abbr of spec.gesetze) {
      const law = await parseGiiArchive(await lawZip(abbr), `https://www.gesetze-im-internet.de/${abbr}/`);
      const s = legal.save(db, law.source, law.chunks);
      console.log(`Gesetz ${s.abbreviation}: ${s.chunk_count} Abschnitte (${s.version.slice(0, 80)})`);
    }
    const store = {
      legalSearch: async (t: string[], k: Parameters<typeof legal.search>[2], l: number) => legal.search(db, t, k, l),
      legalNorm: async (a: string, n: string, abs: number | null) => legal.norm(db, a, n, abs),
      legalSourcesList: async () => legal.list(db),
    };
    // Unter Node mit Schlüssel aus ANTHROPIC_API_KEY (bzw. `ant auth login`)
    const llm = sdkClient(new Anthropic({ maxRetries: 4 }));
    const runs = await pool(fragen, Number(process.env.EVAL_PARALLEL ?? 4), async (q) => {
      const t0 = Date.now();
      try {
        const a = new LegalAssistant({ llm, store, task: q.aufgabe });
        const r = await a.ask(q.frage, q.dokument);
        const score = scoreAnswer(q, r, (Date.now() - t0) / 1000);
        console.log(`${score.bestanden ? "✓" : "✗"} ${q.id}  Normen ${score.norm_recall}  falsch ${score.falsche_zitate}  halluz. ${score.halluzinationen}`);
        return { score, antwort: r.anonymizedText, werkzeuge: r.toolCalls, pruefung: r.report.checks };
      } catch (e) {
        console.log(`✗ ${q.id}  Fehler: ${e instanceof Error ? e.message : e}`);
        return { score: null, fehler: String(e) };
      }
    });
    const scores = runs.map((r) => r.score).filter((s): s is EvalScore => !!s);
    const summary = summarize(scores);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const label = (process.env.EVAL_LABEL ?? "lauf").replace(/[^\w-]/g, "_");
    const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 12);
    const result = {
      datum: new Date().toISOString(),
      label,
      konfiguration: {
        modell: MODEL,
        effort: EFFORT,
        retrieval_limit: RETRIEVAL_LIMIT,
        ueberarbeitungen: MAX_REVISIONS,
        system_prompt_sha: hash(DEFAULT_SYSTEM_PROMPT),
        aufgaben_prompt_sha: hash(JSON.stringify(TASK_PROMPTS)),
        filter: process.env.EVAL_FILTER ?? null,
      },
      zusammenfassung: summary,
      fragen: fragen.map((q, i) => ({ id: q.id, ...runs[i] })),
    };
    fs.mkdirSync(OUT, { recursive: true });
    const file = path.join(OUT, `${stamp}_${label}.json`);
    fs.writeFileSync(file, JSON.stringify(result, null, 2));
    console.log("\nErgebnis:", JSON.stringify(summary, null, 2));
    console.log(`Gespeichert: ${path.relative(ROOT, file)}`);
  });
});
