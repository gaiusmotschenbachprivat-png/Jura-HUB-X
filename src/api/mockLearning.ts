/**
 * Vorschau-Backend (Browser) für Phase 3: Wissensobjekte, Karteikarten, Planung,
 * PDF-Markierungen, Bilder. Vereinfachte Nachbildung der Rust-Regeln.
 */
import type { Backend } from "./backend";
import type { Annotation, Card, CitationData, Exam, Knowledge, SearchHit, Task } from "./types";

const uuid = () => "xxxxxxxx-xxxx-7xxx-8xxx-xxxxxxxxxxxx".replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));
const now = () => new Date().toISOString();
const err = (message: string) => Object.assign(new Error(message), { code: "invalid", message });
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function formatCitation(c: Partial<CitationData>): string {
  const p = [`${c.prefix?.trim() || "§"} ${c.number?.trim() ?? ""}`];
  if (c.paragraph?.trim()) p.push(`Abs. ${c.paragraph.trim()}`);
  if (c.sentence?.trim()) p.push(`S. ${c.sentence.trim()}`);
  if (c.num?.trim()) p.push(`Nr. ${c.num.trim()}`);
  if (c.alt?.trim()) p.push(`Alt. ${c.alt.trim()}`);
  if (c.law?.trim()) p.push(c.law.trim());
  return p.join(" ");
}

type LearningPart = Pick<
  Backend,
  | "knowledgeList"
  | "knowledgeGet"
  | "knowledgeCreate"
  | "knowledgeUpdate"
  | "knowledgeTrash"
  | "knowledgeFields"
  | "citationParse"
  | "cardsList"
  | "cardCreate"
  | "cardUpdate"
  | "cardReview"
  | "cardTrash"
  | "cardStats"
  | "tasksList"
  | "taskCreate"
  | "taskUpdate"
  | "taskTrash"
  | "examsList"
  | "examSave"
  | "examTrash"
  | "annotationsList"
  | "annotationCreate"
  | "annotationUpdate"
  | "annotationDelete"
  | "imageStore"
  | "imageBytes"
>;

export function createLearningMock(areaOf: (nodeId: string) => string | undefined) {
  const knowledge = new Map<string, Knowledge>();
  const cards = new Map<string, Card>();
  const tasks = new Map<string, Task>();
  const exams = new Map<string, Exam>();
  const annotations = new Map<string, Annotation>();
  const images = new Map<string, Uint8Array>();
  const reviews: { card: string; rating: number; at: string }[] = [];

  const inArea = (a: string | null, area?: string | null) => !area || !a || a === area;

  const api: LearningPart = {
    async knowledgeList(f) {
      return [...knowledge.values()]
        .filter((k) => !k.deleted_at && (!f.type || k.type === f.type) && inArea(k.area_id, f.area_id) && (!f.node_id || k.node_id === f.node_id) && (!f.field || k.field === f.field))
        .sort((a, b) => a.title.localeCompare(b.title, "de"));
    },
    async knowledgeGet(id) {
      const k = knowledge.get(id);
      if (!k) throw err("Eintrag nicht gefunden.");
      return k;
    },
    async knowledgeCreate(input) {
      const data = { ...(input.data ?? {}) };
      let title = input.title.trim();
      if (input.type === "citation") {
        if (!String(data.number ?? "").trim()) throw err("Bitte die Paragrafen- bzw. Artikelnummer angeben.");
        title = formatCitation(data as Partial<CitationData>);
        const dup = [...knowledge.values()].find((k) => k.type === "citation" && k.title === title && !k.deleted_at);
        if (dup) return dup;
      }
      if (!title) throw err("Der Titel darf nicht leer sein.");
      if (input.type === "schema") data.items = (data.items as unknown[]) ?? [];
      const k: Knowledge = {
        id: uuid(),
        type: input.type,
        area_id: input.area_id ?? null,
        node_id: input.node_id ?? null,
        title,
        field: input.field ?? "",
        source_kind: input.source_kind ?? "eigen",
        data,
        created_at: now(),
        updated_at: now(),
        deleted_at: null,
      };
      knowledge.set(k.id, k);
      return k;
    },
    async knowledgeUpdate(id, patch) {
      const k = await api.knowledgeGet(id);
      Object.assign(k, Object.fromEntries(Object.entries(patch).filter(([key]) => key !== "data")));
      if (patch.data) k.data = { ...patch.data };
      if (k.type === "citation") k.title = formatCitation(k.data as Partial<CitationData>);
      if (!k.title.trim()) throw err("Der Titel darf nicht leer sein.");
      k.updated_at = now();
      return k;
    },
    async knowledgeTrash(id) {
      (await api.knowledgeGet(id)).deleted_at = now();
    },
    async knowledgeFields() {
      return [...new Set([...knowledge.values()].filter((k) => !k.deleted_at && k.field).map((k) => k.field))].sort();
    },
    async citationParse(text) {
      const m = /^(§§?|Art\.)\s*(\d+\w?)(?:\s+Abs\.\s*(\w+))?(?:\s+S\.\s*(\w+))?(?:\s+Nr\.\s*(\w+))?\s*([A-ZÄÖÜ][\wäöü]*)?/.exec(text.trim());
      if (!m) return null;
      return { prefix: m[1]!.startsWith("§") ? "§" : "Art.", number: m[2]!, paragraph: m[3] ?? "", sentence: m[4] ?? "", num: m[5] ?? "", alt: "", law: m[6] ?? "", notes: "" };
    },

    async cardsList(f) {
      const t = now();
      return [...cards.values()]
        .filter((c) => !c.deleted_at && inArea(c.area_id, f.area_id) && (!f.node_id || c.node_id === f.node_id) && (!f.due_only || (!c.suspended && c.due <= t)) && (!f.difficult_only || c.difficult) && (!f.source_id || c.source_id === f.source_id))
        .sort((a, b) => (f.due_only ? a.due.localeCompare(b.due) : b.created_at.localeCompare(a.created_at)))
        .slice(0, f.limit ?? 5000);
    },
    async cardCreate(input) {
      if (!input.front.trim() || !input.back.trim()) throw err("Vorder- und Rückseite dürfen nicht leer sein.");
      const c: Card = {
        id: uuid(),
        area_id: input.area_id ?? (input.node_id ? areaOf(input.node_id) ?? null : null),
        node_id: input.node_id ?? null,
        kind: input.kind ?? "frage",
        front: input.front.trim(),
        back: input.back.trim(),
        tags: input.tags ?? "",
        source_type: input.source_type ?? null,
        source_id: input.source_id ?? null,
        difficult: false,
        suspended: false,
        due: now(),
        stability: 0,
        difficulty: 0,
        elapsed_days: 0,
        scheduled_days: 0,
        learning_steps: 0,
        reps: 0,
        lapses: 0,
        state: 0,
        last_review: null,
        created_at: now(),
        updated_at: now(),
        deleted_at: null,
      };
      cards.set(c.id, c);
      return c;
    },
    async cardUpdate(id, patch) {
      const c = cards.get(id);
      if (!c) throw err("Karteikarte nicht gefunden.");
      Object.assign(c, patch, { updated_at: now() });
      return c;
    },
    async cardReview(id, r) {
      const c = cards.get(id);
      if (!c) throw err("Karteikarte nicht gefunden.");
      reviews.push({ card: id, rating: r.rating, at: now() });
      Object.assign(c, { ...r, last_review: now(), difficult: r.rating <= 2 ? true : r.rating === 4 ? false : c.difficult });
      return c;
    },
    async cardTrash(id) {
      const c = cards.get(id);
      if (c) c.deleted_at = now();
    },
    async cardStats(areaId, dayStart) {
      const all = [...cards.values()].filter((c) => !c.deleted_at && inArea(c.area_id, areaId));
      const t = now();
      const wk = new Date(Date.now() + 7 * 864e5).toISOString();
      const today = reviews.filter((r) => r.at >= dayStart);
      const month = reviews.filter((r) => r.at >= new Date(Date.now() - 30 * 864e5).toISOString());
      return {
        total: all.length,
        due_now: all.filter((c) => !c.suspended && c.due <= t).length,
        new_cards: all.filter((c) => c.state === 0).length,
        learning: all.filter((c) => c.state === 1 || c.state === 3).length,
        review: all.filter((c) => c.state === 2).length,
        difficult: all.filter((c) => c.difficult).length,
        suspended: all.filter((c) => c.suspended).length,
        reviewed_today: today.length,
        reviews_7d: reviews.filter((r) => r.at >= new Date(Date.now() - 7 * 864e5).toISOString()).length,
        retention_30d: month.length ? month.filter((r) => r.rating > 1).length / month.length : null,
        due_7d: all.filter((c) => !c.suspended && c.due <= wk).length,
      };
    },

    async tasksList(f) {
      return [...tasks.values()]
        .filter((t) => !t.deleted_at && inArea(t.area_id, f.area_id) && (!f.node_id || t.node_id === f.node_id) && (f.include_done || !t.done_at) && (!f.kind || t.kind === f.kind))
        .sort((a, b) => Number(!!a.done_at) - Number(!!b.done_at) || (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999") || a.created_at.localeCompare(b.created_at));
    },
    async taskCreate(input) {
      if (!input.title.trim()) throw err("Der Titel darf nicht leer sein.");
      const t: Task = {
        id: uuid(),
        area_id: input.area_id ?? (input.node_id ? areaOf(input.node_id) ?? null : null),
        node_id: input.node_id ?? null,
        kind: input.kind ?? "aufgabe",
        title: input.title.trim(),
        notes: input.notes ?? "",
        due_date: input.due_date ?? null,
        done_at: null,
        created_at: now(),
        updated_at: now(),
        deleted_at: null,
      };
      tasks.set(t.id, t);
      return t;
    },
    async taskUpdate(id, p) {
      const t = tasks.get(id);
      if (!t) throw err("Aufgabe nicht gefunden.");
      const { done, ...rest } = p;
      Object.assign(t, rest, { updated_at: now() });
      if (done !== undefined) t.done_at = done ? (t.done_at ?? now()) : null;
      return t;
    },
    async taskTrash(id) {
      const t = tasks.get(id);
      if (t) t.deleted_at = now();
    },
    async examsList(areaId, from) {
      return [...exams.values()].filter((e) => !e.deleted_at && inArea(e.area_id, areaId) && (!from || e.date >= from)).sort((a, b) => a.date.localeCompare(b.date));
    },
    async examSave(id, input) {
      if (!input.title.trim()) throw err("Der Titel darf nicht leer sein.");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw err("Bitte ein gültiges Datum angeben.");
      const e: Exam = {
        id: id ?? uuid(),
        area_id: input.area_id ?? (input.node_id ? areaOf(input.node_id) ?? null : null),
        node_id: input.node_id ?? null,
        title: input.title.trim(),
        date: input.date,
        time: input.time ?? "",
        place: input.place ?? "",
        kind: input.kind ?? "",
        notes: input.notes ?? "",
        created_at: exams.get(id ?? "")?.created_at ?? now(),
        updated_at: now(),
        deleted_at: null,
      };
      exams.set(e.id, e);
      return e;
    },
    async examTrash(id) {
      const e = exams.get(id);
      if (e) e.deleted_at = now();
    },

    async annotationsList(documentId) {
      return [...annotations.values()].filter((a) => a.document_id === documentId).sort((a, b) => a.page - b.page);
    },
    async annotationCreate(input) {
      if (input.kind === "bookmark" || input.kind === "ink") {
        const dup = [...annotations.values()].find((a) => a.document_id === input.document_id && a.page === input.page && a.kind === input.kind);
        if (dup) return input.kind === "ink" ? Object.assign(dup, { ink: input.ink ?? "", updated_at: now() }) : dup;
      }
      const a: Annotation = {
        id: uuid(),
        document_id: input.document_id,
        page: input.page,
        kind: input.kind,
        color: input.color ?? "gelb",
        rects: input.rects ?? [],
        quote: input.quote ?? "",
        comment: input.comment ?? "",
        ink: input.ink ?? "",
        created_at: now(),
        updated_at: now(),
      };
      annotations.set(a.id, a);
      return a;
    },
    async annotationUpdate(id, patch) {
      const a = annotations.get(id);
      if (!a) throw err("Markierung nicht gefunden.");
      Object.assign(a, patch, { updated_at: now() });
      return a;
    },
    async annotationDelete(id) {
      annotations.delete(id);
    },

    async imageStore(data) {
      const id = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("");
      images.set(id, data);
      return id;
    },
    async imageBytes(sha) {
      const b = images.get(sha);
      if (!b) throw err("Bild nicht gefunden.");
      return b;
    },
  };

  /** Papierkorb und Suche für die neuen Typen. */
  const extra = {
    trashItems() {
      const rows: { item_type: "knowledge" | "card" | "task" | "exam"; id: string; title: string; kind: string; deleted_at: string; area_id: string | null }[] = [];
      for (const k of knowledge.values()) if (k.deleted_at) rows.push({ item_type: "knowledge", id: k.id, title: k.title, kind: k.type, deleted_at: k.deleted_at, area_id: k.area_id });
      for (const c of cards.values()) if (c.deleted_at) rows.push({ item_type: "card", id: c.id, title: c.front, kind: "card", deleted_at: c.deleted_at, area_id: c.area_id });
      for (const t of tasks.values()) if (t.deleted_at) rows.push({ item_type: "task", id: t.id, title: t.title, kind: t.kind, deleted_at: t.deleted_at, area_id: t.area_id });
      for (const e of exams.values()) if (e.deleted_at) rows.push({ item_type: "exam", id: e.id, title: e.title, kind: "exam", deleted_at: e.deleted_at, area_id: e.area_id });
      return rows;
    },
    restore(type: string, id: string) {
      const m = { knowledge, card: cards, task: tasks, exam: exams }[type as "knowledge"] as Map<string, { deleted_at: string | null }> | undefined;
      const x = m?.get(id);
      if (x) x.deleted_at = null;
    },
    purge(type: string, id: string) {
      ({ knowledge, card: cards, task: tasks, exam: exams })[type as "knowledge"]?.delete(id);
    },
    search(terms: string[], areaId: string | null): SearchHit[] {
      const match = (s: string) => terms.every((t) => fold(s).includes(t));
      const hits: SearchHit[] = [];
      for (const k of knowledge.values()) {
        if (k.deleted_at || !inArea(k.area_id, areaId)) continue;
        const body = JSON.stringify(k.data);
        if (match(`${k.title} ${k.field} ${body}`)) hits.push({ entity_type: "knowledge", entity_id: k.id, area_id: k.area_id, page: null, title: k.title, snippet: String((k.data as { text?: string }).text ?? ""), path: k.field, kind: k.type, target_id: null });
      }
      for (const c of cards.values()) {
        if (!c.deleted_at && inArea(c.area_id, areaId) && match(`${c.front} ${c.back}`)) hits.push({ entity_type: "card", entity_id: c.id, area_id: c.area_id, page: null, title: c.front, snippet: c.back, path: "", kind: "card", target_id: null });
      }
      for (const t of tasks.values()) {
        if (!t.deleted_at && inArea(t.area_id, areaId) && match(t.title)) hits.push({ entity_type: "task", entity_id: t.id, area_id: t.area_id, page: null, title: t.title, snippet: t.notes, path: "", kind: "task", target_id: null });
      }
      return hits;
    },
    describe(id: string) {
      const k = knowledge.get(id);
      return k ? { title: k.title, kind: k.type, missing: !!k.deleted_at } : null;
    },
  };

  return { api, extra };
}
