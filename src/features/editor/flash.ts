/**
 * Kurzes Aufleuchten eines Absatzes nach einem Sprung (Gliederung, Erklärungen,
 * „Zum Wiederholen“). Als Dekoration, damit ProseMirror die Hervorhebung beim
 * Neuzeichnen nicht wieder entfernt.
 */
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { EditorView } from "@tiptap/pm/view";

const key = new PluginKey<DecorationSet>("flash");

export const Flash = Extension.create({
  name: "flash",
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, set) {
            const meta = tr.getMeta(key) as { pos: number } | "clear" | undefined;
            if (meta === "clear") return DecorationSet.empty;
            if (meta) {
              const node = tr.doc.nodeAt(meta.pos);
              return node ? DecorationSet.create(tr.doc, [Decoration.node(meta.pos, meta.pos + node.nodeSize, { class: "outline-flash" })]) : set;
            }
            return set.map(tr.mapping, tr.doc);
          },
        },
        props: { decorations: (state) => key.getState(state) },
      }),
    ];
  },
});

/** Block an `pos` kurz hervorheben. */
export function flashAt(view: EditorView, pos: number) {
  if (!key.get(view.state)) return;
  view.dispatch(view.state.tr.setMeta(key, { pos }));
  setTimeout(() => {
    if (!view.isDestroyed) view.dispatch(view.state.tr.setMeta(key, "clear"));
  }, 1600);
}
