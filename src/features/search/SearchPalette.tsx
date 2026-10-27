import { BookOpenText, FileText, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { api } from "../../api";
import type { LegalHit, SearchHit } from "../../api/types";
import { findNormCitations, normKey } from "../../ai/norms";
import { NormPopover } from "../editor/NormPopover";
import type { NormRef } from "../editor/normLinks";
import { highlightHtml, stripHighlight } from "../../lib/format";
import { areaById, useApp, type View } from "../../state/store";
import { AreaDot } from "../../ui/misc";
import { KindIcon } from "../navigation/icons";

const GROUP_LABEL: Record<string, string> = {
  note: "Notizen",
  knowledge: "Definitionen, Schemata, Fälle, Normen",
  node: "Studienstruktur",
  document: "Dokumente",
  page: "Fundstellen in Dokumenten",
  annotation: "Markierungen in Dokumenten",
  card: "Karteikarten",
  task: "Aufgaben und Fragen",
  exam: "Prüfungen",
};

export function hitToView(h: SearchHit): View {
  switch (h.entity_type) {
    case "note":
      return { type: "note", id: h.entity_id };
    case "node":
      return { type: "node", id: h.entity_id };
    case "document":
      return { type: "document", id: h.entity_id };
    case "page":
      return { type: "document", id: h.entity_id, page: h.page ?? 1 };
    case "annotation":
      return { type: "document", id: h.target_id ?? h.entity_id, page: h.page ?? 1 };
    case "knowledge":
      return { type: "knowledge", id: h.entity_id };
    case "card":
      return { type: "cards", id: h.entity_id };
    case "task":
    case "exam":
      return { type: "planning" };
  }
}

/**
 * „§ 34“, „§34 BGB“, „Art. 1 GG“: Wortlaut aus den importierten Gesetzen.
 * Ohne Gesetzesangabe werden alle importierten Gesetze durchsucht.
 */
export async function lawHitsFor(q: string): Promise<{ ref: NormRef; hits: LegalHit[] }[]> {
  const c = findNormCitations(q.trim())[0];
  if (!c) return [];
  const laws = c.law ? [c.law] : (await api.legalSourcesList()).filter((s) => s.kind === "gesetz").map((s) => s.abbreviation);
  const out: { ref: NormRef; hits: LegalHit[] }[] = [];
  for (const law of laws.slice(0, 20)) {
    const hits = await api.legalNorm(law, normKey(c), null).catch(() => [] as LegalHit[]);
    if (hits.length) out.push({ ref: { law: hits[0]!.abbreviation || law, norm: normKey(c), absatz: c.absatz, label: `${normKey(c)} ${hits[0]!.abbreviation || law}` }, hits });
  }
  return out;
}

/** Ergebnisse gruppieren, Reihenfolge der Gruppen fest. */
function orderHits(hits: SearchHit[]): SearchHit[] {
  const groups = ["note", "knowledge", "node", "page", "annotation", "document", "card", "task", "exam"] as const;
  return groups.flatMap((g) => hits.filter((h) => h.entity_type === g));
}

export function SearchPalette() {
  const open = useApp((s) => s.paletteOpen);
  const setOpen = useApp((s) => s.setPalette);
  if (!open) return null;
  return <Palette onClose={() => setOpen(false)} />;
}

function Palette({ onClose }: { onClose: () => void }) {
  const areaId = useApp((s) => s.areaId);
  const areas = useApp((s) => s.areas);
  const recent = useApp((s) => s.recent);
  const openView = useApp((s) => s.open);
  const [q, setQ] = useState("");
  const [scopeAll, setScopeAll] = useState(areaId === "all");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [sel, setSel] = useState(0);
  const [busy, setBusy] = useState(false);
  const [laws, setLaws] = useState<{ ref: NormRef; hits: LegalHit[] }[]>([]);
  const [normPop, setNormPop] = useState<{ ref: NormRef; rect: DOMRect } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  /** Enter wurde gedrückt, bevor Ergebnisse da waren: ersten Treffer dann öffnen. */
  const pendingEnter = useRef<string | null>(null);
  const resultsFor = useRef("");
  const areaName = areas.find((a) => a.id === areaId)?.name;

  useEffect(() => {
    let alive = true;
    if (!q.trim()) {
      setHits([]);
      setLaws([]);
      return;
    }
    void lawHitsFor(q).then((l) => alive && setLaws(l));
    setBusy(true);
    const t = setTimeout(async () => {
      const res = await api.search(q, scopeAll || areaId === "all" ? null : areaId).catch(() => []);
      if (alive) {
        setHits(res);
        setSel(0);
        setBusy(false);
        resultsFor.current = q;
        if (pendingEnter.current === q) {
          pendingEnter.current = null;
          const first = orderHits(res)[0];
          if (first) choose(first);
        }
      }
    }, 100);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q, scopeAll, areaId]);

  const ordered = useMemo(() => orderHits(hits), [hits]);

  const choose = (h: SearchHit) => {
    onClose();
    openView(hitToView(h), { title: stripHighlight(h.title) });
  };

  useEffect(() => {
    listRef.current?.querySelector(".is-sel")?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  let lastGroup = "";
  return (
    <div className="overlay overlay-top" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-label="Suche">
        <div className="palette-input">
          <Search size={18} className="muted" />
          <input
            autoFocus
            placeholder="Notizen, Dokumente, PDF-Text und Gesetze (z. B. § 34 BGB) durchsuchen …"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              else if (e.key === "ArrowDown") setSel((s) => Math.min(s + 1, Math.max(0, (q ? ordered.length : recent.length) - 1)));
              else if (e.key === "ArrowUp") setSel((s) => Math.max(0, s - 1));
              else if (e.key === "Enter") {
                if (q && resultsFor.current !== q) pendingEnter.current = q;
                else if (q && ordered[sel]) choose(ordered[sel]);
                else if (!q && recent[sel]) {
                  onClose();
                  openView(recent[sel].view);
                }
              } else return;
              e.preventDefault();
            }}
          />
          {areaId !== "all" && (
            <button className={`scope-toggle ${scopeAll ? "" : "is-active"}`} onClick={() => setScopeAll(!scopeAll)} title="Suchbereich umschalten">
              {scopeAll ? "Alle Bereiche" : areaName}
            </button>
          )}
        </div>
        <div className="palette-list" ref={listRef}>
          {!q &&
            (recent.length ? (
              <>
                <div className="palette-group label">Zuletzt geöffnet</div>
                {recent.map((r, i) => (
                  <button
                    key={r.key}
                    className={`palette-item ${i === sel ? "is-sel" : ""}`}
                    onMouseEnter={() => setSel(i)}
                    onClick={() => {
                      onClose();
                      openView(r.view);
                    }}
                  >
                    <span className="palette-icon">{r.view.type === "note" ? <KindIcon kind="note" /> : r.view.type === "document" ? <FileText size={15} /> : <KindIcon kind="folder" />}</span>
                    <span className="grow ellipsis">{r.title}</span>
                  </button>
                ))}
              </>
            ) : (
              <div className="palette-empty muted small">Tippe, um zu suchen. Gesucht wird lokal in Titeln, Notiztexten, Dozenten/Orten und dem Text importierter Dokumente.</div>
            ))}
          {laws.length > 0 && <div className="palette-group label">Gesetze</div>}
          {laws.map((l) => {
            const heading = l.hits.find((h) => h.heading)?.heading?.split(" – ")[0];
            return (
              <button key={l.ref.label} className="palette-item" onClick={(e) => setNormPop({ ref: l.ref, rect: e.currentTarget.getBoundingClientRect() })}>
                <span className="palette-icon">
                  <BookOpenText size={15} />
                </span>
                <span className="grow" style={{ minWidth: 0 }}>
                  <span className="palette-title ellipsis">
                    {l.ref.label}
                    {heading ? ` – ${heading}` : ""}
                  </span>
                  <span className="palette-snippet">{l.hits[0]!.text.slice(0, 160)}</span>
                  <span className="palette-path xs muted ellipsis">{l.hits[0]!.title}</span>
                </span>
              </button>
            );
          })}
          {q && !busy && ordered.length === 0 && laws.length === 0 && <div className="palette-empty muted small">Keine Treffer für „{q}“.</div>}
          {ordered.map((h, i) => {
            const header = h.entity_type !== lastGroup ? GROUP_LABEL[h.entity_type] : null;
            lastGroup = h.entity_type;
            const area = areaById(h.area_id);
            return (
              <div key={`${h.entity_type}:${h.entity_id}:${h.page ?? ""}`}>
                {header && <div className="palette-group label">{header}</div>}
                <button className={`palette-item ${i === sel ? "is-sel" : ""}`} onMouseEnter={() => setSel(i)} onClick={() => choose(h)}>
                  <span className="palette-icon">{h.kind ? <KindIcon kind={h.kind} /> : <FileText size={15} />}</span>
                  <span className="grow" style={{ minWidth: 0 }}>
                    <span className="row">
                      <span className="palette-title ellipsis" dangerouslySetInnerHTML={{ __html: highlightHtml(h.title) }} />
                      {h.page && <span className="pill tnum">S. {h.page}</span>}
                    </span>
                    {h.snippet && h.entity_type !== "document" && <span className="palette-snippet" dangerouslySetInnerHTML={{ __html: highlightHtml(h.snippet) }} />}
                    <span className="palette-path xs muted ellipsis">
                      {area && <AreaDot color={area.color} size={6} />} {h.path}
                    </span>
                  </span>
                </button>
              </div>
            );
          })}
        </div>
        {normPop && <NormPopover refInfo={normPop.ref} anchor={normPop.rect} onClose={() => setNormPop(null)} />}
        <div className="palette-foot xs muted">
          <span>↑↓ auswählen</span>
          <span>↵ öffnen</span>
          <span>Esc schließen</span>
        </div>
      </div>
    </div>
  );
}
