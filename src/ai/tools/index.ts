/**
 * Werkzeuge (Tool Use) des Assistenten. Jedes Werkzeug ist ein austauschbares
 * Modul: Definition für die Claude API + lokale Ausführung. Alle laufen auf
 * dem Gerät; Ergebnisse gehen als `tool_result` an Claude zurück.
 */
import type { BetaTool } from "@anthropic-ai/sdk/resources/beta/messages/messages";

import type { LegalHit, LegalKind } from "../../api/types";
import type { Anonymizer } from "../privacy/anonymize";
import { searchTerms, type LegalStore } from "../retrieval";
import { formatSources, type SourceRegistry } from "../sources/registry";
import { berechneFrist, LAENDER, type Einheit, type FristArt, type Land } from "./fristen";
import { TEMPLATES } from "./vorlagen";

export interface ToolContext {
  store: LegalStore;
  registry: SourceRegistry;
  anonymizer: Anonymizer;
  /** Suche in eigenen Notizen/Dokumenten – nur, wenn der Nutzer das erlaubt hat */
  ownDocuments?: (query: string) => Promise<{ title: string; path: string; snippet: string }[]>;
}

export interface ToolOutput {
  content: string;
  isError?: boolean;
}

export interface AssistantTool {
  definition: BetaTool;
  run(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutput>;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const int = (v: unknown) => (typeof v === "number" && Number.isInteger(v) ? v : NaN);

const noHits = (what: string) =>
  `Keine Treffer für ${what} in den importierten Quellen. Wenn die Quelle fehlt, sage das in der Antwort und nenne, welche Quelle importiert werden sollte.`;

export const normAbrufen: AssistantTool = {
  definition: {
    name: "norm_abrufen",
    description:
      "Ruft den Wortlaut einer Norm aus den importierten Gesetzen ab (z. B. gesetz „BGB“, norm „§ 433“). " +
      "Nutze das, bevor du eine Norm zitierst, deren Wortlaut dir nicht als Quelle vorliegt. absatz = 0 liefert alle Absätze.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        gesetz: { type: "string", description: "Amtliche Abkürzung, z. B. BGB, StGB, GG, KSchG" },
        norm: { type: "string", description: "z. B. „§ 433“ oder „Art. 20“" },
        absatz: { type: "integer", description: "Absatznummer, 0 = alle" },
      },
      required: ["gesetz", "norm", "absatz"],
      additionalProperties: false,
    },
  },
  async run(input, ctx) {
    const gesetz = str(input.gesetz).trim();
    const norm = str(input.norm).trim();
    const absatz = int(input.absatz);
    if (!gesetz || !norm) return { content: "Bitte Gesetz und Norm angeben.", isError: true };
    const hits = await ctx.store.legalNorm(gesetz, norm, absatz > 0 ? absatz : null);
    if (!hits.length) return { content: noHits(`${norm} ${gesetz}`) };
    return { content: formatSources(ctx.registry.register(hits)) };
  },
};

export const quellenSuchen: AssistantTool = {
  definition: {
    name: "quellen_suchen",
    description: "Volltextsuche in den importierten Rechtsquellen (Gesetze, Urteile, Kommentare, eigene Texte). Liefert die besten Abschnitte mit Quellenkennung.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        anfrage: { type: "string", description: "Suchbegriffe, z. B. „Rücktritt Mangel Nacherfüllung Frist“" },
        art: { type: "string", enum: ["alle", "gesetz", "urteil", "kommentar", "dokument"] },
      },
      required: ["anfrage", "art"],
      additionalProperties: false,
    },
  },
  async run(input, ctx) {
    const terms = searchTerms(str(input.anfrage));
    if (!terms.length) return { content: "Bitte aussagekräftige Suchbegriffe angeben.", isError: true };
    const art = str(input.art);
    const kinds = art && art !== "alle" ? [art as LegalKind] : null;
    const hits: LegalHit[] = await ctx.store.legalSearch(terms, kinds, 6);
    if (!hits.length) return { content: noHits(`„${str(input.anfrage)}“`) };
    return { content: formatSources(ctx.registry.register(hits)) };
  },
};

export const dokumenteSuchen: AssistantTool = {
  definition: {
    name: "dokumente_suchen",
    description:
      "Durchsucht die eigenen Notizen und Dokumente des Nutzers in Studium OS (Mitschriften, Skripte). Ergebnisse sind keine Rechtsquellen und belegen keine Normzitate.",
    strict: true,
    input_schema: {
      type: "object",
      properties: { anfrage: { type: "string" } },
      required: ["anfrage"],
      additionalProperties: false,
    },
  },
  async run(input, ctx) {
    if (!ctx.ownDocuments) return { content: "Die Suche in eigenen Dokumenten ist nicht freigegeben.", isError: true };
    const res = await ctx.ownDocuments(str(input.anfrage));
    if (!res.length) return { content: "Keine Treffer in den eigenen Notizen und Dokumenten." };
    // Eigene Inhalte vor dem Senden anonymisieren
    return {
      content: res
        .slice(0, 6)
        .map((r) => ctx.anonymizer.anonymize(`• ${r.title}${r.path ? ` (${r.path})` : ""}: ${r.snippet}`))
        .join("\n"),
    };
  },
};

export const fristBerechnen: AssistantTool = {
  definition: {
    name: "frist_berechnen",
    description:
      "Berechnet ein Fristende nach §§ 187–193 BGB mit gesetzlichen Feiertagen des Landes. Ereignisfrist: beginn = Tag des Ereignisses (z. B. Zugang). Beginnfrist: beginn = erster Tag der Frist.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        beginn: { type: "string", description: "Datum JJJJ-MM-TT" },
        art: { type: "string", enum: ["ereignisfrist", "beginnfrist"] },
        einheit: { type: "string", enum: ["tage", "wochen", "monate", "jahre"] },
        anzahl: { type: "integer" },
        land: { type: "string", enum: LAENDER },
        paragraph193: { type: "boolean", description: "§ 193 BGB anwenden (Wochenende/Feiertag → nächster Werktag)" },
      },
      required: ["beginn", "art", "einheit", "anzahl", "land", "paragraph193"],
      additionalProperties: false,
    },
  },
  async run(input) {
    try {
      const r = berechneFrist({
        beginn: str(input.beginn),
        art: str(input.art) as FristArt,
        einheit: str(input.einheit) as Einheit,
        anzahl: int(input.anzahl),
        land: str(input.land) as Land,
        paragraph193: input.paragraph193 !== false,
      });
      return { content: JSON.stringify(r, null, 2) };
    } catch (e) {
      return { content: e instanceof Error ? e.message : String(e), isError: true };
    }
  },
};

export const vorlageLaden: AssistantTool = {
  definition: {
    name: "vorlage_laden",
    description: `Lädt eine Muster-Vorlage für Schreiben/Schriftsätze. Verfügbar: ${Object.entries(TEMPLATES)
      .map(([k, v]) => `${k} (${v.titel})`)
      .join(", ")}.`,
    strict: true,
    input_schema: {
      type: "object",
      properties: { name: { type: "string", enum: Object.keys(TEMPLATES) } },
      required: ["name"],
      additionalProperties: false,
    },
  },
  async run(input) {
    const t = TEMPLATES[str(input.name)];
    if (!t) return { content: "Unbekannte Vorlage.", isError: true };
    return { content: `Vorlage „${t.titel}“ (${t.rechtsgebiet}; einschlägige Normen laut Vorlage: ${t.normen})\n\n${t.text}` };
  },
};

export function toolsFor(opts: { ownDocuments: boolean }): AssistantTool[] {
  return [normAbrufen, quellenSuchen, fristBerechnen, vorlageLaden, ...(opts.ownDocuments ? [dokumenteSuchen] : [])];
}
