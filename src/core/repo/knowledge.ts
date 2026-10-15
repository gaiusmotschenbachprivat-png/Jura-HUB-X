/**
 * Wissensobjekte: Definitionen, Prüfungsschemata, Fälle und Gesetzesfundstellen
 * – Port von `repo/knowledge.rs`.
 *
 * Gemeinsame Felder liegen in Spalten, typspezifische Felder als JSON in `data`.
 * `data` wird beim Speichern gegen eine feste Struktur je Typ geprüft und
 * normalisiert; unbekannte Felder werden verworfen. Wie `serde_json` (ohne
 * `preserve_order`) werden die Schlüssel alphabetisch sortiert gespeichert.
 */
import type {
  CaseData,
  CitationData,
  DefinitionData,
  QuelleData,
  Knowledge,
  KnowledgeFilter,
  KnowledgePatch,
  NewKnowledge,
  SchemaData,
  SchemaItem,
  SourceKind,
} from "../../api/types";
import type { Db } from "../db";
import { CoreError } from "../errors";
import * as search from "../search";
import { byteLen, cleanTitle, CONTROL, isPlainObject, newId, now, parseJson, requireId, takeChars } from "../util";
import * as areas from "./areas";
import * as links from "./links";
import * as nodes from "./nodes";

export const TYPES: readonly string[] = ["definition", "schema", "case", "citation", "quelle"];
export const QUELLE_ARTEN: readonly string[] = ["kommentar", "lehrbuch", "aufsatz", "urteil", "festschrift", "internet", "sonstiges"];
export const SOURCE_KINDS: readonly string[] = ["eigen", "vorlesung", "lehrbuch", "rechtsprechung", "import", "ki-vorschlag"];
const MAX_DATA = 512 * 1024;

// ---------- Hilfen (Rust-Semantik) ----------

/** `str::trim` in Rust (Unicode-Eigenschaft White_Space). */
function trim(s: string): string {
  return s.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, "");
}

/** Wie `serde_json::Value` mit `BTreeMap`: Objektschlüssel sortiert. */
function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (isPlainObject(v)) {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v).sort()) out[k] = sortKeys(v[k]);
    return out;
  }
  return v;
}

const bad = () => CoreError.invalid("Die Angaben haben ein unerwartetes Format.");

/**
 * Nachbildung von `#[derive(Deserialize)] #[serde(default)]` für Strukturen:
 * Objekte (unbekannte Felder werden ignoriert) oder Arrays in Feldreihenfolge.
 */
function structOf(v: unknown, fields: readonly string[]): Record<string, unknown> {
  if (isPlainObject(v)) return v;
  if (Array.isArray(v)) {
    if (v.length > fields.length) throw bad();
    const o: Record<string, unknown> = {};
    v.forEach((x, i) => (o[fields[i]!] = x));
    return o;
  }
  throw bad();
}

function str(o: Record<string, unknown>, k: string): string {
  const v = o[k];
  if (v === undefined) return "";
  if (typeof v !== "string") throw bad();
  return v;
}

function optStr(o: Record<string, unknown>, k: string): string | null {
  const v = o[k];
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") throw bad();
  return v;
}

function u8(o: Record<string, unknown>, k: string): number {
  const v = o[k];
  if (v === undefined) return 0;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 255) throw bad();
  return v;
}

const DEF_FIELDS = ["text", "source", "citation", "example", "notes"] as const;
const ITEM_FIELDS = ["id", "text", "note", "children"] as const;
const SCHEMA_FIELDS = ["norm", "items", "notes"] as const;
const CASE_FIELDS = ["claim_basis", "difficulty", "status", "facts", "question", "notes", "solution_note_id"] as const;
const CITATION_FIELDS = ["law", "prefix", "number", "paragraph", "sentence", "num", "alt", "notes"] as const;
const QUELLE_FIELDS = ["art", "autoren", "titel", "kurz", "auflage", "ort", "jahr", "zeitschrift", "seite", "gericht", "datum", "az", "fundstelle", "url", "abgerufen", "notes"] as const;

function deQuelle(v: unknown): QuelleData {
  const o = structOf(v, QUELLE_FIELDS);
  const d = Object.fromEntries(QUELLE_FIELDS.map((k) => [k, str(o, k)])) as unknown as QuelleData;
  if (!QUELLE_ARTEN.includes(d.art)) d.art = "sonstiges";
  return d;
}

function deDefinition(v: unknown): DefinitionData {
  const o = structOf(v, DEF_FIELDS);
  return { text: str(o, "text"), source: str(o, "source"), citation: str(o, "citation"), example: str(o, "example"), notes: str(o, "notes") };
}

function deItems(v: unknown): SchemaItem[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) throw bad();
  return v.map((x) => {
    const o = structOf(x, ITEM_FIELDS);
    return { id: str(o, "id"), text: str(o, "text"), note: str(o, "note"), children: deItems(o.children) };
  });
}

function deSchema(v: unknown): SchemaData {
  const o = structOf(v, SCHEMA_FIELDS);
  return { norm: str(o, "norm"), items: deItems(o.items), notes: str(o, "notes") };
}

function deCase(v: unknown): CaseData {
  const o = structOf(v, CASE_FIELDS);
  return {
    claim_basis: str(o, "claim_basis"),
    difficulty: u8(o, "difficulty") as CaseData["difficulty"],
    status: str(o, "status") as CaseData["status"],
    facts: str(o, "facts"),
    question: str(o, "question"),
    notes: str(o, "notes"),
    solution_note_id: optStr(o, "solution_note_id"),
  };
}

function deCitation(v: unknown): CitationData {
  const o = structOf(v, CITATION_FIELDS);
  return {
    law: str(o, "law"),
    prefix: str(o, "prefix") as CitationData["prefix"],
    number: str(o, "number"),
    paragraph: str(o, "paragraph"),
    sentence: str(o, "sentence"),
    num: str(o, "num"),
    alt: str(o, "alt"),
    notes: str(o, "notes"),
  };
}

function emptyCitation(): CitationData {
  return { law: "", prefix: "", number: "", paragraph: "", sentence: "", num: "", alt: "", notes: "" };
}

// ---------- Fundstellen ----------

/** Zitierweise einer Fundstelle, z. B. „§ 433 Abs. 1 S. 1 BGB“ oder „Art. 12 Abs. 1 GG“. */
export function formatCitation(c: CitationData): string {
  const prefix = trim(c.prefix);
  const parts = [`${prefix === "" ? "§" : prefix} ${trim(c.number)}`];
  if (trim(c.paragraph) !== "") parts.push(`Abs. ${trim(c.paragraph)}`);
  if (trim(c.sentence) !== "") parts.push(`S. ${trim(c.sentence)}`);
  if (trim(c.num) !== "") parts.push(`Nr. ${trim(c.num)}`);
  if (trim(c.alt) !== "") parts.push(`Alt. ${trim(c.alt)}`);
  if (trim(c.law) !== "") parts.push(trim(c.law));
  return parts.join(" ");
}

const ROMAN: Record<string, string> = { I: "1", II: "2", III: "3", IV: "4", V: "5", VI: "6", VII: "7", VIII: "8", IX: "9", X: "10" };

/**
 * Liest eine Fundstelle aus Text, z. B. „§ 823 Abs. 1 BGB“, „Art. 2 I GG“, „§§ 133, 157 BGB“
 * (bei mehreren Normen wird die erste verwendet). `null`, wenn nichts erkennbar ist.
 */
export function parseCitation(input: string): CitationData | null {
  const s = trim(String(input ?? ""));
  let prefix: "§" | "Art.";
  let rest: string;
  if (s.startsWith("§§")) [prefix, rest] = ["§", s.slice(2)];
  else if (s.startsWith("§")) [prefix, rest] = ["§", s.slice(1)];
  else if (s.startsWith("Art.")) [prefix, rest] = ["Art.", s.slice(4)];
  else if (s.startsWith("Artikel")) [prefix, rest] = ["Art.", s.slice(7)];
  else return null;
  const tokens = rest.split(/[\p{White_Space},]/u).filter((t) => t !== "");
  const c: CitationData = { ...emptyCitation(), prefix };
  const number = tokens[0];
  if (number === undefined || !/^[0-9]/.test(number)) return null;
  c.number = number;
  let i = 1;
  while (i < tokens.length) {
    const t = tokens[i]!;
    const next = tokens[i + 1] ?? "";
    switch (t) {
      case "Abs.":
      case "Absatz":
        c.paragraph = next;
        i += 2;
        continue;
      case "S.":
      case "Satz":
        c.sentence = next;
        i += 2;
        continue;
      case "Nr.":
      case "Nummer":
        c.num = next;
        i += 2;
        continue;
      case "Alt.":
      case "Alternative":
      case "Var.":
        c.alt = next;
        i += 2;
        continue;
    }
    if (c.paragraph === "" && Object.hasOwn(ROMAN, t)) {
      c.paragraph = ROMAN[t]!;
      i += 1;
    } else if (/^[0-9a]+$/.test(t) && c.law === "") {
      // weitere Normnummer bei „§§ 133, 157“: ignorieren
      i += 1;
    } else if (/^\p{Uppercase}/u.test(t)) {
      c.law = tokens.slice(i).join(" ");
      break;
    } else {
      i += 1;
    }
  }
  return c;
}

// ---------- Normalisierung ----------

function normalizeItems(items: SchemaItem[], depth: number): void {
  if (depth > 12) throw CoreError.invalid("Das Prüfungsschema ist zu tief verschachtelt (höchstens 12 Ebenen).");
  for (const it of items) {
    if (it.id === "" || byteLen(it.id) > 64) it.id = newId();
    it.text = takeChars(it.text.replace(CONTROL, ""), 2000);
    normalizeItems(it.children, depth + 1);
  }
}

/** Prüft und normalisiert `data` für einen Typ. Liefert außerdem den Suchtext. */
export function normalize(ty: string, data: unknown): { value: Record<string, unknown>; text: string } {
  const v = data === null || data === undefined ? {} : data;
  if (!isPlainObject(v)) throw CoreError.invalid("Ungültige Angaben.");
  let value: unknown;
  let text: string;
  switch (ty) {
    case "definition": {
      const d = deDefinition(v);
      text = [d.text, d.source, d.citation, d.example, d.notes].join(" ");
      value = d;
      break;
    }
    case "schema": {
      const d = deSchema(v);
      normalizeItems(d.items, 0);
      const t = [d.norm, d.notes];
      const walk = (items: SchemaItem[]) => {
        for (const it of items) {
          t.push(it.text, it.note);
          walk(it.children);
        }
      };
      walk(d.items);
      text = t.join(" ");
      value = d;
      break;
    }
    case "case": {
      const d = deCase(v);
      if (d.difficulty > 3) d.difficulty = 0;
      if (!["offen", "bearbeitet", "wiederholen", ""].includes(d.status)) d.status = "offen";
      if (d.solution_note_id !== null) requireId(d.solution_note_id);
      text = [d.claim_basis, d.facts, d.question, d.notes].join(" ");
      value = d;
      break;
    }
    case "citation": {
      const d = deCitation(v);
      if (trim(d.number) === "") throw CoreError.invalid("Bitte die Paragrafen- bzw. Artikelnummer angeben.");
      if (!["§", "Art.", ""].includes(trim(d.prefix))) throw CoreError.invalid("Als Zeichen sind nur „§“ und „Art.“ möglich.");
      text = `${formatCitation(d)} ${d.notes}`;
      value = d;
      break;
    }
    case "quelle": {
      const d = deQuelle(v);
      text = [d.autoren, d.titel, d.kurz, d.zeitschrift, d.gericht, d.az, d.fundstelle, d.jahr, d.notes].join(" ");
      value = d;
      break;
    }
    default:
      throw CoreError.invalid("Unbekannter Typ.");
  }
  const sorted = sortKeys(value) as Record<string, unknown>;
  if (byteLen(JSON.stringify(sorted)) > MAX_DATA) throw CoreError.invalid("Der Inhalt ist zu umfangreich.");
  return { value: sorted, text };
}

// ---------- Datensatz ----------

type KnowledgeRow = Omit<Knowledge, "data"> & { data: string };

function fromRow(r: KnowledgeRow): Knowledge {
  return {
    id: r.id,
    type: r.type,
    area_id: r.area_id,
    node_id: r.node_id,
    title: r.title,
    field: r.field,
    source_kind: r.source_kind,
    data: parseJson<Record<string, unknown>>(r.data, {}),
    created_at: r.created_at,
    updated_at: r.updated_at,
    deleted_at: r.deleted_at,
  };
}

function checkRefs(db: Db, area: string | null, node: string | null): void {
  if (area !== null) {
    requireId(area);
    areas.get(db, area);
  }
  if (node !== null) {
    requireId(node);
    nodes.get(db, node);
  }
}

function cleanField(s: string): string {
  return trim(takeChars(String(s ?? "").replace(CONTROL, ""), 80));
}

function cleanSource(s: string | null | undefined): SourceKind {
  const v = s ?? "eigen";
  if (SOURCE_KINDS.includes(v)) return v as SourceKind;
  throw CoreError.invalid("Unbekannte Herkunftsangabe.");
}

function titleFor(ty: string, title: string, data: unknown): string {
  if (ty === "citation") {
    let c: CitationData;
    try {
      c = deCitation(data);
    } catch {
      c = emptyCitation();
    }
    return formatCitation(c);
  }
  return cleanTitle(String(title ?? ""), 300);
}

export function index(db: Db, k: Knowledge, text: string): void {
  search.put(db, "knowledge", k.id, k.area_id, null, k.title, `${k.field} ${text}`);
}

export function get(db: Db, id: string): Knowledge {
  requireId(id);
  const r = db.get<KnowledgeRow>("SELECT * FROM knowledge WHERE id = ?1", [id]);
  if (!r) throw CoreError.notFound("Eintrag nicht gefunden.");
  return fromRow(r);
}

export function create(db: Db, input: NewKnowledge): Knowledge {
  if (!TYPES.includes(input.type)) throw CoreError.invalid("Unbekannter Typ.");
  const { value: data, text } = normalize(input.type, input.data);
  const title = titleFor(input.type, input.title ?? "", data);
  const source = cleanSource(input.source_kind);
  const areaId = input.area_id ?? null;
  const nodeId = input.node_id ?? null;
  return db.tx(() => {
    checkRefs(db, areaId, nodeId);
    // Fundstellen sind eindeutig: dieselbe Norm wird wiederverwendet.
    if (input.type === "citation") {
      const existing = db.value<string>(
        "SELECT id FROM knowledge WHERE type = 'citation' AND title = ?1 AND deleted_at IS NULL",
        [title],
      );
      if (existing !== undefined) return get(db, existing);
    }
    const id = newId();
    const ts = now();
    db.run(
      `INSERT INTO knowledge (id, type, area_id, node_id, title, field, source_kind, data, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)`,
      [id, input.type, areaId, nodeId, title, cleanField(input.field ?? ""), source, JSON.stringify(data), ts],
    );
    const k = get(db, id);
    index(db, k, text);
    return k;
  });
}

export function update(db: Db, id: string, patch: KnowledgePatch): Knowledge {
  return db.tx(() => {
    const k = get(db, id);
    if (k.deleted_at !== null) throw CoreError.invalid("Der Eintrag liegt im Papierkorb.");
    if (patch.data != null) k.data = patch.data;
    const { value: data, text } = normalize(k.type, k.data);
    k.data = data;
    if (patch.title != null) k.title = patch.title;
    k.title = titleFor(k.type, k.title, k.data);
    if (patch.field != null) k.field = cleanField(patch.field);
    if (patch.source_kind != null) k.source_kind = cleanSource(patch.source_kind);
    // `null` entfernt die Zuordnung, fehlend = unverändert
    if (patch.area_id !== undefined) k.area_id = patch.area_id;
    if (patch.node_id !== undefined) k.node_id = patch.node_id;
    checkRefs(db, k.area_id, k.node_id);
    k.updated_at = now();
    db.run(
      "UPDATE knowledge SET title=?2, field=?3, source_kind=?4, area_id=?5, node_id=?6, data=?7, updated_at=?8 WHERE id=?1",
      [id, k.title, k.field, k.source_kind, k.area_id, k.node_id, JSON.stringify(k.data), k.updated_at],
    );
    index(db, k, text);
    return k;
  });
}

/** Liste ohne gelöschte Einträge. Einträge ohne Bereich erscheinen in jedem Bereich. */
export function list(db: Db, f: KnowledgeFilter = {}): Knowledge[] {
  return db
    .all<KnowledgeRow>(
      `SELECT * FROM knowledge
       WHERE deleted_at IS NULL
         AND (?1 IS NULL OR type = ?1)
         AND (?2 IS NULL OR area_id = ?2 OR area_id IS NULL)
         AND (?3 IS NULL OR node_id = ?3)
         AND (?4 IS NULL OR field = ?4)
       ORDER BY title COLLATE NOCASE`,
      [f.type ?? null, f.area_id ?? null, f.node_id ?? null, f.field ?? null],
    )
    .map(fromRow);
}

/** Alle verwendeten Rechtsgebiete/Fachgebiete (für Filter und Vorschläge). */
export function fields(db: Db): string[] {
  return db
    .all<{ field: string }>(
      "SELECT DISTINCT field FROM knowledge WHERE deleted_at IS NULL AND field != '' ORDER BY field COLLATE NOCASE",
    )
    .map((r) => r.field);
}

export function trash(db: Db, id: string): void {
  requireId(id);
  db.run("UPDATE knowledge SET deleted_at = ?2 WHERE id = ?1 AND deleted_at IS NULL", [id, now()]);
}

export function restore(db: Db, id: string): void {
  requireId(id);
  db.run("UPDATE knowledge SET deleted_at = NULL WHERE id = ?1", [id]);
}

export function purge(db: Db, id: string): void {
  db.tx(() => {
    const k = get(db, id);
    if (k.deleted_at === null) throw CoreError.invalid("Nur Einträge im Papierkorb können endgültig gelöscht werden.");
    search.remove(db, "knowledge", id);
    links.removeForEntity(db, "knowledge", id);
    db.run("DELETE FROM knowledge WHERE id = ?1", [id]);
  });
}

export function reindexAll(db: Db): void {
  for (const r of db.all<KnowledgeRow>("SELECT * FROM knowledge")) {
    const k = fromRow(r);
    let text = "";
    try {
      text = normalize(k.type, k.data).text;
    } catch {
      text = "";
    }
    index(db, k, text);
  }
}

// ---------- Befehle (src-tauri/src/commands/learning.rs) ----------

/** `citation_parse` */
export const citationParse = parseCitation;
