import { api } from "../../api";
import type { NodeKind, StudyNode } from "../../api/types";
import { plainText } from "../../lib/pm";
import { templateById } from "../../lib/templates";
import { ancestors } from "../../lib/tree";
import { reportError, useApp, viewId } from "../../state/store";

/** Legt einen Knoten an, lädt den Baum neu und öffnet ihn. */
export async function createNode(opts: {
  areaId: string;
  parentId: string | null;
  kind: NodeKind;
  title: string;
  templateId?: string;
  meta?: Record<string, unknown>;
  contentJson?: string;
  openAfter?: boolean;
}): Promise<StudyNode | null> {
  const st = useApp.getState();
  try {
    let content_json = opts.contentJson;
    let plain_text: string | undefined;
    if (!content_json && opts.kind === "note") {
      const tpl = templateById(opts.templateId ?? "leer");
      if (tpl) {
        const d = tpl.build(opts.title);
        content_json = JSON.stringify(d);
        plain_text = plainText(d);
      }
    }
    const node = await api.nodeCreate({
      area_id: opts.areaId,
      parent_id: opts.parentId,
      kind: opts.kind,
      title: opts.title,
      meta: opts.meta,
      content_json,
      plain_text,
      template: opts.kind === "note" ? opts.templateId : undefined,
    });
    await st.reloadNodes();
    const anc = ancestors(useApp.getState().nodes, node.id);
    st.expandPath(opts.parentId ? [opts.parentId, ...anc] : anc);
    if (opts.openAfter !== false) {
      st.open(node.kind === "note" ? { type: "note", id: node.id } : { type: "node", id: node.id }, { title: node.title });
    }
    return node;
  } catch (e) {
    reportError(e);
    return null;
  }
}

const DEFAULT_TITLE: Record<NodeKind, string> = {
  semester: "Neues Semester",
  module: "Neues Modul",
  course: "Neue Veranstaltung",
  session: "Neuer Vorlesungstermin",
  topic: "Neues Thema",
  folder: "Neuer Ordner",
  note: "Neue Notiz",
};

export function defaultTitle(kind: NodeKind): string {
  return DEFAULT_TITLE[kind];
}

export async function renameNode(id: string, title: string) {
  try {
    await api.nodeUpdate(id, { title });
    await useApp.getState().reloadNodes();
  } catch (e) {
    reportError(e);
  }
}

export async function trashNode(node: StudyNode) {
  const st = useApp.getState();
  try {
    await api.nodeTrash(node.id);
    await st.reloadNodes();
    const vid = viewId(st.view);
    if (vid && (vid === node.id || ancestors(st.nodes, vid).includes(node.id))) st.open({ type: "dashboard" });
    st.toast(`„${node.title}“ liegt jetzt im Papierkorb.`, "info");
  } catch (e) {
    reportError(e);
  }
}

export function openNode(n: Pick<StudyNode, "id" | "kind" | "title">) {
  useApp.getState().open(n.kind === "note" ? { type: "note", id: n.id } : { type: "node", id: n.id }, { title: n.title });
}
