/**
 * Skizzen-Editor: Personen anlegen und mit dem Finger verschieben, Beziehung
 * ziehen (erst „Beziehung“, dann zwei Personen antippen), Art, Richtung und
 * Beschriftung (z. B. Norm) festlegen; aus Kurzschreibweise einlesen.
 */
import { ArrowLeftRight, LayoutGrid, Plus, Trash2, Type, UserPlus } from "lucide-react";
import { createElement, useMemo, useRef, useState, type ReactNode } from "react";

import {
  autoLayout,
  DIR_LABEL,
  H,
  KIND_LABEL,
  preset,
  sketchFromText,
  sketchSpec,
  sketchText,
  uid,
  W,
  type Direction,
  type Relation,
  type RelationKind,
  type Sketch,
} from "../../lib/personenskizze";
import { Button } from "../../ui/Button";
import { confirmDialog, Dialog } from "../../ui/Dialog";
import { Field } from "../../ui/misc";

type Spec = [string, Record<string, string>, ...(Spec | string)[]];

/** DOM-Beschreibung → React (gleiches Bild wie im Text); `root` ergänzt Eigenschaften des äußersten Elements */
function toReact(spec: Spec | string, key: number | string = 0, root?: Record<string, unknown>): ReactNode {
  if (typeof spec === "string") return spec;
  const [tag, attrs, ...kids] = spec;
  const name = tag.includes(" ") ? tag.split(" ")[1]! : tag;
  const props: Record<string, unknown> = { key };
  for (const [k, v] of Object.entries(attrs)) {
    const rk = k === "class" ? "className" : k.startsWith("aria-") || k.startsWith("data-") ? k : k.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    props[rk] = v;
  }
  if (root) Object.assign(props, root, { className: `${String(props.className ?? "")} ${String(root.className ?? "")}`.trim() });
  return createElement(name, props, ...kids.map((k, i) => toReact(k, i)));
}

export function PersonSketchDialog({ sketch: initial, onSave, onDelete, onClose }: { sketch: Sketch; onSave: (s: Sketch) => void; onDelete: () => void; onClose: () => void }) {
  const [s, setS] = useState<Sketch>(() => (initial.persons.length ? initial : { ...initial }));
  const [sel, setSel] = useState<string | null>(null);
  const [linking, setLinking] = useState<string | null | false>(false);
  const [text, setText] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const drag = useRef<{ id: string; dx: number; dy: number; moved: boolean } | null>(null);

  const person = s.persons.find((p) => p.id === sel);
  const relation = s.relations.find((r) => r.id === sel);
  const spec = useMemo(() => {
    const sp = sketchSpec(s, { selected: sel }) as Spec;
    // im Editor: immer die ganze Fläche (sonst springt das Bild beim Verschieben)
    sp[1] = { ...sp[1], viewBox: `0 0 ${W} ${H}` };
    return sp;
  }, [s, sel]);

  const toLocal = (e: { clientX: number; clientY: number }) => {
    const svg = svgRef.current;
    const m = svg?.getScreenCTM();
    if (!svg || !m) return { x: 0, y: 0 };
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  };
  const update = (fn: (s: Sketch) => Sketch) => setS((x) => fn(x));
  const addPerson = () => {
    const names = s.persons.map((p) => p.name);
    const name = ["A", "B", "C", "D", "E", "F", "G", "H", "K", "V", "X", "Y"].find((n) => !names.includes(n)) ?? `P${s.persons.length + 1}`;
    const id = uid("p");
    const n = s.persons.length;
    update((x) => ({ ...x, persons: [...x.persons, { id, name, role: "", x: 110 + ((n * 150) % (W - 160)), y: 70 + Math.floor((n * 150) / (W - 160)) * 110 }] }));
    setSel(id);
  };
  const link = (from: string, to: string) => {
    if (from === to) return;
    const id = uid("r");
    update((x) => ({ ...x, relations: [...x.relations, { id, from, to, kind: "anspruch", dir: "vor", label: "" }] }));
    setSel(id);
    setLinking(false);
  };
  const setRel = (p: Partial<Relation>) => update((x) => ({ ...x, relations: x.relations.map((r) => (r.id === sel ? { ...r, ...p } : r)) }));
  const removeSel = () => {
    if (person) update((x) => ({ persons: x.persons.filter((p) => p.id !== sel), relations: x.relations.filter((r) => r.from !== sel && r.to !== sel) }));
    else if (relation) update((x) => ({ ...x, relations: x.relations.filter((r) => r.id !== sel) }));
    setSel(null);
  };

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const t = e.target as Element;
    const pg = t.closest("[data-person]");
    const rg = t.closest("[data-rel]");
    if (pg) {
      const id = pg.getAttribute("data-person")!;
      if (linking !== false) {
        if (linking === null) setLinking(id);
        else link(linking, id);
        return;
      }
      const p = s.persons.find((x) => x.id === id)!;
      const at = toLocal(e);
      drag.current = { id, dx: at.x - p.x, dy: at.y - p.y, moved: false };
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
      setSel(id);
    } else if (rg) setSel(rg.getAttribute("data-rel"));
    else setSel(null);
  };
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d) return;
    const at = toLocal(e);
    d.moved = true;
    const x = Math.round(Math.min(W - 30, Math.max(30, at.x - d.dx)));
    const y = Math.round(Math.min(H - 25, Math.max(25, at.y - d.dy)));
    update((v) => ({ ...v, persons: v.persons.map((p) => (p.id === d.id ? { ...p, x, y } : p)) }));
  };
  const onPointerUp = () => {
    drag.current = null;
  };
  const name = (id: string) => s.persons.find((p) => p.id === id)?.name ?? "?";

  return (
    <Dialog
      title="Personenskizze"
      onClose={onClose}
      width={980}
      footer={
        <>
          <Button
            variant="ghost"
            icon={<Trash2 size={14} />}
            onClick={async () => {
              if (await confirmDialog({ title: "Personenskizze entfernen?", message: "Die Skizze wird aus der Mitschrift gelöscht (Rückgängig mit ⌘Z).", confirm: "Entfernen", danger: true })) onDelete();
            }}
          >
            Skizze entfernen
          </Button>
          <span className="grow" />
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" onClick={() => onSave(s)}>
            Übernehmen
          </Button>
        </>
      }
    >
      <div className="ps-editor">
        <div className="row wrap ps-tools">
          <Button size="sm" icon={<UserPlus size={14} />} onClick={addPerson}>
            Person
          </Button>
          <Button size="sm" variant={linking !== false ? "primary" : "secondary"} icon={<ArrowLeftRight size={14} />} disabled={s.persons.length < 2} onClick={() => setLinking(linking === false ? (person ? person.id : null) : false)}>
            {linking === false ? "Beziehung" : linking === null ? "Erste Person antippen …" : `${name(linking)} → zweite Person antippen …`}
          </Button>
          <Button size="sm" variant="ghost" icon={<LayoutGrid size={14} />} disabled={s.persons.length < 2} onClick={() => update((x) => ({ ...x, persons: autoLayout(x.persons) }))}>
            Anordnen
          </Button>
          <Button size="sm" variant="ghost" icon={<Type size={14} />} onClick={() => setText(sketchText(s).join("\n"))}>
            Als Text
          </Button>
          {!s.persons.length && (
            <>
              <span className="xs muted">Vorlage:</span>
              <Button size="sm" variant="ghost" onClick={() => setS(preset("zwei"))}>
                Käufer – Verkäufer
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setS(preset("kette"))}>
                Eigentümer – Veräußerer – Dritter
              </Button>
            </>
          )}
        </div>
        <div className="ps-body">
          <div className="ps-canvas">
            <div className="ps-canvas-inner">{toReact(spec, "svg", { ref: svgRef, onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp, className: "is-editing" })}</div>
            {!s.persons.length && <p className="ps-empty small muted">„Person“ tippen oder eine Vorlage wählen. Personen lassen sich mit dem Finger verschieben.</p>}
          </div>
          <aside className="ps-side">
            {person ? (
              <>
                <h3 className="label">Person</h3>
                <Field label="Kürzel / Name">
                  <input value={person.name} maxLength={40} aria-label="Kürzel / Name" onChange={(e) => update((x) => ({ ...x, persons: x.persons.map((p) => (p.id === sel ? { ...p, name: e.target.value } : p)) }))} />
                </Field>
                <Field label="Rolle (optional)">
                  <input value={person.role} maxLength={60} placeholder="z. B. Käufer, Erbe, Täter" aria-label="Rolle" onChange={(e) => update((x) => ({ ...x, persons: x.persons.map((p) => (p.id === sel ? { ...p, role: e.target.value } : p)) }))} />
                </Field>
                <div className="row wrap">
                  <Button size="sm" icon={<ArrowLeftRight size={14} />} onClick={() => setLinking(person.id)}>
                    Beziehung von {person.name}
                  </Button>
                  <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} onClick={removeSel}>
                    Person löschen
                  </Button>
                </div>
              </>
            ) : relation ? (
              <>
                <h3 className="label">Beziehung</h3>
                <div className="row wrap ps-pair">
                  <select value={relation.from} aria-label="Von" onChange={(e) => setRel({ from: e.target.value })}>
                    {s.persons.map((p) => (
                      <option key={p.id} value={p.id} disabled={p.id === relation.to}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <Button size="sm" variant="ghost" title="Richtung tauschen" onClick={() => setRel({ from: relation.to, to: relation.from })}>
                    ⇄
                  </Button>
                  <select value={relation.to} aria-label="Nach" onChange={(e) => setRel({ to: e.target.value })}>
                    {s.persons.map((p) => (
                      <option key={p.id} value={p.id} disabled={p.id === relation.from}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                <Field label="Art">
                  <select value={relation.kind} aria-label="Art" onChange={(e) => setRel({ kind: e.target.value as RelationKind, ...(e.target.value === "vertrag" ? { dir: "keine" as Direction } : relation.dir === "keine" ? { dir: "vor" as Direction } : {}) })}>
                    {Object.entries(KIND_LABEL).map(([k, l]) => (
                      <option key={k} value={k}>
                        {l}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Pfeil">
                  <select value={relation.dir} aria-label="Pfeil" onChange={(e) => setRel({ dir: e.target.value as Direction })}>
                    {Object.entries(DIR_LABEL).map(([k, l]) => (
                      <option key={k} value={k}>
                        {l.replace("von", name(relation.from)).replace("nach", name(relation.to))}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Beschriftung" hint="z. B. § 433 Abs. 2 BGB, Kaufvertrag, übereignet">
                  <input value={relation.label} maxLength={80} aria-label="Beschriftung" onChange={(e) => setRel({ label: e.target.value })} autoFocus />
                </Field>
                <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} onClick={removeSel}>
                  Beziehung löschen
                </Button>
              </>
            ) : (
              <>
                <h3 className="label">Beziehungen</h3>
                {s.relations.length ? (
                  <ul className="ps-rel-list">
                    {sketchText(s).map((t, i) => (
                      <li key={s.relations[i]!.id}>
                        <button className="link-btn" onClick={() => setSel(s.relations[i]!.id)}>
                          {t}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="xs muted">Noch keine. „Beziehung“ tippen, dann nacheinander zwei Personen.</p>
                )}
                <p className="xs muted">Pfeil = Anspruch (von Anspruchsteller zu Anspruchsgegner), Linie = Vertrag, gestrichelt = Handlung/Leistung, gepunktet = sonstige Beziehung.</p>
              </>
            )}
          </aside>
        </div>
        {text !== null && (
          <div className="ps-text">
            <Field label="Als Text (eine Beziehung je Zeile)" hint="A —§ 433 I BGB→ G · A ←§ 433 II BGB— G · A —Kaufvertrag— G · V —übereignet→ K">
              <textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} aria-label="Skizze als Text" />
            </Field>
            <div className="row">
              <Button
                size="sm"
                variant="primary"
                icon={<Plus size={14} />}
                onClick={() => {
                  const next = sketchFromText(text);
                  // vorhandene Positionen und Rollen beibehalten
                  const keep = new Map(s.persons.map((p) => [p.name.toLowerCase(), p]));
                  setS({
                    persons: next.persons.map((p) => {
                      const old = keep.get(p.name.toLowerCase());
                      return old ? { ...p, x: old.x, y: old.y, role: old.role } : p;
                    }),
                    relations: next.relations,
                  });
                  setText(null);
                  setSel(null);
                }}
              >
                Aus Text übernehmen
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setText(null)}>
                Schließen
              </Button>
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}
