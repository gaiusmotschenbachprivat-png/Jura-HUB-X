/** Optionen eines Stapels: Tageslimits, Lernschritte, Zielbehaltensquote, Problemkarten … (Unterstapel erben). */
import { useEffect, useState } from "react";

import { cleanOptions, DEFAULT_OPTIONS, optionsFor, type DeckOptions, type DeckSettings } from "../../lib/decks";
import { reportError, useApp } from "../../state/store";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { Field } from "../../ui/misc";
import { loadDeckSettings, saveDeckSettings } from "./collection";

export function DeckOptionsDialog({ deck, onClose, onSaved }: { deck: string; onClose: () => void; onSaved?: (s: DeckSettings) => void }) {
  const toast = useApp((s) => s.toast);
  const [s, setS] = useState<DeckSettings | null>(null);
  const [o, setO] = useState<DeckOptions>(DEFAULT_OPTIONS);
  const [desc, setDesc] = useState("");
  useEffect(() => {
    void loadDeckSettings().then((v) => {
      setS(v);
      setO(optionsFor(v, deck));
      setDesc(v.descriptions[deck] ?? "");
    }, reportError);
  }, [deck]);
  const own = !!s?.options[deck];
  const set = (p: Partial<DeckOptions>) => setO({ ...o, ...p });
  const save = async (reset = false) => {
    if (!s) return;
    const options = { ...s.options };
    if (reset) delete options[deck];
    else options[deck] = cleanOptions(o);
    const descriptions = { ...s.descriptions };
    if (desc.trim()) descriptions[deck] = desc.trim();
    else delete descriptions[deck];
    const next = { ...s, options, descriptions };
    try {
      await saveDeckSettings(next);
      onSaved?.(next);
      toast(reset ? "Optionen zurückgesetzt – es gelten die des Oberstapels bzw. die Standardwerte." : "Optionen gespeichert.", "success");
      onClose();
    } catch (e) {
      reportError(e);
    }
  };
  const n = (v: string, f: (x: number) => Partial<DeckOptions>) => {
    const x = Number(v.replace(",", "."));
    if (Number.isFinite(x)) set(f(x));
  };
  return (
    <Dialog
      title={`Optionen: ${deck.split("::").join(" › ")}`}
      onClose={onClose}
      width={620}
      footer={
        <>
          {own && <Button onClick={() => void save(true)}>Wie Oberstapel</Button>}
          <span className="grow" />
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" onClick={() => void save()}>
            Speichern
          </Button>
        </>
      }
    >
      <p className="xs muted">{own ? "Eigene Optionen dieses Stapels." : "Noch keine eigenen Optionen – angezeigt werden die geerbten."} Unterstapel ohne eigene Optionen übernehmen diese.</p>
      <h3 className="label">Tageslimits</h3>
      <div className="row wrap opt-grid">
        <Field label="Neue Karten pro Tag" hint="Wie viele noch nie gelernte Karten täglich dazukommen">
          <input type="number" inputMode="numeric" min={0} value={o.newPerDay} onChange={(e) => n(e.target.value, (x) => ({ newPerDay: x }))} aria-label="Neue Karten pro Tag" />
        </Field>
        <Field label="Höchstens Wiederholungen pro Tag">
          <input type="number" inputMode="numeric" min={0} value={o.reviewsPerDay} onChange={(e) => n(e.target.value, (x) => ({ reviewsPerDay: x }))} aria-label="Wiederholungen pro Tag" />
        </Field>
      </div>
      <h3 className="label">Lernschritte</h3>
      <div className="row wrap opt-grid">
        <Field label="Lernschritte (neu)" hint="z. B. „1m 10m“ – Minuten (m), Stunden (h), Tage (d)">
          <input value={o.learningSteps} onChange={(e) => set({ learningSteps: e.target.value })} aria-label="Lernschritte" />
        </Field>
        <Field label="Schritte nach „Nochmal“" hint="bei einer schon gelernten Karte, z. B. „10m“">
          <input value={o.relearningSteps} onChange={(e) => set({ relearningSteps: e.target.value })} aria-label="Schritte nach Nochmal" />
        </Field>
      </div>
      <h3 className="label">Planung (FSRS)</h3>
      <div className="row wrap opt-grid">
        <Field label={`Zielbehaltensquote: ${Math.round(o.retention * 100)} %`} hint="Höher = öfter wiederholen, sicherer behalten. 90 % ist ein guter Wert; vor der Klausur 92–95 %.">
          <input type="range" min={70} max={99} value={Math.round(o.retention * 100)} onChange={(e) => set({ retention: Number(e.target.value) / 100 })} aria-label="Zielbehaltensquote" />
        </Field>
        <Field label="Längstes Intervall (Tage)">
          <input type="number" inputMode="numeric" min={1} value={o.maxInterval} onChange={(e) => n(e.target.value, (x) => ({ maxInterval: x }))} aria-label="Längstes Intervall" />
        </Field>
        <Field label="Neue Karten">
          <select value={o.newOrder} onChange={(e) => set({ newOrder: e.target.value as DeckOptions["newOrder"] })} aria-label="Reihenfolge neuer Karten">
            <option value="added">in der Reihenfolge des Hinzufügens</option>
            <option value="random">zufällig</option>
          </select>
        </Field>
      </div>
      <label className="row small" style={{ gap: 8, margin: "6px 0" }}>
        <input type="checkbox" checked={o.burySiblings} onChange={(e) => set({ burySiblings: e.target.checked })} />
        Zusammengehörige Karten (umgekehrt, andere Lücken) erst am nächsten Tag zeigen
      </label>
      <h3 className="label">Problemkarten</h3>
      <div className="row wrap opt-grid">
        <Field label="Problemkarte ab … Fehlversuchen" hint="0 = aus">
          <input type="number" inputMode="numeric" min={0} value={o.leechThreshold} onChange={(e) => n(e.target.value, (x) => ({ leechThreshold: x }))} aria-label="Problemkarte ab Fehlversuchen" />
        </Field>
        <Field label="Dann">
          <select value={o.leechAction} onChange={(e) => set({ leechAction: e.target.value as DeckOptions["leechAction"] })} aria-label="Aktion bei Problemkarten">
            <option value="tag">Schlagwort „Problemkarte“ vergeben</option>
            <option value="suspend">Schlagwort vergeben und Karte aussetzen</option>
          </select>
        </Field>
      </div>
      <Field label="Beschreibung (erscheint in der Stapelübersicht)">
        <textarea rows={2} value={desc} onChange={(e) => setDesc(e.target.value)} aria-label="Beschreibung" />
      </Field>
    </Dialog>
  );
}
