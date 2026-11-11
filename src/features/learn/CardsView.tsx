/**
 * Karteikarten: Stapelübersicht (Neu / Lernen / Fällig je Stapel mit
 * Unterstapeln), Stapelansicht mit „Jetzt lernen“, Kartenbrowser und
 * Statistiken – aufgebaut wie ein klassisches Lernkartei-Programm.
 */
import { BarChart3, ChevronDown, ChevronRight, FolderPlus, GraduationCap, Layers, MoreHorizontal, Plus, Search, Settings2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { api } from "../../api";
import type { Card, CardStats } from "../../api/types";
import { buildDeckTree, cardStatus, DEFAULT_DECK, deckOf, flattenTree, inDeck, SEP, tagList, todayUsage, type CustomStudy, type DeckNode } from "../../lib/decks";
import { formatInterval, startOfToday } from "../../lib/fsrs";
import { reportError, useApp } from "../../state/store";
import { Button, IconButton } from "../../ui/Button";
import { confirmDialog, Dialog, promptDialog } from "../../ui/Dialog";
import { useMenu } from "../../ui/Menu";
import { EmptyState, Field } from "../../ui/misc";
import { CardBrowser } from "./CardBrowser";
import { CardDialog } from "./CardDialog";
import { addDeck, deckForNode, deleteDeck, renameDeck, saveDeckSettings, sortIntoCourseDecks, useCollection, useDeckSettings } from "./collection";
import { CardStatsView } from "./CardStatsView";
import { DeckOptionsDialog } from "./DeckOptions";
import { FLAGS } from "./flags";
import { BadgePermission, FachProgress, SchemaPractice } from "./LearnOverview";

export function useCardStats() {
  const areaId = useApp((s) => s.areaId);
  const dataVersion = useApp((s) => s.dataVersion);
  const [stats, setStats] = useState<CardStats | null>(null);
  useEffect(() => {
    api
      .cardStats(areaId === "all" ? null : areaId, startOfToday())
      .then(setStats)
      .catch(() => {});
  }, [areaId, dataVersion]);
  return stats;
}

type Tab = "stapel" | "browser" | "statistik";

export function CardsView({ focusId, deck, tab: initialTab, q }: { focusId?: string; deck?: string; tab?: Tab; q?: string }) {
  const open = useApp((s) => s.open);
  const [tab, setTab] = useState<Tab>(initialTab ?? (focusId ? "browser" : "stapel"));
  const [add, setAdd] = useState<string | null>(null);
  useEffect(() => setTab(initialTab ?? (focusId ? "browser" : "stapel")), [initialTab, focusId]);
  return (
    <div className={`page cards-page ${tab === "browser" ? "is-wide" : ""}`}>
      <header className="page-head">
        <div className="small muted">Lernen</div>
        <div className="row wrap">
          <h1 className="page-title-static grow">Karteikarten</h1>
          <Button variant="primary" icon={<Plus size={15} />} onClick={() => setAdd(deck ?? "")}>
            Hinzufügen
          </Button>
        </div>
        <div className="seg cards-tabs" role="tablist" aria-label="Karteikarten">
          {(
            [
              ["stapel", "Stapel", <Layers key="s" size={14} />],
              ["browser", "Durchsuchen", <Search key="b" size={14} />],
              ["statistik", "Statistik", <BarChart3 key="t" size={14} />],
            ] as const
          ).map(([id, label, icon]) => (
            <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "is-active" : ""} onClick={() => {
                setTab(id);
                // aus einer Suche bzw. Statistik-Verknüpfung zurück zur Stapelübersicht
                if (id === "stapel" && (initialTab || focusId)) open({ type: "cards", deck });
              }}
            >
              {icon} {label}
            </button>
          ))}
        </div>
      </header>
      {tab === "stapel" && (deck ? <DeckScreen deck={deck} onAdd={() => setAdd(deck)} /> : <DeckList />)}
      {tab === "browser" && <CardBrowser initialQuery={q ?? (deck ? `deck:"${deck}"` : "")} focusId={focusId} />}
      {tab === "statistik" && (
        <>
          <CardStatsView deck={deck} />
          <FachSection />
        </>
      )}
      {add !== null && <CardDialog deck={add || undefined} onClose={() => setAdd(null)} />}
    </div>
  );
}

/** Lernstand je Veranstaltung (aus dem Mitschrift-Bezug der Karten) */
function FachSection() {
  const { cards } = useCollection();
  return cards && cards.length ? <FachProgress cards={cards} /> : null;
}

// ---------- Stapelliste ----------

function DeckList() {
  const open = useApp((s) => s.open);
  const nodes = useApp((s) => s.nodes);
  const toast = useApp((s) => s.toast);
  const bump = useApp((s) => s.bump);
  const { cards, log } = useCollection();
  const settings = useDeckSettings();
  const menu = useMenu();
  const [options, setOptions] = useState<string | null>(null);
  const [custom, setCustom] = useState<string | null>(null);
  const tree = useMemo(() => {
    if (!cards || !settings) return null;
    const map = new Map(cards.map((c) => [c.id, c]));
    return buildDeckTree(cards, settings, new Date(), todayUsage(log, map, startOfToday()));
  }, [cards, settings, log]);
  const collapsed = useMemo(() => new Set(settings?.collapsed ?? []), [settings]);
  if (!tree || !cards || !settings) return <div className="loading">Lade Stapel …</div>;

  const toggle = (p: string) => void saveDeckSettings({ ...settings, collapsed: collapsed.has(p) ? settings.collapsed.filter((x) => x !== p) : [...settings.collapsed, p] }).catch(reportError);
  const rows = flattenTree(tree, collapsed);
  const total = tree.reduce((s, n) => ({ new: s.new + n.counts.new, learn: s.learn + n.counts.learn, review: s.review + n.counts.review }), { new: 0, learn: 0, review: 0 });
  const studied = log.length;
  const ms = log.reduce((s, l) => s + l.duration_ms, 0);

  const createDeck = async (parent?: string) => {
    const name = await promptDialog({ title: parent ? "Unterstapel anlegen" : "Stapel erstellen", label: "Name", confirm: "Erstellen", value: parent ? `${parent}${SEP}` : "", hint: "Unterstapel mit „::“, z. B. Zivilrecht::BGB AT::Willenserklärung" });
    if (name) await addDeck(name).catch(reportError);
  };
  const deckMenu = (el: HTMLElement, n: DeckNode) =>
    menu.openBelow(el, [
      { label: "Lernen", onSelect: () => open({ type: "learn", deck: n.path }) },
      { label: "Benutzerdefiniert lernen …", onSelect: () => setCustom(n.path) },
      { label: "Karten durchsuchen", onSelect: () => open({ type: "cards", tab: "browser", q: `deck:"${n.path}"` }) },
      { separator: true, label: "" },
      { label: "Optionen …", onSelect: () => setOptions(n.path) },
      { label: "Unterstapel anlegen …", onSelect: () => void createDeck(n.path) },
      ...(n.path !== DEFAULT_DECK ? [{ label: "Umbenennen / verschieben …", onSelect: () => void rename(n.path, cards) }] : []),
      { separator: true, label: "" },
      { label: "Stapel löschen …", danger: true, onSelect: () => void remove(n, cards) },
    ]);

  const unsorted = cards.filter((c) => !c.deck && deckForNode(nodes, c.node_id));
  return (
    <>
      {unsorted.length > 0 && (
        <div className="notice deck-sort-hint row wrap">
          <span className="grow small">
            {unsorted.length} {unsorted.length === 1 ? "Karte stammt" : "Karten stammen"} aus Mitschriften und {unsorted.length === 1 ? "liegt" : "liegen"} noch im Stapel „{DEFAULT_DECK}“.
          </span>
          <Button
            size="sm"
            onClick={() =>
              void sortIntoCourseDecks(unsorted, nodes).then((n) => {
                toast(`${n} Karten nach Veranstaltung einsortiert.`, "success");
                bump();
              }, reportError)
            }
          >
            Nach Veranstaltung einsortieren
          </Button>
        </div>
      )}
      {!cards.length && !settings.decks.length ? (
        <EmptyState
          title="Noch keine Karteikarten"
          action={
            <div className="row" style={{ justifyContent: "center" }}>
              <Button variant="primary" onClick={() => void createDeck()}>
                Ersten Stapel erstellen
              </Button>
            </div>
          }
        >
          Lege Stapel nach Rechtsgebiet an (z. B. „Zivilrecht::BGB AT“) und erfasse dort Definitionen, Prüfungsschemata und Begriffe. Karten entstehen auch aus dem Glossar, aus
          Schemata und aus markiertem Text in Mitschriften.
        </EmptyState>
      ) : (
        <div className="deck-table" role="table" aria-label="Stapel">
          <div className="deck-row deck-head" role="row">
            <span role="columnheader" className="grow">
              Stapel
            </span>
            <span role="columnheader" className="cnt-new">
              Neu
            </span>
            <span role="columnheader" className="cnt-learn">
              Lernen
            </span>
            <span role="columnheader" className="cnt-review">
              Fällig
            </span>
            <span className="deck-gear" />
          </div>
          {rows.map((n) => (
            <div key={n.path} className="deck-row" role="row" aria-label={n.path}>
              <span role="cell" className="grow deck-name" style={{ paddingLeft: n.depth * 20 }}>
                {n.children.length ? (
                  <button className="deck-toggle" aria-label={collapsed.has(n.path) ? "Aufklappen" : "Zuklappen"} onClick={() => toggle(n.path)}>
                    {collapsed.has(n.path) ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                  </button>
                ) : (
                  <span className="deck-toggle" />
                )}
                <button className="deck-link" onClick={() => open({ type: "cards", deck: n.path })}>
                  {n.name}
                </button>
                <span className="xs muted deck-total tnum">{n.counts.total}</span>
              </span>
              <span role="cell" className={`tnum cnt-new ${n.counts.new ? "" : "is-zero"}`}>
                {n.counts.new}
              </span>
              <span role="cell" className={`tnum cnt-learn ${n.counts.learn ? "" : "is-zero"}`}>
                {n.counts.learn}
              </span>
              <span role="cell" className={`tnum cnt-review ${n.counts.review ? "" : "is-zero"}`}>
                {n.counts.review}
              </span>
              <span className="deck-gear">
                <IconButton label={`Optionen für ${n.name}`} onClick={(e) => deckMenu(e.currentTarget, n)}>
                  <MoreHorizontal size={15} />
                </IconButton>
              </span>
            </div>
          ))}
        </div>
      )}
      <div className="row wrap deck-actions">
        <Button variant="primary" icon={<GraduationCap size={15} />} disabled={!total.new && !total.learn && !total.review} onClick={() => open({ type: "learn" })}>
          Alle Stapel lernen
        </Button>
        <Button icon={<FolderPlus size={15} />} onClick={() => void createDeck()}>
          Stapel erstellen
        </Button>
        <BadgePermission />
      </div>
      <p className="small muted tnum deck-today">
        {studied ? `Heute: ${studied} ${studied === 1 ? "Karte" : "Karten"} in ${formatInterval(Math.max(60000, ms))} gelernt (${Math.round(ms / studied / 1000)} s je Karte).` : "Heute noch nichts gelernt."}
      </p>
      <SchemaPractice />
      {options && <DeckOptionsDialog deck={options} onClose={() => setOptions(null)} />}
      {custom && <CustomStudyDialog deck={custom} cards={cards} onClose={() => setCustom(null)} />}
      {menu.el}
    </>
  );
}

async function rename(path: string, cards: Card[]) {
  const to = await promptDialog({ title: "Stapel umbenennen", label: "Neuer Name", value: path, confirm: "Umbenennen", hint: "Mit „::“ wird der Stapel zum Unterstapel, z. B. Zivilrecht::BGB AT" });
  if (to) await renameDeck(path, to, cards).catch(reportError);
  useApp.getState().bump();
}

async function remove(n: DeckNode, cards: Card[]) {
  const count = cards.filter((c) => inDeck(deckOf(c), n.path)).length;
  const ok = await confirmDialog({
    title: `Stapel „${n.name}“ löschen?`,
    message: count ? `${count} ${count === 1 ? "Karte kommt" : "Karten kommen"} in den Papierkorb (dort wiederherstellbar).` : "Der Stapel ist leer.",
    confirm: "Löschen",
    danger: true,
  });
  if (!ok) return;
  await deleteDeck(n.path, cards).catch(reportError);
  useApp.getState().bump();
}

// ---------- Stapelansicht ----------

function DeckScreen({ deck, onAdd }: { deck: string; onAdd: () => void }) {
  const open = useApp((s) => s.open);
  const { cards, log } = useCollection();
  const settings = useDeckSettings();
  const [options, setOptions] = useState(false);
  const [custom, setCustom] = useState(false);
  const node = useMemo(() => {
    if (!cards || !settings) return null;
    const tree = buildDeckTree(cards, settings, new Date(), todayUsage(log, new Map(cards.map((c) => [c.id, c])), startOfToday()));
    return flattenTree(tree, new Set()).find((n) => n.path === deck) ?? null;
  }, [cards, settings, log, deck]);
  if (!cards || !settings) return <div className="loading">Lade …</div>;
  const mine = cards.filter((c) => inDeck(deckOf(c), deck));
  const nowIso = new Date().toISOString();
  const young = mine.filter((c) => c.state === 2 && c.scheduled_days < 21).length;
  const mature = mine.filter((c) => c.state === 2 && c.scheduled_days >= 21).length;
  const counts = node?.counts ?? { new: 0, learn: 0, review: 0, total: 0 };
  const any = counts.new + counts.learn + counts.review > 0;
  const parts = deck.split(SEP);
  return (
    <section className="deck-screen" aria-label={`Stapel ${deck}`}>
      <nav className="xs muted deck-crumbs" aria-label="Stapelpfad">
        <button className="link-btn" onClick={() => open({ type: "cards" })}>
          Alle Stapel
        </button>
        {parts.map((p, i) => (
          <span key={i}>
            {" › "}
            {i < parts.length - 1 ? (
              <button className="link-btn" onClick={() => open({ type: "cards", deck: parts.slice(0, i + 1).join(SEP) })}>
                {p}
              </button>
            ) : (
              <strong>{p}</strong>
            )}
          </span>
        ))}
      </nav>
      <div className="card deck-hero">
        <h2>{parts.at(-1)}</h2>
        {settings.descriptions[deck] && <p className="small muted">{settings.descriptions[deck]}</p>}
        <div className="deck-big tnum">
          <div className="cnt-new">
            <strong>{counts.new}</strong>
            <span className="xs">Neu</span>
          </div>
          <div className="cnt-learn">
            <strong>{counts.learn}</strong>
            <span className="xs">Lernen</span>
          </div>
          <div className="cnt-review">
            <strong>{counts.review}</strong>
            <span className="xs">Fällig</span>
          </div>
        </div>
        <div className="row wrap" style={{ justifyContent: "center" }}>
          <Button variant="primary" icon={<GraduationCap size={15} />} disabled={!any} onClick={() => open({ type: "learn", deck })}>
            {any ? "Jetzt lernen" : "Für heute geschafft"}
          </Button>
          <Button onClick={() => setCustom(true)}>Benutzerdefiniert lernen</Button>
        </div>
        <p className="xs muted tnum" style={{ textAlign: "center" }}>
          {mine.length} Karten · {mine.filter((c) => c.state === 0).length} neu · {young} jung · {mature} ausgereift · {mine.filter((c) => c.suspended).length} ausgesetzt ·{" "}
          {mine.filter((c) => cardStatus(c, nowIso) === "buried").length} zurückgestellt
        </p>
      </div>
      <div className="row wrap deck-actions">
        <Button icon={<Plus size={15} />} onClick={onAdd}>
          Karte hinzufügen
        </Button>
        <Button icon={<Search size={15} />} onClick={() => open({ type: "cards", tab: "browser", q: `deck:"${deck}"` })}>
          Karten durchsuchen
        </Button>
        <Button icon={<BarChart3 size={15} />} onClick={() => open({ type: "cards", tab: "statistik", deck })}>
          Statistik
        </Button>
        <Button icon={<Settings2 size={15} />} onClick={() => setOptions(true)}>
          Optionen
        </Button>
      </div>
      {node && node.children.length > 0 && (
        <>
          <h3 className="label">Unterstapel</h3>
          <div className="deck-table">
            {node.children.map((k) => (
              <div key={k.path} className="deck-row">
                <span className="grow deck-name">
                  <button className="deck-link" onClick={() => open({ type: "cards", deck: k.path })}>
                    {k.name}
                  </button>
                </span>
                <span className={`tnum cnt-new ${k.counts.new ? "" : "is-zero"}`}>{k.counts.new}</span>
                <span className={`tnum cnt-learn ${k.counts.learn ? "" : "is-zero"}`}>{k.counts.learn}</span>
                <span className={`tnum cnt-review ${k.counts.review ? "" : "is-zero"}`}>{k.counts.review}</span>
              </div>
            ))}
          </div>
        </>
      )}
      {options && <DeckOptionsDialog deck={deck} onClose={() => setOptions(false)} />}
      {custom && <CustomStudyDialog deck={deck} cards={cards} onClose={() => setCustom(false)} />}
    </section>
  );
}

// ---------- Benutzerdefiniert lernen ----------

function CustomStudyDialog({ deck, cards, onClose }: { deck: string; cards: Card[]; onClose: () => void }) {
  const open = useApp((s) => s.open);
  const [mode, setMode] = useState<CustomStudy["mode"]>("new");
  const [num, setNum] = useState(10);
  const mine = cards.filter((c) => inDeck(deckOf(c), deck));
  const tags = useMemo(() => [...new Set(mine.flatMap((c) => tagList(c.tags)))].sort((a, b) => a.localeCompare(b, "de")), [mine]);
  const [tag, setTag] = useState(tags[0] ?? "");
  const [flag, setFlag] = useState(1);
  const start = () => {
    const c: CustomStudy =
      mode === "new" ? { mode, count: num } : mode === "forgotten" || mode === "ahead" ? { mode, days: num } : mode === "tag" ? { mode, tag } : mode === "flag" ? { mode, flag } : { mode };
    onClose();
    open({ type: "learn", deck, custom: c });
  };
  const OPTS: [CustomStudy["mode"], string][] = [
    ["new", "Heute zusätzliche neue Karten lernen"],
    ["forgotten", "Vergessene Karten wiederholen"],
    ["ahead", "Vorlernen (bald fällige Karten)"],
    ["difficult", "Schwierige Karten üben"],
    ["tag", "Nach Schlagwort lernen"],
    ["flag", "Karten mit Flagge lernen"],
    ["all", "Alle Karten des Stapels durchgehen (vor der Klausur)"],
  ];
  return (
    <Dialog
      title="Benutzerdefiniert lernen"
      onClose={onClose}
      width={520}
      footer={
        <>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" onClick={start} disabled={mode === "tag" && !tag}>
            Starten
          </Button>
        </>
      }
    >
      <p className="xs muted">Stapel „{deck.split(SEP).join(" › ")}“. Die Antworten fließen wie gewohnt in die Planung ein.</p>
      <div className="custom-study" role="radiogroup" aria-label="Art">
        {OPTS.map(([m, l]) => (
          <label key={m} className="row small">
            <input type="radio" name="custom" checked={mode === m} onChange={() => setMode(m)} /> {l}
          </label>
        ))}
      </div>
      {(mode === "new" || mode === "forgotten" || mode === "ahead") && (
        <Field label={mode === "new" ? "Wie viele zusätzlich?" : mode === "forgotten" ? "Vergessen in den letzten … Tagen" : "Fällig in den nächsten … Tagen"}>
          <input type="number" inputMode="numeric" min={1} max={9999} value={num} onChange={(e) => setNum(Math.max(1, Number(e.target.value) || 1))} aria-label="Anzahl" />
        </Field>
      )}
      {mode === "tag" && (
        <Field label="Schlagwort">
          {tags.length ? (
            <select value={tag} onChange={(e) => setTag(e.target.value)} aria-label="Schlagwort">
              {tags.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          ) : (
            <p className="xs muted">Im Stapel gibt es noch keine Schlagwörter.</p>
          )}
        </Field>
      )}
      {mode === "flag" && (
        <Field label="Flagge">
          <select value={flag} onChange={(e) => setFlag(Number(e.target.value))} aria-label="Flagge">
            {FLAGS.filter((f) => f.id).map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </Field>
      )}
    </Dialog>
  );
}
