/** Export einer Notiz als Markdown (CommonMark + GFM-Tabellen und -Checklisten). */
import type { PMMark, PMNode } from "./pm";

const escapeMd = (s: string) => s.replace(/([\\`*_[\]#|<>])/g, "\\$1");

function inline(nodes: PMNode[] | undefined): string {
  return (nodes ?? [])
    .map((n) => {
      if (n.type === "hardBreak") return "  \n";
      if (n.type === "inlineMath") return `$${String(n.attrs?.latex ?? "")}$`;
      if (n.type !== "text") return "";
      const marks: PMMark[] = n.marks ?? [];
      const has = (t: string) => marks.some((m) => m.type === t);
      let s = has("code") ? "`" + (n.text ?? "").replace(/`/g, "\\`") + "`" : escapeMd(n.text ?? "");
      if (has("bold")) s = `**${s}**`;
      if (has("italic")) s = `*${s}*`;
      if (has("strike")) s = `~~${s}~~`;
      if (has("highlight")) s = `==${s}==`;
      const link = marks.find((m) => m.type === "link");
      const href = typeof link?.attrs?.href === "string" ? link.attrs.href : null;
      if (href && /^(https?:|mailto:)/.test(href)) s = `[${s}](${href})`;
      return s;
    })
    .join("");
}

function block(n: PMNode, indent = ""): string {
  switch (n.type) {
    case "paragraph":
      return indent + inline(n.content);
    case "heading":
      return "#".repeat(Number(n.attrs?.level ?? 1)) + " " + inline(n.content);
    case "blockquote":
      return (n.content ?? []).map((c) => block(c).split("\n").map((l) => "> " + l).join("\n")).join("\n>\n");
    case "codeBlock":
      return "```" + String(n.attrs?.language ?? "") + "\n" + (n.content ?? []).map((c) => c.text ?? "").join("") + "\n```";
    case "horizontalRule":
      return "---";
    case "blockMath":
      return `$$\n${String(n.attrs?.latex ?? "")}\n$$`;
    case "image":
      return "*[Bild]*";
    case "bulletList":
    case "orderedList":
    case "taskList":
      return (n.content ?? [])
        .map((item, i) => {
          const marker =
            n.type === "bulletList" ? "- " : n.type === "orderedList" ? `${i + 1}. ` : item.attrs?.checked ? "- [x] " : "- [ ] ";
          const [first, ...rest] = item.content ?? [];
          const head = indent + marker + (first ? inline(first.content) : "");
          const sub = rest.map((c) => block(c, indent + "   ")).join("\n");
          return sub ? head + "\n" + sub : head;
        })
        .join("\n");
    case "table": {
      const rows = (n.content ?? []).map((r) =>
        (r.content ?? []).map((c) => (c.content ?? []).map((x) => inline(x.content)).join(" ").replace(/\|/g, "\\|")),
      );
      if (!rows.length) return "";
      const width = Math.max(...rows.map((r) => r.length));
      const line = (r: string[]) => "| " + Array.from({ length: width }, (_, i) => r[i] ?? "").join(" | ") + " |";
      return [line(rows[0]!), "| " + Array(width).fill("---").join(" | ") + " |", ...rows.slice(1).map(line)].join("\n");
    }
    default:
      return (n.content ?? []).map((c) => block(c, indent)).join("\n\n");
  }
}

export function toMarkdown(doc: PMNode): string {
  return (doc.content ?? []).map((n) => block(n)).filter((s) => s !== undefined).join("\n\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}
