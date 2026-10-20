/**
 * „Definitionen ins Glossar“: findet Definitionen in der Mitschrift (fetter
 * Begriff am Absatzanfang oder „Definition: …“) und übernimmt die ausgewählten
 * ins Glossar – auf Wunsch zugleich als Karteikarte und mit Link im Text.
 */
import type { Editor } from "@tiptap/react";
import { BookMarked } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { api } from "../../api";
import type { Knowledge, StudyNode } from "../../api/types";
import { scanDefinitions, type DefinitionCandidate } from "../../lib/definitionScan";
import { ancestors } from "../../lib/tree";
import { reportError, useApp } from "../../state/store";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";

interface Row extends DefinitionCandidate {
  pick: boolean;
  existing: Knowledge | null;
}

export function DefinitionHarvest({ editor, node, onClose }: { editor: Editor; node: StudyNode; onClose: () => void }) {
  const nodes = useApp((s) => s.nodes);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [asCards, setAsCards] = useState(true);
  const [link, setLink] = useState(true);
  const [busy, setBusy] = useState(false);
  const course = useMemo(() => {
    const chain = ancestors(nodes, node.id).map((id) => nodes.find((n) => n.id === id));
    return chain.find((n) => n && (n.kind === "course" || n.kind === "module")) ?? null;
  }, [nodes, node.id]);
  const [field, setField] = useState(course?.title ?? "");

  useEffect(() => {
    const found = scanDefinitions(editor.state.doc);
    api
      .knowledgeList({ type: "definition" })
      .then((list) => {
        const byTerm = new Map(list.filter((k) => !k.deleted_at).map((k) => [k.title.trim().toLowerCase(), k]));
        setRows(found.map((c) => {
          const existing = byTerm.get(c.term.toLowerCase()) ?? null;
          return { ...c, existing, pick: !existing && !c.linked };
        }));
      })
      .catch((e) => {
        reportError(e);
        setRows(found.map((c) => ({ ...c, existing: null, pick: !c.linked })));
      });
  }, [editor]);

  const set = (i: number, patch: Partial<Row>) => setRows((r) => r && r.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  const picked = rows?.filter((r) => r.pick) ?? [];

  const save = async () => {
    if (!picked.length) return;
    setBusy(true);
    const created: { row: Row; k: Knowledge }[] = [];
    try {
      for (const row of picked) {
        const k = await api.knowledgeCreate({
          type: "definition",
          area_id: node.area_id,
          node_id: course?.id ?? node.parent_id ?? null,
          title: row.term.trim(),
          field: field.trim(),
          source_kind: "vorlesung",
          data: { text: row.text.trim() },
        });
        created.push({ row, k });
        if (asCards)
          await api.cardCreate({ area_id: node.area_id, node_id: course?.id ?? null, kind: "definition", front: `Definiere: ${k.title}`, back: row.text.trim(), tags: field.trim(), source_type: "knowledge", source_id: k.id });
      }
      // Begriffe im Text verlinken – von hinten nach vorn, damit Positionen stimmen
      if (link) {
        const chain = editor.chain();
        for (const { row, k } of [...created].sort((a, b) => (b.row.termFrom ?? 0) - (a.row.termFrom ?? 0))) {
          if (row.termFrom == null || row.termTo == null) continue;
          if (editor.state.doc.textBetween(row.termFrom, row.termTo) !== row.term) continue;
          chain.setTextSelection({ from: row.termFrom, to: row.termTo }).setLink({ href: `studium:knowledge/${k.id}` });
        }
        chain.run();
      }
      useApp.getState().toast(`${created.length} Definition${created.length === 1 ? "" : "en"} ins Glossar übernommen${asCards ? " (mit Karteikarten)" : ""}.`, "success");
      useApp.getState().bump();
      onClose();
    } catch (e) {
      reportError(e);
      if (created.length) useApp.getState().toast(`${created.length} Definition(en) wurden vor dem Fehler gespeichert.`, "info");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title="Definitionen ins Glossar"
      onClose={onClose}
      width={640}
      footer={
        <>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" icon={<BookMarked size={14} />} disabled={busy || !picked.length} onClick={() => void save()}>
            {picked.length ? `${picked.length} übernehmen` : "Übernehmen"}
          </Button>
        </>
      }
    >
      {!rows ? (
        <div className="loading">Suche Definitionen …</div>
      ) : rows.length === 0 ? (
        <div className="stack small">
          <p>In dieser Mitschrift wurden keine Definitionen erkannt.</p>
          <p className="muted">
            So werden sie gefunden: Begriff <strong>fett</strong> an den Absatzanfang, dann Doppelpunkt oder „ist …“ – z. B. <strong>Willenserklärung:</strong> Äußerung eines
            Willens, der auf eine Rechtsfolge gerichtet ist. Oder den Absatz mit „Definition:“ beginnen.
          </p>
        </div>
      ) : (
        <div className="stack">
          <p className="small muted">Gefunden in dieser Mitschrift. Texte lassen sich vor dem Übernehmen anpassen. Sie gelten als eigene Mitschrift aus der Vorlesung, nicht als geprüfte Quelle.</p>
          <div className="harvest-list">
            {rows.map((r, i) => (
              <div key={`${r.term}-${i}`} className={`harvest-row ${r.pick ? "is-picked" : ""}`}>
                <input type="checkbox" checked={r.pick} onChange={(e) => set(i, { pick: e.target.checked })} aria-label={`„${r.term}“ übernehmen`} />
                <div className="grow stack-tight">
                  <input className="harvest-term" value={r.term} onChange={(e) => set(i, { term: e.target.value, termFrom: null, termTo: null })} aria-label="Begriff" />
                  <textarea rows={2} value={r.text} onChange={(e) => set(i, { text: e.target.value })} aria-label={`Definition von ${r.term}`} />
                  {r.existing && <span className="xs warn-text">Steht schon im Glossar{r.existing.field ? ` (${r.existing.field})` : ""} – wird sonst doppelt angelegt.</span>}
                  {!r.existing && r.linked && <span className="xs muted">Im Text bereits verlinkt.</span>}
                </div>
              </div>
            ))}
          </div>
          <label className="row small">
            Rechtsgebiet <input value={field} onChange={(e) => setField(e.target.value)} placeholder="z. B. BGB AT" style={{ maxWidth: 220 }} />
          </label>
          <label className="row small">
            <input type="checkbox" checked={asCards} onChange={(e) => setAsCards(e.target.checked)} /> zugleich als Karteikarte („Definiere: …“)
          </label>
          <label className="row small">
            <input type="checkbox" checked={link} onChange={(e) => setLink(e.target.checked)} /> Begriff im Text mit dem Glossar verlinken
          </label>
        </div>
      )}
    </Dialog>
  );
}
