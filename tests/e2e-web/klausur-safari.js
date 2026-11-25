// Klausurbogen in echtem Safari: Text bleibt auch nach vielen Seiten auf den Linien
// (Safari rundete mit CSS-zoom die Zeilenhöhe; der Text wanderte nach oben).
// Wird von safari-run.mjs als Funktionsrumpf ausgeführt; `step` 1 legt Daten an, 2 prüft.
const out = [];
const check = (name, ok, extra = "") => out.push({ name, ok: !!ok, extra: String(extra ?? "") });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wait = async (fn, ms = 20000) => {
  const t = Date.now();
  while (Date.now() - t < ms) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {
      /* weiter */
    }
    await sleep(200);
  }
  return null;
};
const api = await wait(() => window.__STUDIUM_API__);
await api.ready;
if (step === 1) {
  const area = (await api.areasList())[0];
  const course = await api.nodeCreate({ area_id: area.id, parent_id: null, kind: "course", title: "Safari Klausurkurs" });
  const para = (t) => ({ type: "paragraph", content: [{ type: "text", text: t }] });
  const content = [];
  for (let i = 0; i < 90; i++) content.push(para(i % 7 === 3 ? `${i}. C könnte sich gem. § 223 Abs. 1 StGB strafbar gemacht haben, indem er F ein hochdosiertes Abführmittel verabreichte.` : `${i}. Kurze Zeile`));
  await api.nodeCreate({ area_id: area.id, parent_id: course.id, kind: "note", title: "Safari Klausur", meta: { noteType: "klausurbogen" }, content_json: JSON.stringify({ type: "doc", content }) });
  check("Klausur angelegt (Safari)", true);
  return out;
}
const row = await wait(() => [...document.querySelectorAll(".tree-row")].find((r) => r.textContent.includes("Safari Klausurkurs")));
row?.click();
await wait(() => [...document.querySelectorAll("main.primary h1, main.primary .page-title, main.primary input")].some((e) => (e.value ?? e.textContent).includes("Safari Klausurkurs")));
await sleep(500);
const link = await wait(() => [...document.querySelectorAll("main.primary *")].filter((e) => e.textContent.trim() === "Safari Klausur").pop());
(link?.closest("button, a, [role=button], [role=link], .list-row") ?? link)?.click();
let root = await wait(() => document.querySelector(".page-klausur .ProseMirror"), 8000);
if (!root) {
  // zweiter Versuch (Ansicht noch nicht fertig)
  const l2 = [...document.querySelectorAll("main.primary .list-row")].find((e) => e.textContent.includes("Safari Klausur"));
  l2?.click();
  root = await wait(() => document.querySelector(".page-klausur .ProseMirror"));
}
check("Klausurbogen öffnet in Safari", !!root);
if (!root) return out;
await sleep(2500);
const MM = 96 / 25.4;
const rr = root.getBoundingClientRect();
const scale = rr.width / (210 * MM);
const pagePx = 297 * MM + 28;
const pitch = 9 * MM;
const top = 40 * MM;
const range = document.createRange();
let worst = 0;
let worstPage = -1;
let outside = 0;
let lines = 0;
const perPage = new Map();
for (const blk of root.children) {
  if (blk.classList.contains("page-gap")) continue;
  range.selectNodeContents(blk);
  const seen = new Set();
  for (const r of range.getClientRects()) {
    if (r.width < 1 || r.height > pitch * 1.5 * scale) continue;
    const y = (r.top + r.height / 2 - rr.top) / scale;
    const k = Math.round(y);
    if (seen.has(k)) continue;
    seen.add(k);
    const p = Math.floor(y / pagePx);
    const inPage = y - p * pagePx - top;
    const rowN = Math.floor(inPage / pitch);
    if (rowN < 0 || rowN >= 27) outside++;
    const off = inPage - (rowN + 0.5) * pitch;
    perPage.set(p, [...(perPage.get(p) ?? []), off]);
    if (Math.abs(off) > worst) {
      worst = Math.abs(off);
      worstPage = p;
    }
    lines++;
  }
}
const avg = [...perPage.entries()].map(([p, a]) => `${p + 1}:${(a.reduce((s, x) => s + x, 0) / a.length).toFixed(1)}`).join(" ");
check(
  "Safari: Text auch auf späteren Bögen auf den Linien",
  lines > 80 && outside === 0 && worst <= 3.5 && perPage.size >= 4,
  `Zeilen ${lines}, Bögen ${perPage.size}, max. Abweichung ${worst.toFixed(1)} px (Bogen ${worstPage + 1}), außerhalb ${outside}, Maßstab ${scale.toFixed(3)}, mittlere Abweichung je Bogen ${avg}`,
);
return out;
