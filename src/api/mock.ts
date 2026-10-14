/**
 * In-Memory-Backend für Browser-Entwicklung (`npm run dev:browser`) und Tests.
 * Bildet die Regeln des Rust-Kerns vereinfacht nach. Wird in der echten App
 * nie verwendet; dort gilt ausschließlich `tauri.ts`.
 */
import type { Backend } from "./backend";
import { createLearningMock } from "./mockLearning";
import type {
  Area,
  BackupRecord,
  DocumentInfo,
  LinkView,
  NewLink,
  Note,
  SearchHit,
  StudyNode,
  TrashItem,
  VersionMeta,
} from "./types";

interface NoteRow {
  content_json: string;
  plain_text: string;
  template: string | null;
  updated_at: string;
}
interface LinkRow extends NewLink {
  id: string;
  created_at: string;
}

const HL0 = "\u0002";
const HL1 = "\u0003";

const uuid = () =>
  "xxxxxxxx-xxxx-7xxx-8xxx-xxxxxxxxxxxx".replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));
const now = () => new Date().toISOString();
const err = (code: string, message: string) => Object.assign(new Error(message), { code, message });
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function createMockBackend(seed?: (b: Backend) => Promise<void>): Backend {
  const areas: Area[] = [];
  const nodes = new Map<string, StudyNode>();
  const notes = new Map<string, NoteRow>();
  const versions = new Map<string, (VersionMeta & { node_id: string; content_json: string })[]>();
  const docs = new Map<string, DocumentInfo & { bytes: Uint8Array; pages: string[] }>();
  const placements: { document_id: string; node_id: string }[] = [];
  const refs: { node_id: string; area_id: string }[] = [];
  const links: LinkRow[] = [];
  const settings: Record<string, unknown> = {};
  const backups: BackupRecord[] = [];

  const learning = createLearningMock((id) => nodes.get(id)?.area_id);
  const getNode = (id: string) => {
    const n = nodes.get(id);
    if (!n) throw err("not_found", "Eintrag nicht gefunden.");
    return n;
  };
  const crumb = (id: string, self = false): string => {
    const parts: string[] = [];
    let cur = nodes.get(id);
    if (cur && self) parts.unshift(cur.title);
    while (cur?.parent_id) {
      cur = nodes.get(cur.parent_id);
      if (cur) parts.unshift(cur.title);
    }
    return parts.join(" › ");
  };
  const subtree = (id: string): string[] => {
    const out = [id];
    for (const n of nodes.values()) if (n.parent_id === id) out.push(...subtree(n.id));
    return out;
  };
  const alive = (n: StudyNode) => !n.deleted_at;
  const placementPath = (docId: string) => {
    const p = placements.filter((x) => x.document_id === docId && alive(getNode(x.node_id)));
    if (!p.length) return "Nicht zugeordnet";
    const first = crumb(p[0]!.node_id, true);
    return p.length > 1 ? `${first} · +${p.length - 1} weitere` : first;
  };
  const docPublic = (d: DocumentInfo & { bytes: Uint8Array; pages: string[] }): DocumentInfo => {
    const { bytes: _b, pages: _p, ...rest } = d;
    return rest;
  };
  const highlight = (text: string, terms: string[]) => {
    let out = text;
    for (const t of terms) {
      const i = fold(out).indexOf(t);
      if (i >= 0) out = out.slice(0, i) + HL0 + out.slice(i, i + t.length) + HL1 + out.slice(i + t.length);
    }
    return out;
  };
  const snippet = (text: string, terms: string[]) => {
    const f = fold(text);
    const i = Math.max(0, Math.min(...terms.map((t) => f.indexOf(t)).filter((x) => x >= 0), f.length));
    const start = Math.max(0, i - 60);
    return (start > 0 ? "…" : "") + highlight(text.slice(start, start + 180), terms) + (text.length > start + 180 ? "…" : "");
  };
  const mentionSync = (nodeId: string, content: string) => {
    for (let i = links.length - 1; i >= 0; i--) {
      const l = links[i]!;
      if (l.source_id === nodeId && l.kind === "mention") links.splice(i, 1);
    }
    const re = /studium:(node|document|knowledge)\/([0-9a-f-]{36})(?:#page=(\d+))?/g;
    for (const m of content.matchAll(re)) {
      links.push({
        id: uuid(),
        created_at: now(),
        source_type: "node",
        source_id: nodeId,
        target_type: m[1] as "node" | "document" | "knowledge",
        target_id: m[2]!,
        kind: "mention",
        anchor: m[3] ? { page: Number(m[3]) } : {},
      });
    }
  };

  const b: Backend = {
    ...learning.api,
    kind: "mock",
    async appInfo() {
      return {
        version: "0.1.0 (Browser-Vorschau)",
        data_dir: "(nur im Arbeitsspeicher – Browser-Vorschau)",
        db_path: "(keine)",
        files_dir: "(keine)",
        log_dir: null,
        schema_version: 1,
        platform: "browser",
      };
    },
    async settingsAll() {
      return { ...settings };
    },
    async settingSet(k, v) {
      settings[k] = v;
    },

    async areasList() {
      return [...areas].sort((a, b) => a.position - b.position);
    },
    async areaCreate(name, color) {
      const a: Area = { id: uuid(), name, color, position: areas.length, archived_at: null, created_at: now() };
      areas.push(a);
      return a;
    },
    async areaUpdate(id, name, color) {
      const a = areas.find((x) => x.id === id);
      if (!a) throw err("not_found", "Studienbereich nicht gefunden.");
      Object.assign(a, { name, color });
      return a;
    },
    async areaReorder(ids) {
      ids.forEach((id, i) => {
        const a = areas.find((x) => x.id === id);
        if (a) a.position = i;
      });
    },

    async nodesList(areaId) {
      return [...nodes.values()].filter((n) => alive(n) && (!areaId || n.area_id === areaId)).sort((a, b) => a.position - b.position);
    },
    async nodeGet(id) {
      return { node: getNode(id), path: crumb(id), also_in_areas: refs.filter((r) => r.node_id === id).map((r) => r.area_id) };
    },
    async nodeCreate(input) {
      if (!input.title.trim()) throw err("invalid", "Der Titel darf nicht leer sein.");
      const siblings = [...nodes.values()].filter((n) => n.parent_id === input.parent_id && n.area_id === input.area_id);
      const n: StudyNode = {
        id: uuid(),
        area_id: input.area_id,
        parent_id: input.parent_id,
        kind: input.kind,
        title: input.title.trim(),
        position: Math.max(0, ...siblings.map((s) => s.position)) + 1024,
        meta: input.meta ?? {},
        created_at: now(),
        updated_at: now(),
        archived_at: null,
        deleted_at: null,
      };
      nodes.set(n.id, n);
      if (n.kind === "note") {
        notes.set(n.id, {
          content_json: input.content_json ?? '{"type":"doc","content":[{"type":"paragraph"}]}',
          plain_text: input.plain_text ?? "",
          template: input.template ?? null,
          updated_at: now(),
        });
      }
      return n;
    },
    async nodeUpdate(id, patch) {
      const n = getNode(id);
      if (patch.title !== undefined) {
        if (!patch.title.trim()) throw err("invalid", "Der Titel darf nicht leer sein.");
        n.title = patch.title.trim();
      }
      if (patch.meta) n.meta = patch.meta;
      n.updated_at = now();
      return n;
    },
    async nodeMove(id, parentId, position, areaId) {
      const n = getNode(id);
      if (parentId && subtree(id).includes(parentId)) throw err("invalid", "Ein Eintrag kann nicht in sich selbst verschoben werden.");
      n.parent_id = parentId;
      n.position = position;
      const target = parentId ? getNode(parentId).area_id : areaId ?? n.area_id;
      if (target !== n.area_id) for (const s of subtree(id)) getNode(s).area_id = target;
      return n;
    },
    async nodeSetArchived(id, archived) {
      const n = getNode(id);
      n.archived_at = archived ? now() : null;
      return n;
    },
    async nodeTrash(id) {
      const ts = now();
      for (const s of subtree(id)) {
        const n = getNode(s);
        if (!n.deleted_at) n.deleted_at = ts;
      }
    },
    async nodeAreaRefAdd(nodeId, areaId) {
      if (!refs.some((r) => r.node_id === nodeId && r.area_id === areaId)) refs.push({ node_id: nodeId, area_id: areaId });
    },
    async nodeAreaRefRemove(nodeId, areaId) {
      const i = refs.findIndex((r) => r.node_id === nodeId && r.area_id === areaId);
      if (i >= 0) refs.splice(i, 1);
    },
    async areaRefsList(areaId) {
      return refs.filter((r) => r.area_id === areaId).map((r) => getNode(r.node_id)).filter(alive);
    },

    async noteGet(id) {
      const n = getNode(id);
      const t = notes.get(id);
      if (!t) throw err("not_found", "Notiz nicht gefunden.");
      const note: Note = {
        node_id: id,
        title: n.title,
        area_id: n.area_id,
        content_json: t.content_json,
        template: t.template,
        word_count: t.plain_text.split(/\s+/).filter(Boolean).length,
        updated_at: t.updated_at,
        path: crumb(id),
      };
      return note;
    },
    async noteSave(id, content, text) {
      const t = notes.get(id);
      if (!t) throw err("not_found", "Notiz nicht gefunden.");
      if (getNode(id).deleted_at) throw err("invalid", "Die Notiz liegt im Papierkorb.");
      if (t.content_json === content) return { updated_at: t.updated_at, version_created: false };
      Object.assign(t, { content_json: content, plain_text: text, updated_at: now() });
      getNode(id).updated_at = t.updated_at;
      mentionSync(id, content);
      const vs = versions.get(id) ?? [];
      const due = !vs[0] || Date.now() - Date.parse(vs[0].created_at) > 600_000;
      if (due) {
        vs.unshift({ id: uuid(), node_id: id, reason: "Automatisch", created_at: now(), word_count: text.split(/\s+/).filter(Boolean).length, content_json: content });
        versions.set(id, vs);
      }
      return { updated_at: t.updated_at, version_created: due };
    },
    async noteVersions(id) {
      return (versions.get(id) ?? []).map(({ id, reason, created_at, word_count }) => ({ id, reason, created_at, word_count }));
    },
    async noteVersionContent(vid) {
      for (const vs of versions.values()) {
        const v = vs.find((x) => x.id === vid);
        if (v) return v.content_json;
      }
      throw err("not_found", "Version nicht gefunden.");
    },
    async noteVersionRestore(id, vid) {
      const content = await b.noteVersionContent(vid);
      const t = notes.get(id)!;
      const vs = versions.get(id) ?? [];
      vs.unshift({ id: uuid(), node_id: id, reason: "Vor Wiederherstellung", created_at: now(), word_count: 0, content_json: t.content_json });
      versions.set(id, vs);
      Object.assign(t, { content_json: content, updated_at: now() });
      return { updated_at: t.updated_at, version_created: true };
    },
    async noteVersionCreate(id, reason) {
      const t = notes.get(id)!;
      const vs = versions.get(id) ?? [];
      vs.unshift({ id: uuid(), node_id: id, reason: reason || "Manuell", created_at: now(), word_count: 0, content_json: t.content_json });
      versions.set(id, vs);
    },
    async notesRecent(areaId, limit) {
      return [...nodes.values()]
        .filter((n) => n.kind === "note" && alive(n) && (!areaId || n.area_id === areaId))
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
        .slice(0, limit)
        .map((n) => ({ node_id: n.id, title: n.title, area_id: n.area_id, updated_at: notes.get(n.id)!.updated_at, path: crumb(n.id), word_count: 0 }));
    },

    async search(query, areaId) {
      const terms = fold(query).split(/[\s§"'()*:,.;]+/).filter(Boolean);
      if (!terms.length) return [];
      const hits: SearchHit[] = [];
      const match = (s: string) => terms.every((t) => fold(s).includes(t));
      for (const n of nodes.values()) {
        if (!alive(n)) continue;
        if (areaId && n.area_id !== areaId && !refs.some((r) => r.node_id === n.id && r.area_id === areaId)) continue;
        const body = n.kind === "note" ? notes.get(n.id)?.plain_text ?? "" : Object.values(n.meta).join(" ");
        if (match(n.title + " " + body)) {
          hits.push({ entity_type: n.kind === "note" ? "note" : "node", entity_id: n.id, area_id: n.area_id, page: null, title: highlight(n.title, terms), snippet: snippet(body, terms), path: crumb(n.id), kind: n.kind, target_id: null });
        }
      }
      for (const d of docs.values()) {
        if (d.deleted_at) continue;
        if (areaId && !placements.some((p) => p.document_id === d.id && getNode(p.node_id).area_id === areaId)) continue;
        if (match(d.title + " " + d.original_name)) hits.push({ entity_type: "document", entity_id: d.id, area_id: null, page: null, title: highlight(d.title, terms), snippet: d.original_name, path: placementPath(d.id), kind: null, target_id: null });
        d.pages.forEach((p, i) => {
          if (match(p)) hits.push({ entity_type: "page", entity_id: d.id, area_id: null, page: i + 1, title: d.title, snippet: snippet(p, terms), path: placementPath(d.id), kind: null, target_id: null });
        });
      }
      hits.push(...learning.extra.search(terms, areaId));
      return hits.slice(0, 60);
    },

    async documentsImport(paths, nodeId, docType) {
      return paths.map((p) => {
        const name = p.split(/[\\/]/).pop() ?? p;
        const ext = (name.split(".").pop() ?? "").toLowerCase();
        const d = {
          id: uuid(),
          title: name.replace(/\.[^.]+$/, "").replace(/_/g, " "),
          original_name: name,
          ext,
          mime: ext === "pdf" ? "application/pdf" : "application/octet-stream",
          size: 1000,
          doc_type: docType,
          page_count: null,
          text_status: (ext === "pdf" || ext === "docx" ? "pending" : "unsupported") as DocumentInfo["text_status"],
          created_at: now(),
          updated_at: now(),
          deleted_at: null,
          file_present: true,
          bytes: new Uint8Array(),
          pages: [] as string[],
        };
        docs.set(d.id, d);
        if (nodeId) placements.push({ document_id: d.id, node_id: nodeId });
        return { file_name: name, document: docPublic(d), error: null };
      });
    },
    async documentsList(scope) {
      return [...docs.values()]
        .filter((d) => !d.deleted_at)
        .filter((d) => {
          const ps = placements.filter((p) => p.document_id === d.id);
          switch (scope.kind) {
            case "all":
              return true;
            case "area":
              return ps.some((p) => getNode(p.node_id).area_id === scope.id);
            case "node":
              return ps.some((p) => p.node_id === scope.id);
            case "subtree": {
              const ids = subtree(scope.id);
              return ps.some((p) => ids.includes(p.node_id));
            }
            case "unassigned":
              return ps.length === 0;
          }
        })
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .map(docPublic);
    },
    async documentsRecent(areaId, limit) {
      return (await b.documentsList(areaId ? { kind: "area", id: areaId } : { kind: "all" })).slice(0, limit);
    },
    async documentGet(id) {
      const d = docs.get(id);
      if (!d) throw err("not_found", "Dokument nicht gefunden.");
      return {
        document: docPublic(d),
        placements: placements
          .filter((p) => p.document_id === id)
          .map((p) => {
            const n = getNode(p.node_id);
            return { node_id: n.id, area_id: n.area_id, title: n.title, path: crumb(n.id, true) };
          }),
      };
    },
    async documentUpdate(id, title, docType) {
      const d = docs.get(id)!;
      Object.assign(d, { title, doc_type: docType });
      return docPublic(d);
    },
    async documentSetText(id, pages) {
      const d = docs.get(id)!;
      d.pages = pages;
      d.page_count = pages.length;
      d.text_status = pages.some((p) => p.trim().length > 3) ? "ok" : "none";
      return docPublic(d);
    },
    async documentTextError(id) {
      docs.get(id)!.text_status = "error";
    },
    async documentAddPlacement(id, nodeId) {
      if (!placements.some((p) => p.document_id === id && p.node_id === nodeId)) placements.push({ document_id: id, node_id: nodeId });
    },
    async documentRemovePlacement(id, nodeId) {
      const i = placements.findIndex((p) => p.document_id === id && p.node_id === nodeId);
      if (i >= 0) placements.splice(i, 1);
    },
    async documentBytes(id) {
      const d = docs.get(id);
      if (!d) throw err("not_found", "Dokument nicht gefunden.");
      return d.bytes;
    },
    async documentTrash(id) {
      docs.get(id)!.deleted_at = now();
    },
    async documentOpenExternal() {
      throw err("unsupported", "In der Browser-Vorschau nicht verfügbar.");
    },
    async documentExportCopy() {
      throw err("unsupported", "In der Browser-Vorschau nicht verfügbar.");
    },
    async documentPageText(id, page) {
      return docs.get(id)?.pages[page - 1] ?? null;
    },
    async documentPagesText(id) {
      return docs.get(id)?.pages ?? [];
    },

    async linksFor(type, id) {
      const out: LinkView[] = [];
      const describe = (t: "node" | "document" | "knowledge", oid: string) => {
        if (t === "knowledge") {
          const k = learning.extra.describe(oid);
          return { title: k?.title ?? "(gelöscht)", kind: k?.kind ?? null, path: "", missing: !k || k.missing };
        }
        if (t === "node") {
          const n = nodes.get(oid);
          return { title: n?.title ?? "(gelöscht)", kind: n?.kind ?? null, path: n ? crumb(oid) : "", missing: !n || !!n.deleted_at };
        }
        const d = docs.get(oid);
        return { title: d?.title ?? "(gelöscht)", kind: null, path: d ? placementPath(oid) : "", missing: !d || !!d.deleted_at };
      };
      for (const l of links) {
        let dir: "outgoing" | "incoming" | null = null;
        let ot: "node" | "document" | "knowledge" = "node";
        let oid = "";
        if (l.source_type === type && l.source_id === id) [dir, ot, oid] = ["outgoing", l.target_type, l.target_id];
        else if (l.target_type === type && l.target_id === id) [dir, ot, oid] = ["incoming", l.source_type, l.source_id];
        if (!dir) continue;
        const d = describe(ot, oid);
        out.push({ id: l.id, kind: l.kind, anchor: l.anchor ?? {}, direction: dir, other_type: ot, other_id: oid, other_title: d.title, other_kind: d.kind, other_path: d.path, other_missing: d.missing, created_at: l.created_at });
      }
      return out.reverse();
    },
    async linkAdd(link) {
      const dup = links.find((l) => l.source_id === link.source_id && l.target_id === link.target_id && JSON.stringify(l.anchor ?? {}) === JSON.stringify(link.anchor ?? {}));
      if (dup) return dup.id;
      const id = uuid();
      links.push({ ...link, id, created_at: now() });
      return id;
    },
    async linkRemove(id) {
      const i = links.findIndex((l) => l.id === id);
      if (i >= 0) links.splice(i, 1);
    },

    async trashList() {
      const out: TrashItem[] = [];
      for (const n of nodes.values()) {
        if (!n.deleted_at) continue;
        const p = n.parent_id ? nodes.get(n.parent_id) : undefined;
        if (p && p.deleted_at === n.deleted_at) continue;
        out.push({ item_type: "node", id: n.id, title: n.title, kind: n.kind, area_id: n.area_id, deleted_at: n.deleted_at, children: subtree(n.id).length - 1, path: crumb(n.id) });
      }
      for (const d of docs.values()) if (d.deleted_at) out.push({ item_type: "document", id: d.id, title: d.title, kind: null, area_id: null, deleted_at: d.deleted_at, children: 0, path: "" });
      for (const x of learning.extra.trashItems()) out.push({ ...x, children: 0, path: "" });
      return out.sort((a, b) => b.deleted_at.localeCompare(a.deleted_at));
    },
    async trashRestore(t, id) {
      if (t !== "node" && t !== "document") return learning.extra.restore(t, id);
      if (t === "document") {
        docs.get(id)!.deleted_at = null;
        return;
      }
      const ts = getNode(id).deleted_at;
      for (const s of subtree(id)) {
        const n = getNode(s);
        if (n.deleted_at === ts) n.deleted_at = null;
      }
    },
    async trashPurge(t, id) {
      if (t !== "node" && t !== "document") return learning.extra.purge(t, id);
      if (t === "document") docs.delete(id);
      else for (const s of subtree(id)) nodes.delete(s);
    },

    async backupSettings() {
      return {
        dir: (settings["backup.dir"] as string) ?? "(Browser-Vorschau)",
        second_dir: (settings["backup.second_dir"] as string) ?? null,
        auto_enabled: Boolean(settings["backup.auto_enabled"]),
        keep: Number(settings["backup.keep"] ?? 14),
        last_auto: null,
      };
    },
    async backupCreate() {
      throw err("unsupported", "Backups sind in der Browser-Vorschau nicht verfügbar. In der Desktop-App funktionieren sie.");
    },
    async backupVerify() {
      throw err("unsupported", "In der Browser-Vorschau nicht verfügbar.");
    },
    async backupRestore() {
      throw err("unsupported", "In der Browser-Vorschau nicht verfügbar.");
    },
    async backupHistory() {
      return backups;
    },

    async exportWrite() {
      throw err("unsupported", "Export ist in der Browser-Vorschau nicht verfügbar.");
    },
    async readExternalFile() {
      throw err("unsupported", "In der Browser-Vorschau nicht verfügbar.");
    },
    async openUrl(url) {
      window.open(url, "_blank", "noopener");
    },
    async revealPath() {},
    async pickFiles() {
      return null;
    },
    async pickDirectory() {
      return null;
    },
    async pickSavePath() {
      return null;
    },
    onFileDrop() {
      return () => {};
    },
  };
  if (seed) void seed(b);
  return b;
}
