import { describe, expect, it } from "vitest";

import type { LlmClient } from "./client";
import { AI_PROFILES, profileFromSettings, routeProfile } from "./config";
import { formatCost, requestCostUsd, requestsFor } from "./cost";
import { prepareNotes } from "./study";

type Params = Parameters<LlmClient["create"]>[0];

describe("KI-Kosten", () => {
  it("rechnet nach Modell, mit Zwischenspeicher", () => {
    // 10 000 Tokens hinein, 2 000 heraus: Opus 4/20 $ je Mio.
    expect(requestCostUsd("claude-opus-5-5", { input_tokens: 10_000, output_tokens: 2_000 })).toBeCloseTo(0.08, 6);
    expect(requestCostUsd("claude-sonnet-5-5", { input_tokens: 10_000, output_tokens: 2_000 })).toBeCloseTo(0.04, 6);
    expect(requestCostUsd("claude-haiku-5-5", { input_tokens: 10_000, output_tokens: 2_000 })).toBeCloseTo(0.002, 6);
    expect(requestCostUsd("claude-opus-5-5", { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1_000_000, cache_creation_input_tokens: 1_000_000 })).toBeCloseTo(5.2, 6);
    // Haiku: über 100 000 Tokens gilt der höhere Tarif
    expect(requestCostUsd("claude-haiku-5-5", { input_tokens: 200_000, output_tokens: 0 })).toBeCloseTo(0.1, 6);
    // Unbekanntes (Ausweich-)Modell: vorsichtig hoch
    expect(requestCostUsd("claude-irgendwas", { input_tokens: 1_000_000, output_tokens: 0 })).toBe(10);
  });
  it("zeigt verständliche Beträge", () => {
    expect(formatCost(0)).toBe("unter 0,1 Cent");
    expect(formatCost(0.005)).toBe("ca. 0,5 Cent");
    expect(formatCost(0.1)).toBe("ca. 9 Cent");
    expect(formatCost(2)).toBe("ca. 1,80 €");
    expect(requestsFor(5, 0.1)).toBe(55);
  });
  it("Modellwahl: Standard „Automatisch“, unbekannte Werte fallen darauf zurück", () => {
    expect(profileFromSettings(undefined).id).toBe("auto");
    expect(profileFromSettings("quatsch").id).toBe("auto");
    expect(profileFromSettings("genau").model).toBe("claude-opus-5-5");
    expect(profileFromSettings("guenstig").model).toBe("claude-haiku-5-5");
  });
  it("„Automatisch“ wählt je Aufgabe: Haiku für Lernhilfen, Sonnet für Fragen und Korrektur, nie Opus", () => {
    const auto = AI_PROFILES.auto;
    expect(routeProfile(auto, "karteikarten").model).toBe("claude-haiku-5-5");
    expect(routeProfile(auto, "aufbereiten").model).toBe("claude-haiku-5-5");
    expect(routeProfile(auto, "assistent")).toMatchObject({ model: "claude-sonnet-5-5", effort: "medium" });
    expect(routeProfile(auto, "korrektur")).toMatchObject({ model: "claude-sonnet-5-5", effort: "high" });
    // eine bewusste Wahl gilt für alle Aufgaben
    expect(routeProfile(AI_PROFILES.genau, "karteikarten").model).toBe("claude-opus-5-5");
  });
  it("Anfrage passt zum Modell: Ausweichmodell nur bei Opus und Sonnet", async () => {
    const calls: Params[] = [];
    const llm: LlmClient = {
      create: async (p) => {
        calls.push(p);
        return { id: "m", type: "message", role: "assistant", model: p.model, content: [{ type: "text", text: "# Skript", citations: null }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 1000, output_tokens: 500 } } as never;
      },
    };
    const results = [];
    for (const p of [AI_PROFILES.genau, AI_PROFILES.sparsam, AI_PROFILES.guenstig, AI_PROFILES.auto]) results.push(await prepareNotes({ llm, profile: p }, "VL", "Stoff ".repeat(30)));
    const [opus, sonnet, haiku, auto] = calls as unknown as Record<string, unknown>[];
    expect(auto).toMatchObject({ model: "claude-haiku-5-5" });
    expect(opus).toMatchObject({ model: "claude-opus-5-5", output_config: { effort: "high" }, fallbacks: "default" });
    expect(sonnet).toMatchObject({ model: "claude-sonnet-5-5", output_config: { effort: "medium" }, fallbacks: "default" });
    expect(haiku).toMatchObject({ model: "claude-haiku-5-5", output_config: { effort: "medium" } });
    expect(haiku).not.toHaveProperty("fallbacks");
    expect(haiku).not.toHaveProperty("betas");
    for (const c of calls as unknown as Record<string, unknown>[]) for (const k of ["temperature", "top_p", "top_k", "thinking"]) expect(c).not.toHaveProperty(k);
    expect(results.map((r) => r.costUsd)).toEqual(
      ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-haiku-5-5"].map((m) => requestCostUsd(m, { input_tokens: 1000, output_tokens: 500 })),
    );
  });
});
