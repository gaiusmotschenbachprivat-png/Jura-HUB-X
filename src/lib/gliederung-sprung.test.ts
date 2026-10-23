// @vitest-environment jsdom
import { Editor, getSchema } from "@tiptap/core";
import { Node as PMNodeClass } from "@tiptap/pm/model";
import { describe, expect, it } from "vitest";

import { editorExtensions } from "../features/editor/extensions";
import { findOutline, findTarget, insertionPoint, normalize } from "../features/editor/outlineJump";

const schema = getSchema(editorExtensions());
const t = (text: string) => ({ type: "text", text });
const p = (text = "") => ({ type: "paragraph", content: text ? [t(text)] : [] });
const h = (level: number, text: string) => ({ type: "heading", attrs: { level }, content: [t(text)] });
const li = (text: string, sub?: object) => ({ type: "listItem", content: [p(text), ...(sub ? [sub] : [])] });
const ol = (...items: object[]) => ({ type: "orderedList", attrs: { start: 1 }, content: items });
const docOf = (...content: object[]) => PMNodeClass.fromJSON(schema, { type: "doc", content });

const lecture = () =>
  docOf(
    h(1, "3. Vorlesung"),
    h(2, "Gliederung"),
    ol(li("Erklärung StGB"), li("Tatbestand", ol(li("Objektiver Tatbestand"))), li("Rechtswidrigkeit"), li("Schuld")),
    h(2, "Mitschrift"),
    h(3, "1. Erklärung StGB"),
    p("Das StGB regelt …"),
    p("Tatbestand: Zunächst der objektive Tatbestand."),
    p("4. Schuld – Vorwerfbarkeit"),
    h(2, "Offene Fragen"),
    p(),
  );

describe("Gliederung → Mitschrift", () => {
  it("findet die nummerierte Gliederung mit Unterpunkten", () => {
    const o = findOutline(lecture())!;
    expect(o.items.map((i) => `${i.number} ${i.text}`)).toEqual(["1 Erklärung StGB", "2 Tatbestand", "2.1 Objektiver Tatbestand", "3 Rechtswidrigkeit", "4 Schuld"]);
  });
  it("ordnet zu: Überschrift, Absatzanfang, Nummer – sonst nichts", () => {
    const d = lecture();
    const o = findOutline(d)!;
    const target = (n: string) => {
      const pos = findTarget(d, o, o.items.find((i) => i.number === n)!);
      return pos === null ? null : d.nodeAt(pos)!.textContent;
    };
    expect(target("1")).toBe("1. Erklärung StGB");
    expect(target("2")).toBe("Tatbestand: Zunächst der objektive Tatbestand.");
    expect(target("4")).toBe("4. Schuld – Vorwerfbarkeit");
    expect(target("3")).toBeNull();
  });
  it("neue Abschnitte kommen ans Ende der Mitschrift, eine Ebene tiefer", () => {
    const d = lecture();
    const at = insertionPoint(d, findOutline(d)!);
    expect(d.nodeAt(at.pos)?.textContent).toBe("Offene Fragen");
    expect(at.level).toBe(3);
  });
  it("Normalisierung entfernt Nummerierung und Satzzeichen", () => {
    expect(normalize("5. Erklärung: StGB")).toBe("erklärung stgb");
    expect(normalize("II. Tatbestand")).toBe("tatbestand");
    expect(normalize("b) Kausalität")).toBe("kausalität");
  });
  it("Antippen legt fehlende Stelle an und springt hin", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const editor = new Editor({ element: el, extensions: editorExtensions(), content: lecture().toJSON() });
    const buttons = el.querySelectorAll<HTMLButtonElement>(".outline-jump");
    expect(buttons).toHaveLength(5);
    const rw = [...buttons].find((b) => b.getAttribute("aria-label")?.includes("Rechtswidrigkeit"))!;
    expect(rw.classList.contains("is-new")).toBe(true);
    let jumped = "";
    editor.view.dom.addEventListener("studium:outline-jump", (e) => (jumped = (e as CustomEvent).detail.label));
    rw.click();
    const json = JSON.stringify(editor.getJSON());
    expect(json).toContain('"level":3},"content":[{"type":"text","text":"Rechtswidrigkeit"');
    // Neue Überschrift steht vor „Offene Fragen“, Cursor darin
    const texts: string[] = [];
    editor.state.doc.forEach((n) => texts.push(n.textContent));
    expect(texts.indexOf("Rechtswidrigkeit")).toBe(texts.indexOf("Offene Fragen") - 2);
    expect(editor.state.doc.resolve(editor.state.selection.from).parent.textContent).toBe("Rechtswidrigkeit");
    expect(jumped).toBe("Rechtswidrigkeit");
    // Danach hat der Punkt ein Ziel
    expect(el.querySelector('.outline-jump[aria-label*="Rechtswidrigkeit"]')?.classList.contains("has-target")).toBe(true);
    // Der gespeicherte Text enthält keine Sprung-Symbole
    expect(json).not.toContain("outline-jump");
    editor.destroy();
  });
});
