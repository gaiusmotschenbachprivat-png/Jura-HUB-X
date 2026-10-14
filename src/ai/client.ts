/**
 * Zugang zur Claude API über das offizielle Anthropic-SDK.
 *
 * - Desktop: Das SDK läuft in der Oberfläche, schickt aber nichts selbst ins Netz.
 *   Seine Anfragen gehen über `fetch` an die Rust-Seite (`ai_http`), die nur
 *   `api.anthropic.com/v1/messages` erlaubt und den Schlüssel aus der
 *   Umgebungsvariable ANTHROPIC_API_KEY einsetzt. Die Oberfläche sieht ihn nie.
 * - Browser/iPad: direkter Aufruf; der Schlüssel liegt nur im Arbeitsspeicher.
 * - Tests/Evaluation (Node): `new Anthropic()` liest ANTHROPIC_API_KEY.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { BetaMessage, MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/beta/messages/messages";

import type { Backend } from "../api/backend";

/** Was der Assistent von einem Claude-Zugang braucht (in Tests ersetzbar). */
export interface LlmClient {
  create(params: MessageCreateParamsNonStreaming): Promise<BetaMessage>;
}

export function sdkClient(client: Anthropic): LlmClient {
  return { create: (params) => client.beta.messages.create(params) };
}

/** `fetch` für das SDK, das über die Rust-Seite weiterleitet (Desktop). */
export function desktopFetch(backend: Pick<Backend, "aiHttp">): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const headers: [string, string][] = [];
    new Headers(init?.headers).forEach((v, k) => headers.push([k, v]));
    const body = typeof init?.body === "string" ? init.body : init?.body ? await new Response(init.body).text() : "";
    const res = await backend.aiHttp(url, init?.method ?? "GET", headers, body);
    return new Response(res.body, { status: res.status, headers: res.headers });
  }) as typeof fetch;
}

/** Claude-Zugang passend zur Plattform der App. */
export async function appClient(backend: Backend): Promise<LlmClient> {
  if (backend.kind === "tauri") {
    return sdkClient(
      new Anthropic({
        // Platzhalter: Die Rust-Seite ersetzt ihn durch den echten Schlüssel.
        apiKey: "wird-von-studium-os-eingesetzt",
        dangerouslyAllowBrowser: true,
        fetch: desktopFetch(backend),
        maxRetries: 2,
      }),
    );
  }
  if (backend.kind === "web") {
    const { webSessionKey } = await import("../api/web");
    const key = webSessionKey();
    if (!key) throw new Error("Bitte gib zuerst deinen API-Schlüssel für diese Sitzung ein.");
    // Im Browser ist der Schlüssel unvermeidlich im Arbeitsspeicher der Seite; er wird nie gespeichert.
    return sdkClient(new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true, maxRetries: 2 }));
  }
  throw new Error("Der KI-Assistent ist in der Vorschau nicht verfügbar.");
}

/** Verständliche Meldung für Fehler der Claude API. */
export function aiErrorMessage(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return "Der API-Schlüssel wurde abgelehnt. Bitte prüfe ihn.";
  if (e instanceof Anthropic.PermissionDeniedError) return "Der API-Schlüssel hat keine Berechtigung für dieses Modell.";
  if (e instanceof Anthropic.RateLimitError) return "Zu viele Anfragen in kurzer Zeit. Bitte warte einen Moment.";
  if (e instanceof Anthropic.BadRequestError) return `Die Anfrage wurde abgelehnt: ${e.message}`;
  if (e instanceof Anthropic.APIConnectionError) return "Keine Verbindung zur Claude API.";
  if (e instanceof Anthropic.APIError) return `Fehler der Claude API (${e.status ?? "?"}): ${e.message}`;
  if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
  return String(e);
}
