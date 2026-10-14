import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open, save } from "@tauri-apps/plugin-dialog";

import type { Backend } from "./backend";

function toBytes(v: unknown): Uint8Array {
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  if (v instanceof Uint8Array) return v;
  if (Array.isArray(v)) return Uint8Array.from(v as number[]);
  throw new Error("Unerwartetes Datenformat vom Backend.");
}

function toHex(s: string): string {
  return Array.from(new TextEncoder().encode(s), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Echte Anbindung an die Rust-Befehle. Argumentnamen werden von Tauri in snake_case umgesetzt. */
export function createTauriBackend(): Backend {
  const c = invoke;
  return {
    kind: "tauri",
    appInfo: () => c("app_info"),
    settingsAll: () => c("settings_all"),
    settingSet: (key, value) => c("setting_set", { key, value }),

    areasList: () => c("areas_list"),
    areaCreate: (name, color) => c("area_create", { name, color }),
    areaUpdate: (id, name, color) => c("area_update", { id, name, color }),
    areaReorder: (ids) => c("area_reorder", { ids }),

    nodesList: (areaId) => c("nodes_list", { areaId }),
    nodeGet: (id) => c("node_get", { id }),
    nodeCreate: (input) => c("node_create", { input }),
    nodeUpdate: (id, patch) => c("node_update", { id, patch }),
    nodeMove: (id, parentId, position, areaId = null) => c("node_move", { id, parentId, position, areaId }),
    nodeSetArchived: (id, archived) => c("node_set_archived", { id, archived }),
    nodeTrash: (id) => c("node_trash", { id }),
    nodeAreaRefAdd: (nodeId, areaId) => c("node_area_ref_add", { nodeId, areaId }),
    nodeAreaRefRemove: (nodeId, areaId) => c("node_area_ref_remove", { nodeId, areaId }),
    areaRefsList: (areaId) => c("area_refs_list", { areaId }),

    noteGet: (id) => c("note_get", { id }),
    noteSave: (id, contentJson, plainText) => c("note_save", { id, contentJson, plainText }),
    noteVersions: (id) => c("note_versions", { id }),
    noteVersionContent: (versionId) => c("note_version_content", { versionId }),
    noteVersionRestore: (id, versionId) => c("note_version_restore", { id, versionId }),
    noteVersionCreate: (id, reason) => c("note_version_create", { id, reason }),
    notesRecent: (areaId, limit) => c("notes_recent", { areaId, limit }),

    search: (query, areaId) => c("search", { query, areaId }),

    documentsImport: (paths, nodeId, docType) => c("documents_import", { paths, nodeId, docType }),
    documentsList: (scope) => c("documents_list", { scope }),
    documentsRecent: (areaId, limit) => c("documents_recent", { areaId, limit }),
    documentGet: (id) => c("document_get", { id }),
    documentUpdate: (id, title, docType) => c("document_update", { id, title, docType }),
    documentSetText: (id, pages) => c("document_set_text", { id, pages }),
    documentTextError: (id) => c("document_text_error", { id }),
    documentAddPlacement: (id, nodeId) => c("document_add_placement", { id, nodeId }),
    documentRemovePlacement: (id, nodeId) => c("document_remove_placement", { id, nodeId }),
    documentBytes: async (id) => toBytes(await c("document_bytes", { id })),
    documentTrash: (id) => c("document_trash", { id }),
    documentOpenExternal: (id) => c("document_open_external", { id }),
    documentExportCopy: (id, dest) => c("document_export_copy", { id, dest }),
    documentPageText: (id, page) => c("document_page_text", { id, page }),
    documentPagesText: (id) => c("document_pages_text", { id }),

    linksFor: (entityType, id) => c("links_for", { entityType, id }),
    linkAdd: (link) => c("link_add", { link }),
    linkRemove: (id) => c("link_remove", { id }),

    trashList: () => c("trash_list"),
    trashRestore: (itemType, id) => c("trash_restore", { itemType, id }),
    trashPurge: (itemType, id) => c("trash_purge", { itemType, id }),

    backupSettings: () => c("backup_settings"),
    backupCreate: () => c("backup_create"),
    backupVerify: (path) => c("backup_verify", { path }),
    backupRestore: (path) => c("backup_restore", { path }),
    backupHistory: () => c("backup_history"),

    exportWrite: (path, data) => c("export_write", data, { headers: { "x-path-hex": toHex(path) } }),
    readExternalFile: async (path) => toBytes(await c("read_external_file", { path })),
    openUrl: (url) => c("open_url", { url }),
    revealPath: (path) => c("reveal_path", { path: path ?? null }),

    async pickFiles({ multiple, extensions, title }) {
      const res = await open({
        multiple,
        directory: false,
        title,
        filters: extensions ? [{ name: "Dokumente", extensions }] : undefined,
      });
      if (res === null) return null;
      return Array.isArray(res) ? res : [res];
    },
    async pickDirectory(title) {
      const res = await open({ directory: true, multiple: false, title });
      return typeof res === "string" ? res : null;
    },
    async pickSavePath(defaultName, ext) {
      return save({ defaultPath: defaultName, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
    },
    onFileDrop(handler, hover) {
      let unlisten: (() => void) | null = null;
      let cancelled = false;
      getCurrentWebview()
        .onDragDropEvent((e) => {
          const p = e.payload;
          if (p.type === "enter" || p.type === "over") hover?.(true);
          else if (p.type === "leave") hover?.(false);
          else if (p.type === "drop") {
            hover?.(false);
            if (p.paths.length) handler(p.paths);
          }
        })
        .then((u) => {
          if (cancelled) u();
          else unlisten = u;
        });
      return () => {
        cancelled = true;
        unlisten?.();
      };
    },
  };
}
