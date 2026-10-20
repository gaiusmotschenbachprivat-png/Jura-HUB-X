/**
 * Diktat in der Mitschrift. Die Spracherkennung übernimmt der Browser bzw.
 * iPadOS (Web Speech API) – je nach Gerät auf dem Gerät oder über Apple-Server,
 * genau wie die Diktierfunktion der Tastatur. Studium OS selbst sendet nichts.
 * Vor der ersten Nutzung wird das erklärt und um Zustimmung gebeten.
 */
import type { Editor } from "@tiptap/react";
import { Clock, Mic, Square } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { api } from "../../api";
import { useApp } from "../../state/store";
import { Button, IconButton } from "../../ui/Button";
import { confirmDialog } from "../../ui/Dialog";

interface RecognitionResult {
  isFinal: boolean;
  0: { transcript: string };
}
interface RecognitionEvent {
  resultIndex: number;
  results: ArrayLike<RecognitionResult>;
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}
type RecognitionCtor = new () => Recognition;

export function recognitionCtor(): RecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** „[10:42] “ – Uhrzeit für die Mitschrift. */
export function timestamp(d = new Date()): string {
  return `[${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}] `;
}

export function insertTimestamp(editor: Editor) {
  editor.chain().focus().insertContent(timestamp()).run();
}

const CONSENT_KEY = "editor.dictationConsent";

export function DictationButton({ editor }: { editor: Editor }) {
  const [active, setActive] = useState(false);
  const [interim, setInterim] = useState("");
  const rec = useRef<Recognition | null>(null);
  const wanted = useRef(false);
  const lastFinal = useRef(0);
  const toast = useApp((s) => s.toast);

  const stop = useCallback(() => {
    wanted.current = false;
    rec.current?.stop();
    setActive(false);
    setInterim("");
  }, []);
  useEffect(() => () => {
    wanted.current = false;
    rec.current?.abort();
  }, []);

  const start = async () => {
    const Ctor = recognitionCtor();
    if (!Ctor) {
      await confirmDialog({
        title: "Diktat",
        message: (
          <>
            <p>Dieser Browser bietet keine eingebaute Spracherkennung für Web-Apps an.</p>
            <p>Auf dem iPad geht es trotzdem: In der Notiz tippen und auf der Bildschirmtastatur die <strong>Mikrofon-Taste</strong> drücken (Diktierfunktion von iPadOS).</p>
          </>
        ),
        confirm: "Verstanden",
      });
      return;
    }
    const settings = await api.settingsAll().catch(() => ({}) as Record<string, unknown>);
    if (settings[CONSENT_KEY] !== true) {
      const ok = await confirmDialog({
        title: "Diktat einschalten?",
        message: (
          <>
            <p>Die Spracherkennung übernimmt iPadOS bzw. der Browser – je nach Gerät auf dem Gerät selbst oder über Server von Apple (bzw. des Browser-Herstellers), wie bei der Diktierfunktion der Tastatur.</p>
            <p>Studium OS sendet dabei nichts an eigene oder fremde Server und speichert keine Tonaufnahmen. Diktiere keine vertraulichen Mandantendaten.</p>
          </>
        ),
        confirm: "Diktat einschalten",
      });
      if (!ok) return;
      await api.settingSet(CONSENT_KEY, true).catch(() => {});
    }
    const r = new Ctor();
    r.lang = "de-DE";
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (e) => {
      let live = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]!;
        const text = res[0].transcript.trim();
        if (!text) continue;
        if (res.isFinal) {
          // Nach einer längeren Pause eine neue Zeile mit Uhrzeit beginnen
          const pause = lastFinal.current && Date.now() - lastFinal.current > 30_000;
          lastFinal.current = Date.now();
          const chain = editor.chain().focus();
          if (pause) chain.splitBlock().insertContent(timestamp());
          chain.insertContent(`${text} `).run();
        } else live += `${text} `;
      }
      setInterim(live.trim());
    };
    r.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        toast("Kein Zugriff auf das Mikrofon. Erlaube es in den iPad-Einstellungen für Safari bzw. die App.", "error");
        stop();
      } else if (e.error !== "no-speech" && e.error !== "aborted") {
        toast(`Diktat unterbrochen (${e.error}).`, "error");
      }
    };
    // Safari beendet die Erkennung nach Pausen – solange gewünscht, neu starten
    r.onend = () => {
      if (wanted.current) {
        try {
          r.start();
          return;
        } catch {
          /* unten beenden */
        }
      }
      setActive(false);
      setInterim("");
    };
    rec.current = r;
    wanted.current = true;
    lastFinal.current = 0;
    editor.chain().focus().insertContent(timestamp()).run();
    try {
      r.start();
      setActive(true);
    } catch {
      wanted.current = false;
      toast("Das Diktat konnte nicht gestartet werden.", "error");
    }
  };

  return (
    <>
      <IconButton label={active ? "Diktat beenden" : "Diktat"} active={active} onClick={() => (active ? stop() : void start())}>
        <Mic size={16} />
      </IconButton>
      {active &&
        createPortal(
          <div className="dictation-bar" role="status" aria-live="polite">
            <span className="dictation-dot" aria-hidden />
            <span className="grow ellipsis">{interim || "Diktat läuft – sprich einfach los …"}</span>
            <IconButton label="Zeitstempel einfügen" onClick={() => insertTimestamp(editor)}>
              <Clock size={15} />
            </IconButton>
            <Button size="sm" variant="primary" icon={<Square size={12} />} onClick={stop}>
              Stopp
            </Button>
          </div>,
          document.body,
        )}
    </>
  );
}
