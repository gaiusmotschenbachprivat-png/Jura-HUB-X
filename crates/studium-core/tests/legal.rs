//! Tests für Rechtsquellen (KI-Assistent).

use std::fs;

use studium_core::db;
use studium_core::repo::areas;
use studium_core::repo::legal::{self, NewLegalChunk, NewLegalSource};
use studium_core::search;

fn setup() -> (tempfile::TempDir, rusqlite::Connection) {
    let dir = tempfile::tempdir().unwrap();
    let conn = db::open(dir.path()).unwrap();
    (dir, conn)
}

fn chunk(norm: &str, absatz: Option<i64>, heading: &str, text: &str) -> NewLegalChunk {
    NewLegalChunk { norm: norm.into(), absatz, heading: heading.into(), text: text.into() }
}

fn gesetz(title: &str, abbr: &str) -> NewLegalSource {
    NewLegalSource { kind: "gesetz".into(), title: title.into(), abbreviation: Some(abbr.into()), ..Default::default() }
}

fn bgb_chunks() -> Vec<NewLegalChunk> {
    vec![
        chunk("§433", Some(1), "Vertragstypische Pflichten beim Kaufvertrag", "Durch den Kaufvertrag wird der Verkäufer einer Sache verpflichtet, dem Käufer die Sache zu übergeben."),
        chunk("§ 433", Some(2), "Vertragstypische Pflichten beim Kaufvertrag", "Der Käufer ist verpflichtet, dem Verkäufer den vereinbarten Kaufpreis zu zahlen."),
        chunk("§ 434", None, "Sachmangel", "Die Sache ist frei von Sachmängeln, wenn sie bei Gefahrübergang den Anforderungen entspricht."),
        chunk("", None, "", "   "),
        chunk("§ 823", Some(1), "Schadensersatzpflicht", "Wer vorsätzlich oder fahrlässig das Leben, den Körper verletzt, ist zum Ersatz verpflichtet."),
    ]
}

#[test]
fn save_validates_and_stores_chunks() {
    let (_d, conn) = setup();
    let bad = NewLegalSource { kind: "blog".into(), title: "x".into(), ..Default::default() };
    assert_eq!(legal::save(&conn, bad, bgb_chunks()).unwrap_err().to_string(), "Unbekannte Art von Rechtsquelle.");
    assert_eq!(legal::save(&conn, gesetz("  ", "BGB"), bgb_chunks()).unwrap_err().to_string(), "Der Titel darf nicht leer sein.");
    assert_eq!(legal::save(&conn, gesetz("BGB", "BGB"), vec![]).unwrap_err().to_string(), "Die Quelle enthält keinen Text.");

    let mut input = gesetz("Bürgerliches Gesetzbuch", "  BGB  ");
    input.version = Some(" Stand 2026 ".into());
    let s = legal::save(&conn, input, bgb_chunks()).unwrap();
    assert_eq!(s.abbreviation, "BGB");
    assert_eq!(s.version, "Stand 2026");
    assert_eq!(s.court, "");
    assert_eq!(s.chunk_count, 4, "leere Abschnitte werden übersprungen");
    assert_eq!(legal::list(&conn).unwrap(), vec![s.clone()]);
    assert_eq!(legal::get(&conn, &s.id).unwrap(), s);

    let hits = legal::norm(&conn, "BGB", "§ 823", None).unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].position, 4, "Position zählt übersprungene Abschnitte mit");
    assert_eq!(hits[0].absatz, Some(1));

    // JSON wie aus der Oberfläche: snake_case, Absatz als Zahl oder null
    let c: NewLegalChunk = serde_json::from_value(serde_json::json!({"norm": "Art 1", "absatz": 1.5, "heading": null, "text": "x"})).unwrap();
    assert_eq!(c.absatz, None);
    assert_eq!(c.heading, "");
    let v = serde_json::to_value(&hits[0]).unwrap();
    for k in ["chunk_id", "source_id", "kind", "file_number", "decision_date", "absatz", "position"] {
        assert!(v.get(k).is_some(), "{k} fehlt");
    }
}

#[test]
fn gesetz_with_same_abbreviation_is_replaced() {
    let (_d, conn) = setup();
    let old = legal::save(&conn, gesetz("BGB alt", "BGB"), bgb_chunks()).unwrap();
    let urteil = NewLegalSource { kind: "urteil".into(), title: "BGH, Urt. v. 1.1.2020".into(), abbreviation: Some("BGB".into()), court: Some("BGH".into()), ..Default::default() };
    let u = legal::save(&conn, urteil, vec![chunk("", None, "", "Kaufvertrag Urteil")]).unwrap();
    let new = legal::save(&conn, gesetz("BGB neu", "BGB"), vec![chunk("§ 433", None, "", "Neue Fassung Kaufvertrag")]).unwrap();
    let all = legal::list(&conn).unwrap();
    assert_eq!(all.iter().map(|s| s.id.as_str()).collect::<Vec<_>>(), vec![new.id.as_str(), u.id.as_str()]);
    assert!(legal::get(&conn, &old.id).is_err());
    assert_eq!(legal::get(&conn, &old.id).unwrap_err().to_string(), "Rechtsquelle nicht gefunden.");
    let hits = legal::search(&conn, &["Kaufvertrag".into()], None, 10).unwrap();
    assert_eq!(hits.len(), 2, "Index der alten Fassung ist entfernt");
    assert!(hits.iter().all(|h| h.source_id != old.id));
}

#[test]
fn search_or_semantics_kind_filter_and_ranking() {
    let (_d, conn) = setup();
    let bgb = legal::save(&conn, gesetz("Bürgerliches Gesetzbuch", "BGB"), bgb_chunks()).unwrap();
    let kommentar = NewLegalSource { kind: "kommentar".into(), title: "Kommentar zum Sachmangel".into(), ..Default::default() };
    legal::save(&conn, kommentar, vec![chunk("", None, "", "Der Sachmangel nach § 434 setzt voraus, dass die Sache abweicht. Sachmangel Sachmangel.")]).unwrap();

    // ODER: jeder Begriff liefert eigene Treffer
    let hits = legal::search(&conn, &["Kaufpreis".into(), "Schadensersatzpflicht".into()], None, 10).unwrap();
    let norms: Vec<&str> = hits.iter().map(|h| h.norm.as_str()).collect();
    assert!(norms.contains(&"§ 433") && norms.contains(&"§ 823"), "{norms:?}");

    // Präfixsuche, Sonderzeichen werden entfernt
    assert_eq!(legal::search(&conn, &["Kaufpr*".into(), "\"(".into()], None, 10).unwrap().len(), 1);
    assert!(legal::search(&conn, &["  ".into(), "§".into()], None, 10).unwrap().is_empty());
    assert!(legal::search(&conn, &[], None, 10).unwrap().is_empty());

    // Überschrift wiegt schwerer als Fließtext
    let hits = legal::search(&conn, &["Sachmangel".into()], None, 10).unwrap();
    assert_eq!(hits.len(), 2);
    assert_eq!(hits[0].source_id, bgb.id, "Treffer in der Überschrift zuerst");

    // Normbezeichnung wiegt schwerer als Fließtext
    let hits = legal::search(&conn, &["434".into()], None, 10).unwrap();
    assert_eq!(hits.len(), 2);
    assert_eq!(hits[0].norm, "§ 434");

    // Filter nach Art; unbekannte Arten werden ignoriert
    let hits = legal::search(&conn, &["Sachmangel".into()], Some(&["kommentar".into()]), 10).unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].kind, "kommentar");
    let hits = legal::search(&conn, &["Sachmangel".into()], Some(&["unsinn".into()]), 10).unwrap();
    assert_eq!(hits.len(), 2, "nur unbekannte Arten = kein Filter");

    // Begrenzung
    assert_eq!(legal::search(&conn, &["Sachmangel".into()], None, 1).unwrap().len(), 1);
    assert_eq!(legal::search(&conn, &["Sachmangel".into()], None, -5).unwrap().len(), 1);
    assert_eq!(legal::search(&conn, &["Sachmangel".into()], None, 0).unwrap().len(), 2, "0 = Standard 8");
}

#[test]
fn norm_lookup_with_absatz_and_normalization() {
    let (_d, conn) = setup();
    legal::save(&conn, gesetz("Bürgerliches Gesetzbuch", "BGB"), bgb_chunks()).unwrap();
    let gg = vec![chunk("Art 20", Some(1), "", "Die Bundesrepublik Deutschland ist ein demokratischer und sozialer Bundesstaat."), chunk("Artikel 20", Some(3), "", "Die Gesetzgebung ist an die verfassungsmäßige Ordnung gebunden.")];
    legal::save(&conn, gesetz("Grundgesetz", "GG"), gg).unwrap();

    let all = legal::norm(&conn, "bgb", "§433", None).unwrap();
    assert_eq!(all.len(), 2);
    assert_eq!(all[0].norm, "§ 433");
    assert!(all[0].position < all[1].position);
    let abs2 = legal::norm(&conn, " BGB ", "§ 433", Some(2)).unwrap();
    assert_eq!(abs2.len(), 1);
    assert_eq!(abs2[0].absatz, Some(2));
    assert_eq!(legal::norm(&conn, "BGB", "§ 433", Some(0)).unwrap().len(), 2, "Absatz 0 = alle");
    // Abschnitte ohne Absatznummer passen immer
    assert_eq!(legal::norm(&conn, "BGB", "§ 434", Some(3)).unwrap().len(), 1);

    let art = legal::norm(&conn, "GG", "Art. 20", Some(3)).unwrap();
    assert_eq!(art.len(), 1);
    assert_eq!(art[0].norm, "Art. 20");
    assert_eq!(legal::norm(&conn, "GG", "art 20", None).unwrap().len(), 2);
    assert!(legal::norm(&conn, "StGB", "§ 433", None).unwrap().is_empty());
}

#[test]
fn chunks_by_ids_and_delete() {
    let (_d, conn) = setup();
    let s = legal::save(&conn, gesetz("Bürgerliches Gesetzbuch", "BGB"), bgb_chunks()).unwrap();
    let hits = legal::norm(&conn, "BGB", "§ 433", None).unwrap();
    let mut ids: Vec<String> = hits.iter().map(|h| h.chunk_id.clone()).rev().collect();
    ids.push("gibt-es-nicht".into());
    let got = legal::chunks(&conn, &ids).unwrap();
    assert_eq!(got.len(), 2);
    assert!(got[0].position < got[1].position, "sortiert nach Titel und Position");
    assert!(legal::chunks(&conn, &[]).unwrap().is_empty());

    assert_eq!(legal::remove(&conn, "kein-id").unwrap_err().to_string(), "Ungültige Kennung.");
    legal::remove(&conn, &s.id).unwrap();
    assert!(legal::list(&conn).unwrap().is_empty());
    assert!(legal::chunks(&conn, &ids).unwrap().is_empty());
    assert!(legal::search(&conn, &["Kaufvertrag".into()], None, 10).unwrap().is_empty());
    let n: i64 = conn.query_row("SELECT COUNT(*) FROM legal_index", [], |r| r.get(0)).unwrap();
    assert_eq!(n, 0);

    // Neuaufbau der allgemeinen Suche berührt die Rechtsquellen nicht
    legal::save(&conn, gesetz("Bürgerliches Gesetzbuch", "BGB"), bgb_chunks()).unwrap();
    search::rebuild(&conn).unwrap();
    assert_eq!(legal::search(&conn, &["Kaufvertrag".into()], None, 10).unwrap().len(), 2);
}

#[test]
fn migration_from_two_keeps_data() {
    let dir = tempfile::tempdir().unwrap();
    {
        let conn = rusqlite::Connection::open(db::db_path(dir.path())).unwrap();
        db::configure(&conn).unwrap();
        db::migrate_with(&conn, None, &db::builtin_migrations()[..2]).unwrap();
        assert_eq!(db::schema_version(&conn).unwrap(), 2);
        conn.execute("INSERT INTO areas (id, name, color, position, created_at, updated_at) VALUES ('01900000-0000-7000-8000-000000000001','Alt','#123456',0,'x','x')", []).unwrap();
    }
    let conn = db::open(dir.path()).unwrap();
    assert_eq!(db::schema_version(&conn).unwrap(), db::SCHEMA_VERSION);
    assert_eq!(areas::list(&conn).unwrap()[0].name, "Alt");
    assert_eq!(fs::read_dir(dir.path().join("pre-migration")).unwrap().count(), 1);
    assert!(legal::list(&conn).unwrap().is_empty());
    legal::save(&conn, gesetz("Grundgesetz", "GG"), vec![chunk("Art. 1", Some(1), "", "Die Würde des Menschen ist unantastbar.")]).unwrap();
    assert_eq!(legal::search(&conn, &["Wurde".into()], None, 5).unwrap().len(), 1, "Diakritika werden ignoriert");
}

#[test]
fn migration_four_adds_quellen_and_keeps_knowledge() {
    use studium_core::repo::knowledge::{self, NewKnowledge};
    let dir = tempfile::tempdir().unwrap();
    let def_id;
    {
        let conn = rusqlite::Connection::open(db::db_path(dir.path())).unwrap();
        db::configure(&conn).unwrap();
        db::migrate_with(&conn, None, &db::builtin_migrations()[..3]).unwrap();
        let k = knowledge::create(
            &conn,
            NewKnowledge { ty: "definition".into(), area_id: None, node_id: None, title: "Willenserklärung".into(), field: "BGB AT".into(), source_kind: None, data: serde_json::json!({ "text": "Äußerung" }) },
        )
        .unwrap();
        def_id = k.id;
    }
    let conn = db::open(dir.path()).unwrap();
    assert_eq!(db::schema_version(&conn).unwrap(), db::SCHEMA_VERSION);
    assert_eq!(knowledge::get(&conn, &def_id).unwrap().title, "Willenserklärung");
    let q = knowledge::create(
        &conn,
        NewKnowledge {
            ty: "quelle".into(),
            area_id: None,
            node_id: None,
            title: "BGH, 12.3.2020, I ZR 1/19".into(),
            field: String::new(),
            source_kind: None,
            data: serde_json::json!({ "art": "quatsch", "gericht": "BGH", "az": "I ZR 1/19", "fremd": "weg" }),
        },
    )
    .unwrap();
    assert_eq!(q.data["art"], "sonstiges");
    assert!(q.data.get("fremd").is_none());
    assert_eq!(q.data.as_object().unwrap().len(), 16);
    let fk: Option<String> = conn.query_row("PRAGMA foreign_key_check", [], |r| r.get(0)).ok();
    assert!(fk.is_none());
}
