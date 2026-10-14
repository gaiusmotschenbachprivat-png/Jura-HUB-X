/** Unveränderliche Operationen auf einem Prüfungsschema-Baum. */
import type { SchemaItem } from "../api/types";

export const newItem = (text = ""): SchemaItem => ({
  id: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Math.random()).slice(2),
  text,
  note: "",
  children: [],
});

interface Loc {
  list: SchemaItem[];
  index: number;
  parent: SchemaItem | null;
}

function clone(items: SchemaItem[]): SchemaItem[] {
  return items.map((i) => ({ ...i, children: clone(i.children) }));
}

function find(items: SchemaItem[], id: string, parent: SchemaItem | null = null): Loc | null {
  for (let i = 0; i < items.length; i++) {
    if (items[i]!.id === id) return { list: items, index: i, parent };
    const sub = find(items[i]!.children, id, items[i]!);
    if (sub) return sub;
  }
  return null;
}

function findParentLoc(items: SchemaItem[], parent: SchemaItem): Loc | null {
  return find(items, parent.id);
}

export function update(items: SchemaItem[], id: string, patch: Partial<Pick<SchemaItem, "text" | "note">>): SchemaItem[] {
  const out = clone(items);
  const l = find(out, id);
  if (l) Object.assign(l.list[l.index]!, patch);
  return out;
}

/** Neuer Punkt direkt nach `id` auf derselben Ebene (oder am Ende, wenn `id` fehlt). */
export function insertAfter(items: SchemaItem[], id: string | null): { items: SchemaItem[]; id: string } {
  const out = clone(items);
  const it = newItem();
  const l = id ? find(out, id) : null;
  if (l) l.list.splice(l.index + 1, 0, it);
  else out.push(it);
  return { items: out, id: it.id };
}

/** Rückt einen Punkt ein: er wird letzter Unterpunkt des vorherigen Geschwisters. */
export function indent(items: SchemaItem[], id: string): SchemaItem[] {
  const out = clone(items);
  const l = find(out, id);
  if (!l || l.index === 0) return items;
  const [it] = l.list.splice(l.index, 1);
  l.list[l.index - 1]!.children.push(it!);
  return out;
}

/** Rückt einen Punkt aus: er folgt direkt auf seinen bisherigen Oberpunkt. */
export function outdent(items: SchemaItem[], id: string): SchemaItem[] {
  const out = clone(items);
  const l = find(out, id);
  if (!l || !l.parent) return items;
  const pl = findParentLoc(out, l.parent)!;
  const [it] = l.list.splice(l.index, 1);
  // Nachfolgende Geschwister werden Unterpunkte des ausgerückten Punkts (wie in Gliederungseditoren üblich)
  const rest = l.list.splice(l.index);
  it!.children.push(...rest);
  pl.list.splice(pl.index + 1, 0, it!);
  return out;
}

export function remove(items: SchemaItem[], id: string): SchemaItem[] {
  const out = clone(items);
  const l = find(out, id);
  if (!l) return items;
  const [it] = l.list.splice(l.index, 1);
  // Unterpunkte bleiben erhalten und rücken an die Stelle des gelöschten Punkts
  l.list.splice(l.index, 0, ...it!.children);
  return out;
}

export function move(items: SchemaItem[], id: string, dir: -1 | 1): SchemaItem[] {
  const out = clone(items);
  const l = find(out, id);
  if (!l) return items;
  const j = l.index + dir;
  if (j < 0 || j >= l.list.length) return items;
  [l.list[l.index], l.list[j]] = [l.list[j]!, l.list[l.index]!];
  return out;
}

/** Flache Liste in Anzeigereihenfolge mit Tiefe und Position (für Nummerierung und Tastatur). */
export function flatten(items: SchemaItem[], depth = 0, out: { item: SchemaItem; depth: number; n: number }[] = []) {
  items.forEach((item, i) => {
    out.push({ item, depth, n: i + 1 });
    flatten(item.children, depth + 1, out);
  });
  return out;
}

/** Schema als eingerückter Text (für Karteikarten und Export). */
export function toOutline(items: SchemaItem[], label: (depth: number, n: number) => string): string {
  return flatten(items)
    .filter((r) => r.item.text.trim())
    .map((r) => `${"   ".repeat(r.depth)}${label(r.depth, r.n)} ${r.item.text}`)
    .join("\n");
}
