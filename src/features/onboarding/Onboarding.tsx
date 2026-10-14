import { useState } from "react";

import { api, errorMessage } from "../../api";
import { AREA_COLORS } from "../../lib/kinds";
import { useApp } from "../../state/store";
import { Button } from "../../ui/Button";

/** Vorschlag für die Semesterbezeichnung anhand des heutigen Datums (frei änderbar). */
export function suggestSemester(d = new Date()): string {
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  if (m >= 4 && m <= 9) return `Sommersemester ${y}`;
  const start = m >= 10 ? y : y - 1;
  return `Wintersemester ${start}/${String(start + 1).slice(2)}`;
}

const DEFAULTS = [
  { name: "Rechtswissenschaften", color: AREA_COLORS[0]!, on: true },
  { name: "Recht & Wirtschaft", color: AREA_COLORS[1]!, on: true },
  { name: "WiWiZ", color: AREA_COLORS[2]!, on: true },
];

export function Onboarding() {
  const [areas, setAreas] = useState(DEFAULTS);
  const [semester, setSemester] = useState(suggestSemester());
  const [withSemester, setWithSemester] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const init = useApp((s) => s.init);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const chosen = areas.filter((a) => a.on && a.name.trim());
      if (!chosen.length) throw new Error("Bitte mindestens einen Studienbereich anlegen.");
      for (const a of chosen) {
        const area = await api.areaCreate(a.name.trim(), a.color);
        if (withSemester && semester.trim()) {
          await api.nodeCreate({ area_id: area.id, parent_id: null, kind: "semester", title: semester.trim() });
        }
      }
      await api.settingSet("onboarding.done", true);
      await init();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <div className="onboarding">
      <div className="onb-card">
        <div className="label">Einrichtung</div>
        <h1>Willkommen bei Studium OS</h1>
        <p className="muted">
          Lege zuerst deine Studienbereiche an. Inhalte bleiben je Bereich getrennt, lassen sich aber verknüpfen. Namen, Farben und Struktur kannst du jederzeit ändern.
        </p>
        <div className="stack onb-areas">
          {areas.map((a, i) => (
            <div key={i} className="row">
              <input type="checkbox" checked={a.on} aria-label={`${a.name} anlegen`} onChange={(e) => setAreas(areas.map((x, j) => (j === i ? { ...x, on: e.target.checked } : x)))} />
              <input type="color" value={a.color} aria-label="Farbe" onChange={(e) => setAreas(areas.map((x, j) => (j === i ? { ...x, color: e.target.value } : x)))} />
              <input className="grow" value={a.name} aria-label="Name des Studienbereichs" onChange={(e) => setAreas(areas.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
            </div>
          ))}
          <button className="side-empty" onClick={() => setAreas([...areas, { name: "", color: AREA_COLORS[areas.length % AREA_COLORS.length]!, on: true }])}>
            + weiteren Bereich
          </button>
        </div>
        <label className="row small onb-sem">
          <input type="checkbox" checked={withSemester} onChange={(e) => setWithSemester(e.target.checked)} />
          <span>In jedem Bereich ein Semester anlegen:</span>
          <input className="grow" value={semester} onChange={(e) => setSemester(e.target.value)} disabled={!withSemester} />
        </label>
        <div className="onb-privacy small">
          <strong>Deine Daten bleiben auf diesem {api.kind === "web" ? "Gerät" : "Rechner"}.</strong> Keine Anmeldung, keine Cloud, keine Übertragung. Lege unter „Einstellungen & Backup“ regelmäßig ein Backup an, z. B. auf einem USB-Stick.
        </div>
        {error && <p className="error-text small">{error}</p>}
        <Button variant="primary" onClick={start} disabled={busy}>
          {busy ? "Richte ein …" : "Loslegen"}
        </Button>
      </div>
    </div>
  );
}
