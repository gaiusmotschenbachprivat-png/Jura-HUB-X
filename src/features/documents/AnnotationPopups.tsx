import { MessageSquare, SquareStack, Trash2 } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { Annotation, AnnotationColor } from "../../api/types";
import { HIGHLIGHT_COLORS } from "../../lib/pdfSelection";
import { Button, IconButton } from "../../ui/Button";
import type { PdfSelection } from "./PdfViewer";

const COLOR_LABEL: Record<AnnotationColor, string> = { gelb: "Gelb", gruen: "Grün", blau: "Blau", rot: "Rot", lila: "Lila" };

function useFloating(x: number, y: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y + 8 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ left: Math.max(8, Math.min(x - r.width / 2, window.innerWidth - r.width - 8)), top: Math.min(y + 8, window.innerHeight - r.height - 8) });
  }, [x, y]);
  return { ref, pos };
}

/** Werkzeugleiste unter einer Textauswahl im PDF. */
export function SelectionToolbar({
  sel,
  onHighlight,
  onCard,
  onClose,
}: {
  sel: PdfSelection;
  onHighlight: (color: AnnotationColor, comment?: string) => void;
  onCard: () => void;
  onClose: () => void;
}) {
  const { ref, pos } = useFloating(sel.x, sel.y);
  const [commenting, setCommenting] = useState(false);
  const [comment, setComment] = useState("");
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return createPortal(
    <div className="float-bar" ref={ref} style={pos} onMouseDown={(e) => e.preventDefault()} role="toolbar" aria-label="Markieren">
      {!commenting ? (
        <div className="row">
          {(Object.keys(HIGHLIGHT_COLORS) as AnnotationColor[]).map((c) => (
            <button key={c} className="color-dot" style={{ background: HIGHLIGHT_COLORS[c] }} aria-label={`${COLOR_LABEL[c]} markieren`} title={`${COLOR_LABEL[c]} markieren`} onClick={() => onHighlight(c)} />
          ))}
          <span className="tb-sep" />
          <IconButton label="Markieren mit Kommentar" onClick={() => setCommenting(true)}>
            <MessageSquare size={15} />
          </IconButton>
          <IconButton label="Karteikarte aus Auswahl" onClick={onCard}>
            <SquareStack size={15} />
          </IconButton>
        </div>
      ) : (
        <form
          className="stack"
          style={{ width: 300 }}
          onSubmit={(e) => {
            e.preventDefault();
            onHighlight("gelb", comment);
          }}
        >
          <div className="xs muted ellipsis">„{sel.quote}“</div>
          <textarea autoFocus rows={3} placeholder="Erklärung, Frage, Querverweis …" value={comment} onChange={(e) => setComment(e.target.value)} onMouseDown={(e) => e.stopPropagation()} />
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <Button size="sm" onClick={onClose}>
              Abbrechen
            </Button>
            <Button size="sm" variant="primary" type="submit">
              Speichern
            </Button>
          </div>
        </form>
      )}
    </div>,
    document.body,
  );
}

/** Bearbeiten einer vorhandenen Markierung. */
export function AnnotationPopover({
  a,
  x,
  y,
  onSave,
  onDelete,
  onCard,
  onClose,
}: {
  a: Annotation;
  x: number;
  y: number;
  onSave: (patch: { comment?: string; color?: AnnotationColor }) => void;
  onDelete: () => void;
  onCard: () => void;
  onClose: () => void;
}) {
  const { ref, pos } = useFloating(x, y);
  const [comment, setComment] = useState(a.comment);
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) {
        if (comment !== a.comment) onSave({ comment });
        onClose();
      }
    };
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", k);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", k);
    };
  }, [comment, a.comment, onSave, onClose, ref]);
  return createPortal(
    <div className="float-bar anno-pop" ref={ref} style={pos}>
      <div className="xs muted anno-quote">„{a.quote}“ · S. {a.page}</div>
      <textarea rows={3} placeholder="Kommentar hinzufügen …" value={comment} onChange={(e) => setComment(e.target.value)} />
      <div className="row">
        {(Object.keys(HIGHLIGHT_COLORS) as AnnotationColor[]).map((c) => (
          <button
            key={c}
            className={`color-dot ${a.color === c ? "is-active" : ""}`}
            style={{ background: HIGHLIGHT_COLORS[c] }}
            aria-label={COLOR_LABEL[c]}
            onClick={() => onSave({ color: c, comment })}
          />
        ))}
        <span className="grow" />
        <IconButton label="Karteikarte" onClick={onCard}>
          <SquareStack size={15} />
        </IconButton>
        {confirm ? (
          <Button size="sm" variant="danger" onClick={onDelete}>
            Wirklich löschen
          </Button>
        ) : (
          <IconButton label="Markierung löschen" onClick={() => setConfirm(true)}>
            <Trash2 size={15} />
          </IconButton>
        )}
        <Button
          size="sm"
          variant="primary"
          onClick={() => {
            onSave({ comment });
            onClose();
          }}
        >
          Fertig
        </Button>
      </div>
    </div>,
    document.body,
  );
}
