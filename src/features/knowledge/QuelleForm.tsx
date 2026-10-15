import type { QuelleArt, QuelleData } from "../../api/types";
import { ART_LABEL, bibEntry, defaultKurz, footnoteText, SAMPLE_PIN } from "../../lib/zitieren";
import { Field } from "../../ui/misc";

type F = keyof QuelleData;
const FIELDS: Record<QuelleArt, { key: F; label: string; ph?: string; wide?: boolean }[]> = {
  kommentar: [
    { key: "autoren", label: "Bearbeiter/in", ph: "z. B. Ellenberger, Jürgen", wide: true },
    { key: "titel", label: "Kommentar", ph: "z. B. Grüneberg, Bürgerliches Gesetzbuch", wide: true },
    { key: "auflage", label: "Auflage", ph: "83" },
    { key: "ort", label: "Ort", ph: "München" },
    { key: "jahr", label: "Jahr", ph: "2024" },
  ],
  lehrbuch: [
    { key: "autoren", label: "Verfasser/in", ph: "z. B. Medicus, Dieter / Petersen, Jens", wide: true },
    { key: "titel", label: "Titel", ph: "z. B. Allgemeiner Teil des BGB", wide: true },
    { key: "auflage", label: "Auflage", ph: "12" },
    { key: "ort", label: "Ort", ph: "Heidelberg" },
    { key: "jahr", label: "Jahr", ph: "2023" },
  ],
  aufsatz: [
    { key: "autoren", label: "Verfasser/in", ph: "z. B. Muster, Max", wide: true },
    { key: "titel", label: "Titel des Aufsatzes", wide: true },
    { key: "zeitschrift", label: "Zeitschrift", ph: "NJW" },
    { key: "jahr", label: "Jahr", ph: "2020" },
    { key: "seite", label: "Anfangsseite", ph: "123" },
  ],
  festschrift: [
    { key: "autoren", label: "Verfasser/in", wide: true },
    { key: "titel", label: "Titel des Beitrags", wide: true },
    { key: "zeitschrift", label: "Sammelwerk / Festschrift", ph: "z. B. FS Canaris", wide: true },
    { key: "ort", label: "Ort" },
    { key: "jahr", label: "Jahr" },
    { key: "seite", label: "Anfangsseite" },
  ],
  urteil: [
    { key: "gericht", label: "Gericht", ph: "BGH" },
    { key: "titel", label: "Art", ph: "Urt. / Beschl." },
    { key: "datum", label: "Datum", ph: "12.3.2020" },
    { key: "az", label: "Aktenzeichen", ph: "I ZR 1/19" },
    { key: "fundstelle", label: "Fundstelle", ph: "NJW 2020, 123", wide: true },
  ],
  internet: [
    { key: "autoren", label: "Verfasser/in", wide: true },
    { key: "titel", label: "Titel", wide: true },
    { key: "url", label: "Adresse", ph: "https://…", wide: true },
    { key: "abgerufen", label: "Abgerufen am", ph: "15.10.2026" },
  ],
  sonstiges: [
    { key: "autoren", label: "Verfasser/in", wide: true },
    { key: "titel", label: "Titel", wide: true },
    { key: "ort", label: "Ort" },
    { key: "jahr", label: "Jahr" },
  ],
};

/** Eingabefelder einer Quelle mit Vorschau von Fußnote und Verzeichniseintrag. */
export function QuelleForm({ d, set, compact }: { d: QuelleData; set: (p: Partial<QuelleData>) => void; compact?: boolean }) {
  const art: QuelleArt = d.art && d.art in FIELDS ? d.art : "kommentar";
  const q = { ...d, art };
  const bib = bibEntry(q);
  return (
    <div className="stack kn-form quelle-form">
      <Field label="Art">
        <select value={art} onChange={(e) => set({ art: e.target.value as QuelleArt })} aria-label="Art der Quelle">
          {(Object.keys(ART_LABEL) as QuelleArt[]).map((a) => (
            <option key={a} value={a}>
              {ART_LABEL[a]}
            </option>
          ))}
        </select>
      </Field>
      <div className="quelle-grid">
        {FIELDS[art].map((f) => (
          <label key={f.key} className={`field ${f.wide ? "is-wide" : ""}`}>
            <span className="field-label">{f.label}</span>
            <input value={(q[f.key] as string) ?? ""} placeholder={f.ph} aria-label={f.label} onChange={(e) => set({ [f.key]: e.target.value } as Partial<QuelleData>)} />
          </label>
        ))}
        {art !== "urteil" && (
          <label className="field is-wide">
            <span className="field-label">Kurzzitat in der Fußnote</span>
            <input value={q.kurz ?? ""} placeholder={defaultKurz(q) || "z. B. Grüneberg/Ellenberger"} aria-label="Kurzzitat" onChange={(e) => set({ kurz: e.target.value })} />
          </label>
        )}
      </div>
      {!compact && (
        <Field label="Notizen">
          <textarea rows={2} value={q.notes ?? ""} onChange={(e) => set({ notes: e.target.value })} />
        </Field>
      )}
      <div className="quelle-preview small">
        <div>
          <span className="muted">Fußnote: </span>
          {footnoteText(q, SAMPLE_PIN[art])}
        </div>
        <div>
          <span className="muted">Literaturverzeichnis: </span>
          {bib ?? <em className="muted">Rechtsprechung erscheint nur in den Fußnoten.</em>}
        </div>
      </div>
    </div>
  );
}
