/**
 * Kalenderdateien (iCalendar, RFC 5545) lesen – z. B. das Stundenplan-Abo der
 * Uni. Nur was ein Stundenplan braucht: Termine mit Titel, Ort, Beginn, Ende,
 * wöchentliche/tägliche Wiederholung, Ausnahmen, verschobene und abgesagte
 * Termine. Zeiten ohne „Z“ gelten als Ortszeit des Geräts.
 */

export interface IcsEvent {
  uid: string;
  summary: string;
  location: string;
  description: string;
  start: Date;
  end: Date;
  allDay: boolean;
  rrule: string;
  exdates: number[];
  /** verschobener/geänderter Einzeltermin einer Serie: ursprünglicher Beginn */
  recurrenceId: number | null;
  cancelled: boolean;
}

export interface Occurrence {
  uid: string;
  summary: string;
  location: string;
  start: Date;
  end: Date;
  allDay: boolean;
  cancelled: boolean;
}

const unescape = (s: string) => s.replace(/\\([\\;,nN])/g, (_, c: string) => (c === "n" || c === "N" ? "\n" : c));

/** „20261104T101500Z“, „20261104T101500“, „20261104“ */
export function parseIcsDate(value: string, params = ""): { date: Date; allDay: boolean } | null {
  const v = value.trim();
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(v);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
  if (!m[4] || /VALUE=DATE(?!-)/i.test(params)) return { date: new Date(y, mo, d), allDay: true };
  const [h, mi, s] = [Number(m[4]), Number(m[5]), Number(m[6] ?? 0)];
  return { date: m[7] ? new Date(Date.UTC(y, mo, d, h, mi, s)) : new Date(y, mo, d, h, mi, s), allDay: false };
}

/** Termine aus einer Kalenderdatei. */
export function parseIcs(text: string): IcsEvent[] {
  const lines = text.replace(/\r\n|\r/g, "\n").replace(/\n[ \t]/g, "").split("\n");
  const out: IcsEvent[] = [];
  let cur: Partial<IcsEvent> & { exdates: number[] } | null = null;
  let depth = 0;
  for (const line of lines) {
    if (/^BEGIN:VEVENT$/i.test(line)) {
      cur = { exdates: [], summary: "", location: "", description: "", rrule: "", uid: "", recurrenceId: null, cancelled: false };
      depth = 0;
      continue;
    }
    if (!cur) continue;
    // verschachtelte Blöcke (z. B. VALARM) überspringen
    if (/^BEGIN:/i.test(line)) depth++;
    else if (/^END:VEVENT$/i.test(line) && depth === 0) {
      if (cur.start) out.push({ ...cur, end: cur.end ?? new Date(cur.start.getTime() + (cur.allDay ? 86400000 : 3600000)) } as IcsEvent);
      cur = null;
      continue;
    } else if (/^END:/i.test(line)) depth = Math.max(0, depth - 1);
    if (depth) continue;
    const i = line.indexOf(":");
    if (i < 0) continue;
    const head = line.slice(0, i);
    const value = line.slice(i + 1);
    const [name, ...rest] = head.split(";");
    const params = rest.join(";");
    switch (name!.toUpperCase()) {
      case "UID":
        cur.uid = value.trim();
        break;
      case "SUMMARY":
        cur.summary = unescape(value).trim();
        break;
      case "LOCATION":
        cur.location = unescape(value).trim();
        break;
      case "DESCRIPTION":
        cur.description = unescape(value).trim();
        break;
      case "DTSTART": {
        const d = parseIcsDate(value, params);
        if (d) [cur.start, cur.allDay] = [d.date, d.allDay];
        break;
      }
      case "DTEND": {
        const d = parseIcsDate(value, params);
        if (d) cur.end = d.date;
        break;
      }
      case "DURATION": {
        const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/.exec(value.trim());
        if (m && cur.start) cur.end = new Date(cur.start.getTime() + ((Number(m[1] ?? 0) * 24 + Number(m[2] ?? 0)) * 60 + Number(m[3] ?? 0)) * 60000);
        break;
      }
      case "RRULE":
        cur.rrule = value.trim();
        break;
      case "EXDATE":
        for (const v of value.split(",")) {
          const d = parseIcsDate(v, params);
          if (d) cur.exdates.push(d.date.getTime());
        }
        break;
      case "RECURRENCE-ID": {
        const d = parseIcsDate(value, params);
        if (d) cur.recurrenceId = d.date.getTime();
        break;
      }
      case "STATUS":
        cur.cancelled = /CANCELLED/i.test(value);
        break;
    }
  }
  return out;
}

const DAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

/** Wiederholungen bis `to` auflösen (wöchentlich und täglich; höchstens 500 je Serie). */
export function expandEvents(events: IcsEvent[], from: Date, to: Date): Occurrence[] {
  const out: Occurrence[] = [];
  const overrides = new Map<string, IcsEvent>();
  for (const e of events) if (e.recurrenceId !== null) overrides.set(`${e.uid}|${e.recurrenceId}`, e);
  const push = (e: IcsEvent, start: Date, end: Date) => {
    if (end < from || start > to) return;
    out.push({ uid: e.uid, summary: e.summary, location: e.location, start, end, allDay: e.allDay, cancelled: e.cancelled });
  };
  for (const e of events) {
    if (e.recurrenceId !== null) {
      push(e, e.start, e.end);
      continue;
    }
    const dur = e.end.getTime() - e.start.getTime();
    const rule = Object.fromEntries(e.rrule.split(";").filter(Boolean).map((p) => p.split("=") as [string, string]));
    const freq = (rule.FREQ ?? "").toUpperCase();
    if (freq !== "WEEKLY" && freq !== "DAILY") {
      push(e, e.start, e.end);
      continue;
    }
    const interval = Math.max(1, Number(rule.INTERVAL) || 1);
    const until = rule.UNTIL ? parseIcsDate(rule.UNTIL)?.date ?? to : to;
    const count = Number(rule.COUNT) || Infinity;
    const byDay = freq === "WEEKLY" && rule.BYDAY ? rule.BYDAY.split(",").map((d) => DAYS.indexOf(d.slice(-2).toUpperCase())).filter((d) => d >= 0) : [e.start.getDay()];
    const last = Math.min(until.getTime(), to.getTime());
    let n = 0;
    // Wochen (bzw. Tage) ab Serienbeginn durchgehen
    const step = freq === "DAILY" ? 1 : 7;
    const base = new Date(e.start.getFullYear(), e.start.getMonth(), e.start.getDate() - (freq === "WEEKLY" ? e.start.getDay() : 0));
    for (let k = 0; n < count && n < 500; k += interval) {
      const blockStart = new Date(base.getFullYear(), base.getMonth(), base.getDate() + k * step);
      if (blockStart.getTime() > last) break;
      for (const wd of freq === "DAILY" ? [blockStart.getDay()] : [...byDay].sort((a, b) => a - b)) {
        const day = new Date(blockStart.getFullYear(), blockStart.getMonth(), blockStart.getDate() + (freq === "DAILY" ? 0 : wd));
        const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), e.start.getHours(), e.start.getMinutes(), e.start.getSeconds());
        if (start < e.start || start.getTime() > last || n >= count) continue;
        n++;
        if (e.exdates.includes(start.getTime())) continue;
        const ov = overrides.get(`${e.uid}|${start.getTime()}`);
        if (ov) continue; // der geänderte Termin steht als eigener Eintrag drin
        push(e, start, new Date(start.getTime() + dur));
      }
    }
  }
  return out.sort((a, b) => a.start.getTime() - b.start.getTime());
}
