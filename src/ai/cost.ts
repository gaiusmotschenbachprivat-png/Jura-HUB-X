/**
 * Geschätzte Kosten einer KI-Anfrage aus den Token-Zahlen, die die Claude API
 * mit jeder Antwort liefert. Preise in US-Dollar je Million Tokens (Stand
 * Oktober 2026, Anthropic-Preisliste). Abgerechnet wird in der Anthropic-Konsole –
 * dort steht der genaue Verbrauch; diese Anzeige dient der Orientierung.
 */
interface Price {
  input: number;
  output: number;
  cacheRead: number;
  /** 5-Minuten-Zwischenspeicher: 1,25-facher Eingabepreis */
  cacheWrite: number;
}

const PRICES: Record<string, Price> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
};
/** Unbekanntes Modell (z. B. Ausweichmodell nach einer Ablehnung): vorsichtig mit dem höchsten Tarif rechnen. */
const UNKNOWN: Price = { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 };
/** Claude Haiku 5.5: längere Anfragen (über 100 000 Tokens) kosten das Fünffache. */
const HAIKU_LONG = 100_000;

/** Grobe Umrechnung nur für die Anzeige. */
export const USD_TO_EUR = 0.9;

export interface TokenUsage {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

export function requestCostUsd(model: string, u: TokenUsage): number {
  const p = PRICES[model] ?? Object.entries(PRICES).find(([k]) => model.startsWith(k))?.[1] ?? UNKNOWN;
  const input = u.input_tokens ?? 0;
  const read = u.cache_read_input_tokens ?? 0;
  const write = u.cache_creation_input_tokens ?? 0;
  const factor = model.startsWith("claude-haiku-5-5") && input + read + write > HAIKU_LONG ? 5 : 1;
  return ((input * p.input + (u.output_tokens ?? 0) * p.output + read * p.cacheRead + write * p.cacheWrite) * factor) / 1_000_000;
}

/** „ca. 0,4 Cent“, „ca. 12 Cent“, „ca. 1,20 €“ */
export function formatCost(usd: number): string {
  const eur = usd * USD_TO_EUR;
  if (eur < 0.0005) return "unter 0,1 Cent";
  if (eur < 0.01) return `ca. ${(eur * 100).toLocaleString("de-DE", { maximumFractionDigits: 1 })} Cent`;
  if (eur < 1) return `ca. ${Math.round(eur * 100)} Cent`;
  return `ca. ${eur.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

/** Wie viele solcher Anfragen ein Guthaben ungefähr erlaubt. */
export function requestsFor(budgetEur: number, usdPerRequest: number): number {
  return usdPerRequest > 0 ? Math.floor(budgetEur / (usdPerRequest * USD_TO_EUR)) : Infinity;
}

export const SPENT_SETTING = "ai.spent";
export interface Spent {
  usd: number;
  since: string;
  requests: number;
}
export function spentFrom(v: unknown): Spent {
  const o = v && typeof v === "object" ? (v as Partial<Spent>) : {};
  return { usd: Number(o.usd) || 0, since: typeof o.since === "string" ? o.since : new Date().toISOString(), requests: Number(o.requests) || 0 };
}
