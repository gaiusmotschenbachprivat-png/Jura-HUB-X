/**
 * Juristisches Glossar: alle Definitionen alphabetisch mit A–Z-Register,
 * Suche über Begriff, Norm und Definition, Filter nach Rechtsgebiet und
 * schnellem Bearbeiten im Dialog. Gestaltung wie das eigenständige Glossar
 * vom Projektbeginn, Daten sind die Wissenseinträge vom Typ „Definition“.
 */
import "@fontsource/literata/400.css";
import "@fontsource/literata/400-italic.css";
import "@fontsource/literata/600.css";
import "@fontsource/ibm-plex-mono/500.css";

import { Copy, Maximize2, Pencil, Plus, Search, SquareStack } from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";

import { findNormCitations, formatNorm, normKey } from "../../ai/norms";
import { api } from "../../api";
import type { DefinitionData, Knowledge } from "../../api/types";
import { reportError, useApp } from "../../state/store";
import { NormPopover } from "../editor/NormPopover";
import type { NormRef } from "../editor/normLinks";
import { CardDialog } from "../learn/CardDialog";
import { FIELD_SUGGESTIONS, UNVERIFIED } from "./meta";

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
const collator = new Intl.Collator("de", { sensitivity: "base", numeric: true });

type Def = Knowledge<DefinitionData>;

/** Anfangsbuchstabe fürs Register (Ä → A, Zahlen/Sonstiges → #). */
export function letterOf(term: string): string {
  const c = (term || "").trim().charAt(0).toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  return LETTERS.includes(c) ? c : "#";
}

/** Glossar-Einträge filtern, sortieren und nach Buchstaben gruppieren. */
export function groupGlossary(items: Def[], query: string, field: string): Map<string, Def[]> {
  const q = query.trim().toLowerCase();
  const shown = items
    .filter((k) => !field || k.field === field)
    .filter((k) => !q || [k.title, k.data.text, k.data.citation].some((v) => (v ?? "").toLowerCase().includes(q)))
    .sort((a, b) => collator.compare(a.title, b.title));
  const groups = new Map<string, Def[]>();
  for (const k of shown) {
    const L = letterOf(k.title);
    groups.set(L, [...(groups.get(L) ?? []), k]);
  }
  return new Map([...groups.entries()].sort(([a], [b]) => (a === "#" ? 1 : b === "#" ? -1 : a.localeCompare(b))));
}

function Hl({ text, q }: { text: string; q: string }) {
  if (!q.trim()) return <>{text}</>;
  const esc = q.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = text.split(new RegExp(`(${esc})`, "gi"));
  return (
    <>
      {parts.map((p, i) => (i % 2 ? <mark key={i}>{p}</mark> : <Fragment key={i}>{p}</Fragment>))}
    </>
  );
}

export function GlossaryView() {
  const areaId = useApp((s) => s.areaId);
  const dataVersion = useApp((s) => s.dataVersion);
  const bump = useApp((s) => s.bump);
  const open = useApp((s) => s.open);
  const [toastMsg, setToastMsg] = useState<{ text: string; n: number } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toast = (text: string, _kind?: string) => {
    setToastMsg((t) => ({ text, n: (t?.n ?? 0) + 1 }));
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(null), 2600);
  };
  useEffect(() => () => void (toastTimer.current && clearTimeout(toastTimer.current)), []);
  const [items, setItems] = useState<Def[] | null>(null);
  const [query, setQuery] = useState("");
  const [field, setField] = useState("");
  const [editing, setEditing] = useState<Def | "new" | null>(null);
  const [card, setCard] = useState<Def | null>(null);
  const [norm, setNorm] = useState<{ ref: NormRef; rect: DOMRect } | null>(null);
  const search = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api
      .knowledgeList({ type: "definition", area_id: areaId === "all" ? null : areaId })
      .then((l) => setItems(l as unknown as Def[]))
      .catch(reportError);
  }, [areaId, dataVersion]);

  // „/“ springt in die Suche
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = (document.activeElement as HTMLElement | null)?.tagName;
      if (e.key === "/" && t !== "INPUT" && t !== "TEXTAREA" && !document.querySelector(".overlay") && !(document.activeElement as HTMLElement)?.isContentEditable) {
        e.preventDefault();
        search.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const used = useMemo(() => {
    const s = new Set((items ?? []).map((k) => k.field).filter(Boolean));
    const known = FIELD_SUGGESTIONS.filter((f) => s.has(f));
    return [...known, ...[...s].filter((f) => !known.includes(f)).sort(collator.compare)];
  }, [items]);
  useEffect(() => {
    if (field && !used.includes(field)) setField("");
  }, [used, field]);
  const groups = useMemo(() => groupGlossary(items ?? [], query, field), [items, query, field]);

  const jump = (L: string) => root.current?.querySelector(`#glossar-${L === "#" ? "x" : L}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  const copy = async (k: Def) => {
    const text = `${k.title}${k.data.citation ? ` (${k.data.citation})` : ""}: ${k.data.text}`;
    try {
      await navigator.clipboard.writeText(text);
      toast("Definition kopiert", "success");
    } catch {
      toast("Kopieren nicht möglich", "error");
    }
  };
  const openNorm = (k: Def, el: HTMLElement) => {
    const c = findNormCitations(k.data.citation ?? "").find((x) => x.law);
    if (!c) return;
    setNorm({ ref: { law: c.law, norm: normKey(c), absatz: c.absatz, label: formatNorm(c) }, rect: el.getBoundingClientRect() });
  };

  return (
    <div className="page glossar" ref={root}>
      <div className="g-wrap">
        <header className="g-head">
          <div className="g-titlerow">
            <h1>Juristisches Glossar</h1>
            <span className="g-count">{items ? `${items.length} ${items.length === 1 ? "Begriff" : "Begriffe"}` : ""}</span>
          </div>
          <div className="g-tools">
            <div className="g-search">
              <Search size={18} aria-hidden />
              <input ref={search} type="search" value={query} placeholder="Begriff, Norm oder Definition suchen …" aria-label="Glossar durchsuchen" autoComplete="off" onChange={(e) => setQuery(e.target.value)} />
            </div>
            <button className="g-btn g-btn-primary" type="button" onClick={() => setEditing("new")}>
              <Plus size={16} aria-hidden />
              <span className="g-btn-label"> Begriff</span>
            </button>
          </div>
          {used.length > 0 && (
            <div className="g-filters" role="group" aria-label="Nach Rechtsgebiet filtern">
              {["", ...used].map((f) => (
                <button key={f || "alle"} type="button" className="g-chip" aria-pressed={field === f} onClick={() => setField(field === f ? "" : f)}>
                  {f || "Alle"}
                </button>
              ))}
            </div>
          )}
        </header>

        <div className="g-layout">
          <nav className="g-register" aria-label="Register A bis Z">
            {[...LETTERS, "#"].map((L) =>
              groups.has(L) ? (
                <button key={L} type="button" onClick={() => jump(L)}>
                  {L}
                </button>
              ) : L === "#" ? null : (
                <span key={L} aria-hidden>
                  {L}
                </span>
              ),
            )}
          </nav>
          <main className="g-main">
            {items === null ? (
              <p className="g-status">Lade Glossar …</p>
            ) : groups.size === 0 ? (
              <div className="g-empty">
                {items.length ? (
                  <>
                    <strong>Keine Treffer</strong>Für „{query}“ gibt es hier noch keinen Eintrag.
                  </>
                ) : (
                  <>
                    <strong>Dein Glossar ist noch leer</strong>Trage über „+ Begriff“ deinen ersten Begriff mit Definition ein. Er wird automatisch alphabetisch einsortiert. Auch in Notizen markierter Text wird über „… → Definition aus Auswahl anlegen“ zum Glossareintrag.
                  </>
                )}
              </div>
            ) : (
              [...groups.entries()].map(([L, list]) => (
                <section key={L} className="g-group">
                  <h2 className="g-letter" id={`glossar-${L === "#" ? "x" : L}`}>
                    {L}
                  </h2>
                  {list.map((k) => (
                    <article key={k.id} className="g-entry" onDoubleClick={() => setEditing(k)}>
                      <div className="g-entry-head">
                        <h3 className="g-term">
                          <Hl text={k.title} q={query} />
                        </h3>
                        {k.data.citation && (
                          <button type="button" className="g-norm" title="Wortlaut anzeigen" onClick={(e) => openNorm(k, e.currentTarget)}>
                            <Hl text={k.data.citation} q={query} />
                          </button>
                        )}
                        {k.field && <span className="g-area">{k.field}</span>}
                      </div>
                      <div className="g-actions">
                        <button type="button" className="g-icon" aria-label="Definition kopieren" title="Kopieren" onClick={() => void copy(k)}>
                          <Copy size={16} />
                        </button>
                        <button type="button" className="g-icon" aria-label="Als Karteikarte lernen" title="Karteikarte" onClick={() => setCard(k)}>
                          <SquareStack size={16} />
                        </button>
                        <button type="button" className="g-icon" aria-label={`${k.title} bearbeiten`} title="Bearbeiten" onClick={() => setEditing(k)}>
                          <Pencil size={16} />
                        </button>
                      </div>
                      <p className="g-def">
                        <Hl text={k.data.text ?? ""} q={query} />
                      </p>
                      {(k.data.example || UNVERIFIED.includes(k.source_kind)) && (
                        <div className="g-meta">
                          {UNVERIFIED.includes(k.source_kind) && <span className="g-badge">{k.source_kind === "ki-vorschlag" ? "KI-Vorschlag" : "Importiert"}</span>}
                          {k.data.example && <span className="g-example">Beispiel: {k.data.example}</span>}
                        </div>
                      )}
                    </article>
                  ))}
                </section>
              ))
            )}
          </main>
        </div>
      </div>

      {editing && (
        <GlossaryEditor
          entry={editing === "new" ? null : editing}
          initialTerm={editing === "new" ? query.trim() : ""}
          items={items ?? []}
          fields={used}
          onClose={() => setEditing(null)}
          onSaved={(msg) => {
            setEditing(null);
            bump();
            toast(msg, "success");
          }}
          onDetails={(id) => {
            setEditing(null);
            open({ type: "knowledge", id });
          }}
        />
      )}
      {card && (
        <CardDialog
          initial={{ front: card.title, back: card.data.text ?? "", kind: "definition", area_id: card.area_id, source_type: "knowledge", source_id: card.id }}
          onClose={() => setCard(null)}
        />
      )}
      {norm && <NormPopover refInfo={norm.ref} anchor={norm.rect} onClose={() => setNorm(null)} />}
      <div className={`g-toast ${toastMsg ? "show" : ""}`} role="status" aria-live="polite">
        {toastMsg?.text}
      </div>
    </div>
  );
}

function GlossaryEditor({
  entry,
  initialTerm,
  items,
  fields,
  onClose,
  onSaved,
  onDetails,
}: {
  entry: Def | null;
  initialTerm: string;
  items: Def[];
  fields: string[];
  onClose: () => void;
  onSaved: (msg: string) => void;
  onDetails: (id: string) => void;
}) {
  const areaId = useApp((s) => s.areaId);
  const [term, setTerm] = useState(entry?.title ?? initialTerm);
  const [norm, setNorm] = useState(entry?.data.citation ?? "");
  const [field, setField] = useState(entry?.field ?? "");
  const [def, setDef] = useState(entry?.data.text ?? "");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const dlg = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = dlg.current;
    if (d && !d.open) d.showModal();
    return () => d?.close();
  }, []);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const t = term.trim();
    const d = def.trim();
    if (!t || !d) return setErr("Bitte Begriff und Definition ausfüllen.");
    const dup = items.find((x) => x.id !== entry?.id && collator.compare(x.title, t) === 0);
    if (dup) return setErr(`„${dup.title}“ steht schon in deinem Glossar. Bearbeite den vorhandenen Eintrag.`);
    setBusy(true);
    try {
      if (entry) {
        await api.knowledgeUpdate(entry.id, { title: t, field: field.trim(), data: { ...entry.data, text: d, citation: norm.trim() } });
        onSaved("Gespeichert");
      } else {
        await api.knowledgeCreate({ type: "definition", area_id: areaId === "all" ? null : areaId, node_id: null, title: t, field: field.trim(), data: { text: d, citation: norm.trim() } });
        onSaved(`„${t}“ hinzugefügt`);
      }
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Speichern fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!entry) return;
    if (!confirmDelete) return setConfirmDelete(true);
    try {
      await api.knowledgeTrash(entry.id);
      onSaved("In den Papierkorb gelegt");
    } catch {
      setErr("Das hat nicht geklappt. Versuche es erneut.");
    }
  };

  return (
    <dialog ref={dlg} className="g-dialog" onCancel={(e) => (e.preventDefault(), onClose())} aria-label={entry ? "Begriff bearbeiten" : "Neuer Begriff"}>
      <form className="g-editor" onSubmit={(e) => void save(e)}>
        <h2>{entry ? "Begriff bearbeiten" : "Neuer Begriff"}</h2>
        <div className="g-field">
          <label htmlFor="g-term">Begriff</label>
          <input id="g-term" autoFocus required maxLength={160} placeholder="z. B. Willenserklärung" value={term} onChange={(e) => setTerm(e.target.value)} />
        </div>
        <div className="g-row2">
          <div className="g-field">
            <label htmlFor="g-norm">
              Norm <span className="g-opt">(optional)</span>
            </label>
            <input id="g-norm" maxLength={80} placeholder="z. B. § 133 BGB" value={norm} onChange={(e) => setNorm(e.target.value)} />
          </div>
          <div className="g-field">
            <label htmlFor="g-area">
              Rechtsgebiet <span className="g-opt">(optional)</span>
            </label>
            <input id="g-area" list="g-areas" maxLength={80} placeholder="z. B. Zivilrecht" value={field} onChange={(e) => setField(e.target.value)} />
            <datalist id="g-areas">
              {[...new Set([...fields, ...FIELD_SUGGESTIONS])].map((f) => (
                <option key={f} value={f} />
              ))}
            </datalist>
          </div>
        </div>
        <div className="g-field">
          <label htmlFor="g-def">Definition</label>
          <textarea id="g-def" required placeholder="Eigene Definition eintragen …" value={def} onChange={(e) => setDef(e.target.value)} />
        </div>
        <p className="g-err" role="alert">
          {err}
        </p>
        <div className="g-form-actions">
          {entry && (
            <>
              <button type="button" className="g-btn g-btn-danger" onClick={() => void remove()}>
                {confirmDelete ? "Wirklich?" : "Löschen"}
              </button>
              <button type="button" className="g-btn g-btn-ghost" title="Quelle, Beispiel, Notizen, Rückverweise" onClick={() => onDetails(entry.id)}>
                <Maximize2 size={14} aria-hidden /> Alle Angaben
              </button>
            </>
          )}
          <span className="g-spacer" />
          <button type="button" className="g-btn g-btn-ghost" onClick={onClose}>
            Abbrechen
          </button>
          <button type="submit" className="g-btn g-btn-primary" disabled={busy}>
            Speichern
          </button>
        </div>
      </form>
    </dialog>
  );
}
