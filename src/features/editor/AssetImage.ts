/**
 * Bilder in Notizen. Bilder liegen im lokalen Dokumentenspeicher und werden
 * über `studium:asset/<sha256>` referenziert. Externe Bildadressen werden nie
 * geladen (kein Netzwerk) und nur als Hinweis angezeigt.
 */
import Image from "@tiptap/extension-image";

import { api } from "../../api";

export const ASSET_PREFIX = "studium:asset/";
/** Antippen einer Zeichnung: der Editor öffnet die Zeichenfläche. */
export const DRAWING_EDIT_EVENT = "studium:edit-drawing";
/** Folie aus der geteilten Ansicht in die Mitschrift übernehmen */
export const INSERT_SLIDE_EVENT = "studium:insert-slide";
export interface InsertSlideDetail {
  noteId: string;
  src: string;
  page: number;
  documentId: string;
  title: string;
}
export interface DrawingEditDetail {
  pos: number;
  drawing: string;
}
export const isAssetSrc = (src: unknown): src is string => typeof src === "string" && /^studium:asset\/[0-9a-f]{64}$/.test(src);

const cache = new Map<string, Promise<string>>();

/** Lädt ein Bild aus dem Speicher als Objekt-URL (zwischengespeichert). */
export function assetUrl(src: string): Promise<string> {
  const sha = src.slice(ASSET_PREFIX.length);
  let p = cache.get(sha);
  if (!p) {
    p = api.imageBytes(sha).then((bytes) => URL.createObjectURL(new Blob([bytes.slice().buffer as ArrayBuffer])));
    cache.set(sha, p);
    p.catch(() => cache.delete(sha));
  }
  return p;
}

export const AssetImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: { default: null },
      /** Vektordaten einer Handzeichnung (siehe lib/drawing.ts); null bei normalen Bildern. */
      drawing: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute("data-drawing"),
        renderHTML: (a: Record<string, unknown>) => (a.drawing ? { "data-drawing": a.drawing } : {}),
      },
    };
  },
  addNodeView() {
    return ({ node, getPos }) => {
      const wrap = document.createElement("span");
      wrap.className = "asset-image";
      if (node.attrs.drawing) {
        wrap.classList.add("is-drawing");
        wrap.title = "Zeichnung – antippen zum Bearbeiten";
        wrap.addEventListener("click", () => {
          const pos = typeof getPos === "function" ? getPos() : undefined;
          if (typeof pos === "number")
            window.dispatchEvent(new CustomEvent<DrawingEditDetail>(DRAWING_EDIT_EVENT, { detail: { pos, drawing: String(node.attrs.drawing) } }));
        });
      }
      const src = node.attrs.src as unknown;
      if (!isAssetSrc(src)) {
        wrap.classList.add("is-missing");
        wrap.textContent = "Externes Bild – wird aus Datenschutzgründen nicht geladen";
        return { dom: wrap };
      }
      const img = document.createElement("img");
      img.alt = (node.attrs.alt as string) ?? "";
      if (node.attrs.width) img.style.width = `${node.attrs.width}px`;
      wrap.appendChild(img);
      assetUrl(src)
        .then((u) => (img.src = u))
        .catch(() => {
          wrap.classList.add("is-missing");
          wrap.textContent = "Bild fehlt im Dokumentenspeicher";
        });
      return { dom: wrap };
    };
  },
}).configure({ inline: false, allowBase64: false });

/** Bild speichern und als Knoten einfügen. */
export async function storeImageFile(file: Blob): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  const sha = await api.imageStore(buf);
  return `${ASSET_PREFIX}${sha}`;
}
