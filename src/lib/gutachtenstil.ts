/**
 * Gutachtenstil farbig: Obersatz, Definition, Subsumtion und Ergebnis werden
 * als farbig hinterlegte, unterstrichene Textstellen markiert (Mark
 * „gutachten“). Die automatische Einfärbung ordnet Sätze anhand typischer
 * Formulierungen zu („könnte … haben“, „ist jede …“, „Somit …“). Sie läuft
 * vollständig lokal und ist eine Lesehilfe, keine inhaltliche Prüfung.
 */
import type { PMNode } from "./pm";

export type GutachtenSchritt = "obersatz" | "definition" | "subsumtion" | "ergebnis";

export const GUTACHTEN_SCHRITTE: { id: GutachtenSchritt; label: string; color: string; hint: string }[] = [
  { id: "obersatz", label: "Obersatz", color: "#6b5bd6", hint: "Hypothese: „A könnte … haben.“ / „Dazu müsste …“" },
  { id: "definition", label: "Definition", color: "#2e8a5b", hint: "Abstrakte Begriffsbestimmung: „… ist jede …“" },
  { id: "subsumtion", label: "Subsumtion", color: "#c98a1a", hint: "Sachverhalt unter die Definition: „Hier …“" },
  { id: "ergebnis", label: "Ergebnis", color: "#c23b5a", hint: "Feststellung: „Somit liegt … vor.“" },
];

export const isSchritt = (v: unknown): v is GutachtenSchritt => GUTACHTEN_SCHRITTE.some((s) => s.id === v);
export const schrittInfo = (id: GutachtenSchritt) => GUTACHTEN_SCHRITTE.find((s) => s.id === id)!;

/** Text mit Gutachten-Markierung (ProseMirror-JSON). */
export const gs = (text: string, step: GutachtenSchritt): PMNode => ({ type: "text", text, marks: [{ type: "gutachten", attrs: { step } }] });

/** Legende wie über einer farbigen Musterlösung: vier markierte Begriffe. */
export function legendeNode(): PMNode {
  const content: PMNode[] = [];
  GUTACHTEN_SCHRITTE.forEach((s, i) => {
    if (i) content.push({ type: "text", text: "  " });
    content.push(gs(s.label, s.id));
  });
  return { type: "paragraph", content };
}

// ---------- Sätze trennen ----------

/** Abkürzungen, nach deren Punkt kein Satz endet. */
const ABK = new Set(
  (
    "gem vgl bzw ggf evtl sog str insb ca bspw zB idR iSd iSv iVm iÜ aA hM hL Rspr Rn Abs Nr Art Artt Alt Var Hs Halbs Satz S Bsp " +
    "Kap Ziff lit Anm Aufl Bd Hrsg ff f u.a d.h z.B i.V.m i.S.d i.S.v h.M h.L a.A u.U o.Ä s.o s.u Dr Prof"
  ).split(" "),
);
/** Großbuchstabe als Teil einer Abkürzung („z. B.“, „i. V. m.“) – sonst Satzende („… an B.“). */
const KLEIN_VORGAENGER = /(?:^|\s)[a-zäöü]\.\s?$/;

/** Teilt Text in Sätze; liefert [Start, Ende) je Satz (ohne führende Leerzeichen). */
export function satzGrenzen(text: string): [number, number][] {
  const out: [number, number][] = [];
  let start = 0;
  const re = /[.!?](?=["“”»)]?\s+|["“”»)]?$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const end = m.index + 1;
    const before = text.slice(start, m.index);
    const word = /([A-Za-zÄÖÜäöüß.]+)$/.exec(before)?.[1] ?? "";
    const bare = word.replace(/\./g, "");
    if (m[0] === "." && word) {
      if (ABK.has(word) || ABK.has(bare)) continue;
      // „z. B.“, „d. h.“: einzelner Buchstabe hinter einer anderen Abkürzung
      if (/^[a-zäöü]$/.test(bare)) continue;
      if (bare.length === 1 && KLEIN_VORGAENGER.test(before.slice(0, -1))) continue;
      // römische Zahlen in Normzitaten („§ 223 I. …“ kommt kaum vor) und Ordnungszahlen („1.“)
      if (/^\d+$/.test(bare)) continue;
    }
    // folgt Kleinbuchstabe, ist es kein Satzende
    const next = text.slice(end).replace(/^["“”»)]?\s*/, "");
    if (next && /^[a-zäöüß]/.test(next)) continue;
    const closing = /^["“”»)]/.exec(text.slice(end))?.[0].length ?? 0;
    push(start, end + closing);
    start = end + closing;
  }
  push(start, text.length);
  return out;

  function push(a: number, b: number) {
    while (a < b && /\s/.test(text[a]!)) a++;
    while (b > a && /\s/.test(text[b - 1]!)) b--;
    if (b > a) out.push([a, b]);
  }
}

// ---------- Sätze zuordnen ----------

const PERSON = /^(?:(?:Der|Die|Dem|Den|Des|der|die|dem|den)\s+)?[A-ZÄÖÜ]\s/;

/**
 * Ordnet einen Satz einem Schritt des Gutachtenstils zu. Nur typische
 * Formulierungen werden erkannt; alles andere gilt als Subsumtion.
 */
export function schrittFuer(satz: string): GutachtenSchritt {
  const s = satz.trim().replace(/^[„"»(]/, "");
  const l = s.toLowerCase();
  // Obersatz: Hypothese im Konjunktiv
  if (/\bkönnte\b/.test(l) && /\b(haben|sein|gemacht haben|zustehen|vorliegen|verletzt|erfolg haben)\b/.test(l)) return "obersatz";
  if (/\b(müsste|müssten)\b/.test(l)) return "obersatz";
  if (/^(fraglich ist|zu prüfen ist|es ist zu prüfen|in betracht kommt|zunächst ist zu prüfen|weiter ist zu prüfen|problematisch ist)/.test(l)) return "obersatz";
  if (/hat erfolg, (?:soweit|wenn) sie zulässig und begründet ist|ist begründet, soweit|ist zulässig, (?:soweit|wenn)/.test(l)) return "obersatz";
  // Ergebnis: Feststellung
  if (/^(somit|folglich|mithin|damit|also|daher|demnach|demzufolge|im ergebnis|ergebnis|zwischenergebnis|gesamtergebnis|insgesamt)\b/.test(l)) return "ergebnis";
  if (/\b(liegt|liegen|lag)\s+(?:somit\s+|damit\s+|folglich\s+|mithin\s+|also\s+|hier\s+)?(?:nicht\s+)?vor\.?$/.test(l) && !/,\s*wenn\b/.test(l)) return "ergebnis";
  if (/\bist\s+(?:somit\s+|damit\s+|folglich\s+|mithin\s+|also\s+)?(?:nicht\s+)?(erfüllt|gegeben|zu bejahen|zu verneinen|eröffnet|statthaft|zulässig|begründet|verletzt|entstanden|untergegangen|erloschen|durchsetzbar|wirksam|unwirksam|nichtig|rechtmäßig|rechtswidrig|verhältnismäßig)\.?$/.test(l)) return "ergebnis";
  if (/\b(handelte|handelt)\s+(?:auch\s+|somit\s+|damit\s+)?(?:nicht\s+)?(vorsätzlich|rechtswidrig|schuldhaft|rechtswidrig und schuldhaft)\.?$/.test(l)) return "ergebnis";
  if (/hat sich .*strafbar gemacht\.?$|ist .*strafbar\.?$|hat gegen .* einen anspruch|hat (?:keinen|einen) anspruch/.test(l)) return "ergebnis";
  // Sachverhaltsbezug: Subsumtion
  if (PERSON.test(s) || /^(hier|vorliegend|im vorliegenden fall|im fall|nach dem sachverhalt|laut sachverhalt|indem|dadurch)\b/.test(l)) return "subsumtion";
  // Definition: abstrakte Begriffsbestimmung
  if (/\b(versteht man|zu verstehen ist|ist zu verstehen|bezeichnet man|definiert)\b/.test(l)) return "definition";
  if (/\b(?:liegt|ist)\s+(?:\w+\s+)?(?:vor|gegeben|anzunehmen),\s*wenn\b/.test(l)) return "definition";
  if (/^(?:eine?|der|die|das)\s+[^,]*\b(?:ist|sind|liegt|liegen)\b[^,]*,\s*(?:wenn|sofern|soweit)\b/.test(l)) return "definition";
  if (/\b(ist|sind|bedeutet|meint)\s+(jede[rsnm]?|alle|jegliche[rsnm]?)\b/.test(l)) return "definition";
  if (/^[a-zäöüß-]+(?:ung|heit|keit|nis|schaft|tion)\s+(?:ist|sind|bedeutet|meint)\s+(?:das|die|der)\s+\S+/.test(l)) return "definition";
  if (/^(?:eine?|der|die|das)\s+(?:[a-zäöüß-]+\s+)?[a-zäöüß-]+\s+(?:ist|sind)\s+(?:das|die|der)\s+[a-zäöüß-]*(?:ung|en|heit|keit|nis)\b/.test(l)) return "definition";
  return "subsumtion";
}

/** Sätze mit Zuordnung – für Vorschau und Tests. */
export function einfaerben(text: string): { from: number; to: number; step: GutachtenSchritt }[] {
  return satzGrenzen(text).map(([from, to]) => ({ from, to, step: schrittFuer(text.slice(from, to)) }));
}
