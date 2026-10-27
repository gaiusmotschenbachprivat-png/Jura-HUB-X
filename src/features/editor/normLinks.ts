/**
 * Normen im Text antippen: Zitate wie „§ 119 Abs. 1 BGB“ oder „Art. 12 I GG“
 * werden erkannt und unterstrichen (nur Anzeige, der gespeicherte Text bleibt
 * unverändert). Antippen zeigt den Wortlaut aus den importierten Gesetzen.
 * Steht kein Gesetz dabei („§ 433 I“), wird es ergänzt (siehe `lib/lawContext`).
 */
import { Extension, type Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

import { findNormCitations, formatNorm, normKey, type NormCitation } from "../../ai/norms";
import type { DefaultLaws } from "../../lib/lawContext";

export const normKeyPlugin = new PluginKey<DecorationSet>("normLinks");

export interface NormRef {
  law: string;
  norm: string;
  absatz: number | null;
  label: string;
  /** Gesetz stand nicht im Text, sondern wurde ergänzt */
  inferred?: boolean;
}

const NO_DEFAULT: DefaultLaws = { "§": "", "Art.": "" };

/** Normzitate mit Gesetz und ihre Position im Dokument. */
export function findNormRefs(doc: PMNode, fallback: DefaultLaws = NO_DEFAULT): { from: number; to: number; ref: NormRef }[] {
  const out: { from: number; to: number; ref: NormRef }[] = [];
  // zuletzt genanntes Gesetz, getrennt nach § und Art.
  const last: DefaultLaws = { "§": "", "Art.": "" };
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
      if (c.law) last[c.sign] = c.law;
      const law = c.law || last[c.sign] || fallback[c.sign];
      if (!law) continue;
      const from = map[c.index];
      const to = map[c.index + c.raw.length - 1];
      if (from === undefined || to === undefined || from < 0 || to < 0) continue;
      out.push({ from, to: to + 1, ref: { law, norm: normKey(c), absatz: c.absatz, label: formatNorm({ ...c, law }), inferred: !c.law } });
    }
    return false;
  });
  return out;
}

function build(doc: PMNode, fallback: DefaultLaws): DecorationSet {
  return DecorationSet.create(
    doc,
    findNormRefs(doc, fallback).map((r) =>
      Decoration.inline(r.from, r.to, {
        class: r.ref.inferred ? "norm-ref is-inferred" : "norm-ref",
        ...(r.ref.inferred ? { title: `${r.ref.label} (Gesetz ergänzt)` } : {}),
        "data-law": r.ref.law,
        "data-norm": r.ref.norm,
        "data-absatz": r.ref.absatz === null ? "" : String(r.ref.absatz),
        "data-label": r.ref.label,
      }),
    ),
  );
}

export const NormLinks = Extension.create<object, { fallback: DefaultLaws }>({
  name: "normLinks",
  addStorage() {
    return { fallback: { ...NO_DEFAULT } };
  },
  addProseMirrorPlugins() {
    const storage = this.storage;
    return [
      new Plugin<DecorationSet>({
        key: normKeyPlugin,
        state: {
          init: (_, state) => build(state.doc, storage.fallback),
          apply: (tr, old, _o, state) => (tr.docChanged || tr.getMeta(normKeyPlugin) ? build(state.doc, storage.fallback) : old),
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
  return { law: n.dataset.law, norm: n.dataset.norm, absatz: n.dataset.absatz ? Number(n.dataset.absatz) : null, label: n.dataset.label ?? "", inferred: n.classList.contains("is-inferred") };
}

/** Ersatz-Gesetze für Zitate ohne Gesetzesangabe setzen und die Markierungen neu berechnen. */
export function setDefaultLaws(editor: Editor, laws: DefaultLaws) {
  const st = (editor.storage as { normLinks?: { fallback: DefaultLaws } }).normLinks;
  if (!st || editor.isDestroyed) return;
  if (st.fallback["§"] === laws["§"] && st.fallback["Art."] === laws["Art."]) return;
  st.fallback = laws;
  editor.view.dispatch(editor.state.tr.setMeta(normKeyPlugin, true));
}
