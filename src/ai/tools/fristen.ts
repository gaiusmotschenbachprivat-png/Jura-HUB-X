/**
 * Fristberechnung nach §§ 187–193 BGB mit gesetzlichen Feiertagen je Land.
 *
 * Rein rechnerisch und ohne Gewähr: Ob eine Frist eine Ereignis- oder
 * Beginnfrist ist, ob § 193 BGB (bzw. § 222 Abs. 2 ZPO) anwendbar ist und ob
 * regionale Feiertage gelten, muss im Einzelfall geprüft werden – das Ergebnis
 * weist darauf hin.
 */

export type FristArt = "ereignisfrist" | "beginnfrist";
export type Einheit = "tage" | "wochen" | "monate" | "jahre";
export type Land = "BW" | "BY" | "BE" | "BB" | "HB" | "HH" | "HE" | "MV" | "NI" | "NW" | "RP" | "SL" | "SN" | "ST" | "SH" | "TH";
export const LAENDER: Land[] = ["BW", "BY", "BE", "BB", "HB", "HH", "HE", "MV", "NI", "NW", "RP", "SL", "SN", "ST", "SH", "TH"];

export interface FristErgebnis {
  beginn: string;
  /** rechnerisches Ende nach § 188 BGB */
  ende_188: string;
  /** Ende nach Verschiebung gemäß § 193 BGB (falls anwendbar) */
  ende: string;
  verschoben: boolean;
  begruendung: string[];
  hinweise: string[];
}

// ---- Datumshilfen (UTC, ohne Uhrzeit) ----
const DAY = 86_400_000;
type D = number; // Millisekunden UTC, 0 Uhr

export function parseDate(s: string): D {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) throw new Error("Datum bitte als JJJJ-MM-TT angeben.");
  const d = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (new Date(d).getUTCDate() !== Number(m[3])) throw new Error("Ungültiges Datum.");
  return d;
}
export const iso = (d: D) => new Date(d).toISOString().slice(0, 10);
const de = (d: D) => {
  const x = new Date(d);
  const wd = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"][x.getUTCDay()];
  return `${wd}, ${String(x.getUTCDate()).padStart(2, "0")}.${String(x.getUTCMonth() + 1).padStart(2, "0")}.${x.getUTCFullYear()}`;
};
const addDays = (d: D, n: number) => d + n * DAY;
const lastDayOfMonth = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

/** Entsprechender Tag n Monate später; `null`, wenn es ihn im Zielmonat nicht gibt (§ 188 Abs. 3 BGB). */
function addMonthsExact(d: D, n: number): { date: D; exists: boolean } {
  const x = new Date(d);
  const y = x.getUTCFullYear();
  const m = x.getUTCMonth() + n;
  const ty = y + Math.floor(m / 12);
  const tm = ((m % 12) + 12) % 12;
  const last = lastDayOfMonth(ty, tm);
  const day = x.getUTCDate();
  return day <= last ? { date: Date.UTC(ty, tm, day), exists: true } : { date: Date.UTC(ty, tm, last), exists: false };
}

// ---- Feiertage ----
export function easterSunday(year: number): D {
  // Gaußsche Osterformel (anonymer gregorianischer Algorithmus)
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return Date.UTC(year, month - 1, day);
}

/** Gesetzliche Feiertage eines Landes (landesweit). Regionale Feiertage werden als Hinweis genannt. */
export function holidays(year: number, land: Land): Map<string, string> {
  const map = new Map<string, string>();
  const add = (d: D, name: string) => map.set(iso(d), name);
  const fix = (m: number, day: number, name: string) => add(Date.UTC(year, m - 1, day), name);
  const easter = easterSunday(year);
  fix(1, 1, "Neujahr");
  add(addDays(easter, -2), "Karfreitag");
  add(addDays(easter, 1), "Ostermontag");
  fix(5, 1, "Tag der Arbeit");
  add(addDays(easter, 39), "Christi Himmelfahrt");
  add(addDays(easter, 50), "Pfingstmontag");
  fix(10, 3, "Tag der Deutschen Einheit");
  fix(12, 25, "1. Weihnachtstag");
  fix(12, 26, "2. Weihnachtstag");
  const is = (...ls: Land[]) => ls.includes(land);
  if (is("BW", "BY", "ST")) fix(1, 6, "Heilige Drei Könige");
  if ((land === "BE" && year >= 2019) || (land === "MV" && year >= 2023)) fix(3, 8, "Internationaler Frauentag");
  if (is("BB")) {
    add(easter, "Ostersonntag");
    add(addDays(easter, 49), "Pfingstsonntag");
  }
  if (is("BW", "BY", "HE", "NW", "RP", "SL")) add(addDays(easter, 60), "Fronleichnam");
  if (is("SL")) fix(8, 15, "Mariä Himmelfahrt");
  if (land === "TH" && year >= 2019) fix(9, 20, "Weltkindertag");
  if (is("BB", "MV", "SN", "ST", "TH") || (is("HB", "HH", "NI", "SH") && year >= 2018) || year === 2017) fix(10, 31, "Reformationstag");
  if (is("BW", "BY", "NW", "RP", "SL")) fix(11, 1, "Allerheiligen");
  if (land === "SN") {
    // Buß- und Bettag: Mittwoch vor dem 23. November
    let d = Date.UTC(year, 10, 22);
    while (new Date(d).getUTCDay() !== 3) d = addDays(d, -1);
    add(d, "Buß- und Bettag");
  }
  return map;
}

function holidayName(d: D, land: Land): string | null {
  return holidays(new Date(d).getUTCFullYear(), land).get(iso(d)) ?? null;
}

/**
 * Berechnet das Fristende.
 * @param beginn Ereignistag (Ereignisfrist) bzw. erster Tag der Frist (Beginnfrist), JJJJ-MM-TT
 */
export function berechneFrist(opts: { beginn: string; art: FristArt; einheit: Einheit; anzahl: number; land?: Land; paragraph193?: boolean }): FristErgebnis {
  const land: Land = opts.land && LAENDER.includes(opts.land) ? opts.land : "BY";
  const n = Math.trunc(opts.anzahl);
  if (!Number.isFinite(n) || n < 1 || n > 1200) throw new Error("Die Anzahl muss zwischen 1 und 1200 liegen.");
  const start = parseDate(opts.beginn);
  const begruendung: string[] = [];
  const hinweise: string[] = [];
  let end: D;
  if (opts.art === "ereignisfrist") {
    begruendung.push(`Ereignisfrist: Der Tag des Ereignisses (${de(start)}) wird nicht mitgerechnet (§ 187 Abs. 1 BGB).`);
  } else {
    begruendung.push(`Beginnfrist: Der Anfangstag (${de(start)}) wird mitgerechnet (§ 187 Abs. 2 BGB).`);
  }
  if (opts.einheit === "tage") {
    end = opts.art === "ereignisfrist" ? addDays(start, n) : addDays(start, n - 1);
    begruendung.push(`Tagesfrist: Sie endet mit Ablauf des letzten Tages der Frist (§ 188 Abs. 1 BGB).`);
  } else if (opts.einheit === "wochen") {
    end = opts.art === "ereignisfrist" ? addDays(start, 7 * n) : addDays(start, 7 * n - 1);
    begruendung.push(
      opts.art === "ereignisfrist"
        ? "Wochenfrist: Sie endet mit Ablauf des Tages der letzten Woche, der durch seine Benennung dem Ereignistag entspricht (§ 188 Abs. 2 Alt. 1 BGB)."
        : "Wochenfrist: Sie endet mit Ablauf des Tages vor dem Tag der letzten Woche, der dem Anfangstag entspricht (§ 188 Abs. 2 Alt. 2 BGB).",
    );
  } else {
    const months = opts.einheit === "jahre" ? 12 * n : n;
    const r = addMonthsExact(start, months);
    if (!r.exists) {
      end = r.date;
      begruendung.push("Der entsprechende Tag fehlt im letzten Monat; die Frist endet mit Ablauf des letzten Tages dieses Monats (§ 188 Abs. 3 BGB).");
    } else {
      end = opts.art === "ereignisfrist" ? r.date : addDays(r.date, -1);
      begruendung.push(
        opts.art === "ereignisfrist"
          ? `${opts.einheit === "jahre" ? "Jahres" : "Monats"}frist: Sie endet mit Ablauf des Tages, der durch seine Zahl dem Ereignistag entspricht (§ 188 Abs. 2 Alt. 1 BGB).`
          : `${opts.einheit === "jahre" ? "Jahres" : "Monats"}frist: Sie endet mit Ablauf des Tages vor dem Tag, der durch seine Zahl dem Anfangstag entspricht (§ 188 Abs. 2 Alt. 2 BGB).`,
      );
    }
  }
  const ende188 = end;
  let verschoben = false;
  if (opts.paragraph193 !== false) {
    for (let guard = 0; guard < 10; guard++) {
      const wd = new Date(end).getUTCDay();
      const hol = holidayName(end, land);
      if (wd === 6 || wd === 0 || hol) {
        const why = hol ? `gesetzlicher Feiertag (${hol}, ${land})` : wd === 6 ? "Samstag" : "Sonntag";
        begruendung.push(`${de(end)} ist ein ${why}; das Fristende verschiebt sich auf den nächsten Werktag (§ 193 BGB).`);
        end = addDays(end, 1);
        verschoben = true;
      } else break;
    }
    hinweise.push("§ 193 BGB gilt für Fristen zur Abgabe einer Willenserklärung oder zur Bewirkung einer Leistung; im Prozess vgl. § 222 Abs. 2 ZPO. Anwendbarkeit im Einzelfall prüfen.");
  }
  if (land === "BY") hinweise.push("In Bayern gelten regional weitere Feiertage (Mariä Himmelfahrt in Gemeinden mit überwiegend katholischer Bevölkerung, Augsburger Friedensfest in Augsburg).");
  hinweise.push("Rechnerisches Ergebnis ohne Gewähr – bitte selbst nachprüfen.");
  return { beginn: iso(start), ende_188: iso(ende188), ende: iso(end), verschoben, begruendung, hinweise };
}
