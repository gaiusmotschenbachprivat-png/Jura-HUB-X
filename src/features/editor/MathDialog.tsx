import katex from "katex";
import { useMemo, useState } from "react";

import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { Field } from "../../ui/misc";

const EXAMPLES = ["KW = -I_0 + \\sum_{t=1}^{T} \\frac{CF_t}{(1+i)^t}", "\\bar{x} = \\frac{1}{n}\\sum_{i=1}^{n} x_i", "\\sigma^2 = \\frac{1}{n}\\sum_{i=1}^{n}(x_i-\\bar{x})^2", "\\frac{\\partial U}{\\partial x}"];

/** Formel eingeben oder bearbeiten (LaTeX mit Live-Vorschau). */
export function MathDialog({
  initial,
  block,
  onSave,
  onDelete,
  onClose,
}: {
  initial: string;
  block: boolean;
  onSave: (latex: string, block: boolean) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const [latex, setLatex] = useState(initial);
  const [isBlock, setIsBlock] = useState(block);
  const preview = useMemo(() => {
    try {
      // trust: false (Standard) – keine Links oder HTML aus Formeln
      return { html: katex.renderToString(latex || "\;", { throwOnError: true, displayMode: isBlock }), error: null };
    } catch (e) {
      return { html: "", error: (e as Error).message.replace(/^KaTeX parse error: /, "") };
    }
  }, [latex, isBlock]);
  return (
    <Dialog
      title="Formel"
      onClose={onClose}
      width={620}
      footer={
        <>
          {onDelete && (
            <Button variant="ghost" onClick={onDelete}>
              Formel entfernen
            </Button>
          )}
          <span className="grow" />
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" disabled={!latex.trim() || !!preview.error} onClick={() => onSave(latex.trim(), isBlock)}>
            Übernehmen
          </Button>
        </>
      }
    >
      <div className="stack">
        <Field label="LaTeX" hint="Im Text: $$a^2+b^2$$ für eine Formel im Satz, $$$…$$$ in eigener Zeile.">
          <textarea autoFocus rows={3} className="mono" value={latex} onChange={(e) => setLatex(e.target.value)} spellCheck={false} />
        </Field>
        <label className="row small">
          <input type="checkbox" checked={isBlock} onChange={(e) => setIsBlock(e.target.checked)} /> in eigener Zeile (abgesetzt)
        </label>
        <div className="math-preview">{preview.error ? <span className="error-text small">{preview.error}</span> : <span dangerouslySetInnerHTML={{ __html: preview.html }} />}</div>
        <div className="row wrap">
          <span className="xs muted">Beispiele:</span>
          {EXAMPLES.map((ex) => (
            <button key={ex} className="chip chip-btn mono" onClick={() => setLatex(ex)}>
              {ex.length > 26 ? ex.slice(0, 26) + "…" : ex}
            </button>
          ))}
        </div>
      </div>
    </Dialog>
  );
}
