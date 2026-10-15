/**
 * Strukturbaum. Verschieben per Zeiger-Ziehen (nicht HTML5-Drag-and-drop):
 * HTML5-DnD ist unter Windows deaktiviert, solange Tauri Datei-Drops von außen
 * annimmt. Zeiger-Ereignisse funktionieren auf allen Plattformen.
 */
import { ChevronRight } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent as RKE } from "react";

import { api } from "../../api";
import type { StudyNode } from "../../api/types";
import { isDescendant, positionBetween, type TreeItem } from "../../lib/tree";
import { areaById, reportError, useApp } from "../../state/store";
import { AreaDot } from "../../ui/misc";
import { formatDateDe, noteTypeOf } from "../../lib/noteTypes";
import { NodeIcon } from "./icons";

type Zone = "before" | "after" | "inside";
interface DropTarget {
  id: string;
  zone: Zone;
}

export function Tree({
  items,
  activeId,
  renamingId,
  onRename,
  onContextMenu,
  onOpen,
  showAreaDots,
}: {
  items: TreeItem[];
  activeId: string | null;
  renamingId: string | null;
  onRename: (id: string, title: string | null) => void;
  onContextMenu: (e: React.MouseEvent, node: StudyNode) => void;
  onOpen: (node: StudyNode) => void;
  showAreaDots: boolean;
}) {
  const nodes = useApp((s) => s.nodes);
  const expanded = useApp((s) => s.expanded);
  const setExpanded = useApp((s) => s.setExpanded);
  const reload = useApp((s) => s.reloadNodes);
  const [drag, setDrag] = useState<{ id: string; title: string; x: number; y: number } | null>(null);
  const [target, setTarget] = useState<DropTarget | null>(null);
  const startRef = useRef<{ id: string; x: number; y: number; pointerId: number } | null>(null);
  const justDragged = useRef(false);
  // iPad: langes Drücken öffnet das Kontextmenü (Ziehen per Finger würde das Scrollen stören)
  const press = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelPress = () => {
    if (press.current) clearTimeout(press.current);
    press.current = null;
  };

  // Ziehen über das ganze Fenster verfolgen
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const s = startRef.current;
      if (!s) return;
      if (!drag && Math.hypot(e.clientX - s.x, e.clientY - s.y) < 6) return;
      const node = nodes.find((n) => n.id === s.id);
      if (!node) return;
      if (!drag) document.body.classList.add("is-dragging");
      setDrag({ id: s.id, title: node.title, x: e.clientX, y: e.clientY });
      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-tree-id]");
      if (!el) return setTarget(null);
      const id = el.dataset.treeId!;
      if (isDescendant(nodes, id, s.id)) return setTarget(null);
      const r = el.getBoundingClientRect();
      const rel = (e.clientY - r.top) / r.height;
      setTarget({ id, zone: rel < 0.28 ? "before" : rel > 0.72 ? "after" : "inside" });
    };
    const up = async () => {
      const s = startRef.current;
      startRef.current = null;
      const t = target;
      const wasDragging = !!drag;
      setDrag(null);
      setTarget(null);
      document.body.classList.remove("is-dragging");
      if (wasDragging) {
        justDragged.current = true;
        setTimeout(() => (justDragged.current = false), 50);
      }
      if (!s || !t || !wasDragging) return;
      const over = nodes.find((n) => n.id === t.id);
      if (!over) return;
      let parentId: string | null;
      let position: number;
      if (t.zone === "inside") {
        parentId = over.id;
        const kids = nodes.filter((n) => n.parent_id === over.id && n.id !== s.id);
        position = positionBetween(Math.max(0, ...kids.map((k) => k.position)), undefined);
        setExpanded(over.id, true);
      } else {
        parentId = over.parent_id;
        const sibs = nodes
          .filter((n) => n.parent_id === over.parent_id && n.area_id === over.area_id && n.id !== s.id)
          .sort((a, b) => a.position - b.position);
        const i = sibs.findIndex((n) => n.id === over.id);
        position =
          t.zone === "before"
            ? positionBetween(sibs[i - 1]?.position, over.position)
            : positionBetween(over.position, sibs[i + 1]?.position);
      }
      try {
        await api.nodeMove(s.id, parentId, position, over.area_id);
        await reload();
      } catch (e) {
        reportError(e);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [drag, target, nodes, reload, setExpanded]);

  const onKey = (e: RKE, item: TreeItem) => {
    const open = !!expanded[item.node.id];
    if (e.key === "ArrowRight" && item.children.length && !open) setExpanded(item.node.id, true);
    else if (e.key === "ArrowLeft" && open) setExpanded(item.node.id, false);
    else if (e.key === "Enter") onOpen(item.node);
    else if (e.key === "F2") onRename(item.node.id, "");
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const rows = [...document.querySelectorAll<HTMLElement>(".tree-row")];
      const i = rows.indexOf(e.currentTarget as HTMLElement);
      rows[i + (e.key === "ArrowDown" ? 1 : -1)]?.focus();
    } else return;
    e.preventDefault();
  };

  const render = (list: TreeItem[]) =>
    list.map((item) => {
      const n = item.node;
      const open = !!expanded[n.id];
      const isTarget = target?.id === n.id;
      return (
        <div key={n.id} role="treeitem" aria-expanded={item.children.length ? open : undefined} aria-selected={activeId === n.id}>
          <div
            className={[
              "tree-row",
              activeId === n.id ? "is-active" : "",
              n.archived_at ? "is-archived" : "",
              drag?.id === n.id ? "is-dragged" : "",
              isTarget ? `drop-${target!.zone}` : "",
            ].join(" ")}
            style={{ paddingLeft: 8 + item.depth * 14 }}
            data-tree-id={n.id}
            tabIndex={0}
            onPointerDown={(e) => {
              if (e.button !== 0 || renamingId === n.id) return;
              if (e.pointerType === "touch") {
                const { clientX, clientY } = e;
                cancelPress();
                press.current = setTimeout(() => {
                  press.current = null;
                  justDragged.current = true;
                  setTimeout(() => (justDragged.current = false), 400);
                  onContextMenu({ clientX, clientY, preventDefault() {} } as React.MouseEvent, n);
                }, 480);
                return;
              }
              startRef.current = { id: n.id, x: e.clientX, y: e.clientY, pointerId: e.pointerId };
            }}
            onPointerMove={(e) => e.pointerType === "touch" && press.current && e.movementY !== 0 && cancelPress()}
            onPointerUp={cancelPress}
            onPointerCancel={cancelPress}
            onClick={() => !justDragged.current && onOpen(n)}
            onDoubleClick={() => onRename(n.id, "")}
            onContextMenu={(e) => onContextMenu(e, n)}
            onKeyDown={(e) => onKey(e, item)}
          >
            <span
              className={`tree-chevron ${item.children.length ? "" : "is-empty"} ${open ? "is-open" : ""}`}
              onClick={(e) => {
                e.stopPropagation();
                if (item.children.length) setExpanded(n.id, !open);
              }}
            >
              <ChevronRight size={13} />
            </span>
            <span className="tree-icon">
              <NodeIcon node={n} />
            </span>
            {renamingId === n.id ? (
              <RenameInput initial={n.title} onDone={(t) => onRename(n.id, t)} />
            ) : (
              <span className="tree-title ellipsis">{n.title}</span>
            )}
            {noteTypeOf(n) === "vorlesung" && typeof n.meta?.date === "string" && (
              <span className="tree-date tnum">{formatDateDe(n.meta.date, true)}</span>
            )}
            {showAreaDots && item.depth === 0 && <AreaDot color={areaById(n.area_id)?.color ?? "#999"} size={6} />}
          </div>
          {open && item.children.length > 0 && <div role="group">{render(item.children)}</div>}
        </div>
      );
    });

  return (
    <div className="tree" role="tree" aria-label="Studienstruktur">
      {render(items)}
      {drag && (
        <div className="drag-ghost" style={{ left: drag.x + 12, top: drag.y + 8 }}>
          {drag.title}
        </div>
      )}
    </div>
  );
}

function RenameInput({ initial, onDone }: { initial: string; onDone: (t: string | null) => void }) {
  const [v, setV] = useState(initial);
  const done = useRef(false);
  const finish = (val: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(val);
  };
  return (
    <input
      className="tree-rename"
      autoFocus
      value={v}
      maxLength={300}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setV(e.target.value)}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") finish(v.trim() && v.trim() !== initial ? v.trim() : null);
        if (e.key === "Escape") finish(null);
      }}
      onBlur={() => finish(v.trim() && v.trim() !== initial ? v.trim() : null)}
    />
  );
}
