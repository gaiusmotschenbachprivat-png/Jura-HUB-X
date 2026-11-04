/**
 * Daten der Übersicht: Struktur, Karten, Prüfungen, Aufgaben, Unterlagen und
 * eine Durchsicht der Mitschriften (offene Fragen, fehlende Erklärungen,
 * Lernskript, Aufnahme). Die Durchsicht merkt sich jede Mitschrift bis zu
 * ihrer nächsten Änderung, damit die Übersicht schnell bleibt.
 */
import { useEffect, useMemo, useState } from "react";

import { api } from "../../api";
import type { Card, DocumentInfo, Exam, LinkView, RecentNote, StudyNode, Task } from "../../api/types";
import { hasLernskript, missingExplanations, openQuestionsOf } from "../../lib/dashboard";
import { noteTypeOf, todayIso } from "../../lib/noteTypes";
import { parseDoc, type PMNode } from "../../lib/pm";
import { useApp } from "../../state/store";

export interface NoteScan {
  updated_at: string;
  questions: string[];
  missing: string[];
  lernskript: boolean;
  recording: boolean;
}

const scanCache = new Map<string, NoteScan>();

function scanDoc(doc: PMNode, updated_at: string): NoteScan {
  return {
    updated_at,
    questions: openQuestionsOf(doc),
    missing: missingExplanations(doc),
    lernskript: hasLernskript(doc),
    recording: (doc.content ?? []).some((n) => n.type === "heading" && (n.content ?? []).some((t) => (t.text ?? "").startsWith("Aufnahme ·"))),
  };
}

/** Mitschriften durchsehen (nur neue oder geänderte werden gelesen). */
async function scanNotes(notes: StudyNode[]): Promise<Map<string, NoteScan>> {
  const todo = notes.filter((n) => scanCache.get(n.id)?.updated_at !== n.updated_at);
  for (let i = 0; i < todo.length; i += 20) {
    await Promise.all(
      todo.slice(i, i + 20).map(async (n) => {
        try {
          const note = await api.noteGet(n.id);
          scanCache.set(n.id, scanDoc(parseDoc(note.content_json), n.updated_at));
        } catch {
          /* gelöscht o. Ä. – überspringen */
        }
      }),
    );
  }
  return new Map(notes.flatMap((n) => (scanCache.has(n.id) ? [[n.id, scanCache.get(n.id)!] as const] : [])));
}

export interface DashboardData {
  nodes: StudyNode[];
  cards: Card[];
  exams: Exam[];
  tasks: Task[];
  sheets: DocumentInfo[];
  recent: RecentNote[];
  scans: Map<string, NoteScan>;
  /** Mitschriften, aus denen Karteikarten entstanden sind */
  cardSources: Set<string>;
  loaded: boolean;
}

export function useDashboardData(): DashboardData {
  const areaId = useApp((s) => s.areaId);
  const dataVersion = useApp((s) => s.dataVersion);
  const scope = areaId === "all" ? null : areaId;
  const [d, setD] = useState<Omit<DashboardData, "cardSources" | "loaded">>({ nodes: [], cards: [], exams: [], tasks: [], sheets: [], recent: [], scans: new Map() });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [nodes, cards, exams, tasks, docs, recent] = await Promise.all([
        api.nodesList(null).catch(() => [] as StudyNode[]),
        api.cardsList({ area_id: scope, limit: 20000 }).catch(() => [] as Card[]),
        api.examsList(scope, todayIso()).catch(() => [] as Exam[]),
        api.tasksList({ area_id: scope, include_done: true }).catch(() => [] as Task[]),
        api.documentsList(scope ? { kind: "area", id: scope } : { kind: "all" }).catch(() => [] as DocumentInfo[]),
        api.notesRecent(scope, 6).catch(() => [] as RecentNote[]),
      ]);
      if (!alive) return;
      // Übungsblätter ohne verknüpfte Notiz gelten als unbearbeitet
      const ex = docs.filter((x) => x.doc_type === "uebungsblatt");
      const links = await Promise.all(ex.map((x) => api.linksFor("document", x.id).catch(() => [] as LinkView[])));
      const sheets = ex.filter((_, i) => links[i]!.length === 0).slice(0, 5);
      setD((p) => ({ ...p, nodes, cards, exams, tasks, sheets, recent }));
      setLoaded(true);
      const notes = nodes.filter((n) => n.kind === "note" && !n.deleted_at && (!scope || n.area_id === scope));
      const scans = await scanNotes(notes);
      if (alive) setD((p) => ({ ...p, scans }));
    })();
    return () => {
      alive = false;
    };
  }, [scope, dataVersion]);

  const cardSources = useMemo(() => new Set(d.cards.filter((c) => c.source_type === "node" && c.source_id).map((c) => c.source_id!)), [d.cards]);
  return { ...d, cardSources, loaded };
}

/** Mitschriften einer Art im aktuellen Bereich. */
export const notesOfType = (nodes: StudyNode[], scope: string | null, type: string) =>
  nodes.filter((n) => n.kind === "note" && !n.deleted_at && !n.archived_at && (!scope || n.area_id === scope) && noteTypeOf(n) === type);
