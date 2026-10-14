use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

/// Aktueller Zeitpunkt als RFC-3339-Text in UTC, z. B. `2026-10-14T10:55:01.611Z`.
pub fn now() -> String {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .expect("RFC 3339 ist für UTC immer formatierbar")
}

/// Zeitstempel für Dateinamen, z. B. `2026-10-14_105501Z`.
pub fn file_stamp() -> String {
    let t = OffsetDateTime::now_utc();
    format!(
        "{:04}-{:02}-{:02}_{:02}{:02}{:02}Z",
        t.year(),
        u8::from(t.month()),
        t.day(),
        t.hour(),
        t.minute(),
        t.second()
    )
}

/// Parst einen RFC-3339-Zeitstempel. Unlesbare Werte gelten als sehr alt.
pub fn parse_ts(s: &str) -> OffsetDateTime {
    OffsetDateTime::parse(s, &Rfc3339).unwrap_or(OffsetDateTime::UNIX_EPOCH)
}

/// Neue, zeitlich sortierbare ID (UUID v7).
pub fn new_id() -> String {
    uuid::Uuid::now_v7().to_string()
}

/// Prüft, ob ein Text wie eine von uns erzeugte UUID aussieht.
pub fn is_id(s: &str) -> bool {
    uuid::Uuid::parse_str(s).is_ok()
}

pub fn require_id(s: &str) -> crate::Result<()> {
    if is_id(s) {
        Ok(())
    } else {
        Err(crate::Error::invalid("Ungültige Kennung."))
    }
}

/// Kürzt und säubert einen Titel. Leere Titel werden abgelehnt.
pub fn clean_title(s: &str, max: usize) -> crate::Result<String> {
    let t: String = s
        .chars()
        .filter(|c| !c.is_control())
        .collect::<String>()
        .trim()
        .to_string();
    if t.is_empty() {
        return Err(crate::Error::invalid("Der Titel darf nicht leer sein."));
    }
    Ok(t.chars().take(max).collect())
}

/// Zählt Wörter in reinem Text.
pub fn word_count(s: &str) -> i64 {
    s.split_whitespace().count() as i64
}
