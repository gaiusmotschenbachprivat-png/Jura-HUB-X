import { useState } from "react";

import type { NodeKind } from "../../api/types";
import { ALL_KINDS, KIND_LABEL, SUGGESTED_CHILDREN } from "../../lib/kinds";
import { TEMPLATES } from "../../lib/templates";
import { useApp } from "../../state/store";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { Field } from "../../ui/misc";
import { createNode, defaultTitle } from "./actions";

export interface NewNodeRequest {
  parentId: string | null;
  areaId: string | null;
  kind?: NodeKind;
}

export function NewNodeDialog({ req, onClose }: { req: NewNodeRequest; onClose: () => void }) {
  const areas = useApp((s) => s.areas);
  const nodes = useApp((s) => s.nodes);
  const parent = req.parentId ? nodes.find((n) => n.id === req.parentId) : undefined;
  const suggestions = SUGGESTED_CHILDREN[parent?.kind ?? "root"];
  const [kind, setKind] = useState<NodeKind>(req.kind ?? suggestions[0] ?? "note");
  const [title, setTitle] = useState("");
  const [areaId, setAreaId] = useState(parent?.area_id ?? req.areaId ?? areas[0]?.id ?? "");
  const [templateId, setTemplateId] = useState("leer");
  const [busy, setBusy] = useState(false);

  const kinds = [...suggestions, ...ALL_KINDS.filter((k) => !suggestions.includes(k))];
  const submit = async () => {
    if (!areaId) return;
    setBusy(true);
    const n = await createNode({
      areaId,
      parentId: req.parentId,
      kind,
      title: title.trim() || defaultTitle(kind),
      templateId: kind === "note" ? templateId : undefined,
    });
    setBusy(false);
    if (n) onClose();
  };

  return (
    <Dialog
      title={parent ? `Neu in „${parent.title}“` : "Neues Element"}
      onClose={onClose}
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
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label="Art">
          <select id="new-kind" value={kind} onChange={(e) => setKind(e.target.value as NodeKind)}>
            {kinds.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Titel">
          <input
            id="new-title"
            autoFocus
            value={title}
            maxLength={300}
            placeholder={defaultTitle(kind)}
            onChange={(e) => setTitle(e.target.value)}
          />
        </Field>
        {!parent && (
          <Field label="Studienbereich">
            <select id="new-area" value={areaId} onChange={(e) => setAreaId(e.target.value)}>
              {areas.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        {kind === "note" && (
          <Field label="Vorlage" hint={TEMPLATES.find((t) => t.id === templateId)?.description}>
            <select id="new-template" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
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
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
