/**
 * Uni-Kalender mit dem Stundenplan verbinden: Abo-Link (webcal/https) oder
 * Kalenderdatei (.ics). Der Link wird nur verschlüsselt gespeichert (deviceSecret)
 * und beim App-Start höchstens alle sechs Stunden neu geladen. Abgerufen wird
 * nur dieser eine Link – direkt vom Gerät, ohne Zwischenserver.
 */
import { api } from "../../api";
import type { StudyNode } from "../../api/types";
import { seal, unseal, type Sealed } from "../../lib/deviceSecret";
import { expandEvents, parseIcs } from "../../lib/ics";
import { courseMeta, groupCourses, planImport, semesterName, type ImportCourse, type ImportPlan } from "../../lib/stundenplanImport";
import { useApp } from "../../state/store";

export const CALENDAR_SETTING = "ui.calendar";
const REFRESH_MS = 6 * 3600 * 1000;

export interface CalendarState {
  link?: Sealed;
  /** Host des Links (zur Anzeige, ohne Schlüssel) */
  host?: string;
  lastSync?: string;
  lastError?: string;
  /** abgewählte Veranstaltungen (Kalenderschlüssel) */
  ignored: string[];
  /** Studienbereich, in den der Stundenplan übernommen wird */
  areaId?: string;
}

export async function loadCalendarState(): Promise<CalendarState> {
  const v = (await api.settingsAll())[CALENDAR_SETTING];
  const o = v && typeof v === "object" ? (v as Partial<CalendarState>) : {};
  return { ...o, ignored: Array.isArray(o.ignored) ? o.ignored.filter((x): x is string => typeof x === "string") : [] };
}

const saveState = (s: CalendarState) => api.settingSet(CALENDAR_SETTING, s);

export function normalizeLink(raw: string): URL | null {
  try {
    const u = new URL(raw.trim().replace(/^webcals?:\/\//i, "https://"));
    return u.protocol === "https:" ? u : null;
  } catch {
    return null;
  }
}

/** Kalendertext → Veranstaltungen (vier Wochen zurück bis ein Jahr voraus). */
export function coursesFromIcs(text: string): ImportCourse[] {
  if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error("Das ist keine Kalenderdatei (iCalendar).");
  const now = Date.now();
  return groupCourses(expandEvents(parseIcs(text), new Date(now - 28 * 86400000), new Date(now + 365 * 86400000)));
}

export async function fetchIcs(link: URL): Promise<string> {
  let res: Response;
  try {
    res = await fetch(link.href, { cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer" });
  } catch {
    throw new Error(
      `Der Kalender von ${link.host} ließ sich nicht direkt laden – meist erlaubt der Uni-Server den Abruf aus Web-Apps nicht (oder es gibt keine Verbindung). Lade die Kalenderdatei (.ics) im Uni-Portal herunter und importiere sie hier; in der App-Store-Version geht das Abo direkt.`,
    );
  }
  if (!res.ok) throw new Error(`Der Uni-Server antwortet mit Fehler ${res.status}. Ist der Abo-Link noch gültig?`);
  return res.text();
}

/** Bereich und Elternknoten für neue Veranstaltungen: neuestes Semester, sonst ein neues. */
async function semesterFor(areaId: string, nodes: StudyNode[]): Promise<string | null> {
  const sem = nodes.filter((n) => n.area_id === areaId && n.kind === "semester" && !n.deleted_at && !n.archived_at).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  if (sem) return sem.id;
  const made = await api.nodeCreate({ area_id: areaId, parent_id: null, kind: "semester", title: semesterName(new Date()) });
  return made.id;
}

/** Plan übernehmen: neue Veranstaltungen anlegen, vorhandene aktualisieren (Dozent/in usw. bleiben). */
export async function applyPlan(plan: ImportPlan, areaId: string, nodes: StudyNode[], skip: Set<string>): Promise<{ created: number; updated: number }> {
  let created = 0;
  let updated = 0;
  const todo = plan.create.filter((c) => !skip.has(c.key));
  const parent = todo.length ? await semesterFor(areaId, nodes) : null;
  for (const c of todo) {
    await api.nodeCreate({ area_id: areaId, parent_id: parent, kind: "course", title: c.title, meta: courseMeta(c) });
    created++;
  }
  for (const u of plan.update) {
    if (skip.has(u.course.key) || !u.changed) continue;
    await api.nodeUpdate(u.node.id, { meta: courseMeta(u.course, u.node.meta) });
    updated++;
  }
  if (created || updated) await useApp.getState().reloadNodes();
  return { created, updated };
}

export async function planFor(courses: ImportCourse[], areaId: string): Promise<{ plan: ImportPlan; nodes: StudyNode[] }> {
  const nodes = await api.nodesList(null);
  return { plan: planImport(courses, nodes, areaId), nodes };
}

export async function connectLink(raw: string): Promise<{ courses: ImportCourse[]; link: URL }> {
  const link = normalizeLink(raw);
  if (!link) throw new Error("Bitte den Abo-Link einfügen (beginnt mit webcal:// oder https://).");
  const courses = coursesFromIcs(await fetchIcs(link));
  return { courses, link };
}

/** Nach „Übernehmen“: Auswahl merken und – beim Abo – den Link (verschlüsselt) für das automatische Aktualisieren. */
export async function rememberChoice(ignored: string[], areaId: string, link?: URL) {
  const s = await loadCalendarState();
  await saveState({
    ...s,
    ignored,
    areaId,
    ...(link ? { link: await seal(link.href), host: link.host, lastSync: new Date().toISOString(), lastError: undefined } : {}),
  });
}

export async function disconnect() {
  const s = await loadCalendarState();
  await saveState({ ignored: s.ignored });
}

/** Beim Start: verbundenes Abo neu laden (höchstens alle sechs Stunden) und still übernehmen. */
export async function syncCalendarIfDue(force = false): Promise<{ created: number; updated: number } | null> {
  const s = await loadCalendarState();
  if (!s.link) return null;
  if (!force && s.lastSync && Date.now() - Date.parse(s.lastSync) < REFRESH_MS) return null;
  const href = await unseal(s.link);
  if (!href) {
    await saveState({ ...s, lastError: "Der Abo-Link wurde auf einem anderen Gerät gespeichert. Bitte hier neu verbinden." });
    return null;
  }
  try {
    const courses = coursesFromIcs(await fetchIcs(new URL(href)));
    const areaId = s.areaId ?? calendarArea();
    if (!areaId) return null;
    const { plan, nodes } = await planFor(courses, areaId);
    const r = await applyPlan(plan, areaId, nodes, new Set(s.ignored));
    await saveState({ ...(await loadCalendarState()), lastSync: new Date().toISOString(), lastError: undefined });
    return r;
  } catch (e) {
    await saveState({ ...(await loadCalendarState()), lastError: e instanceof Error ? e.message : String(e) });
    if (force) throw e;
    return null;
  }
}

/** Studienbereich für den Stundenplan: der gewählte, sonst der erste. */
export function calendarArea(): string | null {
  const st = useApp.getState();
  return st.areaId !== "all" ? st.areaId : (st.areas.find((a) => !a.archived_at)?.id ?? null);
}
