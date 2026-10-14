//! Karteikarten und Wiederholungen.
//!
//! Die Planung (wann eine Karte wieder fällig ist) berechnet die Oberfläche mit
//! der Bibliothek `ts-fsrs` (FSRS-Verfahren). Der Kern prüft die übergebenen
//! Werte, speichert den neuen Stand und protokolliert jede Wiederholung in
//! einer Transaktion.

use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};

use crate::repo::knowledge::double_option;
use crate::search::{self, Entity};
use crate::util::{new_id, now, parse_ts, require_id};
use crate::{Error, Result};

pub const KINDS: &[&str] = &["frage", "definition", "norm"];

#[derive(Debug, Serialize, Clone)]
pub struct Card {
    pub id: String,
    pub area_id: Option<String>,
    pub node_id: Option<String>,
    pub kind: String,
    pub front: String,
    pub back: String,
    pub tags: String,
    pub source_type: Option<String>,
    pub source_id: Option<String>,
    pub difficult: bool,
    pub suspended: bool,
    pub due: String,
    pub stability: f64,
    pub difficulty: f64,
    pub elapsed_days: i64,
    pub scheduled_days: i64,
    pub learning_steps: i64,
    pub reps: i64,
    pub lapses: i64,
    pub state: i64,
    pub last_review: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
}

fn from_row(r: &Row) -> rusqlite::Result<Card> {
    Ok(Card {
        id: r.get("id")?,
        area_id: r.get("area_id")?,
        node_id: r.get("node_id")?,
        kind: r.get("kind")?,
        front: r.get("front")?,
        back: r.get("back")?,
        tags: r.get("tags")?,
        source_type: r.get("source_type")?,
        source_id: r.get("source_id")?,
        difficult: r.get::<_, i64>("difficult")? != 0,
        suspended: r.get::<_, i64>("suspended")? != 0,
        due: r.get("due")?,
        stability: r.get("stability")?,
        difficulty: r.get("difficulty")?,
        elapsed_days: r.get("elapsed_days")?,
        scheduled_days: r.get("scheduled_days")?,
        learning_steps: r.get("learning_steps")?,
        reps: r.get("reps")?,
        lapses: r.get("lapses")?,
        state: r.get("state")?,
        last_review: r.get("last_review")?,
        created_at: r.get("created_at")?,
        updated_at: r.get("updated_at")?,
        deleted_at: r.get("deleted_at")?,
    })
}

fn clean_text(s: &str, max: usize) -> String {
    s.chars().filter(|c| !c.is_control() || *c == '\n').take(max).collect::<String>().trim().to_string()
}

#[derive(Debug, Deserialize, Clone)]
pub struct NewCard {
    #[serde(default)]
    pub area_id: Option<String>,
    #[serde(default)]
    pub node_id: Option<String>,
    #[serde(default = "default_kind")]
    pub kind: String,
    pub front: String,
    pub back: String,
    #[serde(default)]
    pub tags: String,
    #[serde(default)]
    pub source_type: Option<String>,
    #[serde(default)]
    pub source_id: Option<String>,
}

fn default_kind() -> String {
    "frage".into()
}

pub fn index(conn: &Connection, c: &Card) -> Result<()> {
    search::put(conn, Entity::Card, &c.id, c.area_id.as_deref(), None, &c.front, &format!("{} {}", c.back, c.tags))
}

pub fn get(conn: &Connection, id: &str) -> Result<Card> {
    require_id(id)?;
    conn.query_row("SELECT * FROM flashcards WHERE id = ?1", [id], from_row)
        .optional()?
        .ok_or_else(|| Error::not_found("Karteikarte nicht gefunden."))
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

pub fn create(conn: &Connection, input: NewCard) -> Result<Card> {
    if !KINDS.contains(&input.kind.as_str()) {
        return Err(Error::invalid("Unbekannte Kartenart."));
    }
    let front = clean_text(&input.front, 4000);
    let back = clean_text(&input.back, 20000);
    if front.is_empty() || back.is_empty() {
        return Err(Error::invalid("Vorder- und Rückseite dürfen nicht leer sein."));
    }
    if let Some(t) = &input.source_type {
        if !["knowledge", "node", "document"].contains(&t.as_str()) {
            return Err(Error::invalid("Unbekannte Quelle."));
        }
        require_id(input.source_id.as_deref().unwrap_or(""))?;
    }
    let tx = conn.unchecked_transaction()?;
    check_refs(&tx, input.area_id.as_deref(), input.node_id.as_deref())?;
    let id = new_id();
    let ts = now();
    tx.execute(
        "INSERT INTO flashcards (id, area_id, node_id, kind, front, back, tags, source_type, source_id, due, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10, ?10)",
        params![id, input.area_id, input.node_id, input.kind, front, back, clean_text(&input.tags, 300), input.source_type, input.source_id, ts],
    )?;
    let c = get(&tx, &id)?;
    index(&tx, &c)?;
    tx.commit()?;
    Ok(c)
}

#[derive(Debug, Deserialize, Default, Clone)]
pub struct CardPatch {
    pub front: Option<String>,
    pub back: Option<String>,
    pub kind: Option<String>,
    pub tags: Option<String>,
    pub difficult: Option<bool>,
    pub suspended: Option<bool>,
    #[serde(default, deserialize_with = "double_option")]
    pub area_id: Option<Option<String>>,
    #[serde(default, deserialize_with = "double_option")]
    pub node_id: Option<Option<String>>,
}

pub fn update(conn: &Connection, id: &str, p: CardPatch) -> Result<Card> {
    let tx = conn.unchecked_transaction()?;
    let mut c = get(&tx, id)?;
    if let Some(v) = p.front {
        c.front = clean_text(&v, 4000);
    }
    if let Some(v) = p.back {
        c.back = clean_text(&v, 20000);
    }
    if c.front.is_empty() || c.back.is_empty() {
        return Err(Error::invalid("Vorder- und Rückseite dürfen nicht leer sein."));
    }
    if let Some(v) = p.kind {
        if !KINDS.contains(&v.as_str()) {
            return Err(Error::invalid("Unbekannte Kartenart."));
        }
        c.kind = v;
    }
    if let Some(v) = p.tags {
        c.tags = clean_text(&v, 300);
    }
    if let Some(v) = p.difficult {
        c.difficult = v;
    }
    if let Some(v) = p.suspended {
        c.suspended = v;
    }
    if let Some(v) = p.area_id {
        c.area_id = v;
    }
    if let Some(v) = p.node_id {
        c.node_id = v;
    }
    check_refs(&tx, c.area_id.as_deref(), c.node_id.as_deref())?;
    c.updated_at = now();
    tx.execute(
        "UPDATE flashcards SET front=?2, back=?3, kind=?4, tags=?5, difficult=?6, suspended=?7, area_id=?8, node_id=?9, updated_at=?10 WHERE id=?1",
        params![id, c.front, c.back, c.kind, c.tags, c.difficult as i64, c.suspended as i64, c.area_id, c.node_id, c.updated_at],
    )?;
    index(&tx, &c)?;
    tx.commit()?;
    Ok(c)
}

/// Neuer Planungsstand nach einer Wiederholung (berechnet mit FSRS in der Oberfläche).
#[derive(Debug, Deserialize, Clone)]
pub struct ReviewInput {
    /// 1 = Nochmal, 2 = Schwer, 3 = Gut, 4 = Einfach
    pub rating: i64,
    pub due: String,
    pub stability: f64,
    pub difficulty: f64,
    pub elapsed_days: i64,
    pub scheduled_days: i64,
    pub learning_steps: i64,
    pub reps: i64,
    pub lapses: i64,
    pub state: i64,
}

pub fn review(conn: &Connection, id: &str, r: ReviewInput) -> Result<Card> {
    if !(1..=4).contains(&r.rating) {
        return Err(Error::invalid("Ungültige Bewertung."));
    }
    let valid = r.stability.is_finite()
        && r.stability >= 0.0
        && r.difficulty.is_finite()
        && (0.0..=10.0).contains(&r.difficulty)
        && (0..=3).contains(&r.state)
        && r.reps >= 0
        && r.lapses >= 0
        && r.scheduled_days >= 0
        && r.learning_steps >= 0
        && r.elapsed_days >= 0
        && parse_ts(&r.due) != time::OffsetDateTime::UNIX_EPOCH;
    if !valid {
        return Err(Error::invalid("Ungültiger Wiederholungsstand."));
    }
    let tx = conn.unchecked_transaction()?;
    let before = get(&tx, id)?;
    if before.deleted_at.is_some() {
        return Err(Error::invalid("Die Karte liegt im Papierkorb."));
    }
    let ts = now();
    tx.execute(
        "INSERT INTO review_log (id, card_id, rating, state_before, due_before, stability, difficulty, scheduled_days, reviewed_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![new_id(), id, r.rating, before.state, before.due, r.stability, r.difficulty, r.scheduled_days, ts],
    )?;
    // „Schwer“ oder „Nochmal“ markiert die Karte als schwierig; „Einfach“ hebt das auf.
    let difficult = match r.rating {
        1 | 2 => true,
        4 => false,
        _ => before.difficult,
    };
    tx.execute(
        "UPDATE flashcards SET due=?2, stability=?3, difficulty=?4, elapsed_days=?5, scheduled_days=?6, reps=?7, lapses=?8,
                state=?9, last_review=?10, difficult=?11, learning_steps=?12, updated_at=?10 WHERE id=?1",
        params![id, r.due, r.stability, r.difficulty, r.elapsed_days, r.scheduled_days, r.reps, r.lapses, r.state, ts, difficult as i64, r.learning_steps],
    )?;
    let c = get(&tx, id)?;
    tx.commit()?;
    Ok(c)
}

#[derive(Debug, Deserialize, Default, Clone)]
pub struct CardFilter {
    pub area_id: Option<String>,
    pub node_id: Option<String>,
    /// nur fällige Karten (Fälligkeit bis `now`)
    #[serde(default)]
    pub due_only: bool,
    #[serde(default)]
    pub difficult_only: bool,
    pub source_type: Option<String>,
    pub source_id: Option<String>,
    pub limit: Option<i64>,
}

pub fn list(conn: &Connection, f: &CardFilter) -> Result<Vec<Card>> {
    let ts = now();
    let mut stmt = conn.prepare(
        "SELECT * FROM flashcards
         WHERE deleted_at IS NULL
           AND (?1 IS NULL OR area_id = ?1 OR area_id IS NULL)
           AND (?2 IS NULL OR node_id = ?2)
           AND (?3 = 0 OR (suspended = 0 AND due <= ?4))
           AND (?5 = 0 OR difficult = 1)
           AND (?6 IS NULL OR (source_type = ?6 AND source_id = ?7))
         ORDER BY CASE WHEN ?3 = 1 THEN due END, created_at DESC
         LIMIT ?8",
    )?;
    let rows = stmt.query_map(
        params![f.area_id, f.node_id, f.due_only as i64, ts, f.difficult_only as i64, f.source_type, f.source_id, f.limit.unwrap_or(5000).clamp(1, 5000)],
        from_row,
    )?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

#[derive(Debug, Serialize, Clone, Default)]
pub struct CardStats {
    pub total: i64,
    pub due_now: i64,
    pub new_cards: i64,
    pub learning: i64,
    pub review: i64,
    pub difficult: i64,
    pub suspended: i64,
    pub reviewed_today: i64,
    pub reviews_7d: i64,
    /// Anteil der Wiederholungen der letzten 30 Tage mit „Schwer“, „Gut“ oder „Einfach“
    pub retention_30d: Option<f64>,
    /// fällig in den nächsten 7 Tagen (inkl. heute)
    pub due_7d: i64,
}

/// `day_start` / `day_end`: lokaler Tag als RFC-3339-Zeitpunkte (von der Oberfläche).
pub fn stats(conn: &Connection, area_id: Option<&str>, day_start: &str) -> Result<CardStats> {
    let ts = now();
    let start = parse_ts(day_start);
    let week_ahead = (parse_ts(&ts) + time::Duration::days(7))
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or(ts.clone());
    let month_ago = (parse_ts(&ts) - time::Duration::days(30))
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or(ts.clone());
    let week_ago = (parse_ts(&ts) - time::Duration::days(7))
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or(ts.clone());
    let day_start = start.format(&time::format_description::well_known::Rfc3339).unwrap_or(ts.clone());
    let q = |sql: &str, extra: &str| -> Result<i64> {
        Ok(conn.query_row(
            &format!(
                "SELECT COUNT(*) FROM flashcards WHERE deleted_at IS NULL AND (?1 IS NULL OR area_id = ?1 OR area_id IS NULL) AND {sql}"
            ),
            params![area_id, extra],
            |r| r.get(0),
        )?)
    };
    let mut s = CardStats {
        total: q("?2 = ?2", "")?,
        due_now: q("suspended = 0 AND due <= ?2", &ts)?,
        new_cards: q("state = 0 AND ?2 = ?2", "")?,
        learning: q("state IN (1, 3) AND ?2 = ?2", "")?,
        review: q("state = 2 AND ?2 = ?2", "")?,
        difficult: q("difficult = 1 AND ?2 = ?2", "")?,
        suspended: q("suspended = 1 AND ?2 = ?2", "")?,
        due_7d: q("suspended = 0 AND due <= ?2", &week_ahead)?,
        ..Default::default()
    };
    let lq = |since: &str| -> Result<(i64, i64)> {
        Ok(conn.query_row(
            "SELECT COUNT(*), COALESCE(SUM(CASE WHEN l.rating > 1 THEN 1 ELSE 0 END), 0)
             FROM review_log l JOIN flashcards c ON c.id = l.card_id
             WHERE l.reviewed_at >= ?2 AND (?1 IS NULL OR c.area_id = ?1 OR c.area_id IS NULL)",
            params![area_id, since],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?)
    };
    s.reviewed_today = lq(&day_start)?.0;
    s.reviews_7d = lq(&week_ago)?.0;
    let (n, ok) = lq(&month_ago)?;
    s.retention_30d = if n > 0 { Some(ok as f64 / n as f64) } else { None };
    Ok(s)
}

pub fn trash(conn: &Connection, id: &str) -> Result<()> {
    require_id(id)?;
    conn.execute("UPDATE flashcards SET deleted_at = ?2 WHERE id = ?1 AND deleted_at IS NULL", params![id, now()])?;
    Ok(())
}

pub fn restore(conn: &Connection, id: &str) -> Result<()> {
    require_id(id)?;
    conn.execute("UPDATE flashcards SET deleted_at = NULL WHERE id = ?1", [id])?;
    Ok(())
}

pub fn purge(conn: &Connection, id: &str) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    let c = get(&tx, id)?;
    if c.deleted_at.is_none() {
        return Err(Error::invalid("Nur Karten im Papierkorb können endgültig gelöscht werden."));
    }
    search::remove(&tx, Entity::Card, id)?;
    tx.execute("DELETE FROM flashcards WHERE id = ?1", [id])?;
    tx.commit()?;
    Ok(())
}

pub fn reindex_all(conn: &Connection) -> Result<()> {
    let mut stmt = conn.prepare("SELECT * FROM flashcards")?;
    let rows: Vec<Card> = stmt.query_map([], from_row)?.collect::<rusqlite::Result<_>>()?;
    for c in rows {
        index(conn, &c)?;
    }
    Ok(())
}
