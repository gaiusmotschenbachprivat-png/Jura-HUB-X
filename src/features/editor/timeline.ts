/**
 * Zeitstrahl im Text: Einträge aus Zeitpunkt („1.3.2024“, „zwei Tage später“)
 * und Geschehen, senkrecht als Zeitstrahl dargestellt. Oben „Nach Zeit
 * sortieren“ und „Eintrag“; ist die Reihenfolge nicht chronologisch, weist
 * die Kopfzeile darauf hin. Aus einem markierten Sachverhalt (oder dem
 * Abschnitt „Sachverhalt“) lässt sich der Zeitstrahl automatisch anlegen.
 *
 * Aufbau: timeline > timelineEntry+ > (timelineTime, timelineText)
 */
import { Node, mergeAttributes, type Editor } from "@tiptap/core";
import type { Node as PMNodeType, ResolvedPos } from "@tiptap/pm/model";
import { TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";

import { extractEvents, isSorted, sortOrder, type TimelineEvent } from "../../lib/zeitstrahl";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    timeline: {
      /** Zeitstrahl einfügen (leer oder mit Einträgen) */
      insertTimeline: (events?: TimelineEvent[]) => ReturnType;
      /** Zeitstrahl aus der Auswahl bzw. dem Abschnitt „Sachverhalt“ anlegen */
      timelineFromText: () => ReturnType;
      /** Einträge des Zeitstrahls (an `pos` bzw. um die Schreibmarke) nach Zeit ordnen */
      sortTimeline: (pos?: number) => ReturnType;
      /** neuen Eintrag am Ende anfügen */
      addTimelineEntry: (pos?: number) => ReturnType;
    };
  }
}

export const LABEL = "Zeitstrahl";

/** Tiefe des umgebenden Knotens dieser Art (oder -1) */
function depthOf($pos: ResolvedPos, name: string): number {
  for (let d = $pos.depth; d > 0; d--) if ($pos.node(d).type.name === name) return d;
  return -1;
}

/** Zeitstrahl um die Schreibmarke bzw. an `pos`: Position und Knoten */
function timelineAt(state: EditorState, pos?: number): { pos: number; node: PMNodeType } | null {
  if (typeof pos === "number") {
    const node = state.doc.nodeAt(pos);
    return node?.type.name === "timeline" ? { pos, node } : null;
  }
  const $from = state.selection.$from;
  const d = depthOf($from, "timeline");
  return d < 0 ? null : { pos: $from.before(d), node: $from.node(d) };
}

const timesOf = (tl: PMNodeType) => {
  const out: string[] = [];
  tl.forEach((e) => out.push(e.firstChild?.textContent ?? ""));
  return out;
};

function build(state: EditorState, events: TimelineEvent[]): PMNodeType {
  const { schema } = state;
  const t = (s: string) => (s ? [schema.text(s)] : []);
  const entries = (events.length ? events : [{ when: "", text: "" }]).map((e) =>
    schema.nodes.timelineEntry!.create(null, [schema.nodes.timelineTime!.create(null, t(e.when)), schema.nodes.timelineText!.create(null, t(e.text))]),
  );
  return schema.nodes.timeline!.create(null, entries);
}

/** Abschnitt „Sachverhalt …“: Text und Ende (Position hinter dem letzten Block) */
function sachverhalt(doc: PMNodeType): { text: string; end: number } | null {
  let level = 0;
  let start = -1;
  let end = -1;
  const parts: string[] = [];
  doc.forEach((n, pos) => {
    if (end >= 0) return;
    if (n.type.name === "heading") {
      const l = Number(n.attrs.level) || 1;
      if (start < 0 && /^sachverhalt\b/i.test(n.textContent.trim())) {
        level = l;
        start = pos + n.nodeSize;
      } else if (start >= 0 && l <= level) end = pos;
      return;
    }
    if (start >= 0 && n.type.name !== "timeline") parts.push(n.textContent);
  });
  if (start < 0) return null;
  return { text: parts.join(" ").trim(), end: end >= 0 ? end : doc.content.size };
}

/** Schreibmarke in die Zeitzelle des Eintrags Nr. `index` setzen */
function selectEntry(tr: Transaction, tlPos: number, index: number, cell: 0 | 1 = 0, atEnd = false) {
  const tl = tr.doc.nodeAt(tlPos);
  if (!tl) return;
  let p = tlPos + 1;
  for (let i = 0; i < Math.min(index, tl.childCount - 1); i++) p += tl.child(i).nodeSize;
  const entry = tl.child(Math.min(index, tl.childCount - 1));
  let c = p + 1; // Anfang der Zeitzelle
  if (cell === 1) c += entry.child(0).nodeSize;
  const cellNode = entry.child(cell);
  tr.setSelection(TextSelection.create(tr.doc, c + 1 + (atEnd ? cellNode.content.size : 0)));
}

export const TimelineTime = Node.create({
  name: "timelineTime",
  content: "text*",
  marks: "",
  defining: true,
  parseHTML: () => [{ tag: "div.tl-time" }],
  renderHTML: ({ HTMLAttributes }) => ["div", mergeAttributes(HTMLAttributes, { class: "tl-time" }), 0],
});

export const TimelineText = Node.create({
  name: "timelineText",
  content: "inline*",
  defining: true,
  parseHTML: () => [{ tag: "div.tl-text" }],
  renderHTML: ({ HTMLAttributes }) => ["div", mergeAttributes(HTMLAttributes, { class: "tl-text" }), 0],
});

export const TimelineEntry = Node.create({
  name: "timelineEntry",
  content: "timelineTime timelineText",
  defining: true,
  isolating: true,
  parseHTML: () => [{ tag: "div.tl-entry" }],
  renderHTML: ({ HTMLAttributes }) => ["div", mergeAttributes(HTMLAttributes, { class: "tl-entry" }), 0],
});

export const Timeline = Node.create({
  name: "timeline",
  // Enter/Tab/Rücktaste im Zeitstrahl vor den allgemeinen Tastenkürzeln
  priority: 1000,
  group: "block",
  content: "timelineEntry+",
  defining: true,
  isolating: true,

  parseHTML: () => [{ tag: "div.timeline" }],
  renderHTML: ({ HTMLAttributes }) => ["div", mergeAttributes(HTMLAttributes, { class: "timeline", "data-label": LABEL }), 0],

  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = document.createElement("div");
      dom.className = "timeline";
      const head = document.createElement("div");
      head.className = "tl-head";
      head.contentEditable = "false";
      const label = document.createElement("span");
      label.className = "tl-label";
      label.textContent = LABEL;
      const hint = document.createElement("span");
      hint.className = "tl-hint";
      const btn = (text: string, title: string, run: (pos: number) => void) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "tl-btn";
        b.textContent = text;
        b.title = title;
        b.addEventListener("mousedown", (e) => e.preventDefault());
        b.addEventListener("click", (e) => {
          e.preventDefault();
          const pos = typeof getPos === "function" ? getPos() : undefined;
          if (typeof pos === "number" && editor.isEditable) run(pos);
        });
        return b;
      };
      const sort = btn("Nach Zeit sortieren", "Einträge chronologisch ordnen (Einträge ohne Datum bleiben bei ihrem Vorgänger)", (pos) => editor.chain().focus().sortTimeline(pos).run());
      const add = btn("+ Eintrag", "Neuen Eintrag am Ende anfügen", (pos) => editor.chain().focus().addTimelineEntry(pos).run());
      head.append(label, hint, sort, add);
      const content = document.createElement("div");
      content.className = "tl-body";
      dom.append(head, content);
      const render = (n: PMNodeType) => {
        const sorted = isSorted(timesOf(n));
        hint.textContent = sorted ? "" : "Reihenfolge nicht chronologisch";
        dom.classList.toggle("is-unsorted", !sorted);
      };
      render(node);
      return {
        dom,
        contentDOM: content,
        update: (n) => {
          if (n.type.name !== "timeline") return false;
          render(n);
          return true;
        },
        ignoreMutation: (m) => head.contains(m.target as globalThis.Node) || (m.type === "attributes" && m.target === dom),
        stopEvent: (e) => head.contains(e.target as globalThis.Node),
      };
    };
  },

  addCommands() {
    return {
      insertTimeline:
        (events = []) =>
        ({ state, tr, dispatch }) => {
          const { $to } = state.selection;
          // hinter den aktuellen Block der obersten Ebene (nie mitten in Listen o. Ä.)
          const at = $to.depth ? $to.after(1) : $to.pos;
          if (dispatch) {
            tr.insert(at, build(state, events));
            selectEntry(tr, at, events.length ? events.length - 1 : 0, events.length ? 1 : 0, !!events.length);
            tr.scrollIntoView();
          }
          return true;
        },
      timelineFromText:
        () =>
        ({ state, tr, dispatch }) => {
          const { from, to, empty } = state.selection;
          let text = "";
          let at: number;
          if (!empty) {
            text = state.doc.textBetween(from, to, " ", " ");
            const $to = state.doc.resolve(to);
            at = $to.depth ? $to.after(1) : to;
          } else {
            const sv = sachverhalt(state.doc);
            if (!sv?.text) return false;
            text = sv.text;
            at = sv.end;
          }
          const events = extractEvents(text);
          if (!events.length) return false;
          if (dispatch) {
            tr.insert(at, build(state, events));
            selectEntry(tr, at, 0, 0, true);
            tr.scrollIntoView();
          }
          return true;
        },
      sortTimeline:
        (pos) =>
        ({ state, tr, dispatch }) => {
          const tl = timelineAt(state, pos);
          if (!tl) return false;
          const order = sortOrder(timesOf(tl.node));
          if (order.every((v, i) => v === i)) return true;
          if (dispatch) {
            // Schreibmarke bleibt im selben Eintrag (an neuer Stelle)
            const { $from } = state.selection;
            const d = depthOf($from, "timelineEntry");
            const inside = d > 0 && $from.before(d - 1) === tl.pos;
            const was = inside ? $from.index(d - 1) : -1;
            const cell = inside && $from.parent.type.name === "timelineText" ? 1 : 0;
            const offset = inside ? $from.parentOffset : 0;
            const entries = order.map((i) => tl.node.child(i));
            tr.replaceWith(tl.pos + 1, tl.pos + tl.node.nodeSize - 1, entries);
            const now = inside ? order.indexOf(was) : 0;
            selectEntry(tr, tl.pos, now, cell as 0 | 1);
            if (offset) tr.setSelection(TextSelection.create(tr.doc, tr.selection.from + offset));
          }
          return true;
        },
      addTimelineEntry:
        (pos) =>
        ({ state, tr, dispatch }) => {
          const tl = timelineAt(state, pos);
          if (!tl) return false;
          if (dispatch) {
            const { schema } = state;
            const entry = schema.nodes.timelineEntry!.create(null, [schema.nodes.timelineTime!.create(), schema.nodes.timelineText!.create()]);
            tr.insert(tl.pos + tl.node.nodeSize - 1, entry);
            selectEntry(tr, tl.pos, tl.node.childCount);
            tr.scrollIntoView();
          }
          return true;
        },
    };
  },

  addKeyboardShortcuts() {
    const ed = () => this.editor as Editor;
    /** Zelle der Schreibmarke: 0 = Zeit, 1 = Geschehen; dazu Eintrag und Zeitstrahl */
    const where = () => {
      const { $from, empty } = ed().state.selection;
      const name = $from.parent.type.name;
      if (!empty || (name !== "timelineTime" && name !== "timelineText")) return null;
      const d = $from.depth - 1;
      return {
        $from,
        cell: name === "timelineTime" ? (0 as const) : (1 as const),
        entry: $from.node(d),
        entryPos: $from.before(d),
        index: $from.index(d - 1),
        tl: $from.node(d - 1),
        tlPos: $from.before(d - 1),
      };
    };
    /** Änderung als Editor-Befehl (fügt sich in laufende Befehle ein) */
    const run = (fn: (tr: Transaction, state: EditorState) => void) =>
      ed().commands.command(({ tr, state }) => {
        fn(tr, state);
        tr.scrollIntoView();
        return true;
      });
    const move = (by: 1 | -1) => () => {
      const w = where();
      if (!w) return false;
      const flat = w.index * 2 + w.cell + by;
      if (flat < 0 || flat >= w.tl.childCount * 2) return by === 1 ? ed().commands.addTimelineEntry() : true;
      return run((tr) => selectEntry(tr, w.tlPos, Math.floor(flat / 2), (flat % 2) as 0 | 1, true));
    };
    return {
      Tab: move(1),
      "Shift-Tab": move(-1),
      Enter: () => {
        const w = where();
        if (!w) return false;
        if (w.cell === 0) return run((tr) => selectEntry(tr, w.tlPos, w.index, 1));
        // leerer letzter Eintrag: Zeitstrahl verlassen
        if (!w.entry.textContent && w.index === w.tl.childCount - 1 && w.tl.childCount > 1) {
          return run((tr, state) => {
            const after = w.tlPos + w.tl.nodeSize - w.entry.nodeSize;
            tr.delete(w.entryPos, w.entryPos + w.entry.nodeSize);
            tr.insert(after, state.schema.nodes.paragraph!.create());
            tr.setSelection(TextSelection.create(tr.doc, after + 1));
          });
        }
        // am Anfang eines Textes (wie in Word): leeren Eintrag davor einfügen
        if (w.$from.parentOffset === 0 && w.$from.parent.content.size > 0) {
          return run((tr, state) => {
            const { schema } = state;
            tr.insert(w.entryPos, schema.nodes.timelineEntry!.create(null, [schema.nodes.timelineTime!.create(), schema.nodes.timelineText!.create()]));
            selectEntry(tr, w.tlPos, w.index, 0);
          });
        }
        // neuer Eintrag dahinter; Text nach der Schreibmarke wandert mit
        return run((tr, state) => {
          const rest = w.$from.parent.content.cut(w.$from.parentOffset);
          if (rest.size) tr.delete(w.$from.pos, w.$from.end());
          const { schema } = state;
          const entry = schema.nodes.timelineEntry!.create(null, [schema.nodes.timelineTime!.create(), schema.nodes.timelineText!.create(null, rest)]);
          tr.insert(tr.mapping.map(w.entryPos + w.entry.nodeSize), entry);
          selectEntry(tr, w.tlPos, w.index + 1, 0);
        });
      },
      Backspace: () => {
        const w = where();
        if (!w || w.$from.parentOffset > 0) return false;
        // leerer Eintrag am Anfang der Zeit: Eintrag entfernen
        if (w.cell === 0 && !w.entry.textContent) {
          return run((tr, state) => {
            if (w.tl.childCount === 1) {
              tr.replaceWith(w.tlPos, w.tlPos + w.tl.nodeSize, state.schema.nodes.paragraph!.create());
              tr.setSelection(TextSelection.create(tr.doc, w.tlPos + 1));
            } else {
              tr.delete(w.entryPos, w.entryPos + w.entry.nodeSize);
              selectEntry(tr, w.tlPos, Math.max(0, w.index - 1), 1, true);
            }
          });
        }
        // sonst nur in die vorige Zelle wechseln (Zellen werden nicht verschmolzen)
        if (w.cell === 0 && w.index === 0) return true;
        return move(-1)();
      },
    };
  },
});
