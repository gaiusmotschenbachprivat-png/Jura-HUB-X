import { GraduationCap, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { api } from "../../api";
import type { Card, CardStats } from "../../api/types";
import { formatDate } from "../../lib/format";
import { startOfToday, STATE_LABEL } from "../../lib/fsrs";
import { areaById, reportError, useApp } from "../../state/store";
import { Button } from "../../ui/Button";
import { confirmDialog } from "../../ui/Dialog";
import { longPress } from "../../ui/longPress";
import { type MenuItem, useMenu } from "../../ui/Menu";
import { AreaDot, EmptyState } from "../../ui/misc";
import { CARD_KIND_LABEL, CardDialog } from "./CardDialog";
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

export function CardsView({ focusId }: { focusId?: string }) {
  const areaId = useApp((s) => s.areaId);
  const dataVersion = useApp((s) => s.dataVersion);
  const open = useApp((s) => s.open);
  const bump = useApp((s) => s.bump);
  const stats = useCardStats();
  const [cards, setCards] = useState<Card[]>([]);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"alle" | "faellig" | "schwierig" | "pausiert">("alle");
  const [edit, setEdit] = useState<Card | null | "new">(null);
  const menu = useMenu();
  const cardItems = (c: Card): MenuItem[] => [
    { label: "Bearbeiten", onSelect: () => setEdit(c) },
    {
      label: c.suspended ? "Fortsetzen" : "Pausieren",
      onSelect: async () => {
        await api.cardUpdate(c.id, { suspended: !c.suspended }).catch(reportError);
        bump();
      },
    },
    {
      label: c.difficult ? "Nicht mehr als schwierig markieren" : "Als schwierig markieren",
      onSelect: async () => {
        await api.cardUpdate(c.id, { difficult: !c.difficult }).catch(reportError);
        bump();
      },
    },
    { separator: true, label: "" },
    {
      label: "In den Papierkorb",
      danger: true,
      onSelect: async () => {
        if (!(await confirmDialog({ title: "Karte löschen?", message: "Die Karte kommt in den Papierkorb.", confirm: "In den Papierkorb", danger: true }))) return;
        await api.cardTrash(c.id).catch(reportError);
        bump();
      },
    },
  ];
  // iPad: langes Drücken statt Rechtsklick
  const pressMenu = (c: Card) => {
    const lp = longPress((p) => menu.openAt(p, cardItems(c)));
    return { onPointerDown: lp.onPointerDown, onPointerMove: lp.onPointerMove, onPointerUp: lp.onPointerUp, onPointerCancel: lp.onPointerCancel };
  };

  useEffect(() => {
    api.cardsList({ area_id: areaId === "all" ? null : areaId }).then(setCards).catch(reportError);
  }, [areaId, dataVersion]);
  useEffect(() => {
    if (focusId) {
      const c = cards.find((x) => x.id === focusId);
      if (c) setEdit(c);
    }
  }, [focusId, cards]);

  const shown = useMemo(() => {
    const f = q.trim().toLowerCase();
    const t = new Date().toISOString();
    return cards.filter(
      (c) =>
        (filter === "alle" || (filter === "faellig" && !c.suspended && c.due <= t) || (filter === "schwierig" && c.difficult) || (filter === "pausiert" && c.suspended)) &&
        (!f || `${c.front} ${c.back} ${c.tags}`.toLowerCase().includes(f)),
    );
  }, [cards, q, filter]);

  return (
    <div className="page">
      <header className="page-head">
        <div className="small muted">Lernen</div>
        <h1 className="page-title-static">Karteikarten</h1>
        <div className="row wrap">
          <Button variant="primary" icon={<GraduationCap size={15} />} onClick={() => open({ type: "learn" })} disabled={!stats?.due_now}>
            {stats?.due_now ? `${stats.due_now} fällige Karten lernen` : "Keine Karten fällig"}
          </Button>
          <Button icon={<Plus size={15} />} onClick={() => setEdit("new")}>
            Neue Karte
          </Button>
          <BadgePermission />
        </div>
      </header>

      {stats && stats.total > 0 && (
        <div className="stat-row">
          <Stat label="Fällig jetzt" value={stats.due_now} />
          <Stat label="Fällig in 7 Tagen" value={stats.due_7d} />
          <Stat label="Heute wiederholt" value={stats.reviewed_today} />
          <Stat label="Behalten (30 Tage)" value={stats.retention_30d == null ? "–" : `${Math.round(stats.retention_30d * 100)} %`} />
          <Stat label="Karten gesamt" value={stats.total} sub={`${stats.new_cards} neu · ${stats.learning} lernen · ${stats.review} wiederholen`} />
          <Stat label="Schwierig" value={stats.difficult} />
        </div>
      )}

      <FachProgress cards={cards} />
      <SchemaPractice />

      <h2 className="section-title">Alle Karten</h2>
      <div className="filters row wrap">
        <input className="filter-input" placeholder="Karten durchsuchen …" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="seg" role="radiogroup" aria-label="Filter">
          {(
            [
              ["alle", "Alle"],
              ["faellig", "Fällig"],
              ["schwierig", "Schwierig"],
              ["pausiert", "Pausiert"],
            ] as const
          ).map(([v, l]) => (
            <button key={v} role="radio" aria-checked={filter === v} className={filter === v ? "is-active" : ""} onClick={() => setFilter(v)}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {cards.length === 0 ? (
        <EmptyState title="Noch keine Karteikarten" action={<Button variant="primary" onClick={() => setEdit("new")}>Erste Karte anlegen</Button>}>
          Karten entstehen hier, aus Definitionen und Prüfungsschemata („Karteikarte erstellen“) oder aus markiertem Text in Notizen.
        </EmptyState>
      ) : (
        <div className="list" style={{ maxWidth: 1100 }}>
          {shown.map((c) => {
            const area = areaById(c.area_id);
            return (
              <div
                key={c.id}
                className="list-row"
                role="button"
                tabIndex={0}
                onClick={() => setEdit(c)}
                onKeyDown={(e) => e.key === "Enter" && setEdit(c)}
                {...pressMenu(c)}
                onContextMenu={(e) => menu.openAt(e, cardItems(c))}
              >
                <span className="grow" style={{ minWidth: 0 }}>
                  <span className="ellipsis block">{c.front}</span>
                  <span className="xs muted ellipsis block">{c.back}</span>
                </span>
                {c.difficult && <span className="status-pill is-warn">schwierig</span>}
                {c.suspended && <span className="pill">pausiert</span>}
                <span className="pill">{CARD_KIND_LABEL[c.kind].split(" ")[0]}</span>
                {area && <AreaDot color={area.color} size={6} />}
                <span className="xs muted doc-date" title={STATE_LABEL[c.state]}>
                  {c.reps === 0 ? "neu" : `fällig ${formatDate(c.due)}`}
                </span>
              </div>
            );
          })}
        </div>
      )}
      {edit && <CardDialog card={edit === "new" ? undefined : edit} onClose={() => setEdit(null)} />}
      {menu.el}
    </div>
  );
}

export function Stat({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
  return (
    <div className="stat">
      <div className="stat-value tnum">{value}</div>
      <div className="xs muted">{label}</div>
      {sub && <div className="xs muted">{sub}</div>}
    </div>
  );
}
