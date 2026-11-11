/**
 * Suche im Kartenbrowser. Wörter suchen in Vorder-/Rückseite, Feldern und
 * Schlagwörtern (alle müssen vorkommen); „…“ sucht eine Wortgruppe.
 *
 *   deck:"Zivilrecht::BGB AT"  (mit Unterstapeln; * als Platzhalter)
 *   tag:Anfechtung  tag:none
 *   is:new is:learn is:review is:due is:suspended is:buried is:difficult is:leech
 *   flag:1 … flag:7, flag:0
 *   typ:definition | schema | begriff | basis | umgekehrt | luecke | eingabe
 *   prop:ivl>=21  prop:lapses>3  prop:reps=0  prop:due<=1 (Tage ab heute)
 *   added:7 (in den letzten 7 Tagen angelegt)  rated:1 (heute/gestern wiederholt)
 *   -begriff  (nicht)   a or b  (oder)
 */
import type { Card } from "../api/types";
import { clozePlain, parseFields } from "./cardModel";
import { cardStatus, deckOf, inDeck, LEECH_TAG, tagList } from "./decks";

type Pred = (c: Card, now: Date) => boolean;

const fold = (s: string) => s.toLocaleLowerCase("de").normalize("NFKD").replace(/\p{M}/gu, "");

function tokens(q: string): string[] {
  const out: string[] = [];
  const re = /(-?)(?:([a-zäöü]+):)?(?:"([^"]*)"|(\S+))/giu;
  for (const m of q.matchAll(re)) out.push(`${m[1]}${m[2] ? `${m[2].toLowerCase()}:` : ""}${m[3] !== undefined ? `"${m[3]}"` : m[4]}`);
  return out;
}

const unquote = (v: string) => (v.startsWith('"') && v.endsWith('"') ? v.slice(1, -1) : v);
const glob = (pat: string) => new RegExp(`^${fold(pat).replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);
const daysAgo = (iso: string | null, now: Date) => (iso ? (now.getTime() - Date.parse(iso)) / 864e5 : Infinity);

function term(tok: string): Pred {
  const neg = tok.startsWith("-") && tok.length > 1;
  const t = neg ? tok.slice(1) : tok;
  const m = /^([a-zäöü]+):(.*)$/iu.exec(t);
  let p: Pred;
  if (m) {
    const key = m[1]!.toLowerCase();
    const val = unquote(m[2]!);
    const v = fold(val);
    switch (key) {
      case "deck":
      case "stapel":
        p = val.includes("*") ? (c) => glob(val).test(fold(deckOf(c))) : (c) => inDeck(fold(deckOf(c)), v);
        break;
      case "tag":
        p = v === "none" ? (c) => tagList(c.tags).length === 0 : val.includes("*") ? (c) => tagList(c.tags).some((x) => glob(val).test(fold(x))) : (c) => tagList(c.tags).some((x) => fold(x) === v);
        break;
      case "is":
        p = (c, now) => {
          const s = cardStatus(c, now.toISOString());
          if (v === "new" || v === "neu") return s === "new";
          if (v === "learn" || v === "lernen") return s === "learn";
          if (v === "review") return c.state === 2;
          if (v === "due" || v === "faellig" || v === "fällig") return (s === "learn" || s === "review") && c.due <= now.toISOString();
          if (v === "suspended" || v === "ausgesetzt") return c.suspended;
          if (v === "buried" || v === "zurueckgestellt") return s === "buried";
          if (v === "difficult" || v === "schwierig") return c.difficult;
          if (v === "leech" || v === "problemkarte") return tagList(c.tags).some((x) => fold(x) === fold(LEECH_TAG));
          return false;
        };
        break;
      case "flag":
      case "flagge":
        p = (c) => c.flag === Number(v);
        break;
      case "typ":
      case "type":
        p = (c) => c.template === v;
        break;
      case "added":
        p = (c, now) => daysAgo(c.created_at, now) <= Number(v);
        break;
      case "rated":
        p = (c, now) => daysAgo(c.last_review, now) <= Number(v);
        break;
      case "prop": {
        const pm = /^(ivl|lapses|reps|due|ease|s|d)(<=|>=|!=|=|<|>)(-?\d+(?:[.,]\d+)?)$/.exec(v);
        if (!pm) {
          p = () => false;
          break;
        }
        const [, f, op, rawNum] = pm;
        const n = Number(rawNum!.replace(",", "."));
        const get = (c: Card, now: Date) =>
          f === "ivl" ? c.scheduled_days : f === "lapses" ? c.lapses : f === "reps" ? c.reps : f === "s" ? c.stability : f === "d" ? c.difficulty : Math.floor((Date.parse(c.due) - now.getTime()) / 864e5);
        p = (c, now) => {
          const x = get(c, now);
          return op === "<" ? x < n : op === "<=" ? x <= n : op === ">" ? x > n : op === ">=" ? x >= n : op === "!=" ? x !== n : x === n;
        };
        break;
      }
      default:
        p = textPred(t);
    }
  } else p = textPred(unquote(t));
  return neg ? (c, now) => !p(c, now) : p;
}

function textPred(s: string): Pred {
  const want = fold(s);
  return (c) => haystack(c).includes(want);
}

const cache = new WeakMap<Card, string>();
function haystack(c: Card): string {
  let h = cache.get(c);
  if (h === undefined) {
    h = fold([clozePlain(c.front), c.back, ...Object.values(parseFields(c.fields)), c.tags].join(" \n "));
    cache.set(c, h);
  }
  return h;
}

/** Suchtext → Prüffunktion (leer = alles) */
export function compileSearch(q: string): Pred {
  const groups: Pred[][] = [[]];
  for (const tok of tokens(q)) {
    if (tok.toLowerCase() === "or" || tok.toLowerCase() === "oder") groups.push([]);
    else groups.at(-1)!.push(term(tok));
  }
  const live = groups.filter((g) => g.length);
  if (!live.length) return () => true;
  return (c, now) => live.some((g) => g.every((p) => p(c, now)));
}

export type SortKey = "frage" | "antwort" | "stapel" | "typ" | "faellig" | "intervall" | "stabilitaet" | "schwierigkeit" | "wdh" | "fehler" | "hinzugefuegt" | "geaendert";
