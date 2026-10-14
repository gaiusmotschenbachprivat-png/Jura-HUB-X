/** Nachrichten zwischen Oberfläche und Daten-Worker der Browser-Version. */

export interface Request {
  id: number;
  method: string;
  args: unknown[];
}

export type Response =
  | { id: number; ok: true; value: unknown }
  | { id: number; ok: false; error: { code: string; message: string } };

/** Meldung des Workers nach dem Start. */
export type Ready = { ready: true } | { ready: false; error: { code: string; message: string } };
