/**
 * Claude-App-Brücke (ohne API-Kosten): Anfrage kopieren → in der Claude-App
 * einfügen → Antwort kopieren → hier einfügen. Studium OS prüft die Zitate,
 * setzt anonymisierte Angaben wieder ein und verarbeitet die Antwort weiter.
 */
import { ClipboardPaste, Copy, ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";

import { CLAUDE_URL } from "../../ai/bridge";
import { aiErrorMessage } from "../../ai/client";
import { useApp } from "../../state/store";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { useAssistant } from "./state";

/** Die zwei Schritte: Anfrage kopieren und Claude öffnen, Antwort einfügen. */
export function BridgeSteps({ prompt, busy, onAnswer, answerLabel = "Antwort übernehmen" }: { prompt: string | null; busy?: boolean; onAnswer: (text: string) => void; answerLabel?: string }) {
  const toast = useApp((s) => s.toast);
  const [copied, setCopied] = useState(false);
  const [answer, setAnswer] = useState("");
  const copy = () => {
    if (!prompt) return;
    // direkt im Tipp-Ereignis kopieren (Safari erlaubt es sonst nicht)
    navigator.clipboard
      ?.writeText(prompt)
      .then(() => {
        setCopied(true);
        toast("Anfrage kopiert – jetzt in Claude einfügen.", "success");
      })
      .catch(() => toast("Kopieren nicht möglich. Bitte den Text unter „Anfrage ansehen“ markieren und kopieren.", "error"));
  };
  const paste = () => {
    navigator.clipboard
      ?.readText()
      .then((t) => t.trim() && setAnswer(t))
      .catch(() => toast("Einfügen nicht erlaubt – bitte lange ins Feld tippen und „Einsetzen“ wählen.", "error"));
  };
  return (
    <div className="stack bridge">
      <ol className="bridge-steps">
        <li>
          <div className="row wrap">
            <strong className="grow">Anfrage kopieren</strong>
            <Button variant={copied ? "secondary" : "primary"} icon={<Copy size={14} />} disabled={!prompt} onClick={copy}>
              {copied ? "Erneut kopieren" : "Kopieren"}
            </Button>
            <a className={`btn btn-md ${copied ? "btn-primary" : "btn-secondary"}`} href={CLAUDE_URL} target="_blank" rel="noopener noreferrer">
              <ExternalLink size={14} /> Claude öffnen
            </a>
          </div>
          <p className="xs muted">
            In Claude einen neuen Chat beginnen, einfügen und senden. {prompt ? `(${prompt.length.toLocaleString("de-DE")} Zeichen)` : "Wird vorbereitet …"}
          </p>
          {prompt && (
            <details className="xs muted">
              <summary>Anfrage ansehen</summary>
              <pre className="sent-preview">{prompt}</pre>
            </details>
          )}
        </li>
        <li>
          <div className="row wrap">
            <strong className="grow">Antwort von Claude hier einfügen</strong>
            <Button size="sm" variant="ghost" icon={<ClipboardPaste size={13} />} onClick={paste}>
              Aus Zwischenablage
            </Button>
          </div>
          <textarea rows={6} value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="In Claude unter der Antwort auf „Kopieren“ tippen, dann hier einfügen." aria-label="Antwort von Claude" />
          <div className="row">
            <span className="grow xs muted">Zitate und Normen werden danach mit deinen Gesetzen abgeglichen.</span>
            <Button variant="primary" disabled={busy || !answer.trim()} onClick={() => onAnswer(answer)}>
              {busy ? "Wird geprüft …" : answerLabel}
            </Button>
          </div>
        </li>
      </ol>
    </div>
  );
}

/** Frage an den juristischen Assistenten über die Claude-App. */
export function AssistantBridgeDialog({ question, document, onClose }: { question: string; document?: string; onClose: () => void }) {
  const prepare = useAssistant((s) => s.bridgePrepare);
  const accept = useAssistant((s) => s.bridgeAccept);
  const busy = useAssistant((s) => s.busy);
  const [prep, setPrep] = useState<{ prompt: string; userText: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    prepare(question, document).then(setPrep, (e) => setError(aiErrorMessage(e)));
  }, [prepare, question, document]);
  return (
    <Dialog title="In Claude-App fragen (ohne API-Kosten)" onClose={onClose} width={680} footer={<Button onClick={onClose}>Schließen</Button>}>
      <p className="small">
        Studium OS stellt die Anfrage mit den passenden Gesetzestexten zusammen – Namen und persönliche Angaben sind wie gewohnt durch Platzhalter ersetzt. Du fragst in deiner
        Claude-App (mit deinem Abo, ohne zusätzliche Kosten) und fügst die Antwort hier wieder ein.
      </p>
      <p className="ai-user small">{question}</p>
      {error && <p className="error-text small">{error}</p>}
      <BridgeSteps
        prompt={prep?.prompt ?? null}
        busy={busy}
        onAnswer={(answer) => {
          if (!prep) return;
          void accept(question, document, prep.userText, answer)
            .then(onClose)
            .catch((e) => setError(aiErrorMessage(e)));
        }}
      />
    </Dialog>
  );
}
