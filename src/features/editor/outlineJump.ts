/**
 * Gliederung → Mitschrift: In der nummerierten Gliederung oben (Liste unter der
 * Überschrift „Gliederung“, „Inhalt“ oder „Übersicht“) bekommt jeder Punkt ein
 * Sprung-Symbol. Antippen springt zu der Stelle in der Mitschrift, an der der
 * Punkt behandelt wird – erkannt an einer gleichlautenden Überschrift, einem
 * Absatz mit demselben Anfang oder derselben Nummer („5.“). Gibt es die Stelle
 * noch nicht, wird sie als Überschrift in der Mitschrift angelegt.
 * Nur Anzeige: Der gespeicherte Text bleibt unverändert, bis eine Stelle angelegt wird.
 */
import { Extension } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";

export const OUTLINE_JUMP_EVENT = "studium:outline-jump";
export interface OutlineJumpDetail {
  /** Position des Gliederungspunkts (für „zurück“) */
  from: number;
  label: string;
}

const OUTLINE_HEADING = /^(gliederung|inhalt|inhaltsübersicht|inhaltsverzeichnis|übersicht|themen|agenda)\s*:?$/i;

/** Abschnittsüberschriften der Vorlage – nie Ziel eines Gliederungspunkts */
const SECTION_HEADING = /^(mitschrift|offene fragen|zum wiederholen|gliederung)\s*:?$/i;

export interface OutlineItem {
  /** Ende des Absatzes im Listenpunkt (für das Symbol) */
  end: number;
  /** Anfang des Listenpunkts (für „zurück“) */
  start: number;
  text: string;
  /** Nummer, z. B. „5“ bzw. „5.2“ */
  number: string;
  depth: number;
}

export interface Outline {
  from: number;
  to: number;
  items: OutlineItem[];
}

/** Nummerierung am Anfang entfernen, vereinheitlichen. */
export function normalize(s: string): string {
  return s
    .replace(/^\s*(?:(?:\d+\.)*\d+[.)]?|[ivxlc]+\.|[a-z][.)]|§+)\s+/iu, "")
    .toLowerCase()
    .replace(/[„“"'»«:;,.!?()–—-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Erste nummerierte Liste direkt unter einer Überschrift wie „Gliederung“. */
export function findOutline(doc: PMNode): Outline | null {
  let found: Outline | null = null;
  let afterHeading = false;
  doc.forEach((node, offset) => {
    if (found) return;
    if (node.type.name === "heading") {
      afterHeading = OUTLINE_HEADING.test(node.textContent.trim());
      return;
    }
    if (afterHeading && node.type.name === "orderedList") {
      const items: OutlineItem[] = [];
      const walk = (list: PMNode, listPos: number, depth: number, prefix: string) => {
        const startNo = Number(list.attrs.start) || 1;
        let i = 0;
        list.forEach((item, itemOffset) => {
          const itemPos = listPos + 1 + itemOffset;
          const number = `${prefix}${startNo + i}`;
          i++;
          let first: { node: PMNode; pos: number } | null = null;
          item.forEach((child, childOffset) => {
            const childPos = itemPos + 1 + childOffset;
            if (!first && child.isTextblock) first = { node: child, pos: childPos };
            if (child.type.name === "orderedList" || child.type.name === "bulletList") walk(child, childPos, depth + 1, `${number}.`);
          });
          const f = first as { node: PMNode; pos: number } | null;
          const text = f?.node.textContent.trim() ?? "";
          if (f && normalize(text) && !/^…+$/.test(text)) items.push({ start: itemPos, end: f.pos + f.node.nodeSize - 1, text, number, depth });
        });
      };
      walk(node, offset, 0, "");
      items.sort((a, b) => a.start - b.start);
      found = { from: offset, to: offset + node.nodeSize, items };
      return;
    }
    // Absätze zwischen Überschrift und Liste sind erlaubt (z. B. ein Hinweis)
    if (node.type.name !== "paragraph") afterHeading = false;
  });
  return found;
}

/** Stelle in der Mitschrift zu einem Gliederungspunkt (Anfang des Textblocks) oder null. */
export function findTarget(doc: PMNode, outline: Outline, item: OutlineItem): number | null {
  const want = normalize(item.text);
  const numRe = new RegExp(`^\\s*${item.number.replace(/\./g, "\\.")}[.)]?\\s`);
  let heading: number | null = null;
  let para: number | null = null;
  let byNumber: number | null = null;
  doc.descendants((node, pos) => {
    // nur unterhalb der Gliederung suchen
    if (pos < outline.to) return pos + node.nodeSize > outline.to;
    if (!node.isTextblock) return true;
    const raw = node.textContent;
    if (node.type.name === "heading" && SECTION_HEADING.test(raw.trim())) return false;
    const t = normalize(raw);
    if (!t) return false;
    const same = t === want || (want.length >= 3 && t.startsWith(want)) || (t.length >= 4 && want.startsWith(t));
    if (node.type.name === "heading") {
      if (same && heading === null) heading = pos;
    } else if (want.length >= 3 && t.startsWith(want) && para === null) {
      para = pos;
    }
    if (byNumber === null && numRe.test(raw)) byNumber = pos;
    return false;
  });
  return heading ?? para ?? byNumber;
}

/** Wohin ein neuer Abschnitt kommt: ans Ende des Abschnitts „Mitschrift“ (vor der nächsten gleichrangigen Überschrift). */
export function insertionPoint(doc: PMNode, outline: Outline): { pos: number; level: number } {
  let mitschrift: { pos: number; level: number } | null = null;
  let end: number | null = null;
  doc.forEach((node, offset) => {
    if (end !== null || node.type.name !== "heading") return;
    const level = Number(node.attrs.level) || 2;
    if (mitschrift) {
      if (level <= mitschrift.level) end = offset;
    } else if (offset > outline.from && /^mitschrift/i.test(node.textContent.trim())) {
      mitschrift = { pos: offset, level };
    }
  });
  const m = mitschrift as { pos: number; level: number } | null;
  if (!m) return { pos: doc.content.size, level: 2 };
  return { pos: end ?? doc.content.size, level: Math.min(6, m.level + 1) };
}

function jump(view: EditorView, item: OutlineItem) {
  const outline = findOutline(view.state.doc);
  if (!outline) return;
  const current = outline.items.find((i) => i.number === item.number) ?? item;
  let target = findTarget(view.state.doc, outline, current);
  let tr = view.state.tr;
  if (target === null) {
    // Im Lesemodus nichts verändern
    if (!view.editable) return;
    // Stelle anlegen: Überschrift mit dem Text des Gliederungspunkts, darunter ein leerer Absatz
    const { pos, level } = insertionPoint(view.state.doc, outline);
    const schema = view.state.schema;
    const heading = schema.nodes.heading!.create({ level: Math.min(6, level + current.depth) }, schema.text(current.text));
    tr = tr.insert(pos, [heading, schema.nodes.paragraph!.create()]);
    target = pos;
  }
  const node = tr.doc.nodeAt(target);
  const inside = Math.min(tr.doc.content.size, target + (node ? node.nodeSize - 1 : 1));
  tr = tr.setSelection(TextSelection.create(tr.doc, inside)).scrollIntoView();
  view.dispatch(tr);
  view.focus();
  const dom = view.nodeDOM(target);
  if (dom instanceof HTMLElement) {
    dom.scrollIntoView?.({ block: "start", behavior: "smooth" });
    dom.classList.add("outline-flash");
    setTimeout(() => dom.classList.remove("outline-flash"), 1600);
  }
  view.dom.dispatchEvent(new CustomEvent<OutlineJumpDetail>(OUTLINE_JUMP_EVENT, { bubbles: true, detail: { from: current.start, label: current.text } }));
}

export const outlineKey = new PluginKey<DecorationSet>("outlineJump");

function decorations(doc: PMNode): DecorationSet {
  const outline = findOutline(doc);
  if (!outline) return DecorationSet.empty;
  return DecorationSet.create(
    doc,
    outline.items.map((item) => {
      const has = findTarget(doc, outline, item) !== null;
      return Decoration.widget(
        item.end,
        (view) => {
          const b = document.createElement("button");
          b.type = "button";
          b.className = `outline-jump ${has ? "has-target" : "is-new"}`;
          b.contentEditable = "false";
          b.textContent = has ? "↓" : "+";
          const label = has ? `Zu „${item.text}“ springen` : `Abschnitt „${item.text}“ in der Mitschrift anlegen`;
          b.title = label;
          b.setAttribute("aria-label", label);
          b.addEventListener("mousedown", (e) => e.preventDefault());
          b.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            jump(view, item);
          });
          return b;
        },
        { side: 1, ignoreSelection: true, key: `oj-${item.number}-${has ? 1 : 0}-${item.text}` },
      );
    }),
  );
}

export const OutlineJump = Extension.create({
  name: "outlineJump",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: outlineKey,
        state: {
          init: (_, state) => decorations(state.doc),
          apply: (tr, old) => (tr.docChanged ? decorations(tr.doc) : old),
        },
        props: {
          decorations: (state) => outlineKey.getState(state),
        },
      }),
    ];
  },
});
