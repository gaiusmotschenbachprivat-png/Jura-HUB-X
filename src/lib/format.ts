const dateFmt = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium" });
const dateTimeFmt = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" });
const timeFmt = new Intl.DateTimeFormat("de-DE", { timeStyle: "short" });

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : dateFmt.format(d);
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : dateTimeFmt.format(d);
}

/** „gerade eben“, „vor 5 Min.“, „heute 14:02“, „12. Okt. 2026“ */
export function formatRelative(iso: string, now = Date.now()): string {
  const d = new Date(iso);
  const t = d.getTime();
  if (isNaN(t)) return "";
  const diff = (now - t) / 1000;
  if (diff < 45) return "gerade eben";
  if (diff < 3600) return `vor ${Math.round(diff / 60)} Min.`;
  const today = new Date(now);
  if (d.toDateString() === today.toDateString()) return `heute ${timeFmt.format(d)}`;
  const y = new Date(now - 86400000);
  if (d.toDateString() === y.toDateString()) return `gestern ${timeFmt.format(d)}`;
  return dateFmt.format(d);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2).replace(".", ",")} GB`;
}

/** Ersetzt die Treffermarkierungen des Backends durch <mark> – nach dem Escapen. */
export function highlightHtml(s: string): string {
  const esc = s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
  return esc.replace(/\u0002/g, "<mark>").replace(/\u0003/g, "</mark>");
}

export function stripHighlight(s: string): string {
  return s.replace(/[\u0002\u0003]/g, "");
}
