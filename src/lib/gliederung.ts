/**
 * Juristische Gliederungszeichen: A. → I. → 1. → a) → aa) → (1) → (a) → (aa).
 */
const ROMAN: [number, string][] = [
  [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
];

export function roman(n: number): string {
  let out = "";
  let x = n;
  for (const [v, s] of ROMAN) {
    while (x >= v) {
      out += s;
      x -= v;
    }
  }
  return out;
}

/** a, b, …, z, aa, bb, … (wie in juristischen Gliederungen üblich: 27. Punkt = „aa“). */
function letters(n: number): string {
  const ch = String.fromCharCode(97 + ((n - 1) % 26));
  return ch.repeat(Math.floor((n - 1) / 26) + 1);
}

/** Gliederungszeichen für Ebene `depth` (0-basiert) und Position `n` (1-basiert). */
export function gliederung(depth: number, n: number): string {
  switch (depth) {
    case 0:
      return `${letters(n).toUpperCase()}.`;
    case 1:
      return `${roman(n)}.`;
    case 2:
      return `${n}.`;
    case 3:
      return `${letters(n)})`;
    case 4:
      return `${letters(n).repeat(2)})`;
    case 5:
      return `(${n})`;
    case 6:
      return `(${letters(n)})`;
    case 7:
      return `(${letters(n).repeat(2)})`;
    default:
      return "–";
  }
}
