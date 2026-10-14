/**
 * Fehler des Kerns – gleiche Codes und Texte wie `studium_core::Error` in Rust.
 * Die Oberfläche zeigt `message` unverändert an.
 */
export class CoreError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CoreError";
  }
  static invalid(msg: string) {
    return new CoreError("invalid", msg);
  }
  static notFound(msg: string) {
    return new CoreError("not_found", msg);
  }
  static corrupt(msg: string) {
    return new CoreError("backup_corrupt", `Das Backup ist unvollständig oder beschädigt: ${msg}`);
  }
}

/** Wandelt beliebige Fehler in `{ code, message }` für die Oberfläche um. */
export function toCmdError(e: unknown): { code: string; message: string } {
  if (e instanceof CoreError) return { code: e.code, message: e.message };
  const msg = e instanceof Error ? e.message : String(e);
  if (/SQLITE_FULL|QuotaExceeded|quota/i.test(msg)) {
    return { code: "io", message: "Der Speicher des Geräts ist voll. Lösche nicht benötigte Dokumente oder sichere ein Backup." };
  }
  if (/SQLITE|sqlite3/i.test(msg)) return { code: "db", message: `Datenbankfehler: ${msg}` };
  return { code: "io", message: `Dateifehler: ${msg}` };
}
