/**
 * Seitenansicht (Dokument A4): misst nach jeder Änderung die Absätze und setzt
 * Zwischenräume (Seitenende mit Seitenzahl, Abstand, oberer Rand der nächsten
 * Seite) als Dekorationen, sodass ein Absatz, der nicht mehr passt, auf der
 * nächsten Seite beginnt. Ohne Seitenmaß (normale Notiz) bleibt alles wie gehabt.
 */
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";

import { pageBreaks, type Block, type PageLayout } from "../../lib/pageLayout";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    pagination: {
      /** Seitenmaß setzen (null = keine Seitenansicht) */
      setPageLayout: (layout: PageLayout | null) => ReturnType;
    };
  }
}

interface State {
  layout: PageLayout | null;
  deco: DecorationSet;
  pages: number;
  sig: string;
}

export const paginationKey = new PluginKey<State>("pagination");

function gapWidget(height: number, page: number, toPageEnd: number, L: PageLayout) {
  return () => {
    const el = document.createElement("div");
    el.className = "page-gap";
    el.contentEditable = "false";
    el.style.height = `${height}px`;
    el.setAttribute("aria-hidden", "true");
    const foot = document.createElement("div");
    foot.className = "page-foot";
    foot.style.top = `${toPageEnd - L.bottom / 2 - 8}px`;
    foot.textContent = String(page + 1);
    const band = document.createElement("div");
    band.className = "page-band";
    band.style.top = `${toPageEnd}px`;
    band.style.height = `${L.gap}px`;
    band.style.left = `-${L.left}px`;
    band.style.right = `-${L.right}px`;
    el.append(foot, band);
    return el;
  };
}

/** Absätze messen (ohne die bisherigen Zwischenräume) und Umbrüche berechnen */
function compute(view: EditorView, L: PageLayout): { deco: DecorationSet; pages: number; sig: string } {
  const root = view.dom as HTMLElement;
  const rootRect = root.getBoundingClientRect();
  const scale = rootRect.width / L.width || 1;
  const posOf = new Map<Element, { pos: number; isBreak: boolean }>();
  view.state.doc.forEach((node, offset) => {
    const el = view.nodeDOM(offset);
    if (el instanceof Element) posOf.set(el, { pos: offset, isBreak: node.type.name === "pageBreak" });
  });
  const raw: { top: number; bottom: number; pos: number; isBreak: boolean }[] = [];
  let removed = 0;
  for (const child of Array.from(root.children)) {
    const r = child.getBoundingClientRect();
    if (child.classList.contains("page-gap")) {
      removed += r.height / scale;
      continue;
    }
    const info = posOf.get(child);
    if (!info) continue;
    const top = (r.top - rootRect.top) / scale - L.top - removed;
    raw.push({ top, bottom: top + r.height / scale, pos: info.pos, isBreak: info.isBreak });
  }
  const blocks: Block[] = raw.map((b, i) => ({ top: b.top, height: (raw[i + 1]?.top ?? b.bottom) - b.top, pageBreak: b.isBreak }));
  const { gaps, pages } = pageBreaks(blocks, L);
  const sig = gaps.map((g) => `${g.index}:${Math.round(g.height)}`).join(",") + `|${pages}`;
  const deco = DecorationSet.create(
    view.state.doc,
    gaps.map((g) => Decoration.widget(raw[g.index]!.pos, gapWidget(g.height, g.page, g.toPageEnd, L), { side: -1, key: `gap-${g.page}-${Math.round(g.height)}`, ignoreSelection: true })),
  );
  return { deco, pages, sig };
}

export const Pagination = Extension.create({
  name: "pagination",

  addCommands() {
    return {
      setPageLayout:
        (layout) =>
        ({ tr, dispatch }) => {
          if (dispatch) tr.setMeta(paginationKey, { layout }).setMeta("addToHistory", false);
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    let frame = 0;
    return [
      new Plugin<State>({
        key: paginationKey,
        state: {
          init: () => ({ layout: null, deco: DecorationSet.empty, pages: 1, sig: "" }),
          apply(tr, prev) {
            const meta = tr.getMeta(paginationKey) as Partial<State> | undefined;
            if (meta) return { ...prev, ...meta, ...(meta.layout === null ? { deco: DecorationSet.empty, pages: 1, sig: "" } : {}) };
            return prev.layout ? { ...prev, deco: prev.deco.map(tr.mapping, tr.doc) } : prev;
          },
        },
        props: {
          decorations: (state) => paginationKey.getState(state)?.deco,
          attributes: (state): Record<string, string> => {
            const s = paginationKey.getState(state);
            return s?.layout ? { class: "is-paged", "data-pages": String(s.pages) } : {};
          },
        },
        view: (view) => {
          const schedule = () => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => {
              const s = paginationKey.getState(view.state);
              if (!s?.layout || view.isDestroyed) return;
              const next = compute(view, s.layout);
              const root = view.dom as HTMLElement;
              root.style.minHeight = `${next.pages * (s.layout.height + s.layout.gap) - s.layout.gap}px`;
              if (next.sig !== s.sig) view.dispatch(view.state.tr.setMeta(paginationKey, next).setMeta("addToHistory", false));
            });
          };
          const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(schedule) : null;
          ro?.observe(view.dom);
          // Bilder und Schriften ändern die Höhe nachträglich
          const onLoad = () => schedule();
          view.dom.addEventListener("load", onLoad, true);
          void document.fonts?.ready.then(schedule);
          schedule();
          return {
            update: (v, prevState) => {
              const s = paginationKey.getState(v.state);
              const p = paginationKey.getState(prevState);
              if (!s?.layout) {
                if (p?.layout) (v.dom as HTMLElement).style.minHeight = "";
                return;
              }
              if (v.state.doc !== prevState.doc || s.layout !== p?.layout) schedule();
            },
            destroy: () => {
              cancelAnimationFrame(frame);
              ro?.disconnect();
              view.dom.removeEventListener("load", onLoad, true);
            },
          };
        },
      }),
    ];
  },
});
