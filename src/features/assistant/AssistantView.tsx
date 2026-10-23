import { BookOpen, Download, FileUp, KeyRound, MessageSquare, RotateCcw, Scale, Send, Settings2, ShieldCheck, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { api, errorMessage } from "../../api";
import type { AiStatus, LegalKind, LegalSource } from "../../api/types";
import { DEFAULT_SYSTEM_PROMPT, type Task } from "../../ai/assistant";
import { configFromSettings, DEFAULT_CONFIG, type AnonymizeConfig, type Category } from "../../ai/privacy/anonymize";
import { COMMON_LAWS, importFile, importLaw, readText } from "../../ai/sources/importer";
import { formatDate, formatDateTime } from "../../lib/format";
import { AI_PROFILES } from "../../ai/config";
import { formatCost, requestCostUsd, requestsFor, SPENT_SETTING } from "../../ai/cost";
import { markdownToHtml } from "../../lib/docxImport";
import { reportError, useApp } from "../../state/store";
import { Button } from "../../ui/Button";
import { confirmDialog } from "../../ui/Dialog";
import { htmlToDoc } from "../editor/exportImport";
import { createNode } from "../navigation/actions";
import { isVault, MIN_PIN, openKey, sealKey, type KeyVault } from "../../ai/keyVault";
import { AnswerCard } from "./Answer";
import { useAssistant } from "./state";
import { ProfileSelect, useAiProfile } from "./AiProfile";
import { HistoryButton } from "./ChatHistory";

type Tab = "fragen" | "quellen" | "einstellungen";

const TASKS: { id: Task; label: string; placeholder: string }[] = [
  { id: "recherche", label: "Recherche & Fall", placeholder: "Frage oder Sachverhalt, z. B. „V verkauft K ein Fahrrad … Welche Ansprüche hat K?“" },
  { id: "vertrag", label: "Vertrag prüfen", placeholder: "Worauf soll geachtet werden? z. B. „Prüfe die Klauseln auf Wirksamkeit (AGB).“" },
  { id: "schriftsatz", label: "Schriftsatz entwerfen", placeholder: "Was soll entworfen werden? z. B. „Mängelanzeige für ein defektes Notebook, Kauf am 01.09.2026“" },
];

export function AssistantView() {
  const [tab, setTab] = useState<Tab>("fragen");
  const [consent, setConsent] = useState<boolean | null>(null);
  const [status, setStatus] = useState<AiStatus | null>(null);
  const reload = async () => {
    const s = await api.settingsAll();
    setConsent(s["ai.consent"] === true);
    setStatus(await api.aiStatus());
  };
  useEffect(() => {
    void reload().catch(reportError);
  }, []);

  if (consent === null || !status) return <div className="loading">Lade …</div>;
  if (!consent) return <Consent onDone={() => void reload()} />;

  return (
    <div className="page assistant">
      <header className="page-head">
        <div className="small muted">KI-Assistent (Claude)</div>
        <h1 className="page-title-static">Juristischer Assistent</h1>
        <div className="tabs" role="tablist">
          {(
            [
              ["fragen", "Fragen", <MessageSquare key="a" size={14} />],
              ["quellen", "Rechtsquellen", <BookOpen key="b" size={14} />],
              ["einstellungen", "Einstellungen", <Settings2 key="c" size={14} />],
            ] as const
          ).map(([id, label, icon]) => (
            <button key={id} role="tab" aria-selected={tab === id} className={`tab ${tab === id ? "is-active" : ""}`} onClick={() => setTab(id)}>
              {icon} {label}
            </button>
          ))}
        </div>
      </header>
      {!status.available && <KeySetup status={status} onChange={() => void reload()} />}
      {tab === "fragen" && <Chat available={status.available} />}
      {tab === "quellen" && <Sources status={status} />}
      {tab === "einstellungen" && <AiSettings onRevoke={() => void reload()} />}
    </div>
  );
}

export function Consent({ onDone, compact }: { onDone: () => void; compact?: boolean }) {
  const [ok, setOk] = useState(false);
  return (
    <div className={compact ? "" : "page"}>
      <section className="card prose-ui consent" style={{ maxWidth: 720 }}>
        <h2>
          <Scale size={18} /> KI-Assistent einschalten?
        </h2>
        <p>
          Der Assistent nutzt <strong>Claude</strong> von Anthropic. Studium OS ist sonst vollständig lokal – dieser Teil ist die einzige Funktion, die Inhalte an einen
          externen Dienst schickt, und nur, wenn du eine Frage absendest.
        </p>
        <ul className="small">
          <li>Gesendet werden: deine Frage, die dazu gefundenen Abschnitte deiner Rechtsquellen und – nur wenn du es pro Unterhaltung erlaubst – Auszüge aus deinen Notizen.</li>
          <li>Personenbezogene Angaben werden vorher durch Platzhalter ersetzt (abschaltbar). Die Erkennung ist nicht lückenlos.</li>
          <li>Du brauchst einen eigenen API-Schlüssel von Anthropic; die Nutzung ist kostenpflichtig (Abrechnung über dein Anthropic-Konto).</li>
          <li>Antworten können Fehler enthalten. Zitate werden automatisch gegen deine Quellen geprüft – das ersetzt keine eigene Kontrolle und keine anwaltliche Prüfung.</li>
          <li>Keine Mandantendaten im Klartext eingeben. Für berufliche Nutzung gelten Verschwiegenheitspflichten (§ 203 StGB, § 43a BRAO) und die DSGVO.</li>
        </ul>
        <label className="row small">
          <input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} />
          Ich habe das gelesen und möchte den KI-Assistenten nutzen.
        </label>
        <div className="row">
          <Button
            variant="primary"
            disabled={!ok}
            onClick={async () => {
              await api.settingSet("ai.consent", true).catch(reportError);
              onDone();
            }}
          >
            Einschalten
          </Button>
        </div>
      </section>
    </div>
  );
}

export function KeySetup({ status, onChange }: { status: AiStatus; onChange: () => void }) {
  if (api.kind === "web") return <WebKeySetup onChange={onChange} />;
  return (
    <section className="card ai-key">
      <h3>
        <KeyRound size={16} /> Kein API-Schlüssel gefunden
      </h3>
      <p className="small">
        Lege deinen Schlüssel als Umgebungsvariable <code>ANTHROPIC_API_KEY</code> an und starte Studium OS neu. Die App liest ihn nur auf der Rust-Seite; die
        Oberfläche sieht ihn nie, und er wird nicht gespeichert.
      </p>
      <ul className="xs muted">
        <li>
          macOS: <code>launchctl setenv ANTHROPIC_API_KEY sk-ant-…</code> und danach Studium OS neu starten (gilt bis zum Neustart des Macs).
        </li>
        <li>Windows: Einstellungen → „Umgebungsvariablen für dieses Konto bearbeiten“ → Neu: ANTHROPIC_API_KEY.</li>
      </ul>
      {status.key_source === "none" && <p className="xs muted">Rechtsquellen kannst du trotzdem schon importieren.</p>}
    </section>
  );
}

/** Inhalt der gerade geöffneten Seite, den der Nutzer optional einbeziehen kann. */
export interface ContextSource {
  label: string;
  load(): Promise<string>;
}

export function Chat({ available, compact, context }: { available: boolean; compact?: boolean; context?: ContextSource | null }) {
  const { task, setTask, entries, busy, ask, reset, ownDocs, setOwnDocs } = useAssistant();
  const [q, setQ] = useState("");
  const [doc, setDoc] = useState("");
  const [useContext, setUseContext] = useState(false);
  const areaId = useApp((s) => s.areaId);
  const areas = useApp((s) => s.areas);
  const toast = useApp((s) => s.toast);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }), [entries.length, busy]);
  const cur = TASKS.find((t) => t.id === task)!;

  const send = async () => {
    const question = q.trim();
    if (!question) return;
    setQ("");
    const parts: string[] = [];
    if (task === "vertrag" && doc.trim()) parts.push(doc.trim());
    if (context && useContext) {
      try {
        const text = (await context.load()).trim();
        if (text) parts.push(`[${context.label}]\n${text}`);
      } catch (e) {
        reportError(e);
      }
    }
    void ask(question, parts.length ? parts.join("\n\n") : undefined);
  };

  const loadContract = async () => {
    const p = (await api.pickFiles({ multiple: false, extensions: ["pdf", "docx", "txt", "md"], title: "Vertrag laden" }))?.[0];
    if (!p) return;
    try {
      setDoc(await readText(p, await api.readExternalFile(p)));
    } catch (e) {
      reportError(e);
    }
  };

  const saveNote = async (text: string) => {
    const target = areaId !== "all" ? areaId : areas.find((a) => !a.archived_at)?.id;
    if (!target) return toast("Lege zuerst einen Studienbereich an.", "error");
    const html = markdownToHtml(`Erstellt mit dem KI-Assistenten (ungeprüft)\n\n${text}`);
    await createNode({ areaId: target, parentId: null, kind: "note", title: `KI: ${entries.find((e) => e.role === "user")?.text.slice(0, 60) ?? "Antwort"}`, contentJson: JSON.stringify(htmlToDoc(html)) });
  };

  return (
    <div className={`ai-chat ${compact ? "is-compact" : ""}`}>
      <div className="row wrap ai-toolbar">
        {compact ? (
          <select aria-label="Aufgabe" value={task} onChange={(e) => setTask(e.target.value as Task)} disabled={busy}>
            {TASKS.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        ) : (
          <div className="seg" role="radiogroup" aria-label="Aufgabe">
            {TASKS.map((t) => (
              <button key={t.id} role="radio" aria-checked={task === t.id} className={task === t.id ? "is-active" : ""} onClick={() => setTask(t.id)} disabled={busy}>
                {t.label}
              </button>
            ))}
          </div>
        )}
        <label className="row small" title="Erlaubt Claude, deine Notizen und Dokumente zu durchsuchen (Auszüge werden anonymisiert gesendet).">
          <input type="checkbox" checked={ownDocs} onChange={(e) => setOwnDocs(e.target.checked)} disabled={busy} />
          Eigene Notizen durchsuchen
        </label>
        {context && (
          <label className="row small ai-context-toggle" title="Der Text dieser Seite wird (anonymisiert) mitgeschickt.">
            <input type="checkbox" checked={useContext} onChange={(e) => setUseContext(e.target.checked)} disabled={busy} />
            {context.label} einbeziehen
          </label>
        )}
        <span className="grow" />
        <ProfileSelect disabled={busy} />
        {!compact && <HistoryButton disabled={busy} />}
        {!compact && (
          <Button size="sm" variant="ghost" icon={<RotateCcw size={13} />} onClick={reset} disabled={busy || !entries.length}>
            Neue Unterhaltung
          </Button>
        )}
      </div>

      <div className="ai-entries">
        {entries.length === 0 && (
          <p className="small muted">
            Stelle eine Frage. Der Assistent sucht zuerst in deinen Rechtsquellen (Reiter „Rechtsquellen“), nutzt Werkzeuge wie Normabruf und Fristenrechner und prüft
            danach jedes Zitat. Unterhaltungen werden auf diesem Gerät gespeichert (Verlauf-Symbol) – wichtige Antworten kannst du zusätzlich als Notiz sichern.
          </p>
        )}
        {entries.map((e, i) =>
          e.role === "user" ? (
            <div key={i} className="ai-user">
              {e.text}
              {e.document && <div className="xs muted">+ Dokument ({e.document.length.toLocaleString("de-DE")} Zeichen)</div>}
            </div>
          ) : e.role === "assistant" ? (
            <AnswerCard key={i} result={e.result} onSaveNote={(t) => void saveNote(t)} />
          ) : (
            <div key={i} className="card ai-error small">
              {e.text}
            </div>
          ),
        )}
        {busy && <div className="small muted ai-busy">Claude arbeitet … (Quellen abrufen, prüfen – das kann eine Minute dauern)</div>}
        <div ref={endRef} />
      </div>

      {task === "vertrag" && (
        <div className="ai-doc">
          <div className="row">
            <span className="small">Vertragstext</span>
            <span className="grow" />
            <Button size="sm" variant="ghost" icon={<FileUp size={13} />} onClick={() => void loadContract()}>
              Datei laden
            </Button>
          </div>
          <textarea rows={6} value={doc} onChange={(e) => setDoc(e.target.value)} placeholder="Vertrag hier einfügen oder als Datei laden (PDF, DOCX, TXT)" />
        </div>
      )}
      <form
        className="ai-input"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          rows={compact ? 2 : 3}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={cur.placeholder}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <Button type="submit" variant="primary" icon={<Send size={14} />} disabled={!available || busy || !q.trim()} aria-label="Senden">
          {compact ? "" : "Senden"}
        </Button>
      </form>
      <p className="xs muted">Ausgaben können fehlerhaft sein und ersetzen keine anwaltliche Prüfung. ⌘/Strg + Enter sendet.</p>
    </div>
  );
}

function Sources({ status }: { status: AiStatus }) {
  const [list, setList] = useState<LegalSource[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [abbr, setAbbr] = useState("");
  const [meta, setMeta] = useState({ kind: "urteil" as LegalKind, title: "", court: "", file_number: "", decision_date: "", version: "", abbreviation: "" });
  const toast = useApp((s) => s.toast);
  const load = () => api.legalSourcesList().then(setList).catch(reportError);
  useEffect(() => {
    void load();
  }, []);

  const fetchLaw = async (a: string) => {
    setBusy(a);
    try {
      const s = await importLaw(api, a);
      toast(`${s.abbreviation || s.title}: ${s.chunk_count.toLocaleString("de-DE")} Abschnitte importiert.`, "success");
      void load();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(null);
    }
  };

  const pick = async () => {
    const p = (await api.pickFiles({ multiple: false, extensions: ["xml", "zip", "pdf", "docx", "txt", "md"], title: "Rechtsquelle importieren" }))?.[0];
    if (!p) return;
    setBusy("datei");
    try {
      const name = p.split(/[\\/]/).pop() ?? p;
      const s = await importFile(api, name, await api.readExternalFile(p), meta);
      toast(`„${s.title}“: ${s.chunk_count.toLocaleString("de-DE")} Abschnitte importiert.`, "success");
      setMeta({ ...meta, title: "", court: "", file_number: "", decision_date: "", abbreviation: "" });
      void load();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(null);
    }
  };

  const remove = async (s: LegalSource) => {
    if (!(await confirmDialog({ title: "Quelle löschen?", message: `„${s.title}“ wird aus den Rechtsquellen entfernt.`, confirm: "Löschen", danger: true }))) return;
    await api.legalSourceDelete(s.id).catch(reportError);
    void load();
  };

  return (
    <div className="stack settings-section">
      <section className="card">
        <h3>Gesetze laden</h3>
        {status.can_fetch_laws ? (
          <>
            <p className="small muted">
              Lädt die amtliche XML-Fassung von gesetze-im-internet.de – nur auf deinen Klick. Eine neue Fassung ersetzt die alte. Den Stand der Fassung siehst du in der Liste.
            </p>
            <div className="row wrap">
              {COMMON_LAWS.map((l) => (
                <Button key={l.abbr} size="sm" icon={<Download size={12} />} disabled={!!busy} onClick={() => void fetchLaw(l.abbr)}>
                  {busy === l.abbr ? "Lade …" : l.label}
                </Button>
              ))}
            </div>
            <form
              className="row"
              onSubmit={(e) => {
                e.preventDefault();
                if (abbr.trim()) void fetchLaw(abbr);
              }}
            >
              <input placeholder="andere Abkürzung, z. B. bauno_by, bdsg_2018" value={abbr} onChange={(e) => setAbbr(e.target.value)} />
              <Button type="submit" size="sm" disabled={!!busy || !abbr.trim()}>
                Laden
              </Button>
            </form>
            <p className="xs muted">Die Abkürzung steht in der Adresse bei gesetze-im-internet.de, z. B. …/bgb/ oder …/kschg/.</p>
          </>
        ) : (
          <p className="small">
            In der Browser-Version kann Studium OS Gesetze nicht selbst laden (gesetze-im-internet.de erlaubt das technisch nicht). Lade auf gesetze-im-internet.de beim
            jeweiligen Gesetz die „XML“-Datei herunter und importiere sie unten.
          </p>
        )}
      </section>

      <section className="card">
        <h3>Datei importieren</h3>
        <p className="small muted">XML/ZIP von gesetze-im-internet.de, Urteile, Kommentare oder eigene Texte als PDF, DOCX oder TXT.</p>
        <div className="ai-meta">
          <label>
            Art
            <select value={meta.kind} onChange={(e) => setMeta({ ...meta, kind: e.target.value as LegalKind })}>
              <option value="urteil">Urteil / Beschluss</option>
              <option value="kommentar">Kommentar / Aufsatz</option>
              <option value="dokument">Eigenes Dokument</option>
              <option value="gesetz">Gesetz (XML, ZIP, PDF, DOCX, TXT)</option>
            </select>
          </label>
          <label>
            Titel
            <input value={meta.title} onChange={(e) => setMeta({ ...meta, title: e.target.value })} placeholder="leer = Dateiname" />
          </label>
          {meta.kind === "gesetz" && (
            <label>
              Abkürzung
              <input value={meta.abbreviation ?? ""} onChange={(e) => setMeta({ ...meta, abbreviation: e.target.value })} placeholder="leer = aus der Datei, z. B. StGB" />
            </label>
          )}
          {meta.kind === "urteil" && (
            <>
              <label>
                Gericht
                <input value={meta.court} onChange={(e) => setMeta({ ...meta, court: e.target.value })} placeholder="z. B. BGH" />
              </label>
              <label>
                Aktenzeichen
                <input value={meta.file_number} onChange={(e) => setMeta({ ...meta, file_number: e.target.value })} placeholder="z. B. VIII ZR 123/20" />
              </label>
              <label>
                Datum
                <input type="date" value={meta.decision_date} onChange={(e) => setMeta({ ...meta, decision_date: e.target.value })} />
              </label>
            </>
          )}
          {(meta.kind === "kommentar" || meta.kind === "dokument") && (
            <label>
              Fassung / Stand
              <input value={meta.version} onChange={(e) => setMeta({ ...meta, version: e.target.value })} placeholder="z. B. 2026, 85. Aufl." />
            </label>
          )}
        </div>
        <Button icon={<FileUp size={14} />} onClick={() => void pick()} disabled={!!busy}>
          {busy === "datei" ? "Importiere …" : "Datei wählen …"}
        </Button>
      </section>

      <section className="card">
        <h3>Vorhandene Quellen ({list.length})</h3>
        {list.length === 0 ? (
          <p className="small muted">Noch keine Rechtsquellen. Ohne Quellen kann der Assistent nichts belegen.</p>
        ) : (
          <table className="table small">
            <thead>
              <tr>
                <th>Quelle</th>
                <th>Art</th>
                <th>Abschnitte</th>
                <th>Fassung / Stand</th>
                <th>Importiert</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((s) => (
                <tr key={s.id}>
                  <td>
                    <strong>{s.abbreviation || s.file_number || ""}</strong> {s.title}
                    {s.court ? ` (${s.court}${s.decision_date ? `, ${s.decision_date}` : ""})` : ""}
                  </td>
                  <td>{s.kind}</td>
                  <td className="tnum">{s.chunk_count.toLocaleString("de-DE")}</td>
                  <td className="xs ellipsis" style={{ maxWidth: 260 }} title={s.version}>
                    {s.version || "–"}
                  </td>
                  <td className="xs tnum">{formatDateTime(s.imported_at)}</td>
                  <td>
                    <Button size="sm" variant="ghost" icon={<Trash2 size={13} />} aria-label="Löschen" onClick={() => void remove(s)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

const CATEGORY_LABEL: Record<Category, string> = {
  person: "Namen nach Anrede/Titel (Herr, Frau, Dr. …)",
  email: "E-Mail-Adressen",
  telefon: "Telefonnummern",
  iban: "IBAN",
  adresse: "Straßen und Postleitzahl/Ort",
  geburtsdatum: "Geburtsdaten",
  aktenzeichen_eigen: "eigene Aktenzeichen („Unser Az.“)",
};

function AiSettings({ onRevoke }: { onRevoke: () => void }) {
  const [cfg, setCfg] = useState<AnonymizeConfig>(DEFAULT_CONFIG);
  const [terms, setTerms] = useState("");
  const [prompt, setPrompt] = useState("");
  const reset = useAssistant((s) => s.reset);
  const toast = useApp((s) => s.toast);
  useEffect(() => {
    void api.settingsAll().then((s) => {
      const c = configFromSettings(s["ai.anonymize"]);
      setCfg(c);
      setTerms(c.customTerms.join("\n"));
      setPrompt(typeof s["ai.systemPrompt"] === "string" ? (s["ai.systemPrompt"] as string) : DEFAULT_SYSTEM_PROMPT);
    });
  }, []);
  const save = async () => {
    const next = { ...cfg, customTerms: terms.split("\n").map((t) => t.trim()).filter(Boolean) };
    try {
      await api.settingSet("ai.anonymize", next);
      await api.settingSet("ai.systemPrompt", prompt.trim() === DEFAULT_SYSTEM_PROMPT ? null : prompt);
      reset();
      toast("Gespeichert. Gilt ab der nächsten Unterhaltung.", "success");
    } catch (e) {
      reportError(e);
    }
  };
  return (
    <div className="stack settings-section">
      <ModelAndCost />
      <section className="card">
        <h3>
          <ShieldCheck size={16} /> Anonymisierung vor dem Senden
        </h3>
        <label className="row small">
          <input type="checkbox" checked={cfg.enabled} onChange={(e) => setCfg({ ...cfg, enabled: e.target.checked })} />
          Personenbezogene Angaben durch Platzhalter ersetzen
        </label>
        {(Object.keys(CATEGORY_LABEL) as Category[]).map((k) => (
          <label key={k} className="row small" style={{ marginLeft: 20 }}>
            <input
              type="checkbox"
              disabled={!cfg.enabled}
              checked={cfg.categories[k]}
              onChange={(e) => setCfg({ ...cfg, categories: { ...cfg.categories, [k]: e.target.checked } })}
            />
            {CATEGORY_LABEL[k]}
          </label>
        ))}
        <label className="small">
          Eigene Begriffe (z. B. Namen von Beteiligten, Firmen; einer pro Zeile)
          <textarea rows={4} value={terms} onChange={(e) => setTerms(e.target.value)} />
        </label>
        <p className="xs muted">Die Erkennung arbeitet mit Mustern und findet nicht jeden Namen. Trage Namen von Beteiligten deshalb oben ein.</p>
      </section>
      <section className="card">
        <h3>System-Prompt</h3>
        <p className="xs muted">Regeln für den Assistenten. Standard: Datei prompts/system.md. Änderungen gelten ab der nächsten Unterhaltung.</p>
        <textarea rows={14} value={prompt} onChange={(e) => setPrompt(e.target.value)} className="mono" />
        <div className="row">
          <Button size="sm" variant="ghost" onClick={() => setPrompt(DEFAULT_SYSTEM_PROMPT)}>
            Auf Standard zurücksetzen
          </Button>
        </div>
      </section>
      <div className="row">
        <Button variant="primary" onClick={() => void save()}>
          Speichern
        </Button>
        <span className="grow" />
        <Button
          variant="ghost"
          onClick={async () => {
            await api.settingSet("ai.consent", false).catch(reportError);
            reset();
            onRevoke();
          }}
        >
          KI-Assistent ausschalten
        </Button>
      </div>
    </div>
  );
}

function WebKeySetup({ onChange }: { onChange: () => void }) {
  const [vault, setVault] = useState<KeyVault | null | undefined>(undefined);
  const [key, setKey] = useState("");
  const [remember, setRemember] = useState(true);
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useApp((s) => s.toast);
  useEffect(() => {
    void api.settingsAll().then((s) => setVault(isVault(s["ai.keyVault"]) ? (s["ai.keyVault"] as KeyVault) : null));
  }, []);
  if (vault === undefined) return null;

  if (vault) {
    return (
      <section className="card ai-key">
        <h3>
          <KeyRound size={16} /> PIN eingeben
        </h3>
        <p className="small muted">Dein API-Schlüssel ist auf diesem iPad mit deiner PIN verschlüsselt gespeichert.</p>
        <form
          className="row wrap"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await api.aiSetSessionKey(await openKey(vault, pin));
              setPin("");
              onChange();
            } catch (err) {
              toast(errorMessage(err), "error");
            } finally {
              setBusy(false);
            }
          }}
        >
          <input type="password" inputMode="text" autoComplete="off" placeholder="PIN" value={pin} onChange={(e) => setPin(e.target.value)} />
          <Button type="submit" variant="primary" disabled={!pin || busy}>
            {busy ? "Prüfe …" : "Entsperren"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={async () => {
              if (!(await confirmDialog({ title: "Gespeicherten Schlüssel löschen?", message: "Der verschlüsselte Schlüssel wird von diesem iPad entfernt.", confirm: "Löschen", danger: true })))
                return;
              await api.settingSet("ai.keyVault", null).catch(reportError);
              setVault(null);
            }}
          >
            Anderen Schlüssel verwenden
          </Button>
        </form>
      </section>
    );
  }

  const pinOk = !remember || (pin.length >= MIN_PIN && pin === pin2);
  return (
    <section className="card ai-key">
      <h3>
        <KeyRound size={16} /> API-Schlüssel eingeben
      </h3>
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            if (remember) await api.settingSet("ai.keyVault", await sealKey(key, pin));
            await api.aiSetSessionKey(key);
            setKey("");
            setPin("");
            setPin2("");
            onChange();
          } catch (err) {
            toast(errorMessage(err), "error");
          } finally {
            setBusy(false);
          }
        }}
      >
        <input type="password" autoComplete="off" placeholder="sk-ant-…" value={key} onChange={(e) => setKey(e.target.value)} />
        <label className="row small">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Auf diesem iPad merken – verschlüsselt mit einer PIN
        </label>
        {remember && (
          <div className="row wrap">
            <input type="password" autoComplete="new-password" placeholder={`PIN (mind. ${MIN_PIN} Zeichen)`} value={pin} onChange={(e) => setPin(e.target.value)} />
            <input type="password" autoComplete="new-password" placeholder="PIN wiederholen" value={pin2} onChange={(e) => setPin2(e.target.value)} />
          </div>
        )}
        <p className="xs muted">
          {remember
            ? "Gespeichert wird nur der verschlüsselte Schlüssel. Beim nächsten Start gibst du nur die PIN ein. Wähle eine PIN, die nicht leicht zu erraten ist."
            : "Der Schlüssel bleibt nur im Arbeitsspeicher und ist nach dem Schließen der App weg."}
        </p>
        <div>
          <Button type="submit" variant="primary" disabled={!key.trim() || !pinOk || busy}>
            {busy ? "Verschlüssele …" : "Verwenden"}
          </Button>
        </div>
      </form>
    </section>
  );
}

/** Modellwahl mit Preisbeispielen und geschätztem Verbrauch. */
function ModelAndCost() {
  const { profile, change, spent } = useAiProfile();
  const toast = useApp((s) => s.toast);
  // Beispiel: Frage an den Assistenten mit Quellen ≈ 12 000 Tokens hinein, 2 500 heraus (inkl. Denken)
  const example = (model: string, effortFactor: number) => requestCostUsd(model, { input_tokens: 12_000, output_tokens: Math.round(2_500 * effortFactor) });
  return (
    <section className="card">
      <h3>Modell und Kosten</h3>
      <div className="ai-profiles" role="radiogroup" aria-label="KI-Modell">
        {Object.values(AI_PROFILES).map((p) => {
          const per = example(p.model, p.effort === "high" ? 1 : 0.7);
          return (
            <label key={p.id} className={`ai-profile-card ${profile.id === p.id ? "is-active" : ""}`}>
              <input type="radio" name="ai-profile" checked={profile.id === p.id} onChange={() => void change(p.id)} />
              <span className="grow stack-tight">
                <strong>{p.label}</strong>
                <span className="xs muted">{p.hint}</span>
                <span className="xs">
                  Frage an den Assistenten: {formatCost(per)} · mit 5 € etwa {requestsFor(5, per).toLocaleString("de-DE")} Fragen
                </span>
              </span>
            </label>
          );
        })}
      </div>
      <p className="xs muted">Schätzung aus den Token-Zahlen jeder Antwort (Preise der Anthropic-Preisliste, 1 $ ≈ 0,90 €). Lange Texte und ausführliche Antworten kosten mehr. Genau abgerechnet wird in der Anthropic-Konsole unter „Usage“.</p>
      {spent && (
        <div className="row wrap small">
          <span>
            Bisher verbraucht (geschätzt, dieses Gerät): <strong>{formatCost(spent.usd)}</strong> · {spent.requests} Anfragen seit {formatDate(spent.since)}
          </span>
          <span className="grow" />
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              await api.settingSet(SPENT_SETTING, { usd: 0, requests: 0, since: new Date().toISOString() }).catch(reportError);
              useApp.getState().bump();
              toast("Zähler zurückgesetzt.", "success");
            }}
          >
            Zähler zurücksetzen
          </Button>
        </div>
      )}
      <p className="xs muted">Tipp: In der Anthropic-Konsole das automatische Aufladen ausgeschaltet lassen – dann kann nie mehr als das aufgeladene Guthaben verbraucht werden.</p>
    </section>
  );
}
