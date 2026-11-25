/**
 * Seitenansicht (Dokument A4): misst nach jeder Änderung die Absätze und setzt
 * Zwischenräume (Seitenende mit Seitenzahl, Abstand, oberer Rand der nächsten
 * Seite) als Dekorationen, sodass ein Absatz, der nicht mehr passt, auf der
 * nächsten Seite beginnt. Ohne Seitenmaß (normale Notiz) bleibt alles wie gehabt.
 */
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";

import { gridBreaks, pageBreaks, type Block, type GridBlock, type PageLayout } from "../../lib/pageLayout";

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

/** Zwischenraum ohne Inhalt (Zeilenraster): nur Abstand, das Blatt zeichnet die Seite */
function spacer(height: number, inline: boolean) {
  return () => {
    const el = document.createElement(inline ? "span" : "div");
    el.className = inline ? "page-gap is-cut" : "page-gap";
    el.contentEditable = "false";
    el.style.display = "block";
    el.style.height = `${height}px`;
    el.setAttribute("aria-hidden", "true");
    return el;
  };
}

const SPLITTABLE = new Set(["paragraph", "heading", "bulletList", "orderedList", "taskList", "blockquote"]);

/**
 * Zeilenraster (Klausurbogen): Blöcke auf Rasterlinien setzen und lange Absätze
 * zeilenweise auf die nächste Seite umbrechen (Zwischenraum mitten im Absatz).
 */
function computeGrid(view: EditorView, L: PageLayout): { deco: DecorationSet; pages: number; sig: string } {
  const root = view.dom as HTMLElement;
  const rootRect = root.getBoundingClientRect();
  const scale = rootRect.width / L.width || 1;
  const g = L.grid!;
  const info = new Map<Element, { pos: number; node: import("@tiptap/pm/model").Node }>();
  view.state.doc.forEach((node, offset) => {
    const el = view.nodeDOM(offset);
    if (el instanceof Element) info.set(el, { pos: offset, node });
  });
  type Raw = { el: Element; top: number; screenTop: number; height: number; pos: number; node: import("@tiptap/pm/model").Node; inner: { top: number; h: number }[] };
  const raw: Raw[] = [];
  let removed = 0;
  for (const child of Array.from(root.children)) {
    const r = child.getBoundingClientRect();
    if (child.classList.contains("page-gap")) {
      removed += r.height / scale;
      continue;
    }
    const i = info.get(child);
    if (!i) continue;
    // Zwischenräume im Absatz (frühere Seitenumbrüche) herausrechnen
    const inner = Array.from(child.querySelectorAll(".page-gap")).map((e) => {
      const q = e.getBoundingClientRect();
      return { top: (q.top - rootRect.top) / scale, h: q.height / scale };
    });
    const innerH = inner.reduce((s, x) => s + x.h, 0);
    const top = (r.top - rootRect.top) / scale - L.top - removed;
    raw.push({ el: child, top, screenTop: (r.top - rootRect.top) / scale, height: r.height / scale - innerH, pos: i.pos, node: i.node, inner });
    removed += innerH;
  }
  const blocks: GridBlock[] = raw.map((b, i) => {
    const next = raw[i + 1];
    // Höhe bis zum nächsten Block (mit Außenabstand), Seitenumbruch zählt nicht als Zeile
    const h = b.node.type.name === "pageBreak" ? 0 : next ? Math.max(b.height, next.top - b.top) : b.height;
    return { top: b.top, height: h, pageBreak: b.node.type.name === "pageBreak", splittable: SPLITTABLE.has(b.node.type.name) };
  });
  const { placements, pages } = gridBreaks(blocks, L);
  const decos: Decoration[] = [];
  const sigParts: string[] = [];
  placements.forEach((p, i) => {
    const b = raw[i]!;
    if (p.before > 0.5) {
      decos.push(Decoration.widget(b.pos, spacer(p.before, false), { side: -1, key: `g${i}-${Math.round(p.before)}`, ignoreSelection: true }));
      sigParts.push(`${i}:${Math.round(p.before)}`);
    }
    for (const c of p.cuts) {
      const at = cutPos(view, b, c.line, g, scale, rootRect.top);
      if (at === null) continue;
      decos.push(Decoration.widget(at, spacer(c.height, true), { side: -1, key: `c${i}-${c.line}-${Math.round(c.height)}`, ignoreSelection: true }));
      sigParts.push(`${i}/${c.line}@${at}`);
    }
  });
  return { deco: DecorationSet.create(view.state.doc, decos), pages, sig: sigParts.join(",") + `|${pages}` };
}

/**
 * Dokumentposition am Anfang der `line`-ten Zeile eines Blocks (Zwischenräume
 * im Block herausgerechnet). Sucht über die Textpositionen (coordsAtPos) –
 * funktioniert auch für Stellen außerhalb des sichtbaren Bereichs.
 */
function cutPos(
  view: EditorView,
  b: { pos: number; node: import("@tiptap/pm/model").Node; screenTop: number; inner: { top: number; h: number }[] },
  line: number,
  g: number,
  scale: number,
  rootTop: number,
): number | null {
  const lineOf = (pos: number): number => {
    let c: { top: number; bottom: number };
    try {
      c = view.coordsAtPos(pos, 1);
    } catch {
      return -1;
    }
    const mid = ((c.top + c.bottom) / 2 - rootTop) / scale;
    const above = b.inner.filter((x) => x.top < mid).reduce((s, x) => s + x.h, 0);
    return Math.floor((mid - b.screenTop - above) / g);
  };
  // Textpositionen im Block (ohne die Ränder der Absätze)
  let lo = b.pos + 1;
  let hi = b.pos + b.node.nodeSize - 1;
  if (lineOf(hi) < line) return null;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (lineOf(mid) >= line) hi = mid;
    else lo = mid + 1;
  }
  // nicht mitten zwischen zwei Absätzen (Liste): an den Anfang des Textblocks
  const $p = view.state.doc.resolve(lo);
  return $p.parent.isTextblock && $p.parentOffset === 0 ? $p.pos : lo;
}

/** Absätze messen (ohne die bisherigen Zwischenräume) und Umbrüche berechnen */
function compute(view: EditorView, L: PageLayout): { deco: DecorationSet; pages: number; sig: string } {
  if (L.grid) return computeGrid(view, L);
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
