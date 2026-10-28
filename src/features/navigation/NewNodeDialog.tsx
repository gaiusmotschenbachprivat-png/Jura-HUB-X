import { useMemo, useState } from "react";

import type { NodeKind, StudyNode } from "../../api/types";
import { KIND_LABEL, SUGGESTED_CHILDREN } from "../../lib/kinds";
import { lectureDoc, lectureTitle, nextLectureNumber, NOTE_TYPES, noteTypeInfo, todayIso, type NoteType } from "../../lib/noteTypes";
import { GUTACHTEN_ARTEN } from "../../lib/gutachtenVorlagen";
import { gebietOf } from "../../lib/schemaLibrary";
import { TEMPLATES } from "../../lib/templates";
import { buildTree, type TreeItem } from "../../lib/tree";
import { useApp } from "../../state/store";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { Field } from "../../ui/misc";
import { createNode, defaultTitle } from "./actions";
import { KindIcon, NoteTypeIcon } from "./icons";

export interface NewNodeRequest {
  parentId: string | null;
  areaId: string | null;
  kind?: NodeKind;
  noteType?: NoteType;
}

type Choice = { type: "note"; noteType: NoteType } | { type: "structure"; kind: Exclude<NodeKind, "note"> };

const STRUCTURE: Exclude<NodeKind, "note">[] = ["semester", "module", "course", "session", "topic", "folder"];
const STRUCTURE_HINT: Record<Exclude<NodeKind, "note">, string> = {
  semester: "z. B. Wintersemester 2026/27",
  module: "Fach mit mehreren Veranstaltungen",
  course: "Vorlesung, Seminar, AG",
  session: "einzelner Termin mit Unterlagen",
  topic: "Thema innerhalb eines Fachs",
  folder: "freie Ablage",
};

/** Nächste Veranstaltung (oder Modul) über einem Knoten – für Dozent/in und Titel. */
function courseAbove(nodes: StudyNode[], id: string | null): StudyNode | undefined {
  const map = new Map(nodes.map((n) => [n.id, n]));
  let cur = id ? map.get(id) : undefined;
  for (let i = 0; cur && i < 50; i++) {
    if (cur.kind === "course") return cur;
    cur = cur.parent_id ? map.get(cur.parent_id) : undefined;
  }
  return undefined;
}

function initialChoice(req: NewNodeRequest, parent?: StudyNode): Choice {
  if (req.noteType) return { type: "note", noteType: req.noteType };
  if (req.kind && req.kind !== "note") return { type: "structure", kind: req.kind };
  if (req.kind === "note") return { type: "note", noteType: "notiz" };
  if (parent && (parent.kind === "course" || parent.kind === "session")) return { type: "note", noteType: "vorlesung" };
  return { type: "note", noteType: "notiz" };
}

export function NewNodeDialog({ req, onClose }: { req: NewNodeRequest; onClose: () => void }) {
  const areas = useApp((s) => s.areas);
  const nodes = useApp((s) => s.nodes);
  const reqParent = req.parentId ? nodes.find((n) => n.id === req.parentId) : undefined;
  const [choice, setChoice] = useState<Choice>(() => initialChoice(req, reqParent));
  const [areaId, setAreaId] = useState(reqParent?.area_id ?? req.areaId ?? areas.find((a) => !a.archived_at)?.id ?? "");
  const [parentId, setParentId] = useState<string | null>(req.parentId);
  const [title, setTitle] = useState("");
  const [titleTouched, setTitleTouched] = useState(false);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const parent = parentId ? nodes.find((n) => n.id === parentId) : undefined;
  const course = courseAbove(nodes, parentId);
  const [topic, setTopic] = useState("");
  const [date, setDate] = useState(todayIso());
  const [lecturer, setLecturer] = useState<string | null>(null);
  const [nrText, setNrText] = useState<string | null>(null);
  const autoNr = nextLectureNumber(nodes, parentId, areaId);
  const nr = nrText === null ? autoNr : Number(nrText) || null;
  const lecturerValue = lecturer ?? (typeof course?.meta?.lecturer === "string" ? course.meta.lecturer : "");

  const isLecture = choice.type === "note" && choice.noteType === "vorlesung";
  const autoTitle =
    choice.type === "structure" ? defaultTitle(choice.kind) : isLecture ? lectureTitle(nr, topic) : noteTypeInfo(choice.noteType).label;
  const finalTitle = (titleTouched ? title : autoTitle).trim() || autoTitle;
  const isFall = choice.type === "note" && choice.noteType === "fall";
  // Fall/Gutachten: Vorlage nach Rechtsgebiet des Studienbereichs bzw. Ablageorts vorschlagen
  const gebietHint = gebietOf([areas.find((a) => a.id === areaId)?.name, parent?.title, course?.title].join(" "));
  const fallDefault = gebietHint === "zivil" ? "gutachten-zivil" : gebietHint === "straf" ? "gutachten-straf" : gebietHint === "oeff" ? "gutachten-oeff-klage" : "gutachten";
  const tplId = choice.type === "note" ? (templateId ?? (isFall ? fallDefault : noteTypeInfo(choice.noteType).template)) : null;

  // Ablageorte: Strukturelemente des Bereichs (keine Notizen), eingerückt
  const places = useMemo(() => {
    const out: { id: string; label: string; depth: number }[] = [];
    const walk = (items: TreeItem[]) =>
      items.forEach((it) => {
        if (it.node.kind === "note") return;
        out.push({ id: it.node.id, label: it.node.title, depth: it.depth });
        walk(it.children);
      });
    walk(buildTree(nodes.filter((n) => n.area_id === areaId)));
    return out;
  }, [nodes, areaId]);

  const structureKinds = useMemo(() => {
    const sug = SUGGESTED_CHILDREN[parent?.kind ?? "root"].filter((k): k is Exclude<NodeKind, "note"> => k !== "note");
    return [...sug, ...STRUCTURE.filter((k) => !sug.includes(k))];
  }, [parent]);

  const pick = (c: Choice) => {
    setChoice(c);
    setTemplateId(null);
  };

  const submit = async () => {
    if (!areaId) return;
    setBusy(true);
    let n: StudyNode | null;
    if (choice.type === "structure") {
      n = await createNode({ areaId, parentId, kind: choice.kind, title: finalTitle });
    } else if (isLecture) {
      const meta = { noteType: "vorlesung", date, number: nr ?? undefined, lecturer: lecturerValue || undefined };
      n = await createNode({
        areaId,
        parentId,
        kind: "note",
        title: finalTitle,
        meta,
        templateId: tplId ?? undefined,
        contentJson: tplId === "mitschrift" ? JSON.stringify(lectureDoc({ title: finalTitle, date, lecturer: lecturerValue, course: course?.title })) : undefined,
      });
    } else {
      n = await createNode({ areaId, parentId, kind: "note", title: finalTitle, meta: { noteType: choice.noteType }, templateId: tplId ?? undefined });
    }
    setBusy(false);
    if (n) onClose();
  };

  const selected = (c: Choice) =>
    c.type === choice.type && (c.type === "note" ? c.noteType === (choice as { noteType: NoteType }).noteType : c.kind === (choice as { kind: NodeKind }).kind);

  return (
    <Dialog
      title={reqParent ? `Neu in „${reqParent.title}“` : "Neu anlegen"}
      onClose={onClose}
      width={640}
      footer={
        <>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" onClick={submit} disabled={busy || !areaId}>
            Anlegen
          </Button>
        </>
      }
    >
      <form
        className="stack new-node"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div>
          <div className="label new-node-group">Schreiben</div>
          <div className="type-grid" role="radiogroup" aria-label="Schreiben">
            {NOTE_TYPES.map((t) => {
              const c: Choice = { type: "note", noteType: t.id };
              return (
                <button
                  key={t.id}
                  type="button"
                  role="radio"
                  aria-checked={selected(c)}
                  className={`type-tile ${selected(c) ? "is-selected" : ""}`}
                  style={{ "--tile": t.color } as React.CSSProperties}
                  onClick={() => pick(c)}
                >
                  <NoteTypeIcon type={t.id} size={18} />
                  <span className="type-tile-label">{t.label}</span>
                  <span className="type-tile-hint">{t.hint}</span>
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <div className="label new-node-group">Ordnen</div>
          <div className="type-grid is-compact" role="radiogroup" aria-label="Ordnen">
            {structureKinds.map((k) => {
              const c: Choice = { type: "structure", kind: k };
              return (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={selected(c)}
                  className={`type-tile ${selected(c) ? "is-selected" : ""}`}
                  onClick={() => pick(c)}
                  title={STRUCTURE_HINT[k]}
                >
                  <KindIcon kind={k} size={16} />
                  <span className="type-tile-label">{KIND_LABEL[k]}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="new-node-details">
          {isLecture && (
            <div className="form-row">
              <Field label="Nr.">
                <input
                  className="tnum"
                  inputMode="numeric"
                  value={nrText ?? String(autoNr)}
                  onChange={(e) => setNrText(e.target.value.replace(/\D/g, "").slice(0, 3))}
                  style={{ width: 64 }}
                  aria-label="Nummer der Vorlesung"
                />
              </Field>
              <Field label="Datum">
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Datum der Vorlesung" />
              </Field>
              <Field label="Thema (optional)">
                <input value={topic} maxLength={200} placeholder="z. B. Anfechtung" onChange={(e) => setTopic(e.target.value)} aria-label="Thema" />
              </Field>
            </div>
          )}
          <Field label="Titel">
            <input
              id="new-title"
              autoFocus={!isLecture}
              value={titleTouched ? title : autoTitle}
              maxLength={300}
              onChange={(e) => {
                setTitleTouched(true);
                setTitle(e.target.value);
              }}
            />
          </Field>
          {isLecture && (
            <Field label="Dozent/in">
              <input value={lecturerValue} maxLength={200} placeholder="z. B. Prof. Dr. Muster" onChange={(e) => setLecturer(e.target.value)} />
            </Field>
          )}
          <div className="form-row">
            <Field label="Studienbereich">
              <select
                id="new-area"
                value={areaId}
                onChange={(e) => {
                  setAreaId(e.target.value);
                  setParentId(null);
                }}
              >
                {areas
                  .filter((a) => !a.archived_at)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Ablegen in">
              <select id="new-parent" value={parentId ?? ""} onChange={(e) => setParentId(e.target.value || null)}>
                <option value="">– oberste Ebene –</option>
                {places.map((pl) => (
                  <option key={pl.id} value={pl.id}>
                    {" ".repeat(pl.depth)}
                    {pl.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          {isFall && (
            <Field label="Gutachten nach Rechtsgebiet" hint="Jedes Rechtsgebiet hat seinen eigenen Aufbau – die Vorlage gibt ihn mit farbigem Gutachtenstil vor.">
              <div className="seg wrap" role="radiogroup" aria-label="Rechtsgebiet des Gutachtens">
                {GUTACHTEN_ARTEN.map((a) => {
                  const id = a.id === "allgemein" ? "gutachten" : `gutachten-${a.id}`;
                  return (
                    <button key={a.id} type="button" role="radio" aria-checked={tplId === id} className={tplId === id ? "is-active" : ""} onClick={() => setTemplateId(id)}>
                      {a.label}
                    </button>
                  );
                })}
              </div>
            </Field>
          )}
          {choice.type === "note" && (
            <Field label="Vorlage" hint={TEMPLATES.find((t) => t.id === tplId)?.description}>
              <select id="new-template" value={tplId ?? "leer"} onChange={(e) => setTemplateId(e.target.value)}>
                {(["Allgemein", "Jura", "Wirtschaft"] as const).map((g) => (
                  <optgroup key={g} label={g}>
                    {TEMPLATES.filter((t) => t.group === g).map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </Field>
          )}
        </div>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

