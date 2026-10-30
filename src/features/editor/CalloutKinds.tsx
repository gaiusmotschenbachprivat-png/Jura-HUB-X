/**
 * „Kästen anpassen“: mitgelieferte Arten umbenennen und umfärben, eigene Arten
 * anlegen oder entfernen. Gespeichert in der Einstellung `editor.callouts`.
 */
import { Plus, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { api } from "../../api";
import { CALLOUT_SETTING, calloutConfig, CALLOUTS, newCalloutKind, parseCalloutConfig, setCalloutConfig, type CalloutConfig } from "../../lib/callouts";
import { reportError, useApp } from "../../state/store";
import { Button, IconButton } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";

const OPEN_EVENT = "studium:edit-callout-kinds";
export const openCalloutKinds = () => window.dispatchEvent(new CustomEvent(OPEN_EVENT));

/** Gespeicherte Anpassungen laden (beim Start). */
export async function loadCalloutConfig() {
  const s = await api.settingsAll();
  setCalloutConfig(parseCalloutConfig(s[CALLOUT_SETTING]));
}

/** Farbvorschläge – gut unterscheidbar, auch im dunklen Modus lesbar. */
const PALETTE = ["#2f5fb3", "#1f7a85", "#2e7d5b", "#6b4fa3", "#a3354a", "#a86a12", "#b4471f", "#5b6676", "#8a6d1f", "#b03a8c", "#3d7a2a", "#4357ad"];

interface Row {
  kind: string;
  label: string;
  color: string;
  builtin: boolean;
  defaultLabel?: string;
  defaultColor?: string;
}

function rowsFrom(c: CalloutConfig): Row[] {
  return [
    ...CALLOUTS.map((b) => ({
      kind: b.kind,
      label: c.overrides[b.kind]?.label ?? b.label,
      color: c.overrides[b.kind]?.color ?? b.color,
      builtin: true,
      defaultLabel: b.label,
      defaultColor: b.color,
    })),
    ...c.extra.map((e) => ({ ...e, builtin: false })),
  ];
}

function configFrom(rows: Row[]): CalloutConfig {
  const overrides: CalloutConfig["overrides"] = {};
  for (const r of rows.filter((r) => r.builtin)) {
    const label = r.label.trim() && r.label.trim() !== r.defaultLabel ? r.label.trim() : undefined;
    const color = r.color !== r.defaultColor ? r.color : undefined;
    if (label || color) overrides[r.kind] = { ...(label ? { label } : {}), ...(color ? { color } : {}) };
  }
  return parseCalloutConfig({ overrides, extra: rows.filter((r) => !r.builtin && r.label.trim()).map((r) => ({ kind: r.kind, label: r.label, color: r.color })) });
}

export function CalloutKindsDialog({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<Row[]>(() => rowsFrom(calloutConfig()));
  const toast = useApp((s) => s.toast);
  const set = (i: number, p: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const save = async () => {
    const c = configFrom(rows);
    try {
      await api.settingSet(CALLOUT_SETTING, c);
      setCalloutConfig(c);
      toast("Kästen gespeichert.", "success");
      onClose();
    } catch (e) {
      reportError(e);
    }
  };
  return (
    <Dialog
      title="Kästen anpassen"
      onClose={onClose}
      width={600}
      footer={
        <>
          <Button
            icon={<Plus size={14} />}
            onClick={() => setRows([...rows, { kind: newCalloutKind(), label: "Neue Art", color: PALETTE[(rows.length + 3) % PALETTE.length]!, builtin: false }])}
          >
            Neue Art
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
        Bezeichnung und Farbe gelten für alle Kästen dieser Art. Eigene Arten (z. B. „Erläuterung“, „Klausurtipp“) erscheinen danach in der Auswahl. Wird eine eigene Art gelöscht,
        behalten vorhandene Kästen ihre Bezeichnung und Farbe.
      </p>
      <div className="callout-kinds" role="list">
        {rows.map((r, i) => (
          <div key={r.kind} className="callout-kind-row" role="listitem" style={{ ["--c" as string]: r.color }}>
            <input type="color" value={r.color} aria-label={`Farbe für ${r.label || "neue Art"}`} onChange={(e) => set(i, { color: e.target.value })} />
            <input className="grow" value={r.label} maxLength={40} aria-label="Bezeichnung" placeholder={r.defaultLabel ?? "Bezeichnung"} onChange={(e) => set(i, { label: e.target.value })} />
            <div className="callout-kind-palette" aria-label="Farbvorschläge">
              {PALETTE.slice(0, 6).map((c) => (
                <button key={c} type="button" className={`color-dot ${r.color === c ? "is-active" : ""}`} style={{ background: c }} aria-label={`Farbe ${c}`} onClick={() => set(i, { color: c })} />
              ))}
            </div>
            {r.builtin ? (
              <IconButton
                label="Ursprüngliche Bezeichnung und Farbe"
                disabled={r.label === r.defaultLabel && r.color === r.defaultColor}
                onClick={() => set(i, { label: r.defaultLabel!, color: r.defaultColor! })}
              >
                <RotateCcw size={14} />
              </IconButton>
            ) : (
              <IconButton label={`„${r.label}“ entfernen`} onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                <Trash2 size={14} />
              </IconButton>
            )}
          </div>
        ))}
      </div>
    </Dialog>
  );
}

/** Einmal in der App: öffnet den Dialog auf Anforderung (Werkzeugleiste, Kastenmenü, Einstellungen). */
export function CalloutKindsHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const on = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, on);
    return () => window.removeEventListener(OPEN_EVENT, on);
  }, []);
  return open ? <CalloutKindsDialog onClose={() => setOpen(false)} /> : null;
}
