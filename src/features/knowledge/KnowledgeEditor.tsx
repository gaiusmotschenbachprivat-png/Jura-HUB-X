import { AlertTriangle, Check, Copy, FileText, Loader2, MoreHorizontal, SquareStack, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api, errorMessage } from "../../api";
import type { CaseData, CitationData, DefinitionData, Knowledge, KnowledgePatch, SchemaData, SourceKind } from "../../api/types";
import { gliederung } from "../../lib/gliederung";
import { toOutline } from "../../lib/schemaTree";
import { buildTree, type TreeItem } from "../../lib/tree";
import { reportError, useApp } from "../../state/store";
import { Button, IconButton } from "../../ui/Button";
import { confirmDialog } from "../../ui/Dialog";
import { useMenu } from "../../ui/Menu";
import { EmptyState, Field } from "../../ui/misc";
import { CardDialog } from "../learn/CardDialog";
import { createNode } from "../navigation/actions";
import { KindIcon } from "../navigation/icons";
import { CASE_STATUS, DIFFICULTY, FIELD_SUGGESTIONS, SOURCE_LABEL, TYPE_LABEL, UNVERIFIED } from "./meta";
import { SchemaEditor } from "./SchemaEditor";

function flattenNodes(items: TreeItem[], out: { id: string; label: string }[] = []) {
  for (const it of items) {
    if (it.node.kind !== "note") out.push({ id: it.node.id, label: `${" ".repeat(it.depth)}${it.node.title}` });
    flattenNodes(it.children, out);
  }
  return out;
}

export function KnowledgeEditor({ id }: { id: string }) {
  const [k, setK] = useState<Knowledge | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setK(null);
    api
      .knowledgeGet(id)
      .then((x) => alive && setK(x))
      .catch((e) => alive && setError(errorMessage(e)));
    return () => {
      alive = false;
    };
  }, [id]);
  if (error) return <EmptyState title="Nicht verfügbar">{error}</EmptyState>;
  if (!k) return <div className="loading">Lade …</div>;
  if (k.deleted_at) return <EmptyState title="Im Papierkorb">Dieser Eintrag liegt im Papierkorb. Stelle ihn dort wieder her, um ihn zu bearbeiten.</EmptyState>;
  return <Loaded key={k.id} initial={k} />;
}

function Loaded({ initial }: { initial: Knowledge }) {
  const [k, setK] = useState(initial);
  const [status, setStatus] = useState<"saved" | "dirty" | "saving" | "error">("saved");
  const [err, setErr] = useState<string | null>(null);
  const [fields, setFields] = useState<string[]>([]);
  const [cardOpen, setCardOpen] = useState(false);
  const [cardCount, setCardCount] = useState(0);
  const areas = useApp((s) => s.areas);
  const rememberTitle = useApp((s) => s.rememberTitle);
  const open = useApp((s) => s.open);
  const bump = useApp((s) => s.bump);
  const toast = useApp((s) => s.toast);
  const [allNodes, setAllNodes] = useState<Awaited<ReturnType<typeof api.nodesList>>>([]);
  const menu = useMenu();
  const pending = useRef<KnowledgePatch>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    rememberTitle({ type: "knowledge", id: k.id }, k.title);
  }, [k.id, k.title, rememberTitle]);
  useEffect(() => {
    api.knowledgeFields().then(setFields).catch(() => {});
    api.nodesList(null).then(setAllNodes).catch(() => {});
    api.cardsList({ source_type: "knowledge", source_id: initial.id }).then((c) => setCardCount(c.length)).catch(() => {});
  }, [initial.id]);

  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const patch = pending.current;
    if (!Object.keys(patch).length) return;
    pending.current = {};
    setStatus("saving");
    try {
      const saved = await api.knowledgeUpdate(initial.id, patch);
      setK((cur) => ({ ...cur, title: saved.title, updated_at: saved.updated_at }));
      setStatus("saved");
      setErr(null);
      bump();
    } catch (e) {
      pending.current = { ...patch, ...pending.current };
      setStatus("error");
      setErr(errorMessage(e));
    }
  }, [initial.id, bump]);

  useEffect(() => () => void flush(), [flush]);

  const change = (patch: KnowledgePatch) => {
    setK((cur) => ({ ...cur, ...patch, data: (patch.data as Knowledge["data"]) ?? cur.data }) as Knowledge);
    pending.current = { ...pending.current, ...patch };
    setStatus("dirty");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 600);
  };
  const setData = <T,>(patch: Partial<T>) => change({ data: { ...(k.data as object), ...patch } });

  const nodeOptions = useMemo(() => {
    const area = k.area_id;
    return flattenNodes(buildTree(allNodes.filter((n) => !area || n.area_id === area)));
  }, [allNodes, k.area_id]);

  const unverified = UNVERIFIED.includes(k.source_kind);

  const cardDefaults = () => {
    if (k.type === "definition") return { kind: "definition" as const, front: k.title, back: (k.data as unknown as DefinitionData).text ?? "" };
    if (k.type === "schema") {
      const d = k.data as unknown as SchemaData;
      return { kind: "frage" as const, front: `Prüfungsschema: ${k.title}${d.norm ? ` (${d.norm})` : ""}`, back: toOutline(d.items ?? [], gliederung) };
    }
    if (k.type === "citation") return { kind: "norm" as const, front: `${k.title} – Inhalt und Voraussetzungen?`, back: (k.data as unknown as CitationData).notes ?? "" };
    const c = k.data as unknown as CaseData;
    return { kind: "frage" as const, front: `${k.title}: ${c.question || "Wie ist der Fall zu lösen?"}`, back: c.claim_basis ?? "" };
  };

  const openSolution = async () => {
    const c = k.data as unknown as CaseData;
    if (c.solution_note_id) {
      open({ type: "note", id: c.solution_note_id });
      return;
    }
    const areaId = k.area_id ?? (k.node_id ? allNodes.find((n) => n.id === k.node_id)?.area_id : undefined) ?? areas[0]?.id;
    if (!areaId) return;
    await flush();
    const note = await createNode({ areaId, parentId: k.node_id, kind: "note", title: `Lösung: ${k.title}`, templateId: "gutachten", openAfter: false });
    if (!note) return;
    await api.knowledgeUpdate(k.id, { data: { ...(k.data as object), solution_note_id: note.id } }).catch(reportError);
    await api.linkAdd({ source_type: "knowledge", source_id: k.id, target_type: "node", target_id: note.id, kind: "related" }).catch(() => {});
    open({ type: "note", id: note.id }, { title: note.title });
  };

  return (
    <div className="page">
      <header className="page-head">
        <div className="small muted row">
          <KindIcon kind={k.type} size={14} />
          <span>{TYPE_LABEL[k.type]}</span>
          {unverified && (
            <span className="status-pill is-warn" title="Inhalte aus Import oder KI gelten nicht als geprüft.">
              <AlertTriangle size={12} /> nicht geprüft
            </span>
          )}
          <span className="grow" />
          <span className={`save-status is-${status}`} title={err ?? undefined}>
            {status === "saving" ? <Loader2 size={13} className="spin" /> : status === "saved" ? <Check size={13} /> : null}
            {status === "saved" ? "Gespeichert" : status === "saving" ? "Speichert …" : status === "dirty" ? "Änderungen …" : `Nicht gespeichert: ${err}`}
          </span>
          <IconButton
            label="Aktionen"
            onClick={(e) =>
              menu.openBelow(e.currentTarget, [
                { label: "Karteikarte erstellen", icon: <SquareStack size={14} />, onSelect: () => setCardOpen(true) },
                {
                  label: "Link für Notizen kopieren",
                  icon: <Copy size={14} />,
                  onSelect: () => {
                    void navigator.clipboard?.writeText(`studium:knowledge/${k.id}`);
                    toast("Link kopiert. In einer Notiz: Text markieren → „Interne Verknüpfung“.", "info");
                  },
                },
                { separator: true, label: "" },
                {
                  label: "In den Papierkorb",
                  icon: <Trash2 size={14} />,
                  danger: true,
                  onSelect: async () => {
                    const ok = await confirmDialog({ title: "In den Papierkorb?", message: `„${k.title}“ kann im Papierkorb wiederhergestellt werden.`, confirm: "In den Papierkorb", danger: true });
                    if (!ok) return;
                    await api.knowledgeTrash(k.id).catch(reportError);
                    bump();
                    open({ type: "knowledge-list", kind: k.type });
                  },
                },
              ])
            }
          >
            <MoreHorizontal size={16} />
          </IconButton>
        </div>
        {k.type === "citation" ? (
          <h1 className="page-title-static">{k.title}</h1>
        ) : (
          <input className="page-title" value={k.title} maxLength={300} aria-label="Titel" placeholder="Titel" onChange={(e) => change({ title: e.target.value })} onBlur={() => void flush()} />
        )}
        <div className="kn-meta">
          <label className="field">
            <span className="field-label">{k.type === "case" || k.type === "citation" || k.type === "schema" || k.type === "definition" ? "Rechts-/Fachgebiet" : "Gebiet"}</span>
            <input list="kn-fields" value={k.field} placeholder="z. B. Schuldrecht" onChange={(e) => change({ field: e.target.value })} />
            <datalist id="kn-fields">
              {[...new Set([...fields, ...FIELD_SUGGESTIONS])].map((f) => (
                <option key={f} value={f} />
              ))}
            </datalist>
          </label>
          <label className="field">
            <span className="field-label">Studienbereich</span>
            <select value={k.area_id ?? ""} onChange={(e) => change({ area_id: e.target.value || null, node_id: null })}>
              <option value="">Alle Bereiche</option>
              {areas.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Veranstaltung / Thema</span>
            <select value={k.node_id ?? ""} onChange={(e) => change({ node_id: e.target.value || null })}>
              <option value="">– keine –</option>
              {nodeOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Herkunft</span>
            <select value={k.source_kind} onChange={(e) => change({ source_kind: e.target.value as SourceKind })}>
              {Object.entries(SOURCE_LABEL).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>

      <div className="kn-body">
        {k.type === "definition" && <DefinitionForm d={k.data as unknown as DefinitionData} set={setData<DefinitionData>} />}
        {k.type === "schema" && (
          <>
            <Field label="Anspruchsgrundlage / Norm">
              <input value={(k.data as unknown as SchemaData).norm ?? ""} placeholder="z. B. § 433 Abs. 2 BGB" onChange={(e) => setData<SchemaData>({ norm: e.target.value })} />
            </Field>
            <p className="xs muted">Ein Schema ist eine Arbeitshilfe und keine allgemeingültige Vorgabe. Prüfe es gegen Vorlesung, Lehrbuch und Rechtsprechung.</p>
            <SchemaEditor items={(k.data as unknown as SchemaData).items ?? []} onChange={(items) => setData<SchemaData>({ items })} />
            <Field label="Anmerkungen">
              <textarea rows={3} value={(k.data as unknown as SchemaData).notes ?? ""} onChange={(e) => setData<SchemaData>({ notes: e.target.value })} />
            </Field>
          </>
        )}
        {k.type === "case" && <CaseForm d={k.data as unknown as CaseData} set={setData<CaseData>} onSolution={() => void openSolution()} />}
        {k.type === "citation" && <CitationForm d={k.data as unknown as CitationData} set={setData<CitationData>} />}

        <div className="row wrap kn-actions">
          <Button icon={<SquareStack size={15} />} onClick={() => setCardOpen(true)}>
            Karteikarte erstellen
          </Button>
          {cardCount > 0 && (
            <button className="link-btn small" onClick={() => open({ type: "cards" })}>
              {cardCount} {cardCount === 1 ? "Karte" : "Karten"} zu diesem Eintrag
            </button>
          )}
        </div>
      </div>
      {cardOpen && (
        <CardDialog
          initial={{ ...cardDefaults(), area_id: k.area_id, node_id: k.node_id, source_type: "knowledge", source_id: k.id, tags: k.field }}
          onClose={() => setCardOpen(false)}
          onSaved={() => setCardCount((n) => n + 1)}
        />
      )}
      {menu.el}
    </div>
  );
}

function DefinitionForm({ d, set }: { d: DefinitionData; set: (p: Partial<DefinitionData>) => void }) {
  return (
    <div className="stack kn-form">
      <Field label="Definition">
        <textarea className="kn-def" rows={4} value={d.text ?? ""} placeholder="Definition im Wortlaut" onChange={(e) => set({ text: e.target.value })} />
      </Field>
      <div className="row2">
        <Field label="Gesetzesfundstelle">
          <input value={d.citation ?? ""} placeholder="z. B. § 119 Abs. 1 BGB" onChange={(e) => set({ citation: e.target.value })} />
        </Field>
        <Field label="Quelle" hint="Vorlesung, Lehrbuch mit Randnummer, Urteil mit Aktenzeichen">
          <input value={d.source ?? ""} placeholder="z. B. BGH NJW 1984, 2279" onChange={(e) => set({ source: e.target.value })} />
        </Field>
      </div>
      <Field label="Beispiel">
        <textarea rows={2} value={d.example ?? ""} onChange={(e) => set({ example: e.target.value })} />
      </Field>
      <Field label="Eigene Anmerkungen" hint="Verwandte Begriffe und Fälle verknüpfst du im Kontextbereich rechts.">
        <textarea rows={3} value={d.notes ?? ""} onChange={(e) => set({ notes: e.target.value })} />
      </Field>
    </div>
  );
}

function CaseForm({ d, set, onSolution }: { d: CaseData; set: (p: Partial<CaseData>) => void; onSolution: () => void }) {
  return (
    <div className="stack kn-form">
      <div className="row3">
        <Field label="Anspruchsgrundlage">
          <input value={d.claim_basis ?? ""} placeholder="z. B. § 823 Abs. 1 BGB" onChange={(e) => set({ claim_basis: e.target.value })} />
        </Field>
        <Field label="Schwierigkeit">
          <select value={d.difficulty ?? 0} onChange={(e) => set({ difficulty: Number(e.target.value) as CaseData["difficulty"] })}>
            {Object.entries(DIFFICULTY).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Stand">
          <select value={d.status || "offen"} onChange={(e) => set({ status: e.target.value as CaseData["status"] })}>
            {Object.entries(CASE_STATUS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Sachverhalt">
        <textarea rows={7} value={d.facts ?? ""} onChange={(e) => set({ facts: e.target.value })} />
      </Field>
      <Field label="Fallfrage">
        <textarea rows={2} value={d.question ?? ""} onChange={(e) => set({ question: e.target.value })} />
      </Field>
      <div className="hint-card row">
        <FileText size={16} />
        <span className="grow small">
          {d.solution_note_id ? "Die Lösung liegt in einer eigenen Notiz im Gutachtenstil." : "Lege die Lösung als Notiz mit der Gutachten-Vorlage an (Obersatz, Definition, Subsumtion, Ergebnis)."}
        </span>
        <Button size="sm" variant="primary" onClick={onSolution}>
          {d.solution_note_id ? "Lösung öffnen" : "Lösung anlegen"}
        </Button>
      </div>
      <Field label="Lernpunkte / Anmerkungen">
        <textarea rows={3} value={d.notes ?? ""} onChange={(e) => set({ notes: e.target.value })} />
      </Field>
    </div>
  );
}

function CitationForm({ d, set }: { d: CitationData; set: (p: Partial<CitationData>) => void }) {
  const [quick, setQuick] = useState("");
  return (
    <div className="stack kn-form">
      <form
        className="row"
        onSubmit={async (e) => {
          e.preventDefault();
          const c = await api.citationParse(quick).catch(() => null);
          if (c) {
            set({ ...c, notes: d.notes });
            setQuick("");
          } else useApp.getState().toast("Keine Fundstelle erkannt. Beispiel: § 823 Abs. 1 BGB", "error");
        }}
      >
        <input className="grow" value={quick} placeholder="Schnelleingabe, z. B. § 823 Abs. 1 BGB oder Art. 12 I GG" onChange={(e) => setQuick(e.target.value)} />
        <Button type="submit">Übernehmen</Button>
      </form>
      <div className="cit-grid">
        <Field label="Zeichen">
          <select value={d.prefix || "§"} onChange={(e) => set({ prefix: e.target.value as CitationData["prefix"] })}>
            <option value="§">§</option>
            <option value="Art.">Art.</option>
          </select>
        </Field>
        <Field label="Nummer">
          <input value={d.number ?? ""} onChange={(e) => set({ number: e.target.value })} />
        </Field>
        <Field label="Abs.">
          <input value={d.paragraph ?? ""} onChange={(e) => set({ paragraph: e.target.value })} />
        </Field>
        <Field label="S.">
          <input value={d.sentence ?? ""} onChange={(e) => set({ sentence: e.target.value })} />
        </Field>
        <Field label="Nr.">
          <input value={d.num ?? ""} onChange={(e) => set({ num: e.target.value })} />
        </Field>
        <Field label="Alt.">
          <input value={d.alt ?? ""} onChange={(e) => set({ alt: e.target.value })} />
        </Field>
        <Field label="Gesetz">
          <input value={d.law ?? ""} placeholder="BGB" onChange={(e) => set({ law: e.target.value })} />
        </Field>
      </div>
      <Field label="Eigene Notizen zur Norm" hint="Studium OS zeigt keine Gesetzestexte an und sagt nichts über die aktuelle Fassung. Prüfe den Wortlaut in einer aktuellen Gesetzessammlung.">
        <textarea rows={5} value={d.notes ?? ""} placeholder="Voraussetzungen, Rechtsfolge, typische Probleme …" onChange={(e) => set({ notes: e.target.value })} />
      </Field>
    </div>
  );
}
