import type { Editor } from "@tiptap/react";
import { generateJSON } from "@tiptap/core";
import { Sparkles } from "lucide-react";
import { useEffect, useState } from "react";

import { aiErrorMessage, appClient } from "../../ai/client";
import { Anonymizer, configFromSettings } from "../../ai/privacy/anonymize";
import { createCase, prepareNotes, reviewSolution, suggestCards, type CardSuggestion, type Difficulty, type TrainingCase } from "../../ai/study";
import { api } from "../../api";
import type { StudyNode } from "../../api/types";
import { markdownToHtml } from "../../lib/docxImport";
import { doc, h, i, p, type PMNode } from "../../lib/pm";
import { reportError, useApp } from "../../state/store";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { Field } from "../../ui/misc";
import { editorExtensions } from "../editor/extensions";
import { createNode } from "../navigation/actions";
import { Markdown } from "./Answer";
import { useAiReady, useAssistantPanel } from "./AssistantPanel";

export type StudyMode = "aufbereiten" | "karteikarten" | "uebungsfall" | "korrektur";

const TITLE: Record<StudyMode, string> = {
  aufbereiten: "Mitschrift aufbereiten (KI)",
  karteikarten: "Karteikarten vorschlagen (KI)",
  uebungsfall: "Übungsfall erstellen (KI)",
  korrektur: "Lösung besprechen (KI)",
};

const INTRO: Record<StudyMode, string> = {
  aufbereiten: "Claude ordnet die Mitschrift zu einem Lernskript: Gliederung, Kernaussagen, Definitionen, Schemata, Lücken und Wiederholungsfragen. Deine Mitschrift bleibt unverändert.",
  karteikarten: "Claude schlägt Karteikarten zu dieser Notiz vor. Du wählst aus, welche angelegt werden.",
  uebungsfall: "Claude erstellt einen Übungsfall zum Stoff dieser Notiz. Er wird als neue Fall-Notiz angelegt; die Lösungsskizze bleibt verdeckt, bis du sie aufdeckst.",
  korrektur: "Claude gibt Rückmeldung zu deiner Lösung: Aufbau, erkannte Probleme, Gutachtenstil, nächste Schritte – ohne Note.",
};

/** Text unter der Überschrift „Lösung“ (sonst der ganze Text). */
export function solutionText(text: string): string {
  const m = /(?:^|\n)Lösung\s*\n([\s\S]*?)(?=\nRückmeldung \(KI|$)/.exec(text);
  return (m?.[1] ?? text).trim();
}

export function caseDoc(c: TrainingCase): PMNode {
  const paras = (s: string) => s.split(/\n{2,}|\n/).filter((x) => x.trim()).map((x) => p(x.trim()));
  return doc(
    h(1, c.title || "Übungsfall"),
    p(i("Übungsfall, von der KI erstellt (ungeprüft).")),
    h(2, "Sachverhalt"),
    ...paras(c.facts),
    h(2, "Fallfrage"),
    p(c.question),
    ...(c.hint ? [p(i(c.hint))] : []),
    h(2, "Lösung"),
    p(""),
  );
}

export function StudyDialog({ mode, node, text, editor, onClose }: { mode: StudyMode; node: StudyNode; text: string; editor: Editor; onClose: () => void }) {
  const { consent, status } = useAiReady();
  const toast = useApp((s) => s.toast);
  const bump = useApp((s) => s.bump);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [md, setMd] = useState<string | null>(null);
  const [cards, setCards] = useState<(CardSuggestion & { on: boolean })[] | null>(null);
  const [difficulty, setDifficulty] = useState<Difficulty>("anfaenger");
  const [sent, setSent] = useState<string | null>(null);
  const [showSketch, setShowSketch] = useState(false);
  const training = (node.meta?.training ?? null) as { facts: string; question: string; sketch: string } | null;

  useEffect(() => setError(null), [mode]);
  const ready = consent === true && status?.available;
  const tooShort = mode !== "korrektur" && text.trim().length < 80;

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const s = await api.settingsAll();
      const o = { llm: await appClient(api), anonymizer: new Anonymizer(configFromSettings(s["ai.anonymize"])) };
      if (mode === "aufbereiten") {
        const r = await prepareNotes(o, node.title, text);
        setMd(r.value);
        setSent(r.sent);
      } else if (mode === "karteikarten") {
        const r = await suggestCards(o, node.title, text);
        setCards(r.value.map((c) => ({ ...c, on: true })));
        setSent(r.sent);
      } else if (mode === "uebungsfall") {
        const r = await createCase(o, node.title, text, difficulty);
        const n = await createNode({
          areaId: node.area_id,
          parentId: node.parent_id,
          kind: "note",
          title: r.value.title ? `Übungsfall: ${r.value.title}` : "Übungsfall",
          meta: { noteType: "fall", training: { facts: r.value.facts, question: r.value.question, sketch: r.value.sketch.slice(0, 40_000) } },
          contentJson: JSON.stringify(caseDoc(r.value)),
        });
        if (n) toast("Übungsfall angelegt. Schreib deine Lösung unter „Lösung“ und lass sie dann besprechen (Hut-Symbol „KI-Lernhilfen“ → Lösung besprechen).", "success");
        onClose();
      } else if (training) {
        const r = await reviewSolution(o, training, solutionText(text));
        setMd(r.value);
        setSent(r.sent);
      }
    } catch (e) {
      setError(aiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const toDoc = (markdown: string) => generateJSON(markdownToHtml(markdown), editorExtensions()) as PMNode;

  const saveCards = async () => {
    const chosen = (cards ?? []).filter((c) => c.on);
    try {
      for (const c of chosen)
        await api.cardCreate({ area_id: node.area_id, kind: c.kind, front: c.front, back: c.back, tags: "KI-Vorschlag", source_type: "node", source_id: node.id });
      bump();
      toast(`${chosen.length} Karteikarten angelegt.`, "success");
      onClose();
    } catch (e) {
      reportError(e);
    }
  };

  const footer = (
    <>
      <span className="grow xs muted">{sent ? "Anonymisiert an Anthropic gesendet. Ergebnis ungeprüft – bitte kontrollieren." : ""}</span>
      <Button onClick={onClose}>Schließen</Button>
      {ready && !md && !cards && (
        <Button variant="primary" icon={<Sparkles size={15} />} disabled={busy || tooShort || (mode === "korrektur" && !training)} onClick={() => void run()}>
          {busy ? "Claude arbeitet …" : "Starten"}
        </Button>
      )}
      {md && mode === "aufbereiten" && (
        <>
          <Button
            onClick={() => {
              editor.chain().focus("end").insertContent([{ type: "horizontalRule" }, ...(toDoc(`## Lernskript (KI, ungeprüft)\n\n${md.replace(/^# .*\n/, "")}`).content ?? [])]).run();
              onClose();
            }}
          >
            Unter der Mitschrift einfügen
          </Button>
          <Button
            variant="primary"
            onClick={async () => {
              const d = toDoc(`*Aufbereitet aus „${node.title}“ mit KI – ungeprüft.*\n\n${md}`);
              await createNode({ areaId: node.area_id, parentId: node.parent_id, kind: "note", title: `Lernskript: ${node.title}`, meta: { noteType: "zusammenfassung" }, contentJson: JSON.stringify(d) });
              onClose();
            }}
          >
            Als neue Zusammenfassung speichern
          </Button>
        </>
      )}
      {md && mode === "korrektur" && (
        <Button
          variant="primary"
          onClick={() => {
            editor.chain().focus("end").insertContent(toDoc(`## Rückmeldung (KI, ungeprüft)\n\n${md}`).content ?? []).run();
            onClose();
          }}
        >
          Unter der Lösung einfügen
        </Button>
      )}
      {cards && (
        <Button variant="primary" disabled={!cards.some((c) => c.on)} onClick={() => void saveCards()}>
          {cards.filter((c) => c.on).length} Karten anlegen
        </Button>
      )}
    </>
  );

  return (
    <Dialog title={TITLE[mode]} onClose={onClose} width={720} footer={footer}>
      <div className="stack study-dialog">
        {consent === null || !status ? (
          <div className="loading">Lade …</div>
        ) : !ready ? (
          <div className="notice">
            <p className="small">Für die KI-Lernhilfen muss der KI-Assistent eingerichtet sein (Zustimmung und API-Schlüssel bzw. PIN).</p>
            <Button
              icon={<Sparkles size={15} />}
              onClick={() => {
                onClose();
                useAssistantPanel.getState().toggle(true);
              }}
            >
              KI-Assistent öffnen
            </Button>
          </div>
        ) : (
          <>
            {!md && !cards && <p className="small">{INTRO[mode]}</p>}
            {tooShort && !md && !cards && <p className="small notice notice-warn">Die Notiz ist noch sehr kurz – schreib zuerst etwas mehr Stoff hinein.</p>}
            {mode === "korrektur" && !training && <p className="small notice notice-warn">Diese Notiz ist kein KI-Übungsfall. Erstelle zuerst einen Übungsfall (Hut-Symbol „KI-Lernhilfen“ → Übungsfall erstellen).</p>}
            {mode === "uebungsfall" && (
              <Field label="Schwierigkeit">
                <select value={difficulty} onChange={(e) => setDifficulty(e.target.value as Difficulty)}>
                  <option value="anfaenger">Anfänger (60 Minuten)</option>
                  <option value="fortgeschritten">Fortgeschrittene (120 Minuten)</option>
                  <option value="examen">Examensniveau (5 Stunden)</option>
                </select>
              </Field>
            )}
            {busy && <div className="loading">Claude arbeitet … (das kann eine Minute dauern)</div>}
            {error && <p className="error-text small">{error}</p>}
            {md && (
              <div className="study-result prose-ui">
                <Markdown text={md} onSource={() => {}} />
              </div>
            )}
            {mode === "korrektur" && md && training && (
              <div>
                <Button size="sm" variant="ghost" onClick={() => setShowSketch((v) => !v)}>
                  {showSketch ? "Lösungsskizze verbergen" : "Lösungsskizze aufdecken"}
                </Button>
                {showSketch && (
                  <div className="study-result prose-ui">
                    <Markdown text={training.sketch} onSource={() => {}} />
                  </div>
                )}
              </div>
            )}
            {cards && (
              <div className="list study-cards" role="list" aria-label="Vorgeschlagene Karteikarten">
                {cards.map((c, idx) => (
                  <label key={idx} className="list-row study-card" role="listitem">
                    <input type="checkbox" checked={c.on} onChange={(e) => setCards(cards.map((x, j) => (j === idx ? { ...x, on: e.target.checked } : x)))} />
                    <span className="grow" style={{ minWidth: 0 }}>
                      <strong className="block">{c.front}</strong>
                      <span className="small muted block">{c.back}</span>
                    </span>
                    <span className="chip xs">{c.kind === "definition" ? "Definition" : c.kind === "norm" ? "Norm" : "Frage"}</span>
                  </label>
                ))}
              </div>
            )}
            {sent && (
              <details className="xs muted">
                <summary>An Anthropic gesendet</summary>
                <pre className="sent-preview">{sent}</pre>
              </details>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}
