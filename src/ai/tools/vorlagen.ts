/**
 * Muster-Vorlagen aus `prompts/vorlagen/*.md` (mit Kopfdaten: titel, rechtsgebiet, normen).
 * Platzhalter-Implementierung: neue Vorlagen als Markdown-Datei in diesen Ordner legen.
 */
const files = import.meta.glob("../../../prompts/vorlagen/*.md", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

export interface Template {
  titel: string;
  rechtsgebiet: string;
  normen: string;
  text: string;
}

export function parseTemplate(raw: string): Template {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(raw);
  const meta: Record<string, string> = {};
  for (const line of (m?.[1] ?? "").split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { titel: meta.titel ?? "Vorlage", rechtsgebiet: meta.rechtsgebiet ?? "", normen: meta.normen ?? "", text: (m ? raw.slice(m[0].length) : raw).trim() };
}

export const TEMPLATES: Record<string, Template> = Object.fromEntries(
  Object.entries(files).map(([path, raw]) => [path.split("/").pop()!.replace(/\.md$/, ""), parseTemplate(raw)]),
);
