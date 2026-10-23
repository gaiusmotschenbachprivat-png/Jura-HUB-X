//! Rechtsquellen für den KI-Assistenten (Gesetze, Urteile, Kommentare, eigene
//! Texte). Gegenstück zu `src/core/repo/legal.ts` – gleiche SQL-Texte,
//! gleiche Prüfungen, gleiche Meldungen.

use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Deserializer, Serialize};

use crate::util::{clean_title, new_id, now, require_id};
use crate::{Error, Result};

pub const KINDS: &[&str] = &["gesetz", "urteil", "kommentar", "dokument"];
const MAX_CHUNKS: usize = 50_000;
const MAX_CHUNK_CHARS: usize = 20_000;

const SRC_COLS: &str =
    "id, kind, title, abbreviation, court, file_number, decision_date, version, origin, chunk_count, imported_at";
const HIT_COLS: &str = "c.id AS chunk_id, s.id AS source_id, s.kind, s.title, s.abbreviation, s.court, s.file_number,
  s.decision_date, s.version, c.norm, c.absatz, c.heading, c.text, c.position";

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct LegalSource {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub abbreviation: String,
    pub court: String,
    pub file_number: String,
    pub decision_date: String,
    pub version: String,
    pub origin: String,
    pub chunk_count: i64,
    pub imported_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct NewLegalSource {
    pub kind: String,
    pub title: String,
    #[serde(default)]
    pub abbreviation: Option<String>,
    #[serde(default)]
    pub court: Option<String>,
    #[serde(default)]
    pub file_number: Option<String>,
    #[serde(default)]
    pub decision_date: Option<String>,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub origin: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(default)]
pub struct NewLegalChunk {
    #[serde(deserialize_with = "nullable_string")]
    pub norm: String,
    /// Nur ganzzahlige Werte zählen (wie `Number.isInteger`), alles andere gilt als „kein Absatz“.
    #[serde(deserialize_with = "integer_or_none")]
    pub absatz: Option<i64>,
    #[serde(deserialize_with = "nullable_string")]
    pub heading: String,
    #[serde(deserialize_with = "nullable_string")]
    pub text: String,
}

/// Ein Abschnitt einer Rechtsquelle samt Angaben zur Quelle.
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct LegalHit {
    pub chunk_id: String,
    pub source_id: String,
    pub kind: String,
    pub title: String,
    pub abbreviation: String,
    pub court: String,
    pub file_number: String,
    pub decision_date: String,
    pub version: String,
    pub norm: String,
    pub absatz: Option<i64>,
    pub heading: String,
    pub text: String,
    pub position: i64,
}

fn nullable_string<'de, D: Deserializer<'de>>(de: D) -> std::result::Result<String, D::Error> {
    Ok(Option::<String>::deserialize(de)?.unwrap_or_default())
}

fn integer_or_none<'de, D: Deserializer<'de>>(de: D) -> std::result::Result<Option<i64>, D::Error> {
    let v = serde_json::Value::deserialize(de)?;
    Ok(match v {
        serde_json::Value::Number(n) => n.as_i64().or_else(|| {
            n.as_f64()
                .filter(|f| f.fract() == 0.0 && f.abs() < 9.0e15)
                .map(|f| f as i64)
        }),
        _ => None,
    })
}

// ---------- Hilfen (Verhalten wie in JavaScript) ----------

/// Leerraum wie `\s` bzw. `String.prototype.trim` in JavaScript.
fn is_js_space(c: char) -> bool {
    matches!(
        c,
        '\t' | '\n' | '\u{000B}' | '\u{000C}' | '\r' | ' ' | '\u{00A0}' | '\u{1680}' | '\u{2000}'..='\u{200A}'
            | '\u{2028}' | '\u{2029}' | '\u{202F}' | '\u{205F}' | '\u{3000}' | '\u{FEFF}'
    )
}

fn js_trim(s: &str) -> &str {
    s.trim_matches(is_js_space)
}

fn take_chars(s: &str, n: usize) -> String {
    s.chars().take(n).collect()
}

fn clip(s: Option<&str>, n: usize) -> String {
    take_chars(js_trim(s.unwrap_or("")), n)
}

fn positive(n: Option<i64>) -> Option<i64> {
    n.filter(|&v| v > 0)
}

/// Normbezeichnung vereinheitlichen: „§433“ → „§ 433“, „Art 20“ → „Art. 20“.
pub fn normalize_norm(s: &str) -> String {
    // Leerraum zusammenfassen, wie `.trim().replace(/\s+/g, " ")`.
    let t = js_trim(s).split(is_js_space).filter(|p| !p.is_empty()).collect::<Vec<_>>().join(" ");
    // /^(§|Art\.?|Artikel)\s*(\d+\s*[a-z]?)$/i
    for (prefix, para) in [("§", true), ("Artikel", false), ("Art.", false), ("Art", false)] {
        let Some(head) = t.get(..prefix.len()) else { continue };
        if !head.eq_ignore_ascii_case(prefix) {
            continue;
        }
        if let Some(num) = parse_number(&t[prefix.len()..]) {
            return if para { format!("§ {num}") } else { format!("Art. {num}") };
        }
    }
    t
}

/// `\s*(\d+\s*[a-z]?)$` auf zusammengefasstem Text; liefert die Nummer ohne Leerraum, klein.
fn parse_number(rest: &str) -> Option<String> {
    let rest = rest.strip_prefix(' ').unwrap_or(rest);
    let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
    if digits.is_empty() {
        return None;
    }
    let tail = &rest[digits.len()..];
    let tail = tail.strip_prefix(' ').unwrap_or(tail);
    let mut chars = tail.chars();
    match (chars.next(), chars.next()) {
        (None, _) => Some(digits),
        (Some(c), None) if c.is_ascii_alphabetic() => Some(format!("{digits}{}", c.to_ascii_lowercase())),
        _ => None,
    }
}

fn src_from_row(r: &Row) -> rusqlite::Result<LegalSource> {
    Ok(LegalSource {
        id: r.get(0)?,
        kind: r.get(1)?,
        title: r.get(2)?,
        abbreviation: r.get(3)?,
        court: r.get(4)?,
        file_number: r.get(5)?,
        decision_date: r.get(6)?,
        version: r.get(7)?,
        origin: r.get(8)?,
        chunk_count: r.get(9)?,
        imported_at: r.get(10)?,
    })
}

fn hit_from_row(r: &Row) -> rusqlite::Result<LegalHit> {
    Ok(LegalHit {
        chunk_id: r.get(0)?,
        source_id: r.get(1)?,
        kind: r.get(2)?,
        title: r.get(3)?,
        abbreviation: r.get(4)?,
        court: r.get(5)?,
        file_number: r.get(6)?,
        decision_date: r.get(7)?,
        version: r.get(8)?,
        norm: r.get(9)?,
        absatz: r.get(10)?,
        heading: r.get(11)?,
        text: r.get(12)?,
        position: r.get(13)?,
    })
}

// ---------- Zugriff ----------

pub fn list(conn: &Connection) -> Result<Vec<LegalSource>> {
    let mut st = conn.prepare(&format!("SELECT {SRC_COLS} FROM legal_sources ORDER BY kind, abbreviation, title"))?;
    let rows = st.query_map([], src_from_row)?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

pub fn get(conn: &Connection, id: &str) -> Result<LegalSource> {
    conn.query_row(&format!("SELECT {SRC_COLS} FROM legal_sources WHERE id = ?1"), [id], src_from_row)
        .optional()?
        .ok_or_else(|| Error::not_found("Rechtsquelle nicht gefunden."))
}

/// Speichert eine Quelle mit ihren Abschnitten. Ein Gesetz mit derselben
/// Abkürzung wird ersetzt (neue Fassung statt Dublette).
pub fn save(conn: &Connection, input: NewLegalSource, chunks: Vec<NewLegalChunk>) -> Result<LegalSource> {
    if !KINDS.contains(&input.kind.as_str()) {
        return Err(Error::invalid("Unbekannte Art von Rechtsquelle."));
    }
    let title = clean_title(&input.title, 300)?;
    if chunks.is_empty() {
        return Err(Error::invalid("Die Quelle enthält keinen Text."));
    }
    if chunks.len() > MAX_CHUNKS {
        return Err(Error::invalid("Die Quelle ist zu umfangreich."));
    }
    let abbr = clip(input.abbreviation.as_deref(), 40);
    let tx = conn.unchecked_transaction()?;
    if input.kind == "gesetz" && !abbr.is_empty() {
        let old: Vec<String> = {
            let mut st = tx.prepare("SELECT id FROM legal_sources WHERE kind = 'gesetz' AND abbreviation = ?1")?;
            let rows = st.query_map([&abbr], |r| r.get(0))?;
            rows.collect::<rusqlite::Result<_>>()?
        };
        for id in old {
            remove_inner(&tx, &id)?;
        }
    }
    let id = new_id();
    tx.execute(
        "INSERT INTO legal_sources (id, kind, title, abbreviation, court, file_number, decision_date, version, origin, chunk_count, imported_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            id,
            input.kind,
            title,
            abbr,
            clip(input.court.as_deref(), 120),
            clip(input.file_number.as_deref(), 80),
            clip(input.decision_date.as_deref(), 20),
            clip(input.version.as_deref(), 300),
            clip(input.origin.as_deref(), 300),
            chunks.len() as i64,
            now(),
        ],
    )?;
    {
        let mut ins_chunk = tx.prepare(
            "INSERT INTO legal_chunks (id, source_id, position, norm, absatz, heading, text) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        )?;
        let mut ins_index = tx
            .prepare("INSERT INTO legal_index (chunk_id, source_id, norm, heading, text) VALUES (?1, ?2, ?3, ?4, ?5)")?;
        for (i, c) in chunks.iter().enumerate() {
            let text = take_chars(&c.text, MAX_CHUNK_CHARS);
            if js_trim(&text).is_empty() {
                continue;
            }
            let cid = new_id();
            let norm = normalize_norm(&clip(Some(&c.norm), 40));
            let absatz = positive(c.absatz);
            let heading = clip(Some(&c.heading), 300);
            ins_chunk.execute(params![cid, id, i as i64, norm, absatz, heading, text])?;
            ins_index.execute(params![cid, id, norm, heading, text])?;
        }
    }
    tx.execute(
        "UPDATE legal_sources SET chunk_count = (SELECT COUNT(*) FROM legal_chunks WHERE source_id = ?1) WHERE id = ?1",
        [&id],
    )?;
    let s = get(&tx, &id)?;
    tx.commit()?;
    Ok(s)
}

fn remove_inner(conn: &Connection, id: &str) -> Result<()> {
    conn.execute("DELETE FROM legal_index WHERE source_id = ?1", [id])?;
    conn.execute("DELETE FROM legal_chunks WHERE source_id = ?1", [id])?;
    conn.execute("DELETE FROM legal_sources WHERE id = ?1", [id])?;
    Ok(())
}

pub fn remove(conn: &Connection, id: &str) -> Result<()> {
    require_id(id)?;
    let tx = conn.unchecked_transaction()?;
    remove_inner(&tx, id)?;
    tx.commit()?;
    Ok(())
}

/// Suchbegriff für FTS5 absichern (wie `search::build_query`, aber ODER-verknüpft).
fn fts_term(t: &str) -> Option<String> {
    const STRIP: &str = "\"'()*:^{}[]-+,;.§!?/\\<>=&|";
    let clean: String = t.chars().filter(|c| !STRIP.contains(*c)).collect();
    let clean = js_trim(&clean);
    if clean.is_empty() {
        None
    } else {
        Some(format!("\"{clean}\"*"))
    }
}

/// Volltextsuche in den Rechtsquellen. `terms` werden ODER-verknüpft; BM25
/// gewichtet Treffer in Normbezeichnung und Überschrift stärker.
pub fn search(conn: &Connection, terms: &[String], kinds: Option<&[String]>, limit: i64) -> Result<Vec<LegalHit>> {
    let q: Vec<String> = terms.iter().take(24).filter_map(|t| fts_term(t)).collect();
    if q.is_empty() {
        return Ok(Vec::new());
    }
    let ks: Vec<&str> = kinds
        .unwrap_or(&[])
        .iter()
        .map(String::as_str)
        .filter(|k| KINDS.contains(k))
        .collect();
    // Math.min(50, Math.max(1, Math.trunc(Number(limit) || 8)))
    let lim = if limit == 0 { 8 } else { limit.clamp(1, 50) };
    let mut st = conn.prepare(&format!(
        "SELECT {HIT_COLS}
       FROM legal_index i JOIN legal_chunks c ON c.id = i.chunk_id JOIN legal_sources s ON s.id = c.source_id
       WHERE legal_index MATCH ?1 AND (?2 = '' OR instr(?2, ',' || s.kind || ',') > 0)
       ORDER BY bm25(legal_index, 0.0, 0.0, 2.0, 3.0, 1.0)
       LIMIT ?3"
    ))?;
    let kind_list = if ks.is_empty() { String::new() } else { format!(",{},", ks.join(",")) };
    let rows = st.query_map(params![q.join(" OR "), kind_list, lim], hit_from_row)?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// Alle Abschnitte einer Norm (oder ein Absatz) eines Gesetzes.
pub fn norm(conn: &Connection, abbreviation: &str, norm_name: &str, absatz: Option<i64>) -> Result<Vec<LegalHit>> {
    let n = normalize_norm(norm_name);
    let abs = positive(absatz);
    let mut st = conn.prepare(&format!(
        "SELECT {HIT_COLS}
       FROM legal_chunks c JOIN legal_sources s ON s.id = c.source_id
       WHERE s.kind = 'gesetz' AND lower(s.abbreviation) = lower(?1) AND c.norm = ?2 AND (?3 IS NULL OR c.absatz = ?3 OR c.absatz IS NULL)
       ORDER BY c.position"
    ))?;
    let rows = st.query_map(params![js_trim(abbreviation), n, abs], hit_from_row)?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// Texte aller Abschnitte einer Quelle in ihrer Reihenfolge (zum erneuten Aufbereiten).
pub fn source_texts(conn: &Connection, id: &str) -> Result<Vec<String>> {
    require_id(id)?;
    let mut st = conn.prepare("SELECT text FROM legal_chunks WHERE source_id = ?1 ORDER BY position")?;
    let rows = st.query_map([id], |r| r.get::<_, String>(0))?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

pub fn chunks(conn: &Connection, ids: &[String]) -> Result<Vec<LegalHit>> {
    let list: Vec<&String> = ids.iter().take(200).collect();
    if list.is_empty() {
        return Ok(Vec::new());
    }
    let mut st = conn.prepare(&format!(
        "SELECT {HIT_COLS} FROM legal_chunks c JOIN legal_sources s ON s.id = c.source_id
       WHERE c.id IN (SELECT value FROM json_each(?1)) ORDER BY s.title, c.position"
    ))?;
    let rows = st.query_map([serde_json::to_string(&list)?], hit_from_row)?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_norms_like_typescript() {
        assert_eq!(normalize_norm("§433"), "§ 433");
        assert_eq!(normalize_norm("  §   433  "), "§ 433");
        assert_eq!(normalize_norm("§ 433 A"), "§ 433a");
        assert_eq!(normalize_norm("§ 433a"), "§ 433a");
        assert_eq!(normalize_norm("Art 20"), "Art. 20");
        assert_eq!(normalize_norm("art.20"), "Art. 20");
        assert_eq!(normalize_norm("Artikel 5"), "Art. 5");
        assert_eq!(normalize_norm("ARTIKEL5b"), "Art. 5b");
        assert_eq!(normalize_norm("§ 433 ab"), "§ 433 ab");
        assert_eq!(normalize_norm("§§ 133,  157"), "§§ 133, 157");
        assert_eq!(normalize_norm("Präambel"), "Präambel");
        assert_eq!(normalize_norm("§"), "§");
        assert_eq!(normalize_norm(""), "");
        assert_eq!(normalize_norm("Art\u{00A0}12"), "Art. 12");
    }

    #[test]
    fn fts_terms_are_escaped() {
        assert_eq!(fts_term("§ 433").as_deref(), Some("\"433\"*"));
        assert_eq!(fts_term("Kauf\"vertrag").as_deref(), Some("\"Kaufvertrag\"*"));
        assert_eq!(fts_term(" (*) "), None);
    }
}
