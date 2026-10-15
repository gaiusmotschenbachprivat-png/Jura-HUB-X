/**
 * Zitierhilfe nach üblicher juristischer Zitierweise: Kurzzitat in der
 * Fußnote, vollständige Angabe im Literaturverzeichnis. Rechtsprechung steht
 * nur in den Fußnoten (wie in Haus- und Seminararbeiten üblich).
 */
import type { QuelleArt, QuelleData } from "../api/types";
import type { PMNode } from "./pm";

export const ART_LABEL: Record<QuelleArt, string> = {
  kommentar: "Kommentar",
  lehrbuch: "Lehrbuch",
  aufsatz: "Aufsatz",
  urteil: "Urteil / Beschluss",
  festschrift: "Beitrag in Sammelwerk / Festschrift",
  internet: "Internetquelle",
  sonstiges: "Sonstiges",
};

/** Hinweis für die Fundstelle in der Fußnote. */
export const PIN_HINT: Record<QuelleArt, string> = {
  kommentar: "z. B. § 119 Rn. 10",
  lehrbuch: "z. B. Rn. 744 oder S. 210",
  aufsatz: "Seite, z. B. 125",
  urteil: "Seite oder Rn., z. B. 125 oder Rn. 18",
  festschrift: "Seite, z. B. 412",
  internet: "",
  sonstiges: "Seite / Rn.",
};

/** Beispiel-Fundstelle für die Vorschau. */
export const SAMPLE_PIN: Record<QuelleArt, string> = { kommentar: "§ 119 Rn. 10", lehrbuch: "Rn. 744", aufsatz: "125", urteil: "125", festschrift: "412", internet: "", sonstiges: "S. 1" };

export function emptyQuelle(art: QuelleArt = "kommentar"): QuelleData {
  return { art, autoren: "", titel: "", kurz: "", auflage: "", ort: "", jahr: "", zeitschrift: "", seite: "", gericht: "", datum: "", az: "", fundstelle: "", url: "", abgerufen: "", notes: "" };
}

const t = (s: string | undefined) => (s ?? "").trim();
const lastNames = (autoren: string) =>
  t(autoren)
    .split(/\s*[/;]\s*|\s+und\s+/)
    .map((a) => (a.includes(",") ? a.split(",")[0]! : a.split(/\s+/).pop() ?? a).trim())
    .filter(Boolean);
const end = (s: string) => (/[.!?]$/.test(s) ? s : `${s}.`);

/** Vorschlag für das Kurzzitat: Nachnamen, bei Kommentaren „Werk/Bearbeiter“. */
export function defaultKurz(q: QuelleData): string {
  const names = lastNames(q.autoren).slice(0, 3).join("/");
  if (q.art === "kommentar") return [t(q.titel).split(/[,(]/)[0]?.trim(), names].filter(Boolean).join("/") || names;
  if (q.art === "urteil") return t(q.gericht);
  return names || t(q.titel);
}

/** Titel des Wissenseintrags (Anzeige in Listen). */
export function quelleTitle(q: QuelleData): string {
  if (q.art === "urteil") return [t(q.gericht), t(q.datum), t(q.az)].filter(Boolean).join(", ") || "Entscheidung";
  return [t(q.kurz) || defaultKurz(q), t(q.titel)].filter(Boolean).join(" – ") || "Quelle";
}

/** Text der Fußnote für eine Quelle mit Fundstelle (`pin`). */
export function footnoteText(q: QuelleData, pin = ""): string {
  const p = t(pin);
  const kurz = t(q.kurz) || defaultKurz(q);
  switch (q.art) {
    case "kommentar":
    case "lehrbuch":
    case "sonstiges":
      return end([kurz, p].filter(Boolean).join(", "));
    case "aufsatz": {
      const where = [t(q.zeitschrift), t(q.jahr)].filter(Boolean).join(" ");
      const page = [where, t(q.seite)].filter(Boolean).join(", ");
      return end(`${[kurz, page].filter(Boolean).join(", ")}${p ? ` (${p})` : ""}`);
    }
    case "festschrift":
      return end(`${kurz}, in: ${t(q.zeitschrift) || t(q.titel)}${t(q.seite) ? `, S. ${t(q.seite)}` : ""}${p ? ` (${p})` : ""}`);
    case "urteil": {
      const kind = t(q.titel) || "Urt.";
      const head = [t(q.gericht), t(q.datum) ? `${kind} v. ${t(q.datum)}` : ""].filter(Boolean).join(", ");
      return end(`${head}${t(q.az) ? ` – ${t(q.az)}` : ""}${t(q.fundstelle) ? `, ${t(q.fundstelle)}` : ""}${p ? ` (${p})` : ""}`);
    }
    case "internet":
      return end(`${[kurz, t(q.titel), t(q.url)].filter(Boolean).join(", ")}${t(q.abgerufen) ? ` (abgerufen am ${t(q.abgerufen)})` : ""}`);
  }
}

/** Eintrag im Literaturverzeichnis; null für Rechtsprechung. */
export function bibEntry(q: QuelleData): string | null {
  const yearPlace = [t(q.ort), t(q.jahr)].filter(Boolean).join(" ");
  const aufl = t(q.auflage) ? `${t(q.auflage).replace(/\.?\s*Aufl\.?$/i, "")}. Aufl.` : "";
  const kurz = t(q.kurz) || defaultKurz(q);
  const zitiert = kurz ? ` (zitiert: ${kurz})` : "";
  switch (q.art) {
    case "urteil":
      return null;
    case "aufsatz":
      return end(`${t(q.autoren)}, ${t(q.titel)}, ${[t(q.zeitschrift), t(q.jahr)].filter(Boolean).join(" ")}${t(q.seite) ? `, S. ${t(q.seite)}` : ""}`);
    case "festschrift":
      return end(`${t(q.autoren)}, ${t(q.titel)}, in: ${t(q.zeitschrift)}${yearPlace ? `, ${yearPlace}` : ""}${t(q.seite) ? `, S. ${t(q.seite)}` : ""}`);
    case "internet":
      return end(`${[t(q.autoren), t(q.titel), t(q.url)].filter(Boolean).join(", ")}${t(q.abgerufen) ? ` (abgerufen am ${t(q.abgerufen)})` : ""}`);
    default:
      return `${[t(q.autoren), t(q.titel), aufl, yearPlace].filter(Boolean).join(", ")}${zitiert}`.replace(/\s+/g, " ").trim();
  }
}

/** Alphabetisch nach Verfasser, Rechtsprechung ausgenommen, ohne Doppelte. */
export function bibliography(quellen: QuelleData[]): string[] {
  const seen = new Set<string>();
  return quellen
    .map((q) => ({ q, e: bibEntry(q) }))
    .filter((x): x is { q: QuelleData; e: string } => !!x.e)
    .sort((a, b) => a.e.localeCompare(b.e, "de", { sensitivity: "base" }))
    .map((x) => x.e)
    .filter((e) => !seen.has(e) && !!seen.add(e));
}

/** IDs der zitierten Quellen in einer Notiz (Reihenfolge des ersten Auftretens). */
export function citedSources(doc: PMNode): string[] {
  const out: string[] = [];
  const walk = (n: PMNode) => {
    if (n.type === "footnote" && typeof n.attrs?.source === "string" && n.attrs.source && !out.includes(n.attrs.source)) out.push(n.attrs.source);
    n.content?.forEach(walk);
  };
  walk(doc);
  return out;
}
