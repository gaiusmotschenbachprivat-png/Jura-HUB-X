import { BookOpenText, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { api } from "../../api";
import type { LegalHit } from "../../api/types";
import { useApp } from "../../state/store";
import { Button, IconButton } from "../../ui/Button";
import type { NormRef } from "./normLinks";

/** Wortlaut einer angetippten Norm aus den importierten Gesetzen. */
export function NormPopover({ refInfo, anchor, onClose }: { refInfo: NormRef; anchor: DOMRect; onClose: () => void }) {
  const open = useApp((s) => s.open);
  const box = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<{ hits: LegalHit[]; imported: boolean } | null>(null);
  const [pos, setPos] = useState({ x: anchor.left, y: anchor.bottom + 6 });

  useEffect(() => {
    let alive = true;
    (async () => {
      // ganze Norm laden, zitierter Absatz wird hervorgehoben
      const hits = await api.legalNorm(refInfo.law, refInfo.norm, null).catch(() => [] as LegalHit[]);
      const imported = hits.length > 0 || (await api.legalSourcesList().catch(() => [])).some((s) => s.kind === "gesetz" && s.abbreviation.toLowerCase() === refInfo.law.toLowerCase());
      if (alive) setState({ hits, imported });
    })();
    return () => {
      alive = false;
    };
  }, [refInfo]);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const x = Math.max(8, Math.min(anchor.left, window.innerWidth - w - 8));
    const below = anchor.bottom + 6;
    const y = below + h > window.innerHeight - 8 ? Math.max(8, anchor.top - h - 6) : below;
    setPos({ x, y });
  }, [anchor, state]);

  useEffect(() => {
    const close = (e: PointerEvent) => !box.current?.contains(e.target as Node) && onClose();
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    // erst nach dem auslösenden Tippen lauschen
    const t = setTimeout(() => {
      window.addEventListener("pointerdown", close);
      window.addEventListener("keydown", key);
    });
    return () => {
      clearTimeout(t);
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", key);
    };
  }, [onClose]);

  const heading = state?.hits.find((h) => h.heading)?.heading;
  const version = state?.hits[0]?.version;
  return createPortal(
    <div ref={box} className="norm-pop" role="dialog" aria-label={`Wortlaut ${refInfo.label}`} style={{ left: pos.x, top: pos.y }}>
      <div className="norm-pop-head">
        <BookOpenText size={15} />
        <strong className="grow">
          {refInfo.norm} {refInfo.law}
          {heading ? <span className="muted"> – {heading}</span> : null}
        </strong>
        <IconButton label="Schließen" onClick={onClose}>
          <X size={15} />
        </IconButton>
      </div>
      {!state ? (
        <div className="loading small">Lade …</div>
      ) : state.hits.length ? (
        <>
          <div className="norm-pop-text">
            {state.hits.map((h) => (
              <p key={h.chunk_id} className={refInfo.absatz && h.absatz === refInfo.absatz ? "is-cited" : ""}>
                {h.absatz ? <span className="norm-abs">({h.absatz})</span> : null} {h.text}
              </p>
            ))}
          </div>
          <p className="xs muted norm-pop-foot">
            {version ? `Fassung laut Quelle: ${version}. ` : ""}Ob dieser Stand aktuell ist, prüft Studium OS nicht.
          </p>
        </>
      ) : state.imported ? (
        <p className="small muted">
          {refInfo.norm} wurde im importierten {refInfo.law} nicht gefunden (evtl. aufgehoben oder anders nummeriert).
        </p>
      ) : (
        <div className="stack">
          <p className="small">Das {refInfo.law} ist noch nicht importiert. Gesetze lassen sich unter „KI-Assistent → Rechtsquellen“ hinzufügen (XML von gesetze-im-internet.de).</p>
          <Button
            size="sm"
            onClick={() => {
              onClose();
              open({ type: "assistant" });
            }}
          >
            Zu den Rechtsquellen
          </Button>
        </div>
      )}
    </div>,
    document.body,
  );
}
