/**
 * Langes Drücken auf Touch-Geräten (iPad) als Ersatz für den Rechtsklick:
 * Safari auf dem iPad löst kein `contextmenu`-Ereignis aus.
 */
import type React from "react";

export interface PressPoint {
  clientX: number;
  clientY: number;
  preventDefault(): void;
}

const DELAY = 480;
const SLOP = 8;

export function longPress(onLongPress: (p: PressPoint) => void) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let start: { x: number; y: number } | null = null;
  let fired = false;
  const cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    start = null;
  };
  return {
    onPointerDown(e: React.PointerEvent) {
      fired = false;
      if (e.pointerType !== "touch") return;
      start = { x: e.clientX, y: e.clientY };
      const { clientX, clientY } = e;
      timer = setTimeout(() => {
        timer = null;
        fired = true;
        onLongPress({ clientX, clientY, preventDefault() {} });
      }, DELAY);
    },
    onPointerMove(e: React.PointerEvent) {
      if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > SLOP) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    /** `true`, wenn der folgende Klick zum langen Drücken gehört und ignoriert werden soll. */
    consumedClick() {
      const f = fired;
      fired = false;
      return f;
    },
  };
}
