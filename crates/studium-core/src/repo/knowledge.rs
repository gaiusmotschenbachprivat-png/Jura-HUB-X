//! Wissensobjekte: Definitionen, Prüfungsschemata, Fälle und Gesetzesfundstellen.
//!
//! Gemeinsame Felder liegen in Spalten, typspezifische Felder als JSON in `data`.
//! `data` wird beim Speichern gegen eine feste Struktur je Typ geprüft und
//! normalisiert; unbekannte Felder werden verworfen.

use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::search::{self, Entity};
use crate::util::{clean_title, new_id, now, require_id};
use crate::{Error, Result};

pub const TYPES: &[&str] = &["definition", "schema", "case", "citation"];
pub const SOURCE_KINDS: &[&str] = &["eigen", "vorlesung", "lehrbuch", "rechtsprechung", "import", "ki-vorschlag"];
const MAX_DATA: usize = 512 * 1024;

// ---------- Typspezifische Daten ----------

#[derive(Debug, Serialize, Deserialize, Default, Clone, PartialEq)]
#[serde(default)]
pub struct DefinitionData {
    pub text: String,
    pub source: String,
    /// Gesetzesfundstelle als Text, z. B. „§ 119 Abs. 1 BGB“
    pub citation: String,
    pub example: String,
    pub notes: String,
}

#[derive(Debug, Serialize, Deserialize, Default, Clone, PartialEq)]
#[serde(default)]
pub struct SchemaItem {
    pub id: String,
    pub text: String,
    pub note: String,
    pub children: Vec<SchemaItem>,
}

#[derive(Debug, Serialize, Deserialize, Default, Clone, PartialEq)]
#[serde(default)]
pub struct SchemaData {
    /// Anspruchsgrundlage / Norm, z. B. „§ 433 Abs. 2 BGB“
    pub norm: String,
    pub items: Vec<SchemaItem>,
    pub notes: String,
}

#[derive(Debug, Serialize, Deserialize, Default, Clone, PartialEq)]
#[serde(default)]
pub struct CaseData {
    pub claim_basis: String,
    /// 1 = leicht, 2 = mittel, 3 = schwer, 0 = nicht angegeben
    pub difficulty: u8,
    /// offen, bearbeitet, wiederholen
    pub status: String,
    pub facts: String,
    pub question: String,
    pub notes: String,
    /// Notiz mit der Lösung (Gutachten)
    pub solution_note_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Default, Clone, PartialEq)]
#[serde(default)]
pub struct CitationData {
    /// Gesetz, z. B. „BGB“, „GG“, „StGB“
    pub law: String,
    /// „§“ oder „Art.“
    pub prefix: String,
    pub number: String,
    pub paragraph: String,
    pub sentence: String,
    pub num: String,
    pub alt: String,
    pub notes: String,
}

/// Zitierweise einer Fundstelle, z. B. „§ 433 Abs. 1 S. 1 BGB“ oder „Art. 12 Abs. 1 GG“.
pub fn format_citation(c: &CitationData) -> String {
    let mut parts = vec![format!("{} {}", if c.prefix.trim().is_empty() { "§" } else { c.prefix.trim() }, c.number.trim())];
    if !c.paragraph.trim().is_empty() {
        parts.push(format!("Abs. {}", c.paragraph.trim()));
    }
    if !c.sentence.trim().is_empty() {
        parts.push(format!("S. {}", c.sentence.trim()));
    }
    if !c.num.trim().is_empty() {
        parts.push(format!("Nr. {}", c.num.trim()));
    }
    if !c.alt.trim().is_empty() {
        parts.push(format!("Alt. {}", c.alt.trim()));
    }
    if !c.law.trim().is_empty() {
        parts.push(c.law.trim().to_string());
    }
    parts.join(" ")
}

/// Liest eine Fundstelle aus Text, z. B. „§ 823 Abs. 1 BGB“, „Art. 2 I GG“, „§§ 133, 157 BGB“
/// (bei mehreren Normen wird die erste verwendet). `None`, wenn nichts erkennbar ist.
pub fn parse_citation(input: &str) -> Option<CitationData> {
    let s = input.trim();
    let (prefix, rest) = if let Some(r) = s.strip_prefix("§§") {
        ("§", r)
    } else if let Some(r) = s.strip_prefix('§') {
        ("§", r)
    } else if let Some(r) = s.strip_prefix("Art.") {
        ("Art.", r)
    } else {
        ("Art.", s.strip_prefix("Artikel")?)
    };
    let tokens: Vec<&str> = rest.split(|c: char| c.is_whitespace() || c == ',').filter(|t| !t.is_empty()).collect();
    let mut c = CitationData { prefix: prefix.into(), ..Default::default() };
    let mut i = 0;
    let number = tokens.first()?;
    if !number.chars().next()?.is_ascii_digit() {
        return None;
    }
    c.number = number.to_string();
    i += 1;
    let roman = |t: &str| -> Option<String> {
        let v = match t {
            "I" => 1, "II" => 2, "III" => 3, "IV" => 4, "V" => 5, "VI" => 6, "VII" => 7, "VIII" => 8, "IX" => 9, "X" => 10,
            _ => return None,
        };
        Some(v.to_string())
    };
    while i < tokens.len() {
        let t = tokens[i];
        let next = tokens.get(i + 1).copied().unwrap_or("");
        match t {
            "Abs." | "Absatz" => {
                c.paragraph = next.into();
                i += 2;
            }
            "S." | "Satz" => {
                c.sentence = next.into();
                i += 2;
            }
            "Nr." | "Nummer" => {
                c.num = next.into();
                i += 2;
            }
            "Alt." | "Alternative" | "Var." => {
                c.alt = next.into();
                i += 2;
            }
            _ if c.paragraph.is_empty() && roman(t).is_some() => {
                c.paragraph = roman(t).unwrap();
                i += 1;
            }
            _ if t.chars().all(|ch| ch.is_ascii_digit() || ch == 'a') && c.law.is_empty() => {
                // weitere Normnummer bei „§§ 133, 157“: ignorieren
                i += 1;
            }
            _ if t.chars().next().is_some_and(|ch| ch.is_uppercase()) => {
                c.law = tokens[i..].join(" ");
                break;
            }
            _ => i += 1,
        }
    }
    Some(c)
}

fn normalize_items(items: &mut [SchemaItem], depth: usize) -> Result<()> {
    if depth > 12 {
        return Err(Error::invalid("Das Prüfungsschema ist zu tief verschachtelt (höchstens 12 Ebenen)."));
    }
    for it in items.iter_mut() {
        if it.id.is_empty() || it.id.len() > 64 {
            it.id = new_id();
        }
        it.text = it.text.chars().filter(|c| !c.is_control()).take(2000).collect();
        normalize_items(&mut it.children, depth + 1)?;
    }
    Ok(())
}

/// Prüft und normalisiert `data` für einen Typ. Liefert außerdem den Suchtext.
fn normalize(ty: &str, data: Value) -> Result<(Value, String)> {
    let v = if data.is_null() { Value::Object(Default::default()) } else { data };
    if !v.is_object() {
        return Err(Error::invalid("Ungültige Angaben."));
    }
    let bad = |_| Error::invalid("Die Angaben haben ein unerwartetes Format.");
    let (value, text) = match ty {
        "definition" => {
            let d: DefinitionData = serde_json::from_value(v).map_err(bad)?;
            let t = [d.text.as_str(), &d.source, &d.citation, &d.example, &d.notes].join(" ");
            (serde_json::to_value(d)?, t)
        }
        "schema" => {
            let mut d: SchemaData = serde_json::from_value(v).map_err(bad)?;
            normalize_items(&mut d.items, 0)?;
            let mut t = vec![d.norm.clone(), d.notes.clone()];
            fn walk(items: &[SchemaItem], out: &mut Vec<String>) {
                for it in items {
                    out.push(it.text.clone());
                    out.push(it.note.clone());
                    walk(&it.children, out);
                }
            }
            walk(&d.items, &mut t);
            (serde_json::to_value(d)?, t.join(" "))
        }
        "case" => {
            let mut d: CaseData = serde_json::from_value(v).map_err(bad)?;
            if d.difficulty > 3 {
                d.difficulty = 0;
            }
            if !["offen", "bearbeitet", "wiederholen", ""].contains(&d.status.as_str()) {
                d.status = "offen".into();
            }
            if let Some(n) = &d.solution_note_id {
                require_id(n)?;
            }
            let t = [d.claim_basis.as_str(), &d.facts, &d.question, &d.notes].join(" ");
            (serde_json::to_value(d)?, t)
        }
        "citation" => {
            let d: CitationData = serde_json::from_value(v).map_err(bad)?;
            if d.number.trim().is_empty() {
                return Err(Error::invalid("Bitte die Paragrafen- bzw. Artikelnummer angeben."));
            }
            if !["§", "Art.", ""].contains(&d.prefix.trim()) {
                return Err(Error::invalid("Als Zeichen sind nur „§“ und „Art.“ möglich."));
            }
            let t = format!("{} {}", format_citation(&d), d.notes);
            (serde_json::to_value(d)?, t)
        }
        _ => return Err(Error::invalid("Unbekannter Typ.")),
    };
    if serde_json::to_string(&value)?.len() > MAX_DATA {
        return Err(Error::invalid("Der Inhalt ist zu umfangreich."));
    }
    Ok((value, text))
}

// ---------- Datensatz ----------

#[derive(Debug, Serialize, Clone)]
pub struct Knowledge {
    pub id: String,
    #[serde(rename = "type")]
    pub ty: String,
    pub area_id: Option<String>,
    pub node_id: Option<String>,
    pub title: String,
    pub field: String,
    pub source_kind: String,
    pub data: Value,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
}

fn from_row(r: &Row) -> rusqlite::Result<Knowledge> {
    let data: String = r.get("data")?;
    Ok(Knowledge {
        id: r.get("id")?,
        ty: r.get("type")?,
        area_id: r.get("area_id")?,
        node_id: r.get("node_id")?,
        title: r.get("title")?,
        field: r.get("field")?,
        source_kind: r.get("source_kind")?,
        data: serde_json::from_str(&data).unwrap_or(Value::Object(Default::default())),
        created_at: r.get("created_at")?,
        updated_at: r.get("updated_at")?,
        deleted_at: r.get("deleted_at")?,
    })
}

#[derive(Debug, Deserialize, Clone)]
pub struct NewKnowledge {
    #[serde(rename = "type")]
    pub ty: String,
    #[serde(default)]
    pub area_id: Option<String>,
    #[serde(default)]
    pub node_id: Option<String>,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub field: String,
    #[serde(default)]
    pub source_kind: Option<String>,
    #[serde(default)]
    pub data: Value,
}

#[derive(Debug, Deserialize, Clone, Default)]
pub struct KnowledgePatch {
    pub title: Option<String>,
    pub field: Option<String>,
    pub source_kind: Option<String>,
    /// `Some(None)` entfernt die Zuordnung
    #[serde(default, deserialize_with = "double_option")]
    pub area_id: Option<Option<String>>,
    #[serde(default, deserialize_with = "double_option")]
    pub node_id: Option<Option<String>>,
    pub data: Option<Value>,
}

pub(crate) fn double_option<'de, T, D>(de: D) -> std::result::Result<Option<Option<T>>, D::Error>
where
    T: Deserialize<'de>,
    D: serde::Deserializer<'de>,
{
    Deserialize::deserialize(de).map(Some)
}

fn check_refs(conn: &Connection, area: Option<&str>, node: Option<&str>) -> Result<()> {
    if let Some(a) = area {
        require_id(a)?;
        crate::repo::areas::get(conn, a)?;
    }
    if let Some(n) = node {
        require_id(n)?;
        crate::repo::nodes::get(conn, n)?;
    }
    Ok(())
}

fn clean_field(s: &str) -> String {
    s.chars().filter(|c| !c.is_control()).take(80).collect::<String>().trim().to_string()
}

fn clean_source(s: Option<&str>) -> Result<String> {
    let s = s.unwrap_or("eigen");
    if SOURCE_KINDS.contains(&s) {
        Ok(s.into())
    } else {
        Err(Error::invalid("Unbekannte Herkunftsangabe."))
    }
}

fn title_for(ty: &str, title: &str, data: &Value) -> Result<String> {
    if ty == "citation" {
        let c: CitationData = serde_json::from_value(data.clone()).unwrap_or_default();
        return Ok(format_citation(&c));
    }
    clean_title(title, 300)
}

pub fn index(conn: &Connection, k: &Knowledge, text: &str) -> Result<()> {
    let body = format!("{} {}", k.field, text);
    search::put(conn, Entity::Knowledge, &k.id, k.area_id.as_deref(), None, &k.title, &body)
}

pub fn get(conn: &Connection, id: &str) -> Result<Knowledge> {
    require_id(id)?;
    conn.query_row("SELECT * FROM knowledge WHERE id = ?1", [id], from_row)
        .optional()?
        .ok_or_else(|| Error::not_found("Eintrag nicht gefunden."))
}

pub fn create(conn: &Connection, input: NewKnowledge) -> Result<Knowledge> {
    if !TYPES.contains(&input.ty.as_str()) {
        return Err(Error::invalid("Unbekannter Typ."));
    }
    let (data, text) = normalize(&input.ty, input.data)?;
    let title = title_for(&input.ty, &input.title, &data)?;
    let source = clean_source(input.source_kind.as_deref())?;
    let tx = conn.unchecked_transaction()?;
    check_refs(&tx, input.area_id.as_deref(), input.node_id.as_deref())?;
    // Fundstellen sind eindeutig: dieselbe Norm wird wiederverwendet.
    if input.ty == "citation" {
        let existing: Option<String> = tx
            .query_row(
                "SELECT id FROM knowledge WHERE type = 'citation' AND title = ?1 AND deleted_at IS NULL",
                [&title],
                |r| r.get(0),
            )
            .optional()?;
        if let Some(id) = existing {
            let k = get(&tx, &id)?;
            tx.commit()?;
            return Ok(k);
        }
    }
    let id = new_id();
    let ts = now();
    tx.execute(
        "INSERT INTO knowledge (id, type, area_id, node_id, title, field, source_kind, data, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)",
        params![id, input.ty, input.area_id, input.node_id, title, clean_field(&input.field), source, data.to_string(), ts],
    )?;
    let k = get(&tx, &id)?;
    index(&tx, &k, &text)?;
    tx.commit()?;
    Ok(k)
}

pub fn update(conn: &Connection, id: &str, patch: KnowledgePatch) -> Result<Knowledge> {
    let tx = conn.unchecked_transaction()?;
    let mut k = get(&tx, id)?;
    if k.deleted_at.is_some() {
        return Err(Error::invalid("Der Eintrag liegt im Papierkorb."));
    }
    if let Some(d) = patch.data {
        k.data = d;
    }
    let (data, text) = normalize(&k.ty, k.data.clone())?;
    k.data = data;
    if let Some(t) = patch.title {
        k.title = t;
    }
    k.title = title_for(&k.ty, &k.title, &k.data)?;
    if let Some(f) = patch.field {
        k.field = clean_field(&f);
    }
    if let Some(s) = patch.source_kind {
        k.source_kind = clean_source(Some(&s))?;
    }
    if let Some(a) = patch.area_id {
        k.area_id = a;
    }
    if let Some(n) = patch.node_id {
        k.node_id = n;
    }
    check_refs(&tx, k.area_id.as_deref(), k.node_id.as_deref())?;
    k.updated_at = now();
    tx.execute(
        "UPDATE knowledge SET title=?2, field=?3, source_kind=?4, area_id=?5, node_id=?6, data=?7, updated_at=?8 WHERE id=?1",
        params![id, k.title, k.field, k.source_kind, k.area_id, k.node_id, k.data.to_string(), k.updated_at],
    )?;
    index(&tx, &k, &text)?;
    tx.commit()?;
    Ok(k)
}

#[derive(Debug, Deserialize, Default, Clone)]
pub struct KnowledgeFilter {
    #[serde(rename = "type")]
    pub ty: Option<String>,
    pub area_id: Option<String>,
    pub node_id: Option<String>,
    pub field: Option<String>,
}

/// Liste ohne gelöschte Einträge. Einträge ohne Bereich erscheinen in jedem Bereich.
pub fn list(conn: &Connection, f: &KnowledgeFilter) -> Result<Vec<Knowledge>> {
    let mut stmt = conn.prepare(
        "SELECT * FROM knowledge
         WHERE deleted_at IS NULL
           AND (?1 IS NULL OR type = ?1)
           AND (?2 IS NULL OR area_id = ?2 OR area_id IS NULL)
           AND (?3 IS NULL OR node_id = ?3)
           AND (?4 IS NULL OR field = ?4)
         ORDER BY title COLLATE NOCASE",
    )?;
    let rows = stmt.query_map(params![f.ty, f.area_id, f.node_id, f.field], from_row)?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// Alle verwendeten Rechtsgebiete/Fachgebiete (für Filter und Vorschläge).
pub fn fields(conn: &Connection) -> Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT DISTINCT field FROM knowledge WHERE deleted_at IS NULL AND field != '' ORDER BY field COLLATE NOCASE",
    )?;
    let rows = stmt.query_map([], |r| r.get(0))?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

pub fn trash(conn: &Connection, id: &str) -> Result<()> {
    require_id(id)?;
    conn.execute("UPDATE knowledge SET deleted_at = ?2 WHERE id = ?1 AND deleted_at IS NULL", params![id, now()])?;
    Ok(())
}

pub fn restore(conn: &Connection, id: &str) -> Result<()> {
    require_id(id)?;
    conn.execute("UPDATE knowledge SET deleted_at = NULL WHERE id = ?1", [id])?;
    Ok(())
}

pub fn purge(conn: &Connection, id: &str) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    let k = get(&tx, id)?;
    if k.deleted_at.is_none() {
        return Err(Error::invalid("Nur Einträge im Papierkorb können endgültig gelöscht werden."));
    }
    search::remove(&tx, Entity::Knowledge, id)?;
    crate::repo::links::remove_for_entity(&tx, "knowledge", id)?;
    tx.execute("DELETE FROM knowledge WHERE id = ?1", [id])?;
    tx.commit()?;
    Ok(())
}

pub fn reindex_all(conn: &Connection) -> Result<()> {
    let mut stmt = conn.prepare("SELECT * FROM knowledge")?;
    let rows: Vec<Knowledge> = stmt.query_map([], from_row)?.collect::<rusqlite::Result<_>>()?;
    for k in rows {
        let (_, text) = normalize(&k.ty, k.data.clone()).unwrap_or((Value::Null, String::new()));
        index(conn, &k, &text)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn citations_format_and_parse() {
        let c = parse_citation("§ 433 Abs. 1 S. 1 BGB").unwrap();
        assert_eq!(format_citation(&c), "§ 433 Abs. 1 S. 1 BGB");
        let c = parse_citation("Art. 2 I GG").unwrap();
        assert_eq!(format_citation(&c), "Art. 2 Abs. 1 GG");
        let c = parse_citation("§§ 133, 157 BGB").unwrap();
        assert_eq!(format_citation(&c), "§ 133 BGB");
        let c = parse_citation("§ 823 Abs. 1 Alt. 2 BGB").unwrap();
        assert_eq!(c.alt, "2");
        let c = parse_citation("§ 20 Nr. 1 VwVfG").unwrap();
        assert_eq!(format_citation(&c), "§ 20 Nr. 1 VwVfG");
        assert!(parse_citation("Kaufvertrag").is_none());
        assert!(parse_citation("§ abc").is_none());
    }
}
