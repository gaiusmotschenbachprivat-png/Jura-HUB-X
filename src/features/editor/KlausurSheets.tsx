/**
 * Klausurbogen auf dem Bildschirm: je Seite ein Blatt mit Kopffeldern,
 * liniertem Schreibbereich, Korrekturrand und „Bogen Nr.“ – hinter dem Text.
 * Maße wie im PDF (lib/klausurBogen.ts).
 */
import { BOGEN, HEAD_LABELS, MM, type KlausurHead } from "../../lib/klausurBogen";

const px = (mm: number) => `${(mm * MM).toFixed(3)}px`;

export function KlausurSheets({ pages, head, gap }: { pages: number; head: KlausurHead; gap: number }) {
  const b = BOGEN;
  const values = [head.fach, head.name, head.datum];
  return (
    <div className="ks-sheets" aria-hidden>
      {Array.from({ length: Math.max(1, pages) }, (_, i) => (
        <div key={i} className="ks-sheet" style={{ top: `${i * (b.height * MM + gap)}px`, width: px(b.width), height: px(b.height) }}>
          <div className="ks-rule" style={{ left: px(b.head.left), width: px(b.head.right - b.head.left), top: px(b.head.topRule) }} />
          {b.head.lines.map((y, k) => (
            <div key={k} className="ks-field" style={{ left: px(b.head.left), width: px(b.head.right - b.head.left), top: px(y - b.pitch), height: px(b.pitch) }}>
              <span className="ks-label">{HEAD_LABELS[k]}</span>
              <span className="ks-value">{values[k]}</span>
            </div>
          ))}
          <div
            className="ks-box"
            style={{ left: px(b.box.left), top: px(b.box.top), width: px(b.box.right - b.box.left), height: px(b.box.bottom - b.box.top) }}
          >
            <div className="ks-lines" style={{ width: px(b.divider - b.box.left), backgroundSize: `100% ${px(b.pitch)}` }} />
            <div className="ks-divider" style={{ left: px(b.divider - b.box.left) }} />
          </div>
          <div className="ks-field ks-foot" style={{ left: px(b.foot.left), width: px(b.foot.right - b.foot.left), top: px(b.foot.y - b.pitch * 0.8), height: px(b.pitch * 0.8) }}>
            <span className="ks-label">Bogen Nr.</span>
            <span className="ks-value ks-center">{i + 1}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
