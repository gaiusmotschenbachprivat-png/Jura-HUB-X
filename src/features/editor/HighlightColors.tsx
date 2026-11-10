/**
 * „Markerfarben anpassen“: Farbe und Bedeutung je Platz (z. B. „Gelb =
 * Definition“), eigene Farben ergänzen. Vorhandene Markierungen ändern sich mit.
 * Gespeichert in der Einstellung `editor.highlights`.
 */
import { Plus, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { api } from "../../api";
import {
  DEFAULT_HIGHLIGHTS,
  HIGHLIGHT_PALETTE,
  HIGHLIGHT_SETTING,
  highlightConfigOf,
  highlightSlots,
  nextFreeSlot,
  parseHighlightConfig,
  setHighlightConfig,
  type HighlightSlot,
} from "../../lib/highlights";
import { reportError, useApp } from "../../state/store";
import { Button, IconButton } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";

const OPEN_EVENT = "studium:edit-highlight-colors";
export const openHighlightColors = () => window.dispatchEvent(new CustomEvent(OPEN_EVENT));

/** Gespeicherte Markerfarben laden (beim Start). */
export async function loadHighlightConfig() {
  const s = await api.settingsAll();
  setHighlightConfig(parseHighlightConfig(s[HIGHLIGHT_SETTING]));
}

export function HighlightColorsDialog({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<HighlightSlot[]>(() => highlightSlots().map((s) => ({ ...s })));
  const toast = useApp((s) => s.toast);
  const set = (i: number, p: Partial<HighlightSlot>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const free = nextFreeSlot(rows);
  const save = async () => {
    const clean = parseHighlightConfig(highlightConfigOf(rows));
    try {
      await api.settingSet(HIGHLIGHT_SETTING, highlightConfigOf(clean));
      setHighlightConfig(clean);
      toast("Markerfarben gespeichert.", "success");
      onClose();
    } catch (e) {
      reportError(e);
    }
  };
  return (
    <Dialog
      title="Markerfarben anpassen"
      onClose={onClose}
      width={600}
      footer={
        <>
          <Button
            icon={<Plus size={14} />}
            disabled={!free}
            onClick={() => free && setRows([...rows, { slot: free, color: HIGHLIGHT_PALETTE[(rows.length + 1) % HIGHLIGHT_PALETTE.length]!, label: "Eigene Farbe" }])}
          >
            Farbe hinzufügen
          </Button>
          <span className="grow" />
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" onClick={() => void save()}>
            Speichern
          </Button>
        </>
      }
    >
      <p className="small muted">
        Farbe und Bedeutung gelten für alle Markierungen mit dieser Farbe – auch für schon markierte Stellen. Die Bedeutung (z. B. „Definition“, „Problem“) erscheint beim Antippen
        der Farbauswahl. Im dunklen Modus werden die Farben automatisch abgedunkelt, damit die Schrift lesbar bleibt.
      </p>
      <div className="callout-kinds" role="list" aria-label="Markerfarben">
        {rows.map((r, i) => {
          const d = DEFAULT_HIGHLIGHTS.find((x) => x.slot === r.slot);
          return (
            <div key={r.slot} className="callout-kind-row hl-row" role="listitem" style={{ ["--c" as string]: r.color }}>
              <input type="color" value={r.color} aria-label={`Farbe für ${r.label || "Markierung"}`} onChange={(e) => set(i, { color: e.target.value })} />
              <span className="hl-sample" aria-hidden>
                <mark data-color={r.color} style={{ ["--hl" as string]: r.color }}>Beispiel</mark>
              </span>
              <input className="grow" value={r.label} maxLength={30} aria-label="Bedeutung" placeholder={d?.label ?? "Bedeutung"} onChange={(e) => set(i, { label: e.target.value })} />
              <div className="callout-kind-palette" aria-label="Farbvorschläge">
                {HIGHLIGHT_PALETTE.slice(0, 6).map((c) => (
                  <button key={c} type="button" className={`color-dot ${r.color === c ? "is-active" : ""}`} style={{ background: c }} aria-label={`Farbe ${c}`} onClick={() => set(i, { color: c })} />
                ))}
              </div>
              {d ? (
                <IconButton label="Ursprüngliche Farbe und Bezeichnung" disabled={r.color === d.color && r.label === d.label} onClick={() => set(i, { color: d.color, label: d.label })}>
                  <RotateCcw size={14} />
                </IconButton>
              ) : (
                <IconButton label={`„${r.label}“ entfernen`} onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                  <Trash2 size={14} />
                </IconButton>
              )}
            </div>
          );
        })}
      </div>
    </Dialog>
  );
}

/** Einmal in der App: öffnet den Dialog auf Anforderung (Werkzeugleiste). */
export function HighlightColorsHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const on = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, on);
    return () => window.removeEventListener(OPEN_EVENT, on);
  }, []);
  return open ? <HighlightColorsDialog onClose={() => setOpen(false)} /> : null;
}
