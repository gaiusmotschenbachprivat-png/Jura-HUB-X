/**
 * Zeitstrahl zum Sachverhalt: Zeitangaben lesen und sortieren, Ereignisse aus
 * einem markierten Sachverhalt herauslösen. Nur Regeln, keine KI: erkannt
 * werden Datumsangaben („1.3.2024“, „01.03.24“, „1.3.“, „1. März 2024“,
 * „Mitte März 2024“, „2024“), Uhrzeiten („10:15“, „14 Uhr“) und relative
 * Angaben („zwei Tage später“, „am nächsten Tag“). Einträge ohne erkennbares
 * Datum bleiben beim Sortieren hinter ihrem Vorgänger.
 */

const MONTHS = ["januar", "februar", "märz", "april", "mai", "juni", "juli", "august", "september", "oktober", "november", "dezember"];
const MONTH_RE = "(januar|jan\\.?|februar|feb\\.?|märz|maerz|mär\\.?|april|apr\\.?|mai|juni|jun\\.?|juli|jul\\.?|august|aug\\.?|september|sept?\\.?|oktober|okt\\.?|november|nov\\.?|dezember|dez\\.?)";
const monthOf = (w: string) => {
  const s = w.toLowerCase().replace(/\.$/, "").replace("maerz", "märz");
  return MONTHS.findIndex((m) => m.startsWith(s.slice(0, 3)));
};
const fullYear = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y));

/** Zerlegte Zeitangabe; `day`/`month` fehlen bei „2024“, `year` fehlt bei „1.3.“. */
export interface When {
  year?: number;
  month?: number;
  day?: number;
  minutes?: number;
}

const DATE = /\b(\d{1,2})\.\s?(\d{1,2})\.(?:\s?(\d{4}|\d{2})\b)?/;
const DATE_WORD = new RegExp(`\\b(?:(\\d{1,2})\\.\\s*|(anfang|mitte|ende)\\s+)?${MONTH_RE}(?:\\s+(\\d{4}))?(?![a-zäöü])`, "i");
const TIME = /\b(\d{1,2})(?:[:.](\d{2}))?\s*uhr\b|\b(\d{1,2}):(\d{2})\b/i;
const YEAR = /\b(19\d{2}|20\d{2})\b/;

/** Zeitangabe lesen (null, wenn nichts Datum- oder Uhrzeitartiges darin steht). */
export function parseWhen(s: string): When | null {
  const t = s.trim();
  if (!t) return null;
  const w: When = {};
  const d = DATE.exec(t);
  if (d && Number(d[1]) >= 1 && Number(d[1]) <= 31 && Number(d[2]) >= 1 && Number(d[2]) <= 12) {
    w.day = Number(d[1]);
    w.month = Number(d[2]) - 1;
    if (d[3]) w.year = fullYear(d[3]);
  } else {
    const m = DATE_WORD.exec(t);
    if (m && monthOf(m[3]!) >= 0) {
      w.month = monthOf(m[3]!);
      w.day = m[1] ? Number(m[1]) : m[2] ? { anfang: 1, mitte: 15, ende: 28 }[m[2].toLowerCase() as "anfang"] : undefined;
      if (m[4]) w.year = Number(m[4]);
    } else {
      const y = YEAR.exec(t);
      if (y) w.year = Number(y[1]);
    }
  }
  // Uhrzeit (nicht die Ziffern eines Datums)
  const rest = d ? t.replace(d[0], " ") : t;
  const tm = TIME.exec(rest);
  if (tm) {
    const h = Number(tm[1] ?? tm[3]);
    const mi = Number(tm[2] ?? tm[4] ?? 0);
    if (h <= 24 && mi < 60) w.minutes = h * 60 + mi;
  }
  return Object.keys(w).length ? w : null;
}

/**
 * Sortierreihenfolge für Zeitangaben (Indizes). Fehlende Teile werden aus dem
 * vorigen Eintrag ergänzt („1.3.“ bekommt das Jahr, „14 Uhr“ den Tag davor);
 * Einträge ohne Zeitangabe bleiben direkt hinter ihrem Vorgänger.
 */
export function sortOrder(whens: string[]): number[] {
  let ctx: Required<Omit<When, "minutes">> & { minutes: number } = { year: 0, month: 0, day: 1, minutes: -1 };
  let lastKey = -Infinity;
  let sub = 0;
  const keys = whens.map((s) => {
    const w = parseWhen(s);
    if (!w) {
      // ohne Zeitangabe: hinter dem Vorgänger
      sub += 1e-3;
      return lastKey + sub;
    }
    const hasDate = w.day !== undefined || w.month !== undefined || w.year !== undefined;
    const year = w.year ?? ctx.year;
    const month = w.month ?? (hasDate ? 0 : ctx.month);
    const day = w.day ?? (hasDate ? 1 : ctx.day);
    const minutes = w.minutes ?? (hasDate ? -1 : ctx.minutes);
    ctx = { year, month, day, minutes };
    sub = 0;
    lastKey = ((year * 12 + month) * 32 + day) * 1500 + (minutes + 1);
    return lastKey;
  });
  return keys.map((k, i) => [k, i] as const).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(([, i]) => i);
}

export const isSorted = (whens: string[]) => sortOrder(whens).every((v, i) => v === i);

// ---------- Ereignisse aus dem Sachverhalt ----------

const NUM_WORD = "(?:ein(?:e[mnr]?)?|zwei|drei|vier|fünf|sechs|sieben|acht|neun|zehn|elf|zwölf|einige[n]?|wenige[n]?|mehrere[n]?|\\d+)";
const RELATIVE = new RegExp(
  [
    `\\b${NUM_WORD}\\s+(?:tage?|wochen?|monate?|jahre?|stunden?|minuten?)\\s+(?:später|danach|darauf|zuvor|vorher)`,
    `\\b${NUM_WORD}\\s+(?:tage?|wochen?|monate?|jahre?|stunden?|minuten?)\\s+(?:nach|vor)\\s+(?:de[mnrs]|einer?|seine[mr]|ihre[mr])\\s+[A-ZÄÖÜ][a-zäöüß]+`,
    `\\b(?:am|an\\s+dem)\\s+(?:folgenden|nächsten|darauffolgenden|selben|gleichen)\\s+(?:tag|morgen|abend|vormittag|nachmittag)`,
    `\\b(?:in\\s+der\\s+)?(?:folgenden|nächsten|darauffolgenden)\\s+(?:woche|monat|jahr)`,
    `\\b(?:kurz|bald|wenig)\\s+(?:darauf|danach|später)`,
    `\\b(?:noch\\s+)?am\\s+(?:selben|gleichen)\\s+tag`,
    `\\b(?:tags|kurz)\\s+darauf\\b`,
    `\\b(?:anschließend|daraufhin)\\b`,
  ].join("|"),
  "i",
);

/** erste Zeitangabe im Satz (Datum, Uhrzeit oder relative Angabe), sonst "" */
export function whenIn(sentence: string): string {
  const hits: { at: number; text: string }[] = [];
  const add = (m: RegExpExecArray | null, text?: string) => m && hits.push({ at: m.index, text: (text ?? m[0]).trim() });
  const d = DATE.exec(sentence);
  if (d && Number(d[1]) <= 31 && Number(d[2]) >= 1 && Number(d[2]) <= 12) {
    // Datum samt nachfolgender Uhrzeit („1.3.2024 um 10 Uhr“)
    const after = sentence.slice(d.index + d[0].length);
    const tm = /^\s*(?:,\s*)?(?:um\s+|gegen\s+)?(\d{1,2}(?:[:.]\d{2})?\s*uhr|\d{1,2}:\d{2})/i.exec(after);
    add(d, d[0] + (tm ? `, ${tm[1]}` : ""));
  }
  const dw = DATE_WORD.exec(sentence);
  if (dw && monthOf(dw[3]!) >= 0 && (dw[1] || dw[2] || dw[4])) add(dw);
  add(TIME.exec(sentence));
  add(RELATIVE.exec(sentence));
  const y = /\b(?:im\s+(?:jahr\s+)?|seit\s+)(19\d{2}|20\d{2})\b/i.exec(sentence);
  if (y) hits.push({ at: y.index, text: y[1]! });
  hits.sort((a, b) => a.at - b.at);
  const first = hits[0]?.text ?? "";
  return first ? first.charAt(0).toUpperCase() + first.slice(1) : "";
}

const ABBR = ["z. B.", "z.B.", "u. a.", "u.a.", "d. h.", "d.h.", "v. a.", "i. V. m.", "i.V.m.", "e. V.", "Abs.", "Nr.", "Art.", "Rn.", "Var.", "Alt.", "ca.", "bzw.", "ggf.", "evtl.", "vgl.", "usw.", "insb.", "Hs.", "Dr.", "Prof.", "Fa.", "Str.", "S.", "Co.", "Std.", "Min.", "Mio.", "Tsd."];
const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const ABBR_RE = new RegExp(`(?<![A-Za-zÄÖÜäöüß])(?:${ABBR.map(esc).join("|")})`, "g");
const MONTH_NAMES = "januar|februar|märz|april|mai|juni|juli|august|september|oktober|november|dezember";

/** Text in Sätze teilen (ohne bei „Abs.“, „z. B.“ oder Datumspunkten zu trennen). */
export function sentences(text: string): string[] {
  const keep = (m: string) => m.replace(/\./g, "§DOT§");
  const s = text
    .replace(/\s+/g, " ")
    .replace(/\b\d{1,2}\.\s?\d{1,2}\.(?:\s?\d{4}\b|\s?\d{2}\b)?/g, keep)
    .replace(new RegExp(`\\b\\d{1,2}\\.(?=\\s*(?:${MONTH_NAMES})\\b)`, "gi"), keep)
    .replace(ABBR_RE, keep)
    // Initialen („A. und B.“ bleiben Sätze, „Max M. Muster“ nicht)
    .replace(/\b([A-ZÄÖÜ])\.(?= [a-zäöü])/g, "$1§DOT§");
  return s
    .split(/(?<=[.!?])\s+(?=[A-ZÄÖÜ„"(\d])/)
    .map((x) => x.replace(/§DOT§/g, ".").trim())
    .filter(Boolean);
}

export interface TimelineEvent {
  when: string;
  text: string;
}

/**
 * Sachverhalt → Ereignisse: jeder Satz mit Zeitangabe beginnt einen Eintrag,
 * Sätze ohne Zeitangabe gehören zum Eintrag davor (am Anfang: „Ausgangslage“).
 */
export function extractEvents(text: string): TimelineEvent[] {
  const out: TimelineEvent[] = [];
  for (const s of sentences(text)) {
    const when = whenIn(s);
    if (when || !out.length) out.push({ when: when || "Ausgangslage", text: s });
    else out[out.length - 1]!.text += ` ${s}`;
  }
  return out;
}
