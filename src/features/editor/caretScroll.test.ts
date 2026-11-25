import { describe, expect, it } from "vitest";

import { scrollCaretIntoView } from "./caretScroll";

const view = (top: number, bottom: number) => ({ coordsAtPos: () => ({ top, bottom, left: 0, right: 0 }), state: { selection: { head: 1 } } }) as never;
const scroller = (top: number, bottom: number) => {
  const el = { scrollTop: 100, getBoundingClientRect: () => ({ top, bottom, left: 0, right: 0, width: 0, height: bottom - top }) };
  return el as unknown as HTMLElement & { scrollTop: number };
};

describe("Schreibstelle sichtbar halten (nur Textbereich)", () => {
  it("scrollt nach unten, wenn die Schreibstelle zu nah am unteren Rand ist", () => {
    const sc = scroller(0, 800);
    scrollCaretIntoView(view(760, 780), sc, { top: 40, bottom: 96 });
    expect(sc.scrollTop).toBe(100 + (780 - (800 - 96)));
  });
  it("lässt die Ansicht in Ruhe, wenn die Schreibstelle gut sichtbar ist", () => {
    const sc = scroller(0, 800);
    scrollCaretIntoView(view(300, 320), sc);
    expect(sc.scrollTop).toBe(100);
  });
  it("scrollt nach oben, wenn die Schreibstelle oben verschwindet", () => {
    const sc = scroller(100, 800);
    scrollCaretIntoView(view(90, 110), sc, { top: 40, bottom: 96 });
    expect(sc.scrollTop).toBe(100 - 50);
  });
  it("kleiner Bereich (geteilte Ansicht): Abstände werden kleiner", () => {
    const sc = scroller(0, 150);
    scrollCaretIntoView(view(100, 120), sc, { top: 40, bottom: 96 });
    expect(sc.scrollTop).toBe(100 + (120 - (150 - 50)));
  });
});
