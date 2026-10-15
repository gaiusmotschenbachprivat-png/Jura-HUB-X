/**
 * Normen im Text antippen: Zitate wie „§ 119 Abs. 1 BGB“ oder „Art. 12 I GG“
 * werden erkannt und unterstrichen (nur Anzeige, der gespeicherte Text bleibt
 * unverändert). Antippen zeigt den Wortlaut aus den importierten Gesetzen.
 */
import { Extension } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

import { findNormCitations, formatNorm, normKey, type NormCitation } from "../../ai/norms";

export const normKeyPlugin = new PluginKey<DecorationSet>("normLinks");

export interface NormRef {
  law: string;
  norm: string;
  absatz: number | null;
  label: string;
}

/** Normzitate mit Gesetz und ihre Position im Dokument. */
export function findNormRefs(doc: PMNode): { from: number; to: number; ref: NormRef }[] {
  const out: { from: number; to: number; ref: NormRef }[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    if (node.type.name === "codeBlock") return false;
    let text = "";
    const map: number[] = [];
    node.forEach((child, offset) => {
      if (child.isText) {
        const t = child.text ?? "";
        for (let i = 0; i < t.length; i++) map.push(pos + 1 + offset + i);
        text += t;
      } else {
        map.push(-1);
        text += "\u0000";
      }
    });
    for (const c of findNormCitations(text) as NormCitation[]) {
      if (!c.law) continue;
      const from = map[c.index];
      const to = map[c.index + c.raw.length - 1];
      if (from === undefined || to === undefined || from < 0 || to < 0) continue;
      out.push({ from, to: to + 1, ref: { law: c.law, norm: normKey(c), absatz: c.absatz, label: formatNorm(c) } });
    }
    return false;
  });
  return out;
}

function build(doc: PMNode): DecorationSet {
  return DecorationSet.create(
    doc,
    findNormRefs(doc).map((r) =>
      Decoration.inline(r.from, r.to, {
        class: "norm-ref",
        "data-law": r.ref.law,
        "data-norm": r.ref.norm,
        "data-absatz": r.ref.absatz === null ? "" : String(r.ref.absatz),
        "data-label": r.ref.label,
      }),
    ),
  );
}

export const NormLinks = Extension.create({
  name: "normLinks",
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: normKeyPlugin,
        state: {
          init: (_, state) => build(state.doc),
          apply: (tr, old, _o, state) => (tr.docChanged ? build(state.doc) : old),
        },
        props: {
          decorations: (state) => normKeyPlugin.getState(state),
        },
      }),
    ];
  },
});

/** NormRef aus einem angetippten Element. */
export function normRefOf(el: Element | null): NormRef | null {
  const n = el?.closest?.(".norm-ref") as HTMLElement | null;
  if (!n?.dataset.law || !n.dataset.norm) return null;
  return { law: n.dataset.law, norm: n.dataset.norm, absatz: n.dataset.absatz ? Number(n.dataset.absatz) : null, label: n.dataset.label ?? "" };
}
