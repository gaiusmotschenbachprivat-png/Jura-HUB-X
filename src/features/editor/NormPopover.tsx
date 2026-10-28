import { BookOpenText, Copy, PanelTop, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { api } from "../../api";
import type { LegalHit } from "../../api/types";
import { bundledFor, installBundled, type BundledLaw } from "../../ai/sources/bundled";
import { safeTop } from "../../lib/safeArea";
import { useApp } from "../../state/store";
import { Button, IconButton } from "../../ui/Button";
import type { NormRef } from "./normLinks";

/** Absatztext ohne doppelte Nummer: „(1) …“ steht bei PDF-Importen schon im Text. */
const absText = (h: LegalHit) => (h.absatz && !new RegExp(`^\\(${h.absatz}[a-z]?\\)`).test(h.text) ? `(${h.absatz}) ${h.text}` : h.text);

/** Wortlaut als Text zum Kopieren/Einfügen. */
export function normPlainText(refInfo: NormRef, hits: LegalHit[]): { title: string; paragraphs: string[]; source: string } {
  const heading = hits.find((h) => h.heading)?.heading?.split(" – ")[0];
  const title = `${refInfo.norm} ${refInfo.law}${heading ? ` – ${heading}` : ""}`;
  const h0 = hits[0];
  const source = h0 ? `${h0.title}${h0.version ? `, Stand: ${h0.version}` : ""}` : "";
  return { title, paragraphs: hits.map(absText), source };
}

/** Wortlaut einer angetippten Norm aus den importierten Gesetzen. */
export function NormPopover({
  refInfo,
  anchor,
  onClose,
  onInsert,
}: {
  refInfo: NormRef;
  anchor: DOMRect;
  onClose: () => void;
  /** Wortlaut als Gesetzestext-Kasten in die Mitschrift einfügen */
  onInsert?: (text: ReturnType<typeof normPlainText>) => void;
}) {
  const open = useApp((s) => s.open);
  const toast = useApp((s) => s.toast);
  const box = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<{ hits: LegalHit[]; imported: boolean } | null>(null);
  const [bundled, setBundled] = useState<BundledLaw | null>(null);
  const [installing, setInstalling] = useState(false);
  const [reload, setReload] = useState(0);
  const [pos, setPos] = useState({ x: anchor.left, y: anchor.bottom + 6 });

  useEffect(() => {
    let alive = true;
    (async () => {
      // ganze Norm laden, zitierter Absatz wird hervorgehoben
      const hits = await api.legalNorm(refInfo.law, refInfo.norm, null).catch(() => [] as LegalHit[]);
      const imported = hits.length > 0 || (await api.legalSourcesList().catch(() => [])).some((s) => s.kind === "gesetz" && s.abbreviation.toLowerCase() === refInfo.law.toLowerCase());
      if (alive) setState({ hits, imported });
      // nicht gefunden: mitgelieferte vollständige Fassung anbieten
      if (!hits.length) {
        const b = await bundledFor(refInfo.law);
        if (alive) setBundled(b ?? null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [refInfo, reload]);

  const install = async () => {
    if (!bundled) return;
    setInstalling(true);
    try {
      const s = await installBundled(api, bundled);
      toast(`${s.abbreviation}: vollständige Fassung geladen (${s.chunk_count.toLocaleString("de-DE")} Abschnitte).`, "success");
      setBundled(null);
      setReload((n) => n + 1);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setInstalling(false);
    }
  };
  const bundledButton = bundled && (
    <Button size="sm" variant="primary" disabled={installing} onClick={() => void install()}>
      {installing ? "Lade …" : `Vollständiges ${bundled.abbreviation} laden (mitgeliefert)`}
    </Button>
  );

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const x = Math.max(8, Math.min(anchor.left, window.innerWidth - w - 8));
    const below = anchor.bottom + 6;
    const y = below + h > window.innerHeight - 8 ? Math.max(8 + safeTop(), anchor.top - h - 6) : below;
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
                {absText(h)}
              </p>
            ))}
          </div>
          <div className="row wrap norm-pop-actions">
            <Button
              size="sm"
              icon={<Copy size={13} />}
              onClick={async () => {
                const t = normPlainText(refInfo, state.hits);
                const text = [t.title, ...t.paragraphs, t.source ? `(${t.source})` : ""].filter(Boolean).join("\n");
                try {
                  await navigator.clipboard.writeText(text);
                  toast(`${refInfo.norm} ${refInfo.law} kopiert.`, "success");
                } catch {
                  // ohne Zugriff auf die Zwischenablage: Text markieren, dann „Kopieren“ im iPad-Menü
                  const el = box.current?.querySelector(".norm-pop-text");
                  if (el) window.getSelection()?.selectAllChildren(el);
                  toast("Text markiert – zum Kopieren „Kopieren“ wählen.", "info");
                }
              }}
            >
              Kopieren
            </Button>
            {onInsert && (
              <Button
                size="sm"
                icon={<PanelTop size={13} />}
                onClick={() => {
                  onInsert(normPlainText(refInfo, state.hits));
                  onClose();
                }}
              >
                In Mitschrift einfügen
              </Button>
            )}
          </div>
          <p className="xs muted norm-pop-foot">
            {refInfo.inferred ? `Im Text steht kein Gesetz – angenommen: ${refInfo.law}. ` : ""}
            {version ? `Fassung laut Quelle: ${version}. ` : ""}Ob dieser Stand aktuell ist, prüft Studium OS nicht.
          </p>
        </>
      ) : state.imported ? (
        <div className="stack">
          <p className="small muted">
            {refInfo.norm} wurde im importierten {refInfo.law} nicht gefunden
            {bundled ? " – die gespeicherte Fassung ist vermutlich unvollständig." : " (evtl. aufgehoben oder anders nummeriert)."}
          </p>
          {bundledButton}
        </div>
      ) : (
        <div className="stack">
          <p className="small">Das {refInfo.law} ist noch nicht importiert. Gesetze lassen sich unter „KI-Assistent → Rechtsquellen“ hinzufügen (XML oder PDF von gesetze-im-internet.de).</p>
          {bundledButton}
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
