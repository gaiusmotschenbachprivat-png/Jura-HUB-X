//! Tests für Phase 3: Wissensobjekte, Karteikarten, Planung, PDF-Markierungen, Bilder.

use std::fs;
use std::path::Path;

use serde_json::json;
use studium_core::backup::{self, BackupOptions};
use studium_core::db;
use studium_core::files::BlobStore;
use studium_core::repo::annotations::{self, AnnotationPatch, NewAnnotation, Rect};
use studium_core::repo::cards::{self, CardFilter, CardPatch, NewCard, ReviewInput};
use studium_core::repo::knowledge::{self, KnowledgeFilter, KnowledgePatch, NewKnowledge};
use studium_core::repo::links::{self, NewLink};
use studium_core::repo::nodes::{self, NewNode};
use studium_core::repo::planning::{self, ExamInput, NewTask, TaskFilter, TaskPatch};
use studium_core::repo::{areas, documents, notes, trash};
use studium_core::search;

struct F {
    dir: tempfile::TempDir,
    conn: rusqlite::Connection,
    store: BlobStore,
    jura: String,
    wiwi: String,
}

fn setup() -> F {
    let dir = tempfile::tempdir().unwrap();
    let conn = db::open(dir.path()).unwrap();
    let store = BlobStore::new(dir.path()).unwrap();
    let jura = areas::create(&conn, "Rechtswissenschaften", "#1f3f8f").unwrap().id;
    let wiwi = areas::create(&conn, "WiWiZ", "#9a5b13").unwrap().id;
    F { dir, conn, store, jura, wiwi }
}

fn new_k(ty: &str, title: &str, area: Option<&str>, data: serde_json::Value) -> NewKnowledge {
    NewKnowledge { ty: ty.into(), area_id: area.map(String::from), node_id: None, title: title.into(), field: "Zivilrecht".into(), source_kind: None, data }
}

#[test]
fn schema_version_is_two_and_upgrade_from_one_keeps_data() {
    let dir = tempfile::tempdir().unwrap();
    {
        let conn = rusqlite::Connection::open(db::db_path(dir.path())).unwrap();
        db::configure(&conn).unwrap();
        db::migrate_with(&conn, None, &db::builtin_migrations()[..1]).unwrap();
        conn.execute("INSERT INTO areas (id, name, color, position, created_at, updated_at) VALUES ('01900000-0000-7000-8000-000000000001','Alt','#123456',0,'x','x')", []).unwrap();
    }
    let conn = db::open(dir.path()).unwrap();
    assert_eq!(db::schema_version(&conn).unwrap(), 2);
    assert_eq!(areas::list(&conn).unwrap()[0].name, "Alt");
    assert_eq!(fs::read_dir(dir.path().join("pre-migration")).unwrap().count(), 1);
}

#[test]
fn definitions_schemas_cases_citations() {
    let f = setup();
    let def = knowledge::create(&f.conn, new_k("definition", "Willenserklärung", Some(&f.jura), json!({"text": "Äußerung eines Rechtsbindungswillens", "citation": "§§ 116 ff. BGB", "unbekannt": 1}))).unwrap();
    assert_eq!(def.data["text"], "Äußerung eines Rechtsbindungswillens");
    assert!(def.data.get("unbekannt").is_none(), "unbekannte Felder werden verworfen");
    assert_eq!(def.source_kind, "eigen");

    let schema = knowledge::create(
        &f.conn,
        new_k("schema", "Anspruch aus § 433 II BGB", Some(&f.jura), json!({"norm": "§ 433 Abs. 2 BGB", "items": [
            {"text": "Anspruch entstanden", "children": [{"text": "Vertragsschluss", "children": [{"text": "Angebot"}, {"text": "Annahme"}]}]},
            {"text": "Anspruch nicht erloschen"}
        ]})),
    )
    .unwrap();
    let first = &schema.data["items"][0];
    assert!(first["id"].as_str().unwrap().len() > 10, "Schemapunkte bekommen IDs");
    assert_eq!(first["children"][0]["children"][1]["text"], "Annahme");

    // Zu tiefe Verschachtelung wird abgelehnt
    let mut deep = json!({"text": "x"});
    for _ in 0..14 {
        deep = json!({"text": "x", "children": [deep]});
    }
    assert!(knowledge::create(&f.conn, new_k("schema", "Tief", None, json!({"items": [deep]}))).is_err());

    let case = knowledge::create(&f.conn, new_k("case", "Trierer Weinversteigerung", Some(&f.jura), json!({"difficulty": 9, "status": "kaputt", "facts": "Handzeichen bei Versteigerung"}))).unwrap();
    assert_eq!(case.data["difficulty"], 0, "ungültige Schwierigkeit wird zurückgesetzt");
    assert_eq!(case.data["status"], "offen");

    // Fundstelle: Titel wird aus den Feldern gebildet, gleiche Norm wird wiederverwendet
    let c1 = knowledge::create(&f.conn, new_k("citation", "egal", None, json!({"law": "BGB", "prefix": "§", "number": "433", "paragraph": "2"}))).unwrap();
    assert_eq!(c1.title, "§ 433 Abs. 2 BGB");
    let c2 = knowledge::create(&f.conn, new_k("citation", "", None, json!({"law": "BGB", "prefix": "§", "number": "433", "paragraph": "2"}))).unwrap();
    assert_eq!(c1.id, c2.id);
    assert!(knowledge::create(&f.conn, new_k("citation", "", None, json!({"law": "BGB"}))).is_err());

    // Liste je Typ und Bereich (ohne Bereich = überall sichtbar)
    let jura_defs = knowledge::list(&f.conn, &KnowledgeFilter { ty: Some("definition".into()), area_id: Some(f.jura.clone()), ..Default::default() }).unwrap();
    assert_eq!(jura_defs.len(), 1);
    let wiwi_all = knowledge::list(&f.conn, &KnowledgeFilter { area_id: Some(f.wiwi.clone()), ..Default::default() }).unwrap();
    assert_eq!(wiwi_all.len(), 1, "nur die bereichslose Fundstelle");
    assert_eq!(knowledge::fields(&f.conn).unwrap(), vec!["Zivilrecht".to_string()]);

    // Bearbeiten + Suche
    knowledge::update(&f.conn, &def.id, KnowledgePatch { data: Some(json!({"text": "Neu: Kundgabe eines Geschäftswillens"})), ..Default::default() }).unwrap();
    assert_eq!(search::search(&f.conn, "Geschäftswillens", None, 10).unwrap()[0].kind.as_deref(), Some("definition"));
    assert_eq!(search::search(&f.conn, "Annahme", Some(&f.jura), 10).unwrap()[0].entity_id, schema.id);
    assert_eq!(search::search(&f.conn, "433", Some(&f.wiwi), 10).unwrap().len(), 1, "bereichslose Fundstelle überall auffindbar");

    // Papierkorb
    knowledge::trash(&f.conn, &case.id).unwrap();
    assert!(search::search(&f.conn, "Weinversteigerung", None, 10).unwrap().is_empty());
    assert!(trash::list(&f.conn).unwrap().iter().any(|t| t.item_type == "knowledge" && t.id == case.id));
    trash::restore_any(&f.conn, "knowledge", &case.id).unwrap();
    assert_eq!(search::search(&f.conn, "Weinversteigerung", None, 10).unwrap().len(), 1);
    knowledge::trash(&f.conn, &case.id).unwrap();
    trash::purge_any(&f.conn, &f.store, "knowledge", &case.id).unwrap();
    assert!(knowledge::get(&f.conn, &case.id).is_err());
}

#[test]
fn definition_backlinks_from_notes_schemas_and_cases() {
    let f = setup();
    let def = knowledge::create(&f.conn, new_k("definition", "Angebot", Some(&f.jura), json!({"text": "empfangsbedürftige WE"}))).unwrap();
    let schema = knowledge::create(&f.conn, new_k("schema", "Vertragsschluss", Some(&f.jura), json!({}))).unwrap();
    links::add(&f.conn, NewLink { source_type: "knowledge".into(), source_id: schema.id.clone(), target_type: "knowledge".into(), target_id: def.id.clone(), kind: "related".into(), anchor: None }).unwrap();
    let note = nodes::create(&f.conn, NewNode { area_id: f.jura.clone(), parent_id: None, kind: "note".into(), title: "Mitschrift".into(), meta: None, content_json: None, plain_text: None, template: None }).unwrap();
    let content = json!({"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Angebot","marks":[{"type":"link","attrs":{"href": format!("studium:knowledge/{}", def.id)}}]}]}]}).to_string();
    notes::save(&f.conn, &note.id, &content, "Angebot").unwrap();
    let used = links::for_entity(&f.conn, "knowledge", &def.id).unwrap();
    assert_eq!(used.len(), 2, "Verwendet in Schema und Notiz");
    assert!(used.iter().all(|l| l.direction == "incoming"));
    assert!(used.iter().any(|l| l.other_kind.as_deref() == Some("schema")));
    assert!(used.iter().any(|l| l.kind == "mention" && l.other_id == note.id));
    // Endgültiges Löschen entfernt Verknüpfungen
    knowledge::trash(&f.conn, &def.id).unwrap();
    knowledge::purge(&f.conn, &def.id).unwrap();
    assert!(links::for_entity(&f.conn, "knowledge", &schema.id).unwrap().is_empty());
}

fn review_state(due: &str, rating: i64) -> ReviewInput {
    ReviewInput { rating, due: due.into(), stability: 3.2, difficulty: 5.1, elapsed_days: 0, scheduled_days: 3, learning_steps: 0, reps: 1, lapses: 0, state: 2 }
}

#[test]
fn flashcards_review_and_stats() {
    let f = setup();
    let c = cards::create(&f.conn, NewCard { area_id: Some(f.jura.clone()), node_id: None, kind: "definition".into(), front: "Willenserklärung?".into(), back: "Äußerung …".into(), tags: "BGB AT".into(), source_type: None, source_id: None }).unwrap();
    assert!(cards::create(&f.conn, NewCard { area_id: None, node_id: None, kind: "frage".into(), front: " ".into(), back: "x".into(), tags: String::new(), source_type: None, source_id: None }).is_err());
    assert_eq!(c.state, 0);
    let due_now = cards::list(&f.conn, &CardFilter { due_only: true, ..Default::default() }).unwrap();
    assert_eq!(due_now.len(), 1, "neue Karten sind sofort fällig");

    let r = cards::review(&f.conn, &c.id, review_state("2099-01-01T00:00:00Z", 3)).unwrap();
    assert_eq!(r.reps, 1);
    assert_eq!(r.due, "2099-01-01T00:00:00Z");
    assert!(r.last_review.is_some());
    assert!(cards::list(&f.conn, &CardFilter { due_only: true, ..Default::default() }).unwrap().is_empty());
    // „Nochmal“ markiert als schwierig
    let r2 = cards::review(&f.conn, &c.id, review_state("2026-01-01T00:00:00Z", 1)).unwrap();
    assert!(r2.difficult);

    // Ungültige Planungswerte werden abgelehnt
    assert!(cards::review(&f.conn, &c.id, review_state("kein Datum", 3)).is_err());
    let mut bad = review_state("2099-01-01T00:00:00Z", 3);
    bad.stability = f64::NAN;
    assert!(cards::review(&f.conn, &c.id, bad).is_err());
    assert!(cards::review(&f.conn, &c.id, review_state("2099-01-01T00:00:00Z", 7)).is_err());

    let st = cards::stats(&f.conn, Some(&f.jura), "2000-01-01T00:00:00Z").unwrap();
    assert_eq!(st.total, 1);
    assert_eq!(st.reviewed_today, 2);
    assert_eq!(st.difficult, 1);
    assert_eq!(st.retention_30d, Some(0.5));
    let other = cards::stats(&f.conn, Some(&f.wiwi), "2000-01-01T00:00:00Z").unwrap();
    assert_eq!(other.total, 0, "Karten anderer Bereiche zählen nicht");

    cards::update(&f.conn, &c.id, CardPatch { suspended: Some(true), ..Default::default() }).unwrap();
    assert_eq!(cards::stats(&f.conn, None, "2000-01-01T00:00:00Z").unwrap().due_now, 0, "pausierte Karten sind nicht fällig");
    assert_eq!(search::search(&f.conn, "Willenserklärung", None, 5).unwrap()[0].entity_type, "card");
}

#[test]
fn tasks_and_exams() {
    let f = setup();
    let course = nodes::create(&f.conn, NewNode { area_id: f.jura.clone(), parent_id: None, kind: "course".into(), title: "BGB AT".into(), meta: None, content_json: None, plain_text: None, template: None }).unwrap();
    let t = planning::task_create(&f.conn, NewTask { area_id: None, node_id: Some(course.id.clone()), kind: "frage".into(), title: "Was ist ein Erklärungsirrtum?".into(), notes: String::new(), due_date: Some("2026-11-02".into()) }).unwrap();
    assert_eq!(t.area_id.as_deref(), Some(f.jura.as_str()), "Bereich aus der Veranstaltung übernommen");
    assert!(planning::task_create(&f.conn, NewTask { area_id: None, node_id: None, kind: "aufgabe".into(), title: "x".into(), notes: String::new(), due_date: Some("31.12.2026".into()) }).is_err());
    planning::task_update(&f.conn, &t.id, TaskPatch { done: Some(true), ..Default::default() }).unwrap();
    assert!(planning::task_list(&f.conn, &TaskFilter::default()).unwrap().is_empty());
    assert_eq!(planning::task_list(&f.conn, &TaskFilter { include_done: true, ..Default::default() }).unwrap().len(), 1);

    let e = planning::exam_save(&f.conn, None, ExamInput { node_id: Some(course.id.clone()), title: "Klausur BGB AT".into(), date: "2027-02-10".into(), time: "10:00".into(), ..Default::default() }).unwrap();
    planning::exam_save(&f.conn, None, ExamInput { area_id: Some(f.jura.clone()), title: "Alte Klausur".into(), date: "2025-02-10".into(), ..Default::default() }).unwrap();
    let upcoming = planning::exam_list(&f.conn, Some(&f.jura), Some("2026-10-14")).unwrap();
    assert_eq!(upcoming.len(), 1);
    assert_eq!(upcoming[0].id, e.id);
    assert!(planning::exam_save(&f.conn, None, ExamInput { title: "ohne Datum".into(), ..Default::default() }).is_err());
    planning::trash(&f.conn, "exam", &e.id).unwrap();
    assert!(planning::exam_list(&f.conn, None, None).unwrap().iter().all(|x| x.id != e.id));
}

#[test]
fn pdf_annotations_and_bookmarks() {
    let f = setup();
    let src = tempfile::tempdir().unwrap();
    let p = src.path().join("Skript.pdf");
    fs::write(&p, b"%PDF-1.7\nTest").unwrap();
    let d = documents::import(&f.conn, &f.store, &p, None, "skript").unwrap();
    let r = Rect { x: 0.1, y: 0.2, w: 0.5, h: 0.03 };
    let h = annotations::create(&f.conn, NewAnnotation { document_id: d.id.clone(), page: 3, kind: "highlight".into(), color: Some("gruen".into()), rects: vec![r], quote: "Trennungsprinzip".into(), comment: "Klausurrelevant".into() }).unwrap();
    assert_eq!(h.rects, vec![r]);
    assert!(annotations::create(&f.conn, NewAnnotation { document_id: d.id.clone(), page: 1, kind: "highlight".into(), color: None, rects: vec![Rect { x: 5.0, y: 0.0, w: 0.1, h: 0.1 }], quote: String::new(), comment: String::new() }).is_err());
    assert!(annotations::create(&f.conn, NewAnnotation { document_id: d.id.clone(), page: 1, kind: "highlight".into(), color: Some("pink; x".into()), rects: vec![r], quote: String::new(), comment: String::new() }).is_err());
    let b1 = annotations::create(&f.conn, NewAnnotation { document_id: d.id.clone(), page: 5, kind: "bookmark".into(), color: None, rects: vec![], quote: String::new(), comment: "Kapitel 2".into() }).unwrap();
    let b2 = annotations::create(&f.conn, NewAnnotation { document_id: d.id.clone(), page: 5, kind: "bookmark".into(), color: None, rects: vec![], quote: String::new(), comment: String::new() }).unwrap();
    assert_eq!(b1.id, b2.id, "ein Lesezeichen je Seite");

    let hit = &search::search(&f.conn, "klausurrelevant", None, 5).unwrap()[0];
    assert_eq!(hit.entity_type, "annotation");
    assert_eq!(hit.page, Some(3));
    assert_eq!(hit.target_id.as_deref(), Some(d.id.as_str()));
    annotations::update(&f.conn, &h.id, AnnotationPatch { comment: Some("Nicht mehr".into()), color: None }).unwrap();
    assert!(search::search(&f.conn, "klausurrelevant", None, 5).unwrap().is_empty());
    assert_eq!(annotations::list(&f.conn, &d.id).unwrap().len(), 2);
    annotations::delete(&f.conn, &h.id).unwrap();
    assert_eq!(annotations::list(&f.conn, &d.id).unwrap().len(), 1);
}

#[test]
fn note_images_are_stored_backed_up_and_protected() {
    let f = setup();
    let png = [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4];
    let sha = documents::store_image(&f.conn, &f.store, &png).unwrap();
    assert!(documents::store_image(&f.conn, &f.store, b"<svg onload=alert(1)>").is_err(), "nur echte Rasterbilder");
    let (bytes, mime) = documents::image_bytes(&f.conn, &f.store, &sha).unwrap();
    assert_eq!(bytes, png);
    assert_eq!(mime, "image/png");

    // Bild in einer Notiz verwenden
    let note = nodes::create(&f.conn, NewNode { area_id: f.jura.clone(), parent_id: None, kind: "note".into(), title: "Mit Bild".into(), meta: None, content_json: None, plain_text: None, template: None }).unwrap();
    let content = json!({"type":"doc","content":[{"type":"image","attrs":{"src": format!("studium:asset/{sha}")}}]}).to_string();
    notes::save(&f.conn, &note.id, &content, "").unwrap();

    // Dasselbe Bild als Dokument importiert und endgültig gelöscht: Datei bleibt für die Notiz
    let src = tempfile::tempdir().unwrap();
    let p = src.path().join("bild.png");
    fs::write(&p, png).unwrap();
    let d = documents::import(&f.conn, &f.store, &p, None, "sonstiges").unwrap();
    trash::trash_document(&f.conn, &d.id).unwrap();
    trash::purge_document(&f.conn, &f.store, &d.id).unwrap();
    assert!(f.store.exists(&sha), "von einer Notiz verwendetes Bild wird nicht gelöscht");

    // Bild ist im Backup enthalten
    let out = tempfile::tempdir().unwrap();
    let info = backup::create(f.dir.path(), out.path(), &BackupOptions { kind: "manual", app_version: "t", second_dir: None }).unwrap();
    assert_eq!(info.file_count, 1);
    assert!(backup::verify(Path::new(&info.path)).unwrap().ok);
}

#[test]
fn rebuild_index_covers_all_entities() {
    let f = setup();
    knowledge::create(&f.conn, new_k("definition", "Besitz", None, json!({"text": "tatsächliche Sachherrschaft"}))).unwrap();
    cards::create(&f.conn, NewCard { area_id: None, node_id: None, kind: "frage".into(), front: "Eigentum vs. Besitz".into(), back: "rechtliche Herrschaft".into(), tags: String::new(), source_type: None, source_id: None }).unwrap();
    planning::task_create(&f.conn, NewTask { area_id: None, node_id: None, kind: "aufgabe".into(), title: "Sachenrecht wiederholen".into(), notes: String::new(), due_date: None }).unwrap();
    search::rebuild(&f.conn).unwrap();
    assert_eq!(search::search(&f.conn, "Sachherrschaft", None, 5).unwrap().len(), 1);
    assert_eq!(search::search(&f.conn, "Eigentum", None, 5).unwrap().len(), 1);
    assert_eq!(search::search(&f.conn, "Sachenrecht", None, 5).unwrap().len(), 1);
}
