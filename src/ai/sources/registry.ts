/**
 * Quellenverzeichnis einer Unterhaltung: Jeder abgerufene Abschnitt bekommt
 * eine feste Kennung [Q1], [Q2] … Claude zitiert diese Kennungen; die
 * Ausgabeprüfung gleicht Zitate gegen genau diese Abschnitte ab.
 */
import type { LegalHit } from "../../api/types";
import { hitLabel } from "../retrieval";

export interface RegisteredSource {
  id: string; // „Q3“
  hit: LegalHit;
}

export class SourceRegistry {
  private byChunk = new Map<string, RegisteredSource>();
  private list: RegisteredSource[] = [];

  register(hits: LegalHit[]): RegisteredSource[] {
    return hits.map((h) => {
      const existing = this.byChunk.get(h.chunk_id);
      if (existing) return existing;
      const r = { id: `Q${this.list.length + 1}`, hit: h };
      this.byChunk.set(h.chunk_id, r);
      this.list.push(r);
      return r;
    });
  }

  /** Quellen einer gespeicherten Unterhaltung wieder eintragen (Kennungen bleiben gleich). */
  restore(list: readonly RegisteredSource[]) {
    for (const r of list) {
      if (!r?.hit?.chunk_id || !/^Q\d+$/.test(r.id) || this.byChunk.has(r.hit.chunk_id)) continue;
      this.byChunk.set(r.hit.chunk_id, r);
      this.list.push(r);
    }
  }

  get all(): readonly RegisteredSource[] {
    return this.list;
  }

  byId(id: string): RegisteredSource | undefined {
    return this.list.find((s) => s.id === id);
  }
}

/** Darstellung eines Abschnitts für Claude (im Block `<quellen>` oder als Werkzeugergebnis). */
export function formatSource(r: RegisteredSource): string {
  const h = r.hit;
  const meta: string[] = [hitLabel(h)];
  if (h.heading) meta.push(h.heading);
  if (h.kind === "gesetz" && h.title) meta.push(h.title);
  if (h.version) meta.push(`Fassung: ${h.version}`);
  if (h.kind !== "gesetz" && h.decision_date) meta.push(`Datum: ${h.decision_date}`);
  return `[${r.id}] (${h.kind}) ${meta.join(" | ")}\n${h.text}`;
}

export function formatSources(rs: RegisteredSource[]): string {
  return rs.map(formatSource).join("\n\n");
}
