/**
 * Zum Wiederholen: alle Einträge aus den Bereichen „Zum Wiederholen“ aller
 * Mitschriften an einem Ort – nach Veranstaltung und Vorlesung geordnet, mit
 * Suche und Filter. Antippen öffnet die Mitschrift an der Stelle. Gelesen
 * wird nur, was sich seit dem letzten Mal geändert hat.
 */
import { CheckSquare, Copy, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { api } from "../../api";
import type { StudyNode } from "../../api/types";
import { formatDateDe } from "../../lib/noteTypes";
import { parseDoc } from "../../lib/pm";
import { reviewItemsOf, reviewListText, type ReviewItem } from "../../lib/wiederholen";
import { reportError, useApp } from "../../state/store";
import { Button } from "../../ui/Button";
import { requestTextJump } from "../editor/pending";
import { noteStamp } from "../editor/saveQueue";

const cache = new Map<string, { updated_at: string; items: ReviewItem[] }>();

async function scan(notes: StudyNode[]): Promise<Map<string, ReviewItem[]>> {
  const todo = notes.filter((n) => cache.get(n.id)?.updated_at !== noteStamp(n));
  for (let i = 0; i < todo.length; i += 20) {
    await Promise.all(
      todo.slice(i, i + 20).map(async (n) => {
        try {
          const d = await api.noteGet(n.id);
          cache.set(n.id, { updated_at: noteStamp(n), items: reviewItemsOf(parseDoc(d.content_json)) });
        } catch {
          /* gelöscht o. Ä. */
        }
      }),
    );
  }
  return new Map(notes.flatMap((n) => (cache.get(n.id)?.items.length ? [[n.id, cache.get(n.id)!.items] as const] : [])));
}

interface NoteGroup {
  note: StudyNode;
  items: ReviewItem[];
}
interface CourseGroup {
  key: string;
  title: string;
  notes: NoteGroup[];
}

const collator = new Intl.Collator("de", { numeric: true, sensitivity: "base" });
const dateOf = (n: StudyNode) => (typeof n.meta?.date === "string" ? n.meta.date : "");

export function ReviewView() {
  const nodes = useApp((s) => s.nodes);
  const areaId = useApp((s) => s.areaId);
  const dataVersion = useApp((s) => s.dataVersion);
  const open = useApp((s) => s.open);
  const toast = useApp((s) => s.toast);
  const [found, setFound] = useState<Map<string, ReviewItem[]> | null>(null);
  const [q, setQ] = useState("");
  const [course, setCourse] = useState("");
  const [hideDone, setHideDone] = useState(false);
  const notes = useMemo(() => nodes.filter((n) => n.kind === "note" && !n.deleted_at && (areaId === "all" || n.area_id === areaId)), [nodes, areaId]);

  useEffect(() => {
    let alive = true;
    void scan(notes).then((m) => alive && setFound(m), reportError);
    return () => {
      alive = false;
    };
  }, [notes, dataVersion]);

  /** Veranstaltung (bzw. oberster Ordner) einer Mitschrift */
  const courseOf = useMemo(() => {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    return (n: StudyNode): StudyNode | null => {
      let top: StudyNode | null = null;
      for (let p = n.parent_id ? byId.get(n.parent_id) : undefined; p; p = p.parent_id ? byId.get(p.parent_id) : undefined) {
        if (p.kind === "course") return p;
        if (p.kind !== "semester") top = p;
      }
      return top;
    };
  }, [nodes]);

  const all = useMemo(() => {
    const m = new Map<string, CourseGroup>();
    for (const n of notes) {
      const items = found?.get(n.id);
      if (!items) continue;
      const c = courseOf(n);
      const key = c?.id ?? "";
      const g = m.get(key) ?? { key, title: c?.title ?? "Ohne Veranstaltung", notes: [] };
      g.notes.push({ note: n, items });
      m.set(key, g);
    }
    const groups = [...m.values()];
    for (const g of groups) g.notes.sort((a, b) => dateOf(a.note).localeCompare(dateOf(b.note)) || collator.compare(a.note.title, b.note.title));
    return groups.sort((a, b) => (a.key ? 0 : 1) - (b.key ? 0 : 1) || collator.compare(a.title, b.title));
  }, [notes, found, courseOf]);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return all
      .filter((g) => !course || g.key === course)
      .map((g) => ({
        ...g,
        notes: g.notes
          .map((ng) => ({ ...ng, items: ng.items.filter((i) => (!hideDone || !i.done) && (!t || i.text.toLowerCase().includes(t) || ng.note.title.toLowerCase().includes(t))) }))
          .filter((ng) => ng.items.length),
      }))
      .filter((g) => g.notes.length);
  }, [all, q, course, hideDone]);

  const total = all.reduce((s, g) => s + g.notes.reduce((x, n) => x + n.items.length, 0), 0);
  const count = shown.reduce((s, g) => s + g.notes.reduce((x, n) => x + n.items.length, 0), 0);
  const hasDone = all.some((g) => g.notes.some((n) => n.items.some((i) => i.done)));

  const jump = (n: StudyNode, text: string) => {
    requestTextJump(n.id, text);
    open({ type: "note", id: n.id }, { title: n.title });
  };
  const copy = async () => {
    const text = shown.map((g) => `${g.title}\n\n${reviewListText(g.notes.map((n) => ({ title: n.note.title, items: n.items })))}`).join("\n\n\n");
    try {
      await navigator.clipboard.writeText(text);
      toast(`${count} Einträge kopiert.`, "success");
    } catch (e) {
      reportError(e);
    }
  };

  return (
    <div className="page review-page">
      <header className="page-head">
        <div className="small muted">Wissen</div>
        <h1 className="page-title-static">Zum Wiederholen</h1>
        <p className="small muted">
          Automatisch gesammelt aus dem Bereich „Zum Wiederholen“ deiner Mitschriften – jeder Listenpunkt ist ein Eintrag. Neue Einträge schreibst du einfach in der Mitschrift
          dazu; Checklisten-Punkte, die du dort abhakst, gelten hier als erledigt.
        </p>
        <div className="row wrap review-filters">
          <label className="slide-search grow" style={{ maxWidth: 420 }}>
            <Search size={14} />
            <input placeholder="Einträge durchsuchen" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Einträge zum Wiederholen durchsuchen" />
          </label>
          <select value={course} onChange={(e) => setCourse(e.target.value)} aria-label="Veranstaltung">
            <option value="">Alle Veranstaltungen</option>
            {all.map((g) => (
              <option key={g.key} value={g.key}>
                {g.title}
              </option>
            ))}
          </select>
          {hasDone && (
            <label className="row small" style={{ gap: 6 }}>
              <input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} />
              Erledigte ausblenden
            </label>
          )}
          {count > 0 && (
            <Button size="sm" variant="ghost" icon={<Copy size={13} />} onClick={() => void copy()}>
              Liste kopieren
            </Button>
          )}
        </div>
        {found && total > 0 && (
          <p className="xs muted tnum" aria-live="polite">
            {count === total ? `${total} Einträge` : `${count} von ${total} Einträgen`} aus {all.reduce((s, g) => s + g.notes.length, 0)} Mitschriften
          </p>
        )}
      </header>
      {found === null ? (
        <div className="loading">Sammle Einträge …</div>
      ) : !total ? (
        <p className="small muted">
          Noch nichts zum Wiederholen. Einträge erscheinen hier, sobald eine Mitschrift unter der Überschrift „Zum Wiederholen“ Punkte enthält (Vorlesungsmitschriften haben
          den Bereich schon).
        </p>
      ) : (
        <div className="review-list" role="list" aria-label="Einträge zum Wiederholen">
          {shown.map((g) => (
            <section key={g.key} className="review-course" aria-label={g.title}>
              <h2 className="label">{g.title}</h2>
              {g.notes.map(({ note, items }) => (
                <article key={note.id} className="review-note">
                  <button className="review-note-title link-btn" onClick={() => open({ type: "note", id: note.id }, { title: note.title })}>
                    <strong>{note.title}</strong>
                    {dateOf(note) && <span className="xs muted"> · {formatDateDe(dateOf(note), true)}</span>}
                  </button>
                  <ul className="review-items">
                    {items.map((it, i) => (
                      <li key={i} role="listitem" className={`review-item ${it.done ? "is-done" : ""}`} style={{ paddingLeft: 4 + it.depth * 18 }}>
                        <button className="review-item-btn" onClick={() => jump(note, it.text)} title="In der Mitschrift zeigen">
                          {it.done ? <CheckSquare size={13} className="review-check" aria-label="erledigt" /> : <span className="review-dot" aria-hidden />}
                          <span>{it.text}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </section>
          ))}
          {!shown.length && <p className="small muted">Nichts gefunden.</p>}
        </div>
      )}
    </div>
  );
}
