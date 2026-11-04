/**
 * Erklärungen: alle Einträge aus „Begriffe & Erklärungen“ aller Mitschriften,
 * automatisch gesammelt, A–Z mit Suche. Antippen der Quelle öffnet die
 * Mitschrift am Eintrag; „Ins Glossar“ übernimmt einen Begriff als Definition.
 */
import { BookOpenCheck, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { api } from "../../api";
import type { Knowledge } from "../../api/types";
import { explanationsOf, sameTerm } from "../../lib/erklaerungen";
import { parseDoc } from "../../lib/pm";
import { reportError, useApp } from "../../state/store";
import { Button } from "../../ui/Button";
import { requestEntryJump } from "../editor/erklaerungen";
import { letterOf } from "./GlossaryView";

interface Source {
  noteId: string;
  noteTitle: string;
  areaId: string;
  text: string;
}
interface Group {
  term: string;
  sources: Source[];
}

const collator = new Intl.Collator("de", { sensitivity: "base", numeric: true });

/** Einträge aller Mitschriften laden und nach Begriff zusammenfassen. */
async function collect(notes: { id: string; title: string; area_id: string }[]): Promise<Group[]> {
  const groups: Group[] = [];
  for (let i = 0; i < notes.length; i += 20) {
    const batch = await Promise.all(notes.slice(i, i + 20).map((n) => api.noteGet(n.id).then((d) => ({ n, d }), () => null)));
    for (const r of batch) {
      if (!r) continue;
      for (const e of explanationsOf(parseDoc(r.d.content_json))) {
        const g = groups.find((x) => sameTerm(x.term, e.term));
        const src = { noteId: r.n.id, noteTitle: r.n.title, areaId: r.n.area_id, text: e.text };
        if (g) g.sources.push(src);
        else groups.push({ term: e.term, sources: [src] });
      }
    }
  }
  return groups.sort((a, b) => collator.compare(a.term, b.term));
}

export function ExplanationsView() {
  const nodes = useApp((s) => s.nodes);
  const areaId = useApp((s) => s.areaId);
  const dataVersion = useApp((s) => s.dataVersion);
  const open = useApp((s) => s.open);
  const toast = useApp((s) => s.toast);
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [glossary, setGlossary] = useState<Knowledge[]>([]);
  const [q, setQ] = useState("");
  const notes = useMemo(() => nodes.filter((n) => n.kind === "note" && !n.deleted_at && (areaId === "all" || n.area_id === areaId)), [nodes, areaId]);

  useEffect(() => {
    let alive = true;
    void collect(notes).then((g) => alive && setGroups(g), reportError);
    void api.knowledgeList({ type: "definition" }).then((k) => alive && setGlossary(k), () => {});
    return () => {
      alive = false;
    };
  }, [notes, dataVersion]);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (groups ?? []).filter((g) => !t || g.term.toLowerCase().includes(t) || g.sources.some((s) => s.text.toLowerCase().includes(t)));
  }, [groups, q]);
  const byLetter = useMemo(() => {
    const m = new Map<string, Group[]>();
    for (const g of shown) m.set(letterOf(g.term), [...(m.get(letterOf(g.term)) ?? []), g]);
    return [...m.entries()];
  }, [shown]);

  const toGlossary = async (g: Group) => {
    const s = g.sources[0]!;
    try {
      const k = await api.knowledgeCreate({
        type: "definition",
        area_id: s.areaId,
        node_id: s.noteId,
        title: g.term,
        field: "",
        data: { text: g.sources.map((x) => x.text).filter(Boolean).join("\n\n"), source: `Mitschrift „${s.noteTitle}“`, citation: "", example: "", notes: "" },
      });
      setGlossary([...glossary, k]);
      toast(`„${g.term}“ steht jetzt im Glossar.`, "success");
    } catch (e) {
      reportError(e);
    }
  };

  return (
    <div className="page explanations-page">
      <header className="page-head">
        <div className="small muted">Wissen</div>
        <h1 className="page-title-static">Erklärungen</h1>
        <p className="small muted">
          Automatisch gesammelt aus dem Bereich „Begriffe & Erklärungen“ unten in deinen Mitschriften. Neue Einträge: im Text einen Begriff markieren und in der Werkzeugleiste
          „Begriff erklären“ tippen.
        </p>
        <label className="slide-search" style={{ maxWidth: 420 }}>
          <Search size={14} />
          <input placeholder="Begriff oder Erklärung suchen" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Erklärungen durchsuchen" />
        </label>
      </header>
      {groups === null ? (
        <div className="loading">Sammle Erklärungen …</div>
      ) : !groups.length ? (
        <p className="small muted">Noch keine Erklärungen. Sie erscheinen hier, sobald eine Mitschrift einen Bereich „Begriffe & Erklärungen“ mit Einträgen hat.</p>
      ) : (
        <div className="explanations">
          {byLetter.map(([L, items]) => (
            <section key={L} className="explanations-letter">
              <h2 className="label">{L}</h2>
              {items.map((g) => {
                const inGlossary = glossary.some((k) => sameTerm(k.title, g.term));
                return (
                  <article key={g.term} className="explanation" role="listitem">
                    <div className="row">
                      <strong className="grow">{g.term}</strong>
                      {inGlossary ? (
                        <span className="chip xs">im Glossar</span>
                      ) : (
                        <Button size="sm" variant="ghost" icon={<BookOpenCheck size={13} />} onClick={() => void toGlossary(g)}>
                          Ins Glossar
                        </Button>
                      )}
                    </div>
                    {g.sources.map((s, i) => (
                      <div key={i} className="explanation-src">
                        {s.text ? <p>{s.text}</p> : <p className="muted small">(noch ohne Erklärung)</p>}
                        <button
                          className="link-btn xs"
                          onClick={() => {
                            requestEntryJump(s.noteId, g.term);
                            open({ type: "note", id: s.noteId }, { title: s.noteTitle });
                          }}
                        >
                          aus „{s.noteTitle}“
                        </button>
                      </div>
                    ))}
                  </article>
                );
              })}
            </section>
          ))}
          {!shown.length && <p className="small muted">Nichts gefunden.</p>}
        </div>
      )}
    </div>
  );
}
