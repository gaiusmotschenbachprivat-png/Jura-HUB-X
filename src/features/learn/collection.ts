/**
 * Gemeinsamer Datenzugriff der Karteikarten: alle Karten des Bereichs,
 * Lernprotokoll (heute bzw. für Statistiken) und Stapel-Einstellungen.
 */
import { useEffect, useState } from "react";

import { api } from "../../api";
import type { Card, ReviewLogEntry, StudyNode } from "../../api/types";
import { DECK_SETTING, inDeck, normDeck, parseDeckSettings, SEP, type DeckSettings } from "../../lib/decks";
import { startOfToday } from "../../lib/fsrs";
import { courseOf } from "../../lib/learnStats";
import { reportError, useApp } from "../../state/store";

export function useCollection(sinceDays = 0) {
  const areaId = useApp((s) => s.areaId);
  const dataVersion = useApp((s) => s.dataVersion);
  const [cards, setCards] = useState<Card[] | null>(null);
  const [log, setLog] = useState<ReviewLogEntry[]>([]);
  useEffect(() => {
    let alive = true;
    const scope = areaId === "all" ? null : areaId;
    const since = sinceDays ? new Date(Date.now() - sinceDays * 864e5).toISOString() : startOfToday();
    void Promise.all([api.cardsList({ area_id: scope, limit: 20000 }), api.cardReviewLog(scope, since)]).then(([c, l]) => {
      if (!alive) return;
      setCards(c);
      setLog(l);
    }, reportError);
    return () => {
      alive = false;
    };
  }, [areaId, dataVersion, sinceDays]);
  return { cards, log };
}

let cached: DeckSettings | null = null;
const listeners = new Set<(s: DeckSettings) => void>();

export async function loadDeckSettings(): Promise<DeckSettings> {
  if (!cached) cached = parseDeckSettings((await api.settingsAll())[DECK_SETTING]);
  return cached;
}

export async function saveDeckSettings(s: DeckSettings) {
  cached = s;
  listeners.forEach((l) => l(s));
  await api.settingSet(DECK_SETTING, s);
}

export function useDeckSettings(): DeckSettings | null {
  const [s, setS] = useState<DeckSettings | null>(cached);
  useEffect(() => {
    let alive = true;
    void loadDeckSettings().then((v) => alive && setS(v), reportError);
    listeners.add(setS);
    return () => {
      alive = false;
      listeners.delete(setS);
    };
  }, []);
  return s;
}

/** Stapel umbenennen bzw. verschieben: Karten und Einstellungen (auch der Unterstapel) */
export async function renameDeck(from: string, to: string, cards: Card[]) {
  const target = normDeck(to);
  if (!target || target === from) return;
  const map = (p: string) => (inDeck(p, from) ? target + p.slice(from.length) : p);
  for (const c of cards.filter((c) => inDeck(c.deck, from))) await api.cardUpdate(c.id, { deck: map(c.deck) });
  const s = await loadDeckSettings();
  const remap = <T>(r: Record<string, T>) => Object.fromEntries(Object.entries(r).map(([k, v]) => [map(k), v]));
  await saveDeckSettings({
    decks: [...new Set([...s.decks.map(map), target])],
    options: remap(s.options),
    descriptions: remap(s.descriptions),
    collapsed: s.collapsed.map(map),
  });
}

export async function addDeck(path: string) {
  const p = normDeck(path);
  if (!p) return;
  const s = await loadDeckSettings();
  if (!s.decks.includes(p)) await saveDeckSettings({ ...s, decks: [...s.decks, p] });
}

/** Stapel löschen: Karten in den Papierkorb, Einstellungen entfernen */
export async function deleteDeck(path: string, cards: Card[]) {
  for (const c of cards.filter((c) => inDeck(c.deck || "", path))) await api.cardTrash(c.id);
  const s = await loadDeckSettings();
  const keep = (p: string) => !inDeck(p, path);
  await saveDeckSettings({
    decks: s.decks.filter(keep),
    options: Object.fromEntries(Object.entries(s.options).filter(([k]) => keep(k))),
    descriptions: Object.fromEntries(Object.entries(s.descriptions).filter(([k]) => keep(k))),
    collapsed: s.collapsed.filter(keep),
  });
}

/** zuletzt verwendeter Stapel (für „Hinzufügen“) */
const LAST_DECK = "studium.lastDeck";
export const lastDeck = () => {
  try {
    return localStorage.getItem(LAST_DECK) ?? "";
  } catch {
    return "";
  }
};
export const rememberDeck = (d: string) => {
  try {
    localStorage.setItem(LAST_DECK, d);
  } catch {
    /* egal */
  }
};

/** alle bekannten Stapelpfade (Karten + angelegte), sortiert */
export function allDecks(cards: Card[], s: DeckSettings | null): string[] {
  const set = new Set<string>(s?.decks ?? []);
  for (const c of cards) if (c.deck) set.add(c.deck);
  for (const p of [...set]) {
    const parts = p.split(SEP);
    for (let i = 1; i < parts.length; i++) set.add(parts.slice(0, i).join(SEP));
  }
  return [...set].sort((a, b) => a.localeCompare(b, "de", { numeric: true }));
}

/** Stapelvorschlag für Karten aus einer Mitschrift: die Veranstaltung (bzw. das Modul) */
export function deckForNode(nodes: StudyNode[], nodeId: string | null): string | null {
  const c = courseOf(nodes, nodeId);
  return c ? normDeck(c.title.replace(/:{2,}/g, ":")) || null : null;
}

/** Karten ohne Stapel nach Veranstaltung einsortieren (nur Karten mit Mitschrift-Bezug) */
export async function sortIntoCourseDecks(cards: Card[], nodes: StudyNode[]): Promise<number> {
  let n = 0;
  for (const c of cards) {
    if (c.deck || c.deleted_at) continue;
    const d = deckForNode(nodes, c.node_id);
    if (!d) continue;
    await api.cardUpdate(c.id, { deck: d });
    n++;
  }
  return n;
}
