/** Rechtsquellen im Arbeitsspeicher (Browser-Vorschau mit ?demo und Oberflächentests). */
import type { Backend } from "./backend";
import type { LegalHit, LegalSource } from "./types";

type LegalApi = Pick<
  Backend,
  | "legalSourcesList"
  | "legalSourceSave"
  | "legalSourceDelete"
  | "legalSearch"
  | "legalNorm"
  | "legalChunks"
  | "aiStatus"
  | "aiSetSessionKey"
  | "aiHttp"
  | "lawFetch"
>;

export function createLegalMock(): LegalApi {
  const sources = new Map<string, LegalSource>();
  const hits: LegalHit[] = [];
  let seq = 0;
  const notAvailable = async (): Promise<never> => {
    throw { code: "invalid", message: "In der Vorschau nicht verfügbar." };
  };
  return {
    async legalSourcesList() {
      return [...sources.values()];
    },
    async legalSourceSave(input, chunks) {
      if (input.kind === "gesetz" && input.abbreviation) {
        for (const s of [...sources.values()]) if (s.kind === "gesetz" && s.abbreviation === input.abbreviation) await this.legalSourceDelete(s.id);
      }
      const id = `00000000-0000-7000-8000-${String(++seq).padStart(12, "0")}`;
      const src: LegalSource = {
        id,
        kind: input.kind,
        title: input.title,
        abbreviation: input.abbreviation ?? "",
        court: input.court ?? "",
        file_number: input.file_number ?? "",
        decision_date: input.decision_date ?? "",
        version: input.version ?? "",
        origin: input.origin ?? "",
        chunk_count: chunks.length,
        imported_at: new Date().toISOString(),
      };
      sources.set(id, src);
      chunks.forEach((c, i) =>
        hits.push({ ...src, chunk_id: `${id}-${i}`, source_id: id, norm: c.norm, absatz: c.absatz, heading: c.heading, text: c.text, position: i }),
      );
      return src;
    },
    async legalSourceDelete(id) {
      sources.delete(id);
      for (let i = hits.length - 1; i >= 0; i--) if (hits[i]!.source_id === id) hits.splice(i, 1);
    },
    async legalSearch(terms, kinds, limit) {
      const ts = terms.map((t) => t.toLowerCase()).filter(Boolean);
      return hits
        .filter((h) => !kinds?.length || kinds.includes(h.kind))
        .map((h) => ({ h, n: ts.filter((t) => `${h.norm} ${h.heading} ${h.text}`.toLowerCase().includes(t)).length }))
        .filter((x) => x.n > 0)
        .sort((a, b) => b.n - a.n)
        .slice(0, limit)
        .map((x) => x.h);
    },
    async legalNorm(abbreviation, norm, absatz) {
      return hits.filter(
        (h) => h.kind === "gesetz" && h.abbreviation.toLowerCase() === abbreviation.toLowerCase() && h.norm === norm && (absatz == null || h.absatz == null || h.absatz === absatz),
      );
    },
    async legalChunks(ids) {
      return hits.filter((h) => ids.includes(h.chunk_id));
    },
    async aiStatus() {
      return { available: false, key_source: "none", can_fetch_laws: false };
    },
    aiSetSessionKey: notAvailable,
    aiHttp: notAvailable,
    lawFetch: notAvailable,
  };
}
