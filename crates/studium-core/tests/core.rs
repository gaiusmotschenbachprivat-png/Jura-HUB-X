//! Integrationstests für den Kern. Jeder Test arbeitet in einem eigenen
//! temporären Datenordner.

use std::fs;
use std::io::Write;
use std::path::Path;

use studium_core::backup::{self, BackupOptions};
use studium_core::db;
use studium_core::files::BlobStore;
use studium_core::repo::documents::{self, Scope};
use studium_core::repo::links::{self, NewLink};
use studium_core::repo::nodes::{self, NewNode, NodePatch};
use studium_core::repo::{areas, notes, trash};
use studium_core::search;

fn node(area: &str, parent: Option<&str>, kind: &str, title: &str) -> NewNode {
    NewNode {
        area_id: area.into(),
        parent_id: parent.map(String::from),
        kind: kind.into(),
        title: title.into(),
        meta: None,
        content_json: None,
        plain_text: None,
        template: None,
    }
}

fn doc_json(text: &str) -> String {
    serde_json::json!({"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":text}]}]}).to_string()
}

struct Fixture {
    dir: tempfile::TempDir,
    conn: rusqlite::Connection,
    store: BlobStore,
    jura: String,
    rw: String,
}

fn setup() -> Fixture {
    let dir = tempfile::tempdir().unwrap();
    let conn = db::open(dir.path()).unwrap();
    let store = BlobStore::new(dir.path()).unwrap();
    let jura = areas::create(&conn, "Rechtswissenschaften", "#1f3f8f").unwrap().id;
    let rw = areas::create(&conn, "Recht & Wirtschaft", "#2b8a3e").unwrap().id;
    Fixture { dir, conn, store, jura, rw }
}

fn write_file(dir: &Path, name: &str, content: &[u8]) -> std::path::PathBuf {
    let p = dir.join(name);
    fs::File::create(&p).unwrap().write_all(content).unwrap();
    p
}

// ---------- Migrationen ----------

#[test]
fn fresh_database_has_current_schema_and_reopens() {
    let f = setup();
    assert_eq!(db::schema_version(&f.conn).unwrap(), db::SCHEMA_VERSION);
    drop(f.conn);
    let conn = db::open(f.dir.path()).unwrap();
    assert_eq!(areas::list(&conn).unwrap().len(), 2, "Daten bleiben beim erneuten Öffnen erhalten");
}

#[test]
fn newer_schema_is_rejected_without_changes() {
    let f = setup();
    f.conn.execute_batch("PRAGMA user_version = 99;").unwrap();
    drop(f.conn);
    let err = db::open(f.dir.path()).unwrap_err().to_string();
    assert!(err.contains("neueren Version"), "{err}");
    let c = rusqlite::Connection::open(db::db_path(f.dir.path())).unwrap();
    let n: i64 = c.query_row("SELECT COUNT(*) FROM areas", [], |r| r.get(0)).unwrap();
    assert_eq!(n, 2);
}

// ---------- Struktur ----------

#[test]
fn hierarchy_is_flexible_and_moves_safely() {
    let f = setup();
    let ws = nodes::create(&f.conn, node(&f.jura, None, "semester", "WS 2026/27")).unwrap();
    let bgb = nodes::create(&f.conn, node(&f.jura, Some(&ws.id), "course", "BGB AT")).unwrap();
    let t1 = nodes::create(&f.conn, node(&f.jura, Some(&bgb.id), "session", "Termin 1: Willenserklärung")).unwrap();
    let extra = nodes::create(&f.conn, node(&f.jura, Some(&t1.id), "folder", "Zusatzebene")).unwrap();
    let note = nodes::create(&f.conn, node(&f.jura, Some(&extra.id), "note", "Mitschrift")).unwrap();

    assert_eq!(nodes::breadcrumb(&f.conn, &note.id, false).unwrap(), "WS 2026/27 › BGB AT › Termin 1: Willenserklärung › Zusatzebene");
    assert_eq!(nodes::list(&f.conn, Some(&f.jura)).unwrap().len(), 5);
    assert_eq!(nodes::list(&f.conn, Some(&f.rw)).unwrap().len(), 0, "keine Vermischung der Bereiche");

    // Zyklus verhindern
    assert!(nodes::move_node(&f.conn, &ws.id, Some(&note.id), 1.0, None).is_err());

    // Bereichswechsel nimmt Unterknoten mit
    nodes::move_node(&f.conn, &bgb.id, None, 1.0, Some(&f.rw)).unwrap();
    assert_eq!(nodes::get(&f.conn, &note.id).unwrap().area_id, f.rw);
    assert_eq!(nodes::list(&f.conn, Some(&f.jura)).unwrap().len(), 1);

    // Umbenennen + Metadaten
    let n = nodes::update(
        &f.conn,
        &bgb.id,
        NodePatch { title: Some("BGB Allgemeiner Teil".into()), meta: Some(serde_json::json!({"lecturer": "Prof. Dr. Muster"})) },
    )
    .unwrap();
    assert_eq!(n.title, "BGB Allgemeiner Teil");
    let hits = search::search(&f.conn, "Muster", None, 10).unwrap();
    assert_eq!(hits.len(), 1, "Dozent ist durchsuchbar");

    // Archivieren
    let a = nodes::set_archived(&f.conn, &ws.id, true).unwrap();
    assert!(a.archived_at.is_some());
    assert!(nodes::set_archived(&f.conn, &ws.id, false).unwrap().archived_at.is_none());
}

#[test]
fn rejects_invalid_input() {
    let f = setup();
    assert!(nodes::create(&f.conn, node(&f.jura, None, "virus", "x")).is_err());
    assert!(nodes::create(&f.conn, node(&f.jura, None, "note", "   ")).is_err());
    assert!(nodes::create(&f.conn, node("kein-id", None, "note", "x")).is_err());
    assert!(areas::create(&f.conn, "X", "red; background:url(x)").is_err());
    let other = nodes::create(&f.conn, node(&f.rw, None, "module", "Modul")).unwrap();
    assert!(nodes::create(&f.conn, node(&f.jura, Some(&other.id), "note", "x")).is_err());
}

#[test]
fn area_refs_show_content_in_other_area() {
    let f = setup();
    let gesr = nodes::create(&f.conn, node(&f.jura, None, "course", "Gesellschaftsrecht")).unwrap();
    nodes::add_area_ref(&f.conn, &gesr.id, &f.rw).unwrap();
    assert_eq!(nodes::list_area_refs(&f.conn, &f.rw).unwrap()[0].id, gesr.id);
    assert_eq!(search::search(&f.conn, "Gesellschaft", Some(&f.rw), 10).unwrap().len(), 1);
    assert!(nodes::add_area_ref(&f.conn, &gesr.id, &f.jura).is_err());
}

// ---------- Notizen ----------

#[test]
fn notes_save_version_restore_and_survive_restart() {
    let f = setup();
    let n = nodes::create(&f.conn, node(&f.jura, None, "note", "Anfechtung")).unwrap();
    let r1 = notes::save(&f.conn, &n.id, &doc_json("Erste Fassung"), "Erste Fassung").unwrap();
    assert!(r1.version_created, "erste Speicherung erzeugt eine Version");
    let r2 = notes::save(&f.conn, &n.id, &doc_json("Zweite Fassung Irrtum"), "Zweite Fassung Irrtum").unwrap();
    assert!(!r2.version_created, "innerhalb von 10 Minuten keine neue Version");
    let same = notes::save(&f.conn, &n.id, &doc_json("Zweite Fassung Irrtum"), "Zweite Fassung Irrtum").unwrap();
    assert_eq!(same.updated_at, r2.updated_at, "unveränderter Inhalt wird nicht neu geschrieben");

    assert!(notes::save(&f.conn, &n.id, "{kaputt", "").is_err());
    assert!(notes::save(&f.conn, &n.id, r#"{"type":"bild"}"#, "").is_err());

    let versions = notes::list_versions(&f.conn, &n.id).unwrap();
    assert_eq!(versions.len(), 1);
    notes::restore_version(&f.conn, &n.id, &versions[0].id).unwrap();
    assert!(notes::get(&f.conn, &n.id).unwrap().content_json.contains("Erste Fassung"));
    assert_eq!(notes::list_versions(&f.conn, &n.id).unwrap().len(), 2, "Stand vor Wiederherstellung gesichert");
    // Suche folgt dem wiederhergestellten Inhalt
    assert!(search::search(&f.conn, "Irrtum", None, 10).unwrap().is_empty());
    assert_eq!(search::search(&f.conn, "Fassung", None, 10).unwrap().len(), 1);

    // Neustart simulieren
    let id = n.id.clone();
    drop(f.conn);
    let conn = db::open(f.dir.path()).unwrap();
    assert!(notes::get(&conn, &id).unwrap().content_json.contains("Erste Fassung"));
    assert_eq!(notes::recent(&conn, None, 5).unwrap()[0].node_id, id);
}

// ---------- Papierkorb ----------

#[test]
fn trash_hides_restores_and_purges() {
    let f = setup();
    let c = nodes::create(&f.conn, node(&f.jura, None, "course", "Strafrecht AT")).unwrap();
    let n = nodes::create(&f.conn, node(&f.jura, Some(&c.id), "note", "Vorsatz")).unwrap();
    notes::save(&f.conn, &n.id, &doc_json("dolus eventualis"), "dolus eventualis").unwrap();

    trash::trash_node(&f.conn, &c.id).unwrap();
    assert!(nodes::list(&f.conn, Some(&f.jura)).unwrap().is_empty());
    assert!(search::search(&f.conn, "dolus", None, 10).unwrap().is_empty());
    let items = trash::list(&f.conn).unwrap();
    assert_eq!(items.len(), 1, "nur der oberste Eintrag erscheint");
    assert_eq!(items[0].children, 1);
    assert!(notes::save(&f.conn, &n.id, &doc_json("x"), "x").is_err(), "gelöschte Notiz nicht bearbeitbar");

    trash::restore_node(&f.conn, &c.id).unwrap();
    assert_eq!(nodes::list(&f.conn, Some(&f.jura)).unwrap().len(), 2);
    assert_eq!(search::search(&f.conn, "dolus", None, 10).unwrap().len(), 1);

    assert!(trash::purge_node(&f.conn, &c.id).is_err(), "endgültig nur aus dem Papierkorb");
    trash::trash_node(&f.conn, &c.id).unwrap();
    trash::purge_node(&f.conn, &c.id).unwrap();
    assert!(nodes::get(&f.conn, &n.id).is_err());
    assert!(trash::list(&f.conn).unwrap().is_empty());
}

// ---------- Dokumente ----------

#[test]
fn documents_import_dedup_text_and_placements() {
    let f = setup();
    let src = tempfile::tempdir().unwrap();
    let c1 = nodes::create(&f.conn, node(&f.jura, None, "course", "Gesellschaftsrecht")).unwrap();
    let c2 = nodes::create(&f.conn, node(&f.rw, None, "course", "Unternehmensfinanzierung")).unwrap();

    let txt = write_file(src.path(), "Skript_GmbH.txt", "Die GmbH haftet mit ihrem Gesellschaftsvermögen.".as_bytes());
    let d1 = documents::import(&f.conn, &f.store, &txt, Some(&c1.id), "skript").unwrap();
    assert_eq!(d1.title, "Skript GmbH");
    assert_eq!(d1.text_status, "ok");
    assert!(txt.exists(), "Original bleibt unverändert am Ursprungsort");

    // Ein Dokument, zwei Veranstaltungen, keine Kopie
    documents::add_placement(&f.conn, &d1.id, &c2.id).unwrap();
    assert_eq!(documents::list(&f.conn, None, Scope::Area(&f.rw)).unwrap().len(), 1);
    assert_eq!(documents::placements(&f.conn, &d1.id).unwrap().len(), 2);

    // Gleiche Datei erneut: zweiter Datensatz, aber nur eine physische Datei
    let d2 = documents::import(&f.conn, &f.store, &txt, None, "skript").unwrap();
    let blobs: i64 = f.conn.query_row("SELECT COUNT(*) FROM blobs", [], |r| r.get(0)).unwrap();
    assert_eq!(blobs, 1);
    assert_eq!(documents::list(&f.conn, None, Scope::Unassigned).unwrap()[0].id, d2.id);

    // Suche: Text mit Fundstelle, Umlaute ohne Akzent findbar
    let hits = search::search(&f.conn, "gesellschaftsvermogen", None, 10).unwrap();
    assert!(hits.iter().any(|h| h.entity_type == "page" && h.page == Some(1)));
    assert!(hits[0].snippet.contains(search::HL_START));

    // PDF: falsche Signatur wird abgelehnt, Text aus der Oberfläche seitenweise
    let fake = write_file(src.path(), "fake.pdf", b"MZ\x90\x00 kein pdf");
    assert!(documents::import(&f.conn, &f.store, &fake, None, "folien").is_err());
    let pdf = write_file(src.path(), "Folien BGB AT.pdf", b"%PDF-1.7\n% Testinhalt\n");
    let p = documents::import(&f.conn, &f.store, &pdf, Some(&c1.id), "folien").unwrap();
    assert_eq!(p.text_status, "pending");
    documents::set_text(&f.conn, &p.id, &["Deckblatt".into(), "Die Willenserklärung ist …".into(), "".into()]).unwrap();
    let hit = search::search(&f.conn, "willenserklarung", Some(&f.jura), 10).unwrap();
    assert_eq!(hit.len(), 1);
    assert_eq!(hit[0].page, Some(2), "konkrete Seite wird geliefert");
    let scanned = write_file(src.path(), "Scan.pdf", b"%PDF-1.4\n%scan\n");
    let s = documents::import(&f.conn, &f.store, &scanned, None, "skript").unwrap();
    assert_eq!(documents::set_text(&f.conn, &s.id, &["".into(), " ".into()]).unwrap().text_status, "none");

    // Unerlaubte Typen und Ordner
    let exe = write_file(src.path(), "setup.exe", b"MZ");
    assert!(documents::import(&f.conn, &f.store, &exe, None, "sonstiges").is_err());
    assert!(documents::import(&f.conn, &f.store, src.path(), None, "sonstiges").is_err());
}

#[test]
fn missing_document_file_is_reported() {
    let f = setup();
    let src = tempfile::tempdir().unwrap();
    let p = write_file(src.path(), "a.txt", b"Inhalt");
    let d = documents::import(&f.conn, &f.store, &p, None, "sonstiges").unwrap();
    let sha = documents::blob_sha(&f.conn, &d.id).unwrap();
    f.store.remove(&sha).unwrap();
    let doc = documents::get(&f.conn, Some(&f.store), &d.id).unwrap();
    assert!(!doc.file_present);
    let err = documents::read_bytes(&f.conn, &f.store, &d.id).unwrap_err().to_string();
    assert!(err.contains("fehlt im Dokumentenspeicher"), "{err}");
}

#[test]
fn purge_document_keeps_shared_blob() {
    let f = setup();
    let src = tempfile::tempdir().unwrap();
    let p = write_file(src.path(), "x.txt", b"geteilt");
    let a = documents::import(&f.conn, &f.store, &p, None, "sonstiges").unwrap();
    let b = documents::import(&f.conn, &f.store, &p, None, "sonstiges").unwrap();
    let sha = documents::blob_sha(&f.conn, &a.id).unwrap();
    trash::trash_document(&f.conn, &a.id).unwrap();
    trash::purge_document(&f.conn, &f.store, &a.id).unwrap();
    assert!(f.store.exists(&sha), "Datei bleibt, solange b sie nutzt");
    trash::trash_document(&f.conn, &b.id).unwrap();
    trash::purge_document(&f.conn, &f.store, &b.id).unwrap();
    assert!(!f.store.exists(&sha));
}

// ---------- Verknüpfungen ----------

#[test]
fn links_are_bidirectional_and_survive_rename() {
    let f = setup();
    let src = tempfile::tempdir().unwrap();
    let note = nodes::create(&f.conn, node(&f.jura, None, "note", "Mitschrift Termin 3")).unwrap();
    let pdf = write_file(src.path(), "Folien.pdf", b"%PDF-1.7\n");
    let d = documents::import(&f.conn, &f.store, &pdf, None, "folien").unwrap();
    let id = links::add(
        &f.conn,
        NewLink {
            source_type: "node".into(),
            source_id: note.id.clone(),
            target_type: "document".into(),
            target_id: d.id.clone(),
            kind: "page".into(),
            anchor: Some(serde_json::json!({"page": 12})),
        },
    )
    .unwrap();
    // Doppelt anlegen liefert dieselbe Verknüpfung
    let again = links::add(
        &f.conn,
        NewLink {
            source_type: "node".into(),
            source_id: note.id.clone(),
            target_type: "document".into(),
            target_id: d.id.clone(),
            kind: "page".into(),
            anchor: Some(serde_json::json!({"page": 12})),
        },
    )
    .unwrap();
    assert_eq!(id, again);
    nodes::update(&f.conn, &note.id, NodePatch { title: Some("Umbenannt".into()), meta: None }).unwrap();
    let back = links::for_entity(&f.conn, "document", &d.id).unwrap();
    assert_eq!(back.len(), 1);
    assert_eq!(back[0].direction, "incoming");
    assert_eq!(back[0].other_title, "Umbenannt");
    assert_eq!(back[0].anchor["page"], 12);
    assert_eq!(links::for_entity(&f.conn, "node", &note.id).unwrap()[0].direction, "outgoing");

    let bad = NewLink {
        source_type: "node".into(),
        source_id: note.id.clone(),
        target_type: "document".into(),
        target_id: d.id.clone(),
        kind: "page".into(),
        anchor: Some(serde_json::json!({"page": 0})),
    };
    assert!(links::add(&f.conn, bad).is_err());
}

// ---------- Suche ----------

#[test]
fn search_handles_special_input_and_area_filter() {
    let f = setup();
    let a = nodes::create(&f.conn, node(&f.jura, None, "note", "Kaufvertrag § 433 BGB")).unwrap();
    notes::save(&f.conn, &a.id, &doc_json("Anspruch auf Übereignung"), "Anspruch auf Übereignung").unwrap();
    let b = nodes::create(&f.conn, node(&f.rw, None, "note", "Investitionsrechnung")).unwrap();
    notes::save(&f.conn, &b.id, &doc_json("Kapitalwert und Anspruch"), "Kapitalwert und Anspruch").unwrap();

    assert_eq!(search::search(&f.conn, "§ 433", None, 10).unwrap().len(), 1);
    assert_eq!(search::search(&f.conn, "anspr", None, 10).unwrap().len(), 2, "Präfixsuche");
    assert_eq!(search::search(&f.conn, "anspruch", Some(&f.rw), 10).unwrap().len(), 1, "Bereichsfilter");
    assert_eq!(search::search(&f.conn, "ubereignung", None, 10).unwrap().len(), 1, "ohne Umlaut");
    for weird in ["\"", "(", "NEAR(", "*", "a OR", "AND", "'; DROP TABLE nodes; --"] {
        assert!(search::search(&f.conn, weird, None, 10).is_ok(), "Eingabe {weird:?}");
    }
    assert!(search::search(&f.conn, "   ", None, 10).unwrap().is_empty());
    // Titel werden höher gewichtet als Fließtext
    let c = nodes::create(&f.conn, node(&f.jura, None, "note", "Anspruch")).unwrap();
    let hits = search::search(&f.conn, "anspruch", None, 10).unwrap();
    assert_eq!(hits[0].entity_id, c.id);

    // Neuaufbau des Index liefert dieselben Treffer
    search::rebuild(&f.conn).unwrap();
    assert_eq!(search::search(&f.conn, "anspruch", None, 10).unwrap().len(), 3);
}

// ---------- Backups ----------

fn opts() -> BackupOptions<'static> {
    BackupOptions { kind: "manual", app_version: "test", second_dir: None }
}

#[test]
fn backup_roundtrip_restores_previous_state() {
    let f = setup();
    let src = tempfile::tempdir().unwrap();
    let out = tempfile::tempdir().unwrap();
    let second = tempfile::tempdir().unwrap();
    let n = nodes::create(&f.conn, node(&f.jura, None, "note", "Gutachten")).unwrap();
    notes::save(&f.conn, &n.id, &doc_json("Obersatz Definition Subsumtion Ergebnis"), "Obersatz Definition Subsumtion Ergebnis").unwrap();
    let pdf = write_file(src.path(), "Klausur.pdf", b"%PDF-1.7\nKlausurinhalt");
    let d = documents::import(&f.conn, &f.store, &pdf, None, "klausur").unwrap();

    let info = backup::create(
        f.dir.path(),
        out.path(),
        &BackupOptions { kind: "manual", app_version: "test", second_dir: Some(second.path()) },
    )
    .unwrap();
    assert_eq!(info.file_count, 1);
    assert!(info.second_copy.is_some(), "{:?}", info.second_copy_error);
    assert!(backup::verify(Path::new(&info.path)).unwrap().ok);
    assert!(backup::verify(Path::new(info.second_copy.as_ref().unwrap())).unwrap().ok);
    let leftovers: Vec<_> = fs::read_dir(out.path()).unwrap().filter_map(|e| e.ok()).filter(|e| e.file_name().to_string_lossy().ends_with(".partial")).collect();
    assert!(leftovers.is_empty(), "keine .partial-Reste");
    backup::record(&f.conn, &info, "ok", None).unwrap();

    // Danach Daten ändern und Dokument endgültig löschen
    notes::save(&f.conn, &n.id, &doc_json("Versehentlich überschrieben"), "Versehentlich überschrieben").unwrap();
    trash::trash_document(&f.conn, &d.id).unwrap();
    trash::purge_document(&f.conn, &f.store, &d.id).unwrap();

    drop(f.conn);
    let res = backup::restore(Path::new(&info.path), f.dir.path()).unwrap();
    assert!(Path::new(&res.previous_state_dir).join("studium.sqlite").exists(), "alter Stand wurde beiseitegelegt");

    let conn = db::open(f.dir.path()).unwrap();
    assert!(notes::get(&conn, &n.id).unwrap().content_json.contains("Obersatz"));
    let store = BlobStore::new(f.dir.path()).unwrap();
    assert_eq!(documents::read_bytes(&conn, &store, &d.id).unwrap(), b"%PDF-1.7\nKlausurinhalt");
    assert_eq!(search::search(&conn, "Subsumtion", None, 10).unwrap().len(), 1);
}

#[test]
fn damaged_backups_are_detected_and_never_restored() {
    let f = setup();
    let out = tempfile::tempdir().unwrap();
    let src = tempfile::tempdir().unwrap();
    let pdf = write_file(src.path(), "a.pdf", b"%PDF-1.7\nAAAA");
    documents::import(&f.conn, &f.store, &pdf, None, "skript").unwrap();
    nodes::create(&f.conn, node(&f.jura, None, "note", "Wichtig")).unwrap();
    let info = backup::create(f.dir.path(), out.path(), &opts()).unwrap();
    let bytes = fs::read(&info.path).unwrap();

    // 1. abgeschnittene Datei
    let cut = out.path().join("abgeschnitten.studiumbackup");
    fs::write(&cut, &bytes[..bytes.len() / 2]).unwrap();
    let r = backup::verify(&cut).unwrap();
    assert!(!r.ok && !r.problems.is_empty());

    // 2. veränderter Inhalt (ein Byte in der gespeicherten PDF)
    let pos = bytes.windows(4).position(|w| w == b"AAAA").expect("PDF ist unkomprimiert gespeichert");
    let mut tampered = bytes.clone();
    tampered[pos] = b'B';
    let t = out.path().join("manipuliert.studiumbackup");
    fs::write(&t, &tampered).unwrap();
    let r = backup::verify(&t).unwrap();
    assert!(!r.ok, "Manipulation muss auffallen");
    assert!(r.problems.iter().any(|p| p.contains("Prüfsumme")), "{:?}", r.problems);

    // 3. keine Zip-Datei
    let junk = out.path().join("kein.studiumbackup");
    fs::write(&junk, b"hallo").unwrap();
    assert!(!backup::verify(&junk).unwrap().ok);

    // Wiederherstellung verweigert, Daten unverändert
    drop(f.conn);
    assert!(backup::restore(&t, f.dir.path()).is_err());
    let conn = db::open(f.dir.path()).unwrap();
    assert_eq!(nodes::list(&conn, None).unwrap().len(), 1);
    let pre: Vec<_> = fs::read_dir(f.dir.path()).unwrap().filter_map(|e| e.ok()).filter(|e| e.file_name().to_string_lossy().starts_with("pre-restore")).collect();
    assert!(pre.is_empty(), "bei abgelehntem Backup wird nichts verschoben");
}

#[test]
fn zip_slip_entries_are_rejected() {
    let out = tempfile::tempdir().unwrap();
    let p = out.path().join("boese.studiumbackup");
    let mut zip = zip::ZipWriter::new(fs::File::create(&p).unwrap());
    let o = zip::write::SimpleFileOptions::default();
    zip.start_file("../../evil.txt", o).unwrap();
    zip.write_all(b"x").unwrap();
    zip.start_file("manifest.json", o).unwrap();
    zip.write_all(br#"{"format":"studium-os-backup","format_version":1,"app_version":"x","schema_version":1,"created_at":"x","kind":"manual","entries":[{"path":"../../evil.txt","sha256":"00","size":1}]}"#).unwrap();
    zip.finish().unwrap();
    let r = backup::verify(&p).unwrap();
    assert!(!r.ok);
    let data = tempfile::tempdir().unwrap();
    assert!(backup::restore(&p, data.path()).is_err());
    assert!(!data.path().parent().unwrap().join("evil.txt").exists());
}

#[test]
fn prune_keeps_manual_backups() {
    let dir = tempfile::tempdir().unwrap();
    for i in 0..5 {
        fs::write(dir.path().join(format!("Studium-OS-Auto-Backup-2026-01-0{i}_000000Z.studiumbackup")), b"x").unwrap();
    }
    fs::write(dir.path().join("Studium-OS-Backup-2026-01-01_000000Z.studiumbackup"), b"x").unwrap();
    assert_eq!(backup::prune_auto(dir.path(), 2).unwrap(), 3);
    let names: Vec<String> = fs::read_dir(dir.path()).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into()).collect();
    assert_eq!(names.len(), 3);
    assert!(names.iter().any(|n| n.starts_with("Studium-OS-Backup-")));
}

#[test]
fn internal_links_in_text_become_backlinks() {
    let f = setup();
    let def = nodes::create(&f.conn, node(&f.jura, None, "note", "Definition Willenserklärung")).unwrap();
    let n = nodes::create(&f.conn, node(&f.jura, None, "note", "Mitschrift")).unwrap();
    let content = serde_json::json!({"type":"doc","content":[{"type":"paragraph","content":[
        {"type":"text","text":"siehe Definition","marks":[{"type":"link","attrs":{"href":format!("studium:node/{}", def.id)}}]},
        {"type":"text","text":" und tot","marks":[{"type":"link","attrs":{"href":"studium:node/01900000-0000-7000-8000-00000000dead"}}]}
    ]}]}).to_string();
    notes::save(&f.conn, &n.id, &content, "siehe Definition").unwrap();
    let back = links::for_entity(&f.conn, "node", &def.id).unwrap();
    assert_eq!(back.len(), 1);
    assert_eq!(back[0].kind, "mention");
    assert_eq!(back[0].other_id, n.id);
    // Link entfernen → Rückverweis verschwindet
    notes::save(&f.conn, &n.id, &doc_json("ohne Link"), "ohne Link").unwrap();
    assert!(links::for_entity(&f.conn, "node", &def.id).unwrap().is_empty());
}
