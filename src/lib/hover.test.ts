// @vitest-environment node
/**
 * iPad: Ein Knopf, der nach dem Antippen „hinterlegt“ bleibt (z. B. Fett in der
 * Werkzeugleiste), entsteht durch :hover-Regeln – Safari hält den Hover-Zustand
 * fest. Alle :hover-Regeln müssen daher in @media (hover: hover) stehen.
 */
import fs from "node:fs";

import { describe, expect, it } from "vitest";

function hoverOutsideMedia(css: string): string[] {
  const bad: string[] = [];
  const walk = (s: string, inHover: boolean) => {
    let i = 0;
    while (i < s.length) {
      const j = s.indexOf("{", i);
      if (j < 0) return;
      let d = 1;
      let k = j + 1;
      while (d && k < s.length) {
        if (s[k] === "{") d++;
        else if (s[k] === "}") d--;
        k++;
      }
      const head = s.slice(i, j).replace(/\/\*[\s\S]*?\*\//g, "").trim();
      const body = s.slice(j + 1, k - 1);
      if (head.startsWith("@")) walk(body, inHover || head.startsWith("@media (hover: hover)"));
      else if (head.includes(":hover") && !inHover) bad.push(head);
      i = k;
    }
  };
  walk(css, false);
  return bad;
}

describe("Touch-Bedienung", () => {
  it("keine :hover-Regel außerhalb von @media (hover: hover)", () => {
    const files = fs.readdirSync("src/styles").filter((f) => f.endsWith(".css"));
    const bad = files.flatMap((f) => hoverOutsideMedia(fs.readFileSync(`src/styles/${f}`, "utf8")).map((h) => `${f}: ${h}`));
    expect(bad).toEqual([]);
  });

  it("Prüfung erkennt Verstöße", () => {
    expect(hoverOutsideMedia(".a:hover { color: red }")).toEqual([".a:hover"]);
    expect(hoverOutsideMedia("@media (hover: hover) { .a:hover { color: red } }")).toEqual([]);
  });
});
