//! Hilfsprogramm für den Kompatibilitätstest Desktop ↔ iPad-Version.
//!
//! `backup_compat create <ordner> <pdf>` – legt Daten an und schreibt ein Backup nach <ordner>
//! `backup_compat verify <datei>`        – prüft ein Backup (z. B. aus der Browser-Version)
//! `backup_compat restore <datei> <ordner>` – stellt es wieder her und gibt Kennzahlen aus
use std::path::Path;

use studium_core::backup::{self, BackupOptions};
use studium_core::files::BlobStore;
use studium_core::repo::{areas, documents, nodes, notes};
use studium_core::{db, search};

fn main() {
    let args: Vec<String> = std::env::args().collect();
    match args.get(1).map(String::as_str) {
        Some("create") => {
            let out = Path::new(&args[2]);
            let data = out.join("daten");
            let conn = db::open(&data).unwrap();
            let store = BlobStore::new(&data).unwrap();
            let a = areas::create(&conn, "Rechtswissenschaften", "#2f4a8a").unwrap();
            let n = nodes::create(
                &conn,
                nodes::NewNode {
                    area_id: a.id.clone(),
                    parent_id: None,
                    kind: "note".into(),
                    title: "Vom Desktop".into(),
                    meta: None,
                    content_json: None,
                    plain_text: None,
                    template: None,
                },
            )
            .unwrap();
            let doc = r#"{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Desktop-Inhalt Gestaltungsrecht"}]}]}"#;
            notes::save(&conn, &n.id, doc, "Desktop-Inhalt Gestaltungsrecht").unwrap();
            documents::import(&conn, &store, Path::new(&args[3]), None, "folien").unwrap();
            drop(conn);
            let info = backup::create(&data, out, &BackupOptions { kind: "manual", app_version: "desktop-test", second_dir: None }).unwrap();
            println!("{}", info.path);
        }
        Some("verify") => {
            let r = backup::verify(Path::new(&args[2])).unwrap();
            println!("ok={} files={} problems={:?}", r.ok, r.file_count, r.problems);
            std::process::exit(if r.ok { 0 } else { 1 });
        }
        Some("restore") => {
            let data = Path::new(&args[3]);
            std::fs::create_dir_all(data).unwrap();
            backup::restore(Path::new(&args[2]), data).unwrap();
            let conn = db::open(data).unwrap();
            search::rebuild(&conn).unwrap();
            let hits = search::search(&conn, "Browser", None, 10).unwrap();
            let docs: i64 = conn.query_row("SELECT COUNT(*) FROM documents", [], |r| r.get(0)).unwrap();
            let store = BlobStore::new(data).unwrap();
            let sha: String = conn.query_row("SELECT blob_sha FROM documents LIMIT 1", [], |r| r.get(0)).unwrap();
            println!("hits={} docs={} file_ok={}", hits.len(), docs, store.exists(&sha));
        }
        _ => eprintln!("Aufruf: backup_compat create|verify|restore …"),
    }
}
