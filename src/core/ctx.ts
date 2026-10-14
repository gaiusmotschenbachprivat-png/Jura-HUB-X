import type { BlobStore } from "./blobs";
import type { Db } from "./db";

/** Datenbank und Dateispeicher – das, was in Rust `AppState` (Verbindung + `BlobStore`) ist. */
export interface Ctx {
  db: Db;
  blobs: BlobStore;
}
