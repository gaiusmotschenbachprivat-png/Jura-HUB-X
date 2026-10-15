/**
 * API-Schlüssel auf dem iPad merken – verschlüsselt mit einer PIN.
 *
 * Standardverfahren der Web Crypto API (keine eigene Kryptografie):
 * PBKDF2-SHA-256 (600 000 Runden, zufälliges Salz) leitet aus der PIN einen
 * AES-256-GCM-Schlüssel ab; damit wird der API-Schlüssel verschlüsselt. Gespeichert
 * werden nur Salz, IV und Chiffrat. Ohne PIN ist der Schlüssel nicht lesbar.
 *
 * Grenze: Wer Zugriff auf die Daten des Geräts hat, kann kurze PINs durch
 * Ausprobieren erraten. Deshalb mindestens 6 Zeichen; besser länger.
 */

export interface KeyVault {
  v: 1;
  iterations: number;
  salt: string;
  iv: string;
  data: string;
}

export const MIN_PIN = 6;
const ITERATIONS = 600_000;

const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derive(pin: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as Uint8Array<ArrayBuffer>, iterations, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function sealKey(apiKey: string, pin: string, iterations = ITERATIONS): Promise<KeyVault> {
  if (pin.length < MIN_PIN) throw new Error(`Die PIN muss mindestens ${MIN_PIN} Zeichen haben.`);
  if (!apiKey.trim()) throw new Error("Kein Schlüssel angegeben.");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await derive(pin, salt, iterations);
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(apiKey.trim())));
  return { v: 1, iterations, salt: b64(salt), iv: b64(iv), data: b64(data) };
}

export async function openKey(vault: KeyVault, pin: string): Promise<string> {
  try {
    const key = await derive(pin, unb64(vault.salt), vault.iterations);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(vault.iv) as Uint8Array<ArrayBuffer> }, key, unb64(vault.data) as Uint8Array<ArrayBuffer>);
    return new TextDecoder().decode(plain);
  } catch {
    throw new Error("Falsche PIN.");
  }
}

export function isVault(v: unknown): v is KeyVault {
  const o = v as KeyVault | null;
  return !!o && o.v === 1 && typeof o.salt === "string" && typeof o.iv === "string" && typeof o.data === "string" && Number.isInteger(o.iterations);
}
