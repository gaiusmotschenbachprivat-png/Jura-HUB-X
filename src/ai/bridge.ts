/**
 * Claude-App-Brücke: Studium OS stellt die Anfrage zusammen (Anweisungen,
 * passende Gesetzestexte, anonymisierte Unterlagen), die Nutzerin bzw. der
 * Nutzer kopiert sie in die Claude-App und fügt die Antwort wieder ein. Es
 * fallen keine API-Kosten an; Zitatprüfung, Rückübersetzung der Platzhalter
 * und Weiterverarbeitung laufen wie bei einer Anfrage über die API.
 */
import bruecke from "../../prompts/bruecke.md?raw";
import studySystem from "../../prompts/lernen/system.md?raw";
import { TASK_PROMPTS, type Task } from "./assistant";
import { CARD_SCHEMA, CASE_SCHEMA, STUDY_PROMPTS, type StudyTask } from "./study";

/** Kennung statt Modellname bei Antworten aus der Claude-App. */
export const BRIDGE_MODEL = "claude-app";
export const CLAUDE_URL = "https://claude.ai/new";

/** Anfrage an den juristischen Assistenten für die Claude-App. */
export function bridgeAssistantPrompt(task: Task, userText: string): string {
  return [bruecke.trim(), `## Aufgabe\n\n${TASK_PROMPTS[task].trim()}`, userText].join("\n\n");
}

const JSON_HINT: Partial<Record<StudyTask, { schema: unknown; example: string }>> = {
  karteikarten: {
    schema: CARD_SCHEMA,
    example: '{"karten": [{"art": "definition", "vorderseite": "…", "rueckseite": "…"}]}',
  },
  uebungsfall: {
    schema: CASE_SCHEMA,
    example: '{"titel": "…", "sachverhalt": "…", "fallfrage": "…", "bearbeitungshinweis": "…", "loesungsskizze": "…"}',
  },
};

/** Lernhilfe (Lernskript, Karteikarten, Übungsfall, Korrektur) für die Claude-App. */
export function bridgeStudyPrompt(task: StudyTask, user: string): string {
  const json = JSON_HINT[task];
  const format = json
    ? `## Antwortformat\n\nAntworte ausschließlich mit einem JSON-Objekt in einem Codeblock (\`\`\`json … \`\`\`), ohne Text davor oder danach, nach diesem Muster:\n\n${json.example}\n\nJSON-Schema: ${JSON.stringify(json.schema)}`
    : "## Antwortformat\n\nAntworte in Markdown.";
  return [studySystem.trim(), STUDY_PROMPTS[task].trim(), format, user].join("\n\n");
}

/** JSON aus einer eingefügten Antwort holen (Codeblock oder erstes {…}). */
export function extractJson(text: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const body = (fenced?.[1] ?? text).trim();
  const a = body.indexOf("{");
  const b = body.lastIndexOf("}");
  if (a < 0 || b < a) throw new Error("In der eingefügten Antwort wurde kein JSON gefunden. Bitte die ganze Antwort aus Claude kopieren.");
  return body.slice(a, b + 1);
}
