/** Modellwahl (Genau / Sparsam / Sehr günstig) und Kostenstand für die Oberfläche. */
import { useEffect, useState } from "react";

import { api } from "../../api";
import { AI_PROFILES, type AiProfileId, PROFILE_SETTING, profileFromSettings } from "../../ai/config";
import { addToSpent, BUDGET_SETTING, budgetExceeded, budgetFrom, formatCost, SPENT_SETTING, spentFrom, type Spent } from "../../ai/cost";
import { useApp } from "../../state/store";

/** Kosten einer Anfrage zum geschätzten Gesamtverbrauch dieses Geräts addieren. */
export async function addSpend(usd: number, requests = 1) {
  if (!(usd > 0)) return;
  try {
    const s = spentFrom((await api.settingsAll())[SPENT_SETTING]);
    await api.settingSet(SPENT_SETTING, addToSpent(s, usd, requests));
    useApp.getState().bump();
  } catch {
    /* nur Anzeige – kein Fehler zeigen */
  }
}

/** Vor jeder bezahlten Anfrage: Ist das Monatsbudget erreicht, wird nicht gesendet. */
export async function checkBudget() {
  const s = await api.settingsAll();
  const msg = budgetExceeded(spentFrom(s[SPENT_SETTING]), budgetFrom(s[BUDGET_SETTING]));
  if (msg) throw new Error(msg);
}

export async function loadProfile() {
  return profileFromSettings((await api.settingsAll())[PROFILE_SETTING]);
}

export function useAiProfile() {
  const dataVersion = useApp((s) => s.dataVersion);
  const [id, setId] = useState<AiProfileId>("auto");
  const [spent, setSpent] = useState<Spent | null>(null);
  useEffect(() => {
    void api.settingsAll().then((s) => {
      setId(profileFromSettings(s[PROFILE_SETTING]).id);
      setSpent(spentFrom(s[SPENT_SETTING]));
    });
  }, [dataVersion]);
  const change = async (next: AiProfileId) => {
    setId(next);
    await api.settingSet(PROFILE_SETTING, next).catch(() => {});
    useApp.getState().bump();
  };
  return { profile: AI_PROFILES[id], change, spent };
}

/** Kleine Auswahl für Werkzeugleisten und Dialoge. */
export function ProfileSelect({ disabled, onChange }: { disabled?: boolean; onChange?: (id: AiProfileId) => void }) {
  const { profile, change, spent } = useAiProfile();
  return (
    <label className="row small ai-profile" title={`${profile.hint}${spent?.usd ? `\nBisher verbraucht (geschätzt): ${formatCost(spent.usd)}` : ""}`}>
      <span className="muted">Modell</span>
      <select
        aria-label="KI-Modell"
        value={profile.id}
        disabled={disabled}
        onChange={(e) => {
          const v = e.target.value as AiProfileId;
          void change(v);
          onChange?.(v);
        }}
      >
        {Object.values(AI_PROFILES).map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </select>
    </label>
  );
}
