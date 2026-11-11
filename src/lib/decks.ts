/**
 * Stapel (mit Unterstapeln „Zivilrecht::BGB AT::Willenserklärung“), ihre
 * Optionen (Tageslimits, Lernschritte, Zielbehaltensquote …) und die
 * Warteschlange einer Lernsitzung – angelehnt an bewährte Lernkartei-Programme:
 * zuerst fällige Lernkarten, dann Wiederholungen, dann neue Karten bis zum
 * Tageslimit; Lernkarten kommen nach ihrem Lernschritt (1 Min., 10 Min. …) wieder.
 */
import type { Card, ReviewLogEntry } from "../api/types";

export const SEP = "::";
export const DEFAULT_DECK = "Standard";
export const DECK_SETTING = "learn.decks";

export interface DeckOptions {
  newPerDay: number;
  reviewsPerDay: number;
  /** Lernschritte für neue Karten, z. B. „1m 10m“ */
  learningSteps: string;
  /** Schritte nach „Nochmal“ bei Wiederholungen */
  relearningSteps: string;
  /** Zielbehaltensquote (0,7–0,99) */
  retention: number;
  maxInterval: number;
  /** zusammengehörige Karten (umgekehrt, Lücken) erst am nächsten Tag zeigen */
  burySiblings: boolean;
  /** ab so vielen Fehlversuchen gilt eine Karte als Problemkarte (0 = aus) */
  leechThreshold: number;
  leechAction: "tag" | "suspend";
  /** Reihenfolge neuer Karten */
  newOrder: "added" | "random";
}

export const DEFAULT_OPTIONS: DeckOptions = {
  newPerDay: 20,
  reviewsPerDay: 200,
  learningSteps: "1m 10m",
  relearningSteps: "10m",
  retention: 0.9,
  maxInterval: 3650,
  burySiblings: true,
  leechThreshold: 8,
  leechAction: "tag",
  newOrder: "added",
};

export interface DeckSettings {
  /** angelegte (auch leere) Stapel */
  decks: string[];
  /** Optionen je Stapel (Unterstapel erben vom nächsten Oberstapel) */
  options: Record<string, Partial<DeckOptions>>;
  collapsed: string[];
  /** Beschreibung je Stapel */
  descriptions: Record<string, string>;
}

const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const steps = (v: unknown, d: string) => (typeof v === "string" && /^(\s*\d+(\.\d+)?[mhd]\s*)*$/.test(v) ? v.trim() : d);

export function cleanOptions(o: Partial<DeckOptions> | undefined, base: DeckOptions = DEFAULT_OPTIONS): DeckOptions {
  const v = o ?? {};
  return {
    newPerDay: Math.round(num(v.newPerDay, 0, 9999, base.newPerDay)),
    reviewsPerDay: Math.round(num(v.reviewsPerDay, 0, 99999, base.reviewsPerDay)),
    learningSteps: steps(v.learningSteps, base.learningSteps),
    relearningSteps: steps(v.relearningSteps, base.relearningSteps),
    retention: num(v.retention, 0.7, 0.99, base.retention),
    maxInterval: Math.round(num(v.maxInterval, 1, 36500, base.maxInterval)),
    burySiblings: typeof v.burySiblings === "boolean" ? v.burySiblings : base.burySiblings,
    leechThreshold: Math.round(num(v.leechThreshold, 0, 99, base.leechThreshold)),
    leechAction: v.leechAction === "suspend" || v.leechAction === "tag" ? v.leechAction : base.leechAction,
    newOrder: v.newOrder === "random" || v.newOrder === "added" ? v.newOrder : base.newOrder,
  };
}

export function parseDeckSettings(v: unknown): DeckSettings {
  const o = v && typeof v === "object" ? (v as Partial<DeckSettings>) : {};
  const strs = (a: unknown) => (Array.isArray(a) ? a.filter((x): x is string => typeof x === "string").map(normDeck).filter(Boolean) : []);
  const rec = <T>(r: unknown, f: (x: unknown) => T | null): Record<string, T> => {
    const out: Record<string, T> = {};
    if (r && typeof r === "object") for (const [k, x] of Object.entries(r)) {
      const val = f(x);
      if (val !== null && normDeck(k)) out[normDeck(k)] = val;
    }
    return out;
  };
  return {
    decks: [...new Set(strs(o.decks))],
    options: rec(o.options, (x) => (x && typeof x === "object" ? (x as Partial<DeckOptions>) : null)),
    collapsed: [...new Set(strs(o.collapsed))],
    descriptions: rec(o.descriptions, (x) => (typeof x === "string" ? x.slice(0, 2000) : null)),
  };
}

/** Stapelpfad bereinigen (wie im Kern) */
export const normDeck = (s: string) =>
  s
    .split(/:{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .join(SEP)
    .slice(0, 200);

export const deckName = (path: string) => path.split(SEP).at(-1) ?? path;
export const parentsOf = (path: string) => path.split(SEP).map((_, i, a) => a.slice(0, i + 1).join(SEP));
export const inDeck = (cardDeck: string, deck: string) => cardDeck === deck || cardDeck.startsWith(deck + SEP);

/** Stapel einer Karte: eigener Stapel, sonst „Standard“ */
export const deckOf = (c: Pick<Card, "deck">) => c.deck || DEFAULT_DECK;

/** Optionen eines Stapels: eigene, sonst vom nächsten Oberstapel, sonst Standard */
export function optionsFor(s: DeckSettings, path: string): DeckOptions {
  let o = DEFAULT_OPTIONS;
  for (const p of parentsOf(path)) if (s.options[p]) o = cleanOptions(s.options[p], o);
  return o;
}

// ---------- Zählen ----------

export type CardState = "new" | "learn" | "review" | "suspended" | "buried";

export function cardStatus(c: Card, nowIso: string): CardState {
  if (c.suspended) return "suspended";
  if (c.buried_until && c.buried_until > nowIso) return "buried";
  if (c.state === 0) return "new";
  if (c.state === 1 || c.state === 3) return "learn";
  return "review";
}

/** zählt als heute fällig: bis Tagesende */
const dueToday = (c: Card, endOfDay: string) => c.due <= endOfDay;

export interface DeckCounts {
  new: number;
  learn: number;
  review: number;
  total: number;
}

export interface DeckNode {
  path: string;
  name: string;
  depth: number;
  children: DeckNode[];
  counts: DeckCounts;
}

/** Bereits heute eingeführte neue Karten und Wiederholungen je Stapel (aus dem Protokoll) */
export function todayUsage(log: ReviewLogEntry[], cards: Map<string, Card>, dayStart: string): Map<string, { newDone: number; reviewsDone: number }> {
  const out = new Map<string, { newDone: number; reviewsDone: number }>();
  const seenNew = new Set<string>();
  for (const l of log) {
    if (l.reviewed_at < dayStart) continue;
    const c = cards.get(l.card_id);
    if (!c) continue;
    for (const p of parentsOf(deckOf(c))) {
      const u = out.get(p) ?? { newDone: 0, reviewsDone: 0 };
      if (l.state_before === 0 && !seenNew.has(`${p}|${c.id}`)) {
        seenNew.add(`${p}|${c.id}`);
        u.newDone++;
      } else if (l.state_before === 2) u.reviewsDone++;
      out.set(p, u);
    }
  }
  return out;
}

/**
 * Stapelbaum mit den heute anstehenden Zahlen. Neue Karten und
 * Wiederholungen werden durch die Tageslimits des Stapels (und aller
 * Oberstapel) begrenzt; Lernkarten nicht.
 */
export function buildDeckTree(cards: Card[], s: DeckSettings, now: Date, usage: Map<string, { newDone: number; reviewsDone: number }>): DeckNode[] {
  const nowIso = now.toISOString();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();
  const paths = new Set<string>(s.decks);
  for (const c of cards) paths.add(deckOf(c));
  for (const p of [...paths]) for (const q of parentsOf(p)) paths.add(q);
  // Rohzahlen je Stapel (nur eigene Karten)
  const own = new Map<string, DeckCounts>();
  for (const p of paths) own.set(p, { new: 0, learn: 0, review: 0, total: 0 });
  for (const c of cards) {
    const o = own.get(deckOf(c))!;
    o.total++;
    const st = cardStatus(c, nowIso);
    if (st === "new") o.new++;
    else if (st === "learn" && dueToday(c, end)) o.learn++;
    else if (st === "review" && dueToday(c, end)) o.review++;
  }
  const byParent = new Map<string, string[]>();
  for (const p of paths) {
    const parent = p.includes(SEP) ? p.slice(0, p.lastIndexOf(SEP)) : "";
    byParent.set(parent, [...(byParent.get(parent) ?? []), p]);
  }
  const make = (path: string, depth: number): DeckNode => {
    const kids = (byParent.get(path) ?? []).sort((a, b) => collator.compare(deckName(a), deckName(b))).map((k) => make(k, depth + 1));
    const o = own.get(path)!;
    const sum = kids.reduce((acc, k) => ({ new: acc.new + k.counts.new, learn: acc.learn + k.counts.learn, review: acc.review + k.counts.review, total: acc.total + k.counts.total }), { ...o });
    const opt = optionsFor(s, path);
    const u = usage.get(path) ?? { newDone: 0, reviewsDone: 0 };
    const counts = {
      new: Math.min(sum.new, Math.max(0, opt.newPerDay - u.newDone)),
      learn: sum.learn,
      review: Math.min(sum.review, Math.max(0, opt.reviewsPerDay - u.reviewsDone)),
      total: sum.total,
    };
    return { path, name: deckName(path), depth, children: kids, counts };
  };
  return (byParent.get("") ?? []).sort((a, b) => (a === DEFAULT_DECK ? 1 : b === DEFAULT_DECK ? -1 : collator.compare(a, b))).map((p) => make(p, 0));
}

const collator = new Intl.Collator("de", { numeric: true, sensitivity: "base" });

export function flattenTree(nodes: DeckNode[], collapsed: Set<string>): DeckNode[] {
  const out: DeckNode[] = [];
  const walk = (ns: DeckNode[]) => {
    for (const n of ns) {
      out.push(n);
      if (!collapsed.has(n.path)) walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

// ---------- Warteschlange ----------

/** Benutzerdefiniertes Lernen (außerhalb der Tageslimits) */
export type CustomStudy =
  | { mode: "new"; count: number }
  | { mode: "forgotten"; days: number }
  | { mode: "ahead"; days: number }
  | { mode: "tag"; tag: string }
  | { mode: "flag"; flag: number }
  | { mode: "difficult" }
  | { mode: "all" }
  | ({ mode: "repeat" } & RepeatOptions);

/** Stapel wiederholen – auch Karten, die noch nicht fällig sind */
export interface RepeatOptions {
  /** alle Karten, nur schon gelernte oder nur die in den nächsten Tagen fälligen */
  which: "all" | "learned" | "soon";
  days: number;
  order: "random" | "due";
  /** nur üben: Antworten ändern die Planung nicht */
  practice: boolean;
}

export const DEFAULT_REPEAT: RepeatOptions = { which: "all", days: 7, order: "random", practice: true };

/** Karten für „Stapel wiederholen“ (ohne Ausgesetzte und Zurückgestellte) */
export function repeatList(cards: Card[], r: RepeatOptions, now: Date, rand: () => number = Math.random): Card[] {
  const nowIso = now.toISOString();
  const until = new Date(now.getTime() + r.days * 864e5).toISOString();
  const list = cards.filter(
    (c) => !c.deleted_at && !c.suspended && cardStatus(c, nowIso) !== "buried" && (r.which === "all" || (c.state !== 0 && (r.which === "learned" || c.due <= until))),
  );
  if (r.order === "random") return shuffle(list, rand);
  // schon gelernte nach Fälligkeit, neue danach in Reihenfolge des Anlegens
  return list.sort((a, b) => Number(a.state === 0) - Number(b.state === 0) || (a.state === 0 ? a.created_at.localeCompare(b.created_at) || a.ord - b.ord : a.due.localeCompare(b.due)));
}

/** Wie weit eine Karte in der Übungsrunde (ohne Planung) zurückwandert */
export const PRACTICE_AGAIN_GAP = 3;

/**
 * Übungsrunde: „Nochmal“ bringt die Karte nach wenigen Karten wieder,
 * „Schwer“ ans Ende der Runde, „Gut“/„Einfach“ nimmt sie heraus.
 */
export function practiceRequeue(main: Card[], card: Card, rating: 1 | 2 | 3 | 4): Card[] {
  const rest = main.filter((c) => c.id !== card.id);
  if (rating === 1) return [...rest.slice(0, PRACTICE_AGAIN_GAP), card, ...rest.slice(PRACTICE_AGAIN_GAP)];
  if (rating === 2) return [...rest, card];
  return rest;
}

/**
 * Neue Karten bzw. Wiederholungen innerhalb der Tageslimits: jede Karte
 * belegt einen Platz im eigenen Stapel und in jedem Oberstapel bis `root`
 * (beim Lernen eines Unterstapels gelten dessen Limits und die darunter).
 */
export function applyLimits(list: Card[], kind: "new" | "review", s: DeckSettings, usage: Map<string, { newDone: number; reviewsDone: number }>, root?: string): Card[] {
  const left = new Map<string, number>();
  const room = (p: string) => {
    if (!left.has(p)) {
      const o = optionsFor(s, p);
      const u = usage.get(p) ?? { newDone: 0, reviewsDone: 0 };
      left.set(p, kind === "new" ? o.newPerDay - u.newDone : o.reviewsPerDay - u.reviewsDone);
    }
    return left.get(p)!;
  };
  const out: Card[] = [];
  for (const c of list) {
    const chain = parentsOf(deckOf(c)).filter((p) => !root || inDeck(p, root));
    if (chain.every((p) => room(p) > 0)) {
      for (const p of chain) left.set(p, room(p) - 1);
      out.push(c);
    }
  }
  return out;
}

export interface StudyLimits {
  newLeft: number;
  reviewsLeft: number;
}

/** Karten für eine Sitzung: fällige Lernkarten, Wiederholungen (älteste zuerst), neue bis zum Limit. */
export function buildQueue(cards: Card[], now: Date, limits: StudyLimits, opts: Pick<DeckOptions, "newOrder">, rand: () => number = Math.random): { learning: Card[]; main: Card[] } {
  const nowIso = now.toISOString();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();
  const live = cards.filter((c) => !c.deleted_at);
  const learning = live.filter((c) => cardStatus(c, nowIso) === "learn" && dueToday(c, end)).sort((a, b) => a.due.localeCompare(b.due));
  const reviews = live
    .filter((c) => cardStatus(c, nowIso) === "review" && c.due <= end)
    .sort((a, b) => a.due.localeCompare(b.due))
    .slice(0, Math.max(0, limits.reviewsLeft));
  let fresh = live.filter((c) => cardStatus(c, nowIso) === "new");
  fresh = opts.newOrder === "random" ? shuffle(fresh, rand) : fresh.sort((a, b) => a.created_at.localeCompare(b.created_at) || a.ord - b.ord);
  fresh = fresh.slice(0, Math.max(0, limits.newLeft));
  // neue Karten gleichmäßig zwischen die Wiederholungen streuen
  const main: Card[] = [];
  const every = fresh.length ? Math.max(1, Math.floor((reviews.length + fresh.length) / fresh.length)) : 0;
  let r = 0;
  let f = 0;
  while (r < reviews.length || f < fresh.length) {
    if (f < fresh.length && (r >= reviews.length || (main.length + 1) % every === 0)) main.push(fresh[f++]!);
    else main.push(reviews[r++]!);
  }
  return { learning, main };
}

function shuffle<T>(a: T[], rand: () => number): T[] {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [b[i], b[j]] = [b[j]!, b[i]!];
  }
  return b;
}

/** Wie lange darf eine Lernkarte vorgezogen werden, wenn sonst nichts ansteht (Minuten) */
export const LEARN_AHEAD_MIN = 20;

/**
 * Nächste Karte: fällige Lernkarte, sonst die nächste aus `main`, sonst eine
 * Lernkarte, die in den nächsten 20 Minuten fällig wird.
 */
export function nextCard(learning: Card[], main: Card[], now: Date): { card: Card; from: "learning" | "main" } | null {
  const nowIso = now.toISOString();
  const dueL = learning.filter((c) => c.due <= nowIso).sort((a, b) => a.due.localeCompare(b.due))[0];
  if (dueL) return { card: dueL, from: "learning" };
  if (main.length) return { card: main[0]!, from: "main" };
  const ahead = new Date(now.getTime() + LEARN_AHEAD_MIN * 60000).toISOString();
  const soon = learning.filter((c) => c.due <= ahead).sort((a, b) => a.due.localeCompare(b.due))[0];
  return soon ? { card: soon, from: "learning" } : null;
}

/** Ist die Karte nach der Bewertung heute noch einmal dran (Lernschritt)? */
export const staysToday = (c: Card, now: Date) => (c.state === 1 || c.state === 3) && c.due < new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();

/** Beginn des nächsten Tages (zum Zurückstellen) */
export const tomorrow = (now: Date) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();

/** Ist die Karte jetzt eine Problemkarte (Fehlversuche erreichen die Schwelle, danach alle halbe Schwelle)? */
export function becameLeech(before: Card, after: Card, threshold: number): boolean {
  if (!threshold || after.lapses <= before.lapses) return false;
  if (after.lapses < threshold) return false;
  const step = Math.max(1, Math.ceil(threshold / 2));
  return (after.lapses - threshold) % step === 0;
}

export const LEECH_TAG = "Problemkarte";
/** Schlagwörter: durch Komma oder Semikolon getrennt (mehrere Wörter je Schlagwort möglich, z. B. „BGB AT“) */
export const tagList = (tags: string) => [...new Set(tags.split(/[,;]+/).map((t) => t.trim()).filter(Boolean))];
export const addTag = (tags: string, t: string) => (tagList(tags).some((x) => x.toLowerCase() === t.toLowerCase()) ? tags : [...tagList(tags), t].join(", "));
export const removeTag = (tags: string, t: string) => tagList(tags).filter((x) => x.toLowerCase() !== t.toLowerCase()).join(", ");
