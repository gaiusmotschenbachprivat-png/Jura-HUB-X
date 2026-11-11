/**
 * Kartenbrowser: alle Karten durchsuchen (Suchsprache siehe lib/cardSearch),
 * in der Seitenleiste nach Stapel, Status, Flagge, Kartentyp und Schlagwort
 * filtern, Spalten sortieren, mehrere Karten auswählen und gemeinsam
 * verschieben, verschlagworten, markieren, aussetzen, zurücksetzen oder löschen.
 */
import { ChevronDown, ChevronUp, Filter } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { api } from "../../api";
import type { Card } from "../../api/types";
import { cardQuestion, TEMPLATES, templateDef } from "../../lib/cardModel";
import { compileSearch, type SortKey } from "../../lib/cardSearch";
import { addTag, cardStatus, deckOf, removeTag, SEP, tagList } from "../../lib/decks";
import { formatDate } from "../../lib/format";
import { formatInterval, retrievability } from "../../lib/fsrs";
import { reportError, useApp } from "../../state/store";
import { Button } from "../../ui/Button";
import { confirmDialog, promptDialog } from "../../ui/Dialog";
import { useMenu } from "../../ui/Menu";
import { CardDialog } from "./CardDialog";
import { allDecks, useCollection, useDeckSettings } from "./collection";
import { FLAGS } from "./flags";

const COLS: { key: SortKey; label: string; cls?: string }[] = [
  { key: "frage", label: "Frage" },
  { key: "antwort", label: "Antwort", cls: "col-wide" },
  { key: "stapel", label: "Stapel" },
  { key: "typ", label: "Typ", cls: "col-opt" },
  { key: "faellig", label: "Fällig" },
  { key: "intervall", label: "Intervall", cls: "col-opt" },
  { key: "schwierigkeit", label: "Schwierigk.", cls: "col-opt" },
  { key: "wdh", label: "Wdh.", cls: "col-opt" },
  { key: "fehler", label: "Fehler", cls: "col-opt" },
  { key: "hinzugefuegt", label: "Hinzugefügt", cls: "col-opt" },
];

function sortValue(c: Card, k: SortKey): string | number {
  switch (k) {
    case "frage":
      return cardQuestion(c).toLocaleLowerCase("de");
    case "antwort":
      return c.back.toLocaleLowerCase("de");
    case "stapel":
      return deckOf(c).toLocaleLowerCase("de");
    case "typ":
      return c.template;
    case "faellig":
      return c.state === 0 ? `9${c.created_at}` : `${c.suspended ? 8 : 0}${c.due}`;
    case "intervall":
      return c.scheduled_days;
    case "stabilitaet":
      return c.stability;
    case "schwierigkeit":
      return c.state ? c.difficulty : -1;
    case "wdh":
      return c.reps;
    case "fehler":
      return c.lapses;
    case "hinzugefuegt":
      return c.created_at;
    case "geaendert":
      return c.updated_at;
  }
}

export function CardBrowser({ initialQuery = "", focusId }: { initialQuery?: string; focusId?: string }) {
  const bump = useApp((s) => s.bump);
  const toast = useApp((s) => s.toast);
  const { cards } = useCollection();
  const settings = useDeckSettings();
  const menu = useMenu();
  const [q, setQ] = useState(initialQuery);
  const [query, setQuery] = useState(initialQuery);
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "hinzugefuegt", desc: true });
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<number | null>(null);
  const [edit, setEdit] = useState<Card | null>(null);
  const [side, setSide] = useState(false);
  const [limit, setLimit] = useState(300);
  useEffect(() => {
    setQ(initialQuery);
    setQuery(initialQuery);
  }, [initialQuery]);
  useEffect(() => {
    const t = setTimeout(() => setQuery(q), 200);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    if (focusId && cards) {
      const c = cards.find((x) => x.id === focusId);
      if (c) setEdit(c);
    }
  }, [focusId, cards]);

  const now = useMemo(() => new Date(), [cards]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = useMemo(() => {
    if (!cards) return [];
    const pred = compileSearch(query);
    const list = cards.filter((c) => pred(c, now));
    const dir = sort.desc ? -1 : 1;
    return list.sort((a, b) => {
      const x = sortValue(a, sort.key);
      const y = sortValue(b, sort.key);
      return (x < y ? -1 : x > y ? 1 : 0) * dir;
    });
  }, [cards, query, sort, now]);
  const decks = useMemo(() => allDecks(cards ?? [], settings), [cards, settings]);
  const tags = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of cards ?? []) for (const t of tagList(c.tags)) m.set(t, (m.get(t) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], "de"));
  }, [cards]);
  useEffect(() => setSel((s) => new Set([...s].filter((id) => shown.some((c) => c.id === id)))), [shown]);

  if (!cards) return <div className="loading">Lade Karten …</div>;
  const chosen = shown.filter((c) => sel.has(c.id));
  const setFilter = (f: string) => {
    setQ(f);
    setQuery(f);
    setSide(false);
  };

  const bulk = async (label: string, fn: (c: Card) => Promise<unknown>) => {
    try {
      for (const c of chosen) await fn(c);
      toast(`${label}: ${chosen.length} ${chosen.length === 1 ? "Karte" : "Karten"}.`, "success");
      bump();
    } catch (e) {
      reportError(e);
    }
  };
  const actions = (el: HTMLElement) =>
    menu.openBelow(el, [
      {
        label: "Stapel ändern …",
        onSelect: async () => {
          const d = await promptDialog({ title: "In Stapel verschieben", label: "Stapel", value: deckOf(chosen[0]!), confirm: "Verschieben", hint: "Unterstapel mit „::“" });
          if (d) await bulk("Verschoben", (c) => api.cardUpdate(c.id, { deck: d }));
        },
      },
      {
        label: "Schlagwort hinzufügen …",
        onSelect: async () => {
          const t = await promptDialog({ title: "Schlagwort hinzufügen", label: "Schlagwort", confirm: "Hinzufügen" });
          if (t) await bulk("Schlagwort ergänzt", (c) => api.cardUpdate(c.id, { tags: tagList(t).reduce(addTag, c.tags) }));
        },
      },
      {
        label: "Schlagwort entfernen …",
        onSelect: async () => {
          const t = await promptDialog({ title: "Schlagwort entfernen", label: "Schlagwort", confirm: "Entfernen" });
          if (t) await bulk("Schlagwort entfernt", (c) => api.cardUpdate(c.id, { tags: tagList(t).reduce(removeTag, c.tags) }));
        },
      },
      { separator: true, label: "" },
      ...FLAGS.filter((f) => f.id).map((f) => ({ label: `Flagge ${f.label}`, icon: <span className="flag-dot" style={{ background: f.color }} />, onSelect: () => void bulk(`Flagge ${f.label}`, (c) => api.cardUpdate(c.id, { flag: f.id })) })),
      { label: "Flagge entfernen", onSelect: () => void bulk("Flagge entfernt", (c) => api.cardUpdate(c.id, { flag: 0 })) },
      { separator: true, label: "" },
      chosen.every((c) => c.suspended)
        ? { label: "Fortsetzen", onSelect: () => void bulk("Fortgesetzt", (c) => api.cardUpdate(c.id, { suspended: false })) }
        : { label: "Aussetzen", onSelect: () => void bulk("Ausgesetzt", (c) => api.cardUpdate(c.id, { suspended: true })) },
      { label: "Zurückstellen aufheben", onSelect: () => void bulk("Wieder freigegeben", (c) => api.cardUpdate(c.id, { buried_until: null })) },
      {
        label: "Vergessen (als neu lernen) …",
        onSelect: async () => {
          if (await confirmDialog({ title: "Lernstand zurücksetzen?", message: `${chosen.length} Karten werden wieder zu neuen Karten. Das Protokoll (Statistik) bleibt erhalten.`, confirm: "Zurücksetzen", danger: true }))
            await bulk("Zurückgesetzt", (c) => api.cardUpdate(c.id, { reset: true }));
        },
      },
      { separator: true, label: "" },
      {
        label: "Löschen …",
        danger: true,
        onSelect: async () => {
          if (await confirmDialog({ title: `${chosen.length} Karten löschen?`, message: "Die Karten kommen in den Papierkorb.", confirm: "In den Papierkorb", danger: true }))
            await bulk("In den Papierkorb", (c) => api.cardTrash(c.id));
        },
      },
    ]);

  const click = (i: number, c: Card, e: React.MouseEvent) => {
    if (e.shiftKey && anchor !== null) {
      const [a, b] = [Math.min(anchor, i), Math.max(anchor, i)];
      setSel(new Set([...sel, ...shown.slice(a, b + 1).map((x) => x.id)]));
    } else if (e.metaKey || e.ctrlKey) {
      const s = new Set(sel);
      if (s.has(c.id)) s.delete(c.id);
      else s.add(c.id);
      setSel(s);
      setAnchor(i);
    } else setEdit(c);
  };
  const toggle = (i: number, c: Card) => {
    const s = new Set(sel);
    if (s.has(c.id)) s.delete(c.id);
    else s.add(c.id);
    setSel(s);
    setAnchor(i);
  };

  const SideItem = ({ label, f, count, indent = 0, dot }: { label: string; f: string; count?: number; indent?: number; dot?: string }) => (
    <button className={`browser-side-item ${query === f ? "is-active" : ""}`} style={{ paddingLeft: 8 + indent * 14 }} onClick={() => setFilter(f)}>
      {dot && <span className="flag-dot" style={{ background: dot }} />}
      <span className="grow ellipsis">{label}</span>
      {count !== undefined && <span className="xs muted tnum">{count}</span>}
    </button>
  );
  const nowIso = now.toISOString();
  const by = (p: (c: Card) => boolean) => cards.filter(p).length;

  return (
    <div className={`browser ${side ? "is-side-open" : ""}`}>
      <aside className="browser-side" aria-label="Filter">
        <div className="label">Heute</div>
        <SideItem label="Heute hinzugefügt" f="added:1" />
        <SideItem label="Heute gelernt" f="rated:1" />
        <SideItem label="Jetzt fällig" f="is:due" count={by((c) => !c.suspended && c.state !== 0 && c.due <= nowIso)} />
        <div className="label">Stand</div>
        <SideItem label="Alle Karten" f="" count={cards.length} />
        <SideItem label="Neu" f="is:new" count={by((c) => cardStatus(c, nowIso) === "new")} />
        <SideItem label="Lernen" f="is:learn" count={by((c) => cardStatus(c, nowIso) === "learn")} />
        <SideItem label="Wiederholen" f="is:review" count={by((c) => c.state === 2)} />
        <SideItem label="Ausgesetzt" f="is:suspended" count={by((c) => c.suspended)} />
        <SideItem label="Zurückgestellt" f="is:buried" count={by((c) => cardStatus(c, nowIso) === "buried")} />
        <SideItem label="Problemkarten" f="is:leech" />
        <div className="label">Flaggen</div>
        {FLAGS.filter((f) => f.id).map((f) => (
          <SideItem key={f.id} label={f.label} f={`flag:${f.id}`} dot={f.color} count={by((c) => c.flag === f.id)} />
        ))}
        <div className="label">Stapel</div>
        {decks.map((d) => (
          <SideItem key={d} label={d.split(SEP).at(-1)!} f={`deck:"${d}"`} indent={d.split(SEP).length - 1} />
        ))}
        <div className="label">Kartentypen</div>
        {TEMPLATES.map((t) => (
          <SideItem key={t.id} label={t.label} f={`typ:${t.id}`} count={by((c) => c.template === t.id)} />
        ))}
        {tags.length > 0 && <div className="label">Schlagwörter</div>}
        {tags.map(([t, n]) => (
          <SideItem key={t} label={t} f={`tag:"${t}"`} count={n} />
        ))}
      </aside>
      <div className="browser-main">
        <div className="row wrap browser-bar">
          <Button size="sm" variant="ghost" icon={<Filter size={14} />} className="browser-side-toggle" onClick={() => setSide(!side)}>
            Filter
          </Button>
          <input
            className="grow browser-search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder='Suchen, z. B. Anfechtung  deck:"Zivilrecht"  is:due  tag:Irrtum  flag:1'
            aria-label="Karten durchsuchen"
            autoCapitalize="off"
            spellCheck={false}
          />
          <span className="xs muted tnum">
            {shown.length} {shown.length === 1 ? "Karte" : "Karten"}
            {chosen.length ? ` · ${chosen.length} ausgewählt` : ""}
          </span>
          {chosen.length > 0 && (
            <Button size="sm" variant="primary" onClick={(e) => actions(e.currentTarget)}>
              Aktionen ({chosen.length})
            </Button>
          )}
        </div>
        <div className="browser-table-wrap">
          <table className="browser-table">
            <thead>
              <tr>
                <th className="col-check">
                  <input
                    type="checkbox"
                    aria-label="Alle auswählen"
                    checked={shown.length > 0 && chosen.length === Math.min(shown.length, limit)}
                    onChange={(e) => setSel(e.target.checked ? new Set(shown.slice(0, limit).map((c) => c.id)) : new Set())}
                  />
                </th>
                {COLS.map((c) => (
                  <th key={c.key} className={c.cls} aria-sort={sort.key === c.key ? (sort.desc ? "descending" : "ascending") : "none"}>
                    <button onClick={() => setSort({ key: c.key, desc: sort.key === c.key ? !sort.desc : c.key === "hinzugefuegt" })}>
                      {c.label}
                      {sort.key === c.key && (sort.desc ? <ChevronDown size={12} /> : <ChevronUp size={12} />)}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.slice(0, limit).map((c, i) => {
                const st = cardStatus(c, nowIso);
                const flag = FLAGS.find((f) => f.id === c.flag);
                const r = retrievability(c, now);
                return (
                  <tr
                    key={c.id}
                    className={`${sel.has(c.id) ? "is-selected" : ""} ${c.suspended ? "is-suspended" : ""} ${st === "buried" ? "is-buried" : ""}`}
                    style={c.flag ? { ["--flag" as string]: flag?.color } : undefined}
                    onClick={(e) => click(i, c, e)}
                  >
                    <td className="col-check" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={sel.has(c.id)} onChange={() => toggle(i, c)} aria-label={`Auswählen: ${cardQuestion(c)}`} />
                    </td>
                    <td className="col-q">
                      <span className="ellipsis block">{cardQuestion(c)}</span>
                    </td>
                    <td className="col-wide">
                      <span className="ellipsis block muted">{c.template === "luecke" ? "" : c.back}</span>
                    </td>
                    <td>
                      <span className="ellipsis block">{deckOf(c).split(SEP).at(-1)}</span>
                    </td>
                    <td className="col-opt">{templateDef(c.template).label}</td>
                    <td className="tnum" title={r == null ? undefined : `Abrufwahrscheinlichkeit ${Math.round(r * 100)} %`}>
                      {c.suspended ? "ausgesetzt" : st === "buried" ? "zurückgestellt" : c.state === 0 ? "neu" : formatDate(c.due)}
                    </td>
                    <td className="col-opt tnum">{c.state === 2 ? formatInterval(c.scheduled_days * 864e5) : c.state ? "Lernen" : "–"}</td>
                    <td className="col-opt tnum">{c.state ? `${Math.round(((c.difficulty - 1) / 9) * 100)} %` : "–"}</td>
                    <td className="col-opt tnum">{c.reps}</td>
                    <td className="col-opt tnum">{c.lapses}</td>
                    <td className="col-opt tnum">{formatDate(c.created_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {shown.length > limit && (
            <div className="row" style={{ justifyContent: "center", padding: 10 }}>
              <Button size="sm" onClick={() => setLimit(limit + 500)}>
                Weitere {Math.min(500, shown.length - limit)} anzeigen
              </Button>
            </div>
          )}
          {!shown.length && <p className="small muted" style={{ padding: 12 }}>Keine Karten gefunden.</p>}
        </div>
        <p className="xs muted">Antippen öffnet die Karte zum Bearbeiten. Mehrere auswählen: Kästchen antippen (am Rechner auch ⌘/Strg- bzw. ⇧-Klick).</p>
      </div>
      {edit && <CardDialog card={edit} onClose={() => setEdit(null)} />}
      {menu.el}
    </div>
  );
}
