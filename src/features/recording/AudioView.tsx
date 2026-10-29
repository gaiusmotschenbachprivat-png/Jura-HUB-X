/** Aufnahme anhören, Transkript mitlesen; Antippen einer Zeile springt dorthin. */
import { Copy } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { formatTime, parseTranscript, transcriptText } from "../../lib/transcript";
import { useApp } from "../../state/store";
import { Button } from "../../ui/Button";

export const AUDIO_EXT = ["m4a", "mp3", "wav", "webm"];

export function AudioView({ url, pages }: { url: string; pages: string[] }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [now, setNow] = useState(0);
  const toast = useApp((s) => s.toast);
  const segs = useMemo(() => parseTranscript(pages), [pages]);
  const current = useMemo(() => {
    let i = -1;
    for (let k = 0; k < segs.length && segs[k]!.t <= now; k++) i = k;
    return i;
  }, [segs, now]);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    list.current?.querySelector(".is-current")?.scrollIntoView({ block: "nearest" });
  }, [current]);
  return (
    <div className="audio-view">
      <audio ref={audio} controls preload="metadata" src={url} onTimeUpdate={(e) => setNow(e.currentTarget.currentTime)} />
      {segs.length ? (
        <>
          <div className="row">
            <strong className="grow">Transkript</strong>
            <span className="xs muted">automatisch erstellt, ungeprüft</span>
            <Button
              size="sm"
              variant="ghost"
              icon={<Copy size={13} />}
              onClick={() => void navigator.clipboard?.writeText(transcriptText(segs)).then(() => toast("Transkript kopiert.", "success"))}
            >
              Kopieren
            </Button>
          </div>
          <div className="transcript" ref={list} role="list">
            {segs.map((s, i) => (
              <button
                key={i}
                role="listitem"
                className={`transcript-line ${i === current ? "is-current" : ""}`}
                onClick={() => {
                  const a = audio.current;
                  if (!a) return;
                  a.currentTime = s.t;
                  void a.play().catch(() => {});
                }}
              >
                <span className="tnum small">{formatTime(s.t)}</span>
                <span>{s.text}</span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <p className="small muted">Zu dieser Aufnahme gibt es kein Transkript.</p>
      )}
    </div>
  );
}
