/**
 * Geheimnisse nur für dieses Gerät verschlüsseln (z. B. den Abo-Link des
 * Uni-Kalenders mit persönlichem Schlüssel). AES-GCM über WebCrypto mit einem
 * nicht exportierbaren Schlüssel in IndexedDB: In Einstellungen, Backups und
 * Abgleich-Dateien steht nur der verschlüsselte Text – auf einem anderen
 * Gerät ist er wertlos und muss neu eingegeben werden.
 */
const DB = "studium-geheim";
const STORE = "keys";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function deviceKey(): Promise<CryptoKey> {
  const db = await openDb();
  try {
    const existing = await new Promise<CryptoKey | undefined>((resolve, reject) => {
      const q = db.transaction(STORE).objectStore(STORE).get("device");
      q.onsuccess = () => resolve(q.result as CryptoKey | undefined);
      q.onerror = () => reject(q.error);
    });
    if (existing) return existing;
    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction(STORE, "readwrite");
      t.objectStore(STORE).put(key, "device");
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
    return key;
  } finally {
    db.close();
  }
}

const b64 = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b)));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export interface Sealed {
  iv: string;
  data: string;
}

export async function seal(text: string): Promise<Sealed> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await deviceKey(), new TextEncoder().encode(text));
  return { iv: b64(iv), data: b64(data) };
}

/** Entschlüsseln; null, wenn der Text von einem anderen Gerät stammt. */
export async function unseal(s: unknown): Promise<string | null> {
  if (!s || typeof s !== "object" || typeof (s as Sealed).iv !== "string" || typeof (s as Sealed).data !== "string") return null;
  try {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64((s as Sealed).iv) }, await deviceKey(), unb64((s as Sealed).data));
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}
