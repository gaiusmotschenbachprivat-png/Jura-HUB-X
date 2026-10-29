//! Dokumente (PDF, DOCX, Bilder …), ihre Zuordnungen und ihr extrahierter Text.

use std::path::Path;

use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::Serialize;

use crate::files::BlobStore;
use crate::repo::nodes;
use crate::search::{self, Entity};
use crate::util::{clean_title, new_id, now, require_id};
use crate::{Error, Result};

pub const DOC_TYPES: &[&str] = &[
    "folien", "skript", "uebungsblatt", "loesung", "mitschrift", "gesetz", "aufsatz", "urteil", "klausur",
    "aufnahme", "sonstiges",
];

/// Höchstmenge an Text je Seite, die indexiert wird.
const MAX_PAGE_TEXT: usize = 200_000;
const MAX_PAGES: usize = 20_000;

#[derive(Debug, Serialize, Clone)]
pub struct Document {
    pub id: String,
    pub title: String,
    pub original_name: String,
    pub ext: String,
    pub mime: String,
    pub size: i64,
    pub doc_type: String,
    pub page_count: Option<i64>,
    pub text_status: String,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
    /// `false`, wenn die Datei im Speicher fehlt (z. B. manuell gelöscht).
    pub file_present: bool,
}

#[derive(Debug, Serialize, Clone)]
pub struct Placement {
    pub node_id: String,
    pub area_id: String,
    pub title: String,
    pub path: String,
}

fn from_row(r: &Row) -> rusqlite::Result<(Document, String)> {
    Ok((
        Document {
            id: r.get("id")?,
            title: r.get("title")?,
            original_name: r.get("original_name")?,
            ext: r.get("ext")?,
            mime: r.get("mime")?,
            size: r.get("size")?,
            doc_type: r.get("doc_type")?,
            page_count: r.get("page_count")?,
            text_status: r.get("text_status")?,
            created_at: r.get("created_at")?,
            updated_at: r.get("updated_at")?,
            deleted_at: r.get("deleted_at")?,
            file_present: true,
        },
        r.get("blob_sha")?,
    ))
}

const SELECT: &str = "SELECT d.*, b.mime, b.size FROM documents d JOIN blobs b ON b.sha256 = d.blob_sha";

fn with_presence(store: Option<&BlobStore>, (mut d, sha): (Document, String)) -> Document {
    if let Some(s) = store {
        d.file_present = s.exists(&sha);
    }
    d
}

pub fn get(conn: &Connection, store: Option<&BlobStore>, id: &str) -> Result<Document> {
    require_id(id)?;
    let row = conn
        .query_row(&format!("{SELECT} WHERE d.id = ?1"), [id], from_row)
        .optional()?
        .ok_or_else(|| Error::not_found("Dokument nicht gefunden."))?;
    Ok(with_presence(store, row))
}

pub fn blob_sha(conn: &Connection, id: &str) -> Result<String> {
    conn.query_row("SELECT blob_sha FROM documents WHERE id = ?1", [id], |r| r.get(0))
        .optional()?
        .ok_or_else(|| Error::not_found("Dokument nicht gefunden."))
}

/// Text-Dateien werden sofort indexiert; PDF und DOCX extrahiert die Oberfläche
/// (pdf.js / mammoth) und liefert den Text über [`set_text`] nach.
fn initial_text_status(ext: &str) -> &'static str {
    match ext {
        "pdf" | "docx" => "pending",
        "txt" | "md" | "markdown" => "ok",
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "m4a" | "mp3" | "wav" | "webm" => "none",
        _ => "unsupported",
    }
}

fn title_from_name(name: &str) -> String {
    let stem = Path::new(name).file_stem().and_then(|s| s.to_str()).unwrap_or(name);
    let t = stem.replace(['_'], " ");
    let t = t.trim();
    if t.is_empty() { "Dokument".into() } else { t.chars().take(300).collect() }
}

/// Importiert eine Datei: Kopie in den Speicher, Datensatz, Zuordnung, Index.
pub fn import(
    conn: &Connection,
    store: &BlobStore,
    src: &Path,
    node_id: Option<&str>,
    doc_type: &str,
) -> Result<Document> {
    if !DOC_TYPES.contains(&doc_type) {
        return Err(Error::invalid("Unbekannter Dokumenttyp."));
    }
    if let Some(n) = node_id {
        require_id(n)?;
        nodes::get(conn, n)?;
    }
    let blob = store.import(src)?;
    let original_name: String = src
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("Datei")
        .chars()
        .filter(|c| !c.is_control())
        .take(255)
        .collect();
    let title = title_from_name(&original_name);
    let id = new_id();
    let ts = now();
    let status = initial_text_status(&blob.ext);

    let text_pages: Option<Vec<String>> = if status == "ok" {
        let bytes = std::fs::read(store.path_for(&blob.sha256)?)?;
        Some(vec![String::from_utf8_lossy(&bytes).chars().take(MAX_PAGE_TEXT).collect()])
    } else {
        None
    };

    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "INSERT OR IGNORE INTO blobs (sha256, size, mime, created_at) VALUES (?1, ?2, ?3, ?4)",
        params![blob.sha256, blob.size as i64, blob.mime, ts],
    )?;
    tx.execute(
        "INSERT INTO documents (id, blob_sha, title, original_name, ext, doc_type, page_count, text_status, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)",
        params![id, blob.sha256, title, original_name, blob.ext, doc_type, text_pages.as_ref().map(|p| p.len() as i64), status, ts],
    )?;
    if let Some(n) = node_id {
        tx.execute(
            "INSERT INTO placements (document_id, node_id, created_at) VALUES (?1, ?2, ?3)",
            params![id, n, ts],
        )?;
    }
    search::put(&tx, Entity::Document, &id, None, None, &title, &original_name)?;
    if let Some(pages) = &text_pages {
        write_pages(&tx, &id, &title, pages)?;
    }
    let doc = get(&tx, Some(store), &id)?;
    tx.commit()?;
    Ok(doc)
}

fn write_pages(conn: &Connection, id: &str, title: &str, pages: &[String]) -> Result<()> {
    conn.execute("DELETE FROM document_pages WHERE document_id = ?1", [id])?;
    conn.execute("DELETE FROM search_index WHERE entity_type = 'page' AND entity_id = ?1", [id])?;
    for (i, text) in pages.iter().enumerate() {
        let text: String = text.chars().take(MAX_PAGE_TEXT).collect();
        let no = i as i64 + 1;
        conn.execute(
            "INSERT INTO document_pages (document_id, page_no, text) VALUES (?1, ?2, ?3)",
            params![id, no, text],
        )?;
        if !text.trim().is_empty() {
            search::put(conn, Entity::Page, id, None, Some(no), title, &text)?;
        }
    }
    Ok(())
}

/// Speichert den extrahierten Text (eine Zeichenkette je Seite). Enthält keine
/// Seite Text, wird das Dokument als „ohne Text“ markiert (z. B. Scan ohne OCR).
pub fn set_text(conn: &Connection, id: &str, pages: &[String]) -> Result<Document> {
    require_id(id)?;
    if pages.len() > MAX_PAGES {
        return Err(Error::invalid("Zu viele Seiten."));
    }
    let tx = conn.unchecked_transaction()?;
    let doc = get(&tx, None, id)?;
    write_pages(&tx, id, &doc.title, pages)?;
    let has_text = pages.iter().any(|p| p.trim().chars().count() > 3);
    tx.execute(
        "UPDATE documents SET page_count = ?2, text_status = ?3, updated_at = ?4 WHERE id = ?1",
        params![id, pages.len() as i64, if has_text { "ok" } else { "none" }, now()],
    )?;
    let doc = get(&tx, None, id)?;
    tx.commit()?;
    Ok(doc)
}

pub fn set_text_error(conn: &Connection, id: &str) -> Result<()> {
    require_id(id)?;
    conn.execute(
        "UPDATE documents SET text_status = 'error', updated_at = ?2 WHERE id = ?1",
        params![id, now()],
    )?;
    Ok(())
}

pub fn update(conn: &Connection, id: &str, title: &str, doc_type: &str) -> Result<Document> {
    require_id(id)?;
    if !DOC_TYPES.contains(&doc_type) {
        return Err(Error::invalid("Unbekannter Dokumenttyp."));
    }
    let title = clean_title(title, 300)?;
    let tx = conn.unchecked_transaction()?;
    let doc = get(&tx, None, id)?;
    tx.execute(
        "UPDATE documents SET title = ?2, doc_type = ?3, updated_at = ?4 WHERE id = ?1",
        params![id, title, doc_type, now()],
    )?;
    search::put(&tx, Entity::Document, id, None, None, &title, &doc.original_name)?;
    tx.execute(
        "UPDATE search_index SET title = ?2 WHERE entity_type = 'page' AND entity_id = ?1",
        params![id, title],
    )?;
    let d = get(&tx, None, id)?;
    tx.commit()?;
    Ok(d)
}

#[derive(Debug, Clone, Copy)]
pub enum Scope<'a> {
    All,
    Area(&'a str),
    /// Direkt diesem Knoten zugeordnet
    Node(&'a str),
    /// Diesem Knoten oder einem seiner Nachfahren zugeordnet
    Subtree(&'a str),
    Unassigned,
}

pub fn list(conn: &Connection, store: Option<&BlobStore>, scope: Scope) -> Result<Vec<Document>> {
    let (cond, arg): (&str, Option<&str>) = match scope {
        Scope::All => ("1=1", None),
        Scope::Area(a) => (
            "EXISTS (SELECT 1 FROM placements p JOIN nodes n ON n.id = p.node_id
                     WHERE p.document_id = d.id AND n.area_id = ?1 AND n.deleted_at IS NULL)",
            Some(a),
        ),
        Scope::Node(n) => ("EXISTS (SELECT 1 FROM placements p WHERE p.document_id = d.id AND p.node_id = ?1)", Some(n)),
        Scope::Subtree(n) => (
            "EXISTS (WITH RECURSIVE t(id) AS (SELECT ?1 UNION ALL SELECT x.id FROM nodes x JOIN t ON x.parent_id = t.id)
                     SELECT 1 FROM placements p JOIN t ON t.id = p.node_id WHERE p.document_id = d.id)",
            Some(n),
        ),
        Scope::Unassigned => (
            "NOT EXISTS (SELECT 1 FROM placements p JOIN nodes n ON n.id = p.node_id
                         WHERE p.document_id = d.id AND n.deleted_at IS NULL)",
            None,
        ),
    };
    let sql = format!(
        "{SELECT} WHERE d.deleted_at IS NULL AND ({cond}) ORDER BY d.created_at DESC"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows: Vec<(Document, String)> = match arg {
        Some(a) => stmt.query_map([a], from_row)?.collect::<rusqlite::Result<_>>()?,
        None => stmt.query_map([], from_row)?.collect::<rusqlite::Result<_>>()?,
    };
    Ok(rows.into_iter().map(|r| with_presence(store, r)).collect())
}

pub fn recent(conn: &Connection, store: Option<&BlobStore>, area_id: Option<&str>, limit: i64) -> Result<Vec<Document>> {
    let mut docs = match area_id {
        Some(a) => list(conn, store, Scope::Area(a))?,
        None => list(conn, store, Scope::All)?,
    };
    docs.truncate(limit.clamp(1, 100) as usize);
    Ok(docs)
}

pub fn placements(conn: &Connection, id: &str) -> Result<Vec<Placement>> {
    let mut stmt = conn.prepare(
        "SELECT n.id, n.area_id, n.title FROM placements p JOIN nodes n ON n.id = p.node_id
         WHERE p.document_id = ?1 AND n.deleted_at IS NULL ORDER BY p.created_at",
    )?;
    let rows: Vec<(String, String, String)> = stmt
        .query_map([id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
        .collect::<rusqlite::Result<_>>()?;
    rows.into_iter()
        .map(|(node_id, area_id, title)| {
            Ok(Placement { path: nodes::breadcrumb(conn, &node_id, true)?, node_id, area_id, title })
        })
        .collect()
}

/// Kurzer Fundort-Text für Suchtreffer, z. B. „BGB AT · +1 weitere“.
pub fn placement_summary(conn: &Connection, id: &str) -> Result<String> {
    let p = placements(conn, id)?;
    Ok(match p.len() {
        0 => "Nicht zugeordnet".into(),
        1 => p[0].path.clone(),
        n => format!("{} · +{} weitere", p[0].path, n - 1),
    })
}

pub fn add_placement(conn: &Connection, id: &str, node_id: &str) -> Result<()> {
    require_id(id)?;
    require_id(node_id)?;
    get(conn, None, id)?;
    nodes::get(conn, node_id)?;
    conn.execute(
        "INSERT OR IGNORE INTO placements (document_id, node_id, created_at) VALUES (?1, ?2, ?3)",
        params![id, node_id, now()],
    )?;
    Ok(())
}

pub fn remove_placement(conn: &Connection, id: &str, node_id: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM placements WHERE document_id = ?1 AND node_id = ?2",
        params![id, node_id],
    )?;
    Ok(())
}

pub fn read_bytes(conn: &Connection, store: &BlobStore, id: &str) -> Result<Vec<u8>> {
    let sha = blob_sha(conn, id)?;
    store.read(&sha)
}

/// Text einer Seite (für die Kontextanzeige von Verknüpfungen).
pub fn page_text(conn: &Connection, id: &str, page: i64) -> Result<Option<String>> {
    Ok(conn
        .query_row(
            "SELECT text FROM document_pages WHERE document_id = ?1 AND page_no = ?2",
            params![id, page],
            |r| r.get(0),
        )
        .optional()?)
}

/// Text aller Seiten (Index 0 = Seite 1); leer, solange nichts ausgelesen wurde.
pub fn pages_text(conn: &Connection, id: &str) -> Result<Vec<String>> {
    require_id(id)?;
    let mut stmt = conn.prepare("SELECT text FROM document_pages WHERE document_id = ?1 ORDER BY page_no")?;
    let rows = stmt.query_map([id], |r| r.get(0))?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// Speichert ein Bild für eine Notiz im Dokumentenspeicher und vermerkt es in `blobs`
/// (damit es in Backups enthalten ist). Liefert den SHA-256 als Kennung.
pub fn store_image(conn: &Connection, store: &BlobStore, bytes: &[u8]) -> Result<String> {
    let blob = store.import_image(bytes)?;
    conn.execute(
        "INSERT OR IGNORE INTO blobs (sha256, size, mime, created_at) VALUES (?1, ?2, ?3, ?4)",
        params![blob.sha256, blob.size as i64, blob.mime, now()],
    )?;
    Ok(blob.sha256)
}

/// Bilddaten eines in Notizen verwendeten Bildes.
pub fn image_bytes(conn: &Connection, store: &BlobStore, sha: &str) -> Result<(Vec<u8>, String)> {
    let mime: String = conn
        .query_row("SELECT mime FROM blobs WHERE sha256 = ?1", [sha], |r| r.get(0))
        .optional()?
        .ok_or_else(|| Error::not_found("Bild nicht gefunden."))?;
    if !mime.starts_with("image/") {
        return Err(Error::invalid("Kein Bild."));
    }
    Ok((store.read(sha)?, mime))
}
