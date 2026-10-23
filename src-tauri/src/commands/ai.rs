//! Befehle für den KI-Assistenten: Rechtsquellen, Status, eine eng begrenzte
//! Weiterleitung an die Claude API und das Laden von Gesetzen.
//!
//! Die Oberfläche spricht nie selbst mit dem Netz (CSP bleibt geschlossen) und
//! sieht den API-Schlüssel nie: Er wird hier aus `ANTHROPIC_API_KEY` gesetzt.
//! Protokolliert werden nur Methode, Pfad, Status und Dauer – nie Inhalte.

use std::sync::OnceLock;
use std::time::{Duration, Instant};

use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use reqwest::{redirect, Client, Url};
use serde::Serialize;
use studium_core::repo::ai_chats::{self, AiChat, AiChatInput, AiChatMeta};
use studium_core::repo::legal::{self, LegalHit, LegalSource, NewLegalChunk, NewLegalSource};
use tauri::ipc::Response;

use super::St;
use crate::state::{CmdError, CmdResult};

const API_HOST: &str = "api.anthropic.com";
const API_PATHS: &[&str] = &["/v1/messages", "/v1/messages/count_tokens"];
const FORWARD_HEADERS: &[&str] = &["content-type", "anthropic-version", "anthropic-beta", "accept"];
const MAX_API_BODY: usize = 32 * 1024 * 1024;
const API_TIMEOUT: Duration = Duration::from_secs(10 * 60);

const LAW_HOST: &str = "www.gesetze-im-internet.de";
const MAX_LAW_BYTES: usize = 100 * 1024 * 1024;
const LAW_TIMEOUT: Duration = Duration::from_secs(5 * 60);

const NO_KEY: &str =
    "Kein API-Schlüssel gefunden. Setze die Umgebungsvariable ANTHROPIC_API_KEY und starte Studium OS neu.";
const LAW_OFFLINE: &str = "Keine Verbindung zu gesetze-im-internet.de.";

// ---- Rechtsquellen ----

#[tauri::command]
pub async fn legal_sources_list(state: St<'_>) -> CmdResult<Vec<LegalSource>> {
    state.with(legal::list)
}

#[tauri::command]
pub async fn legal_source_save(state: St<'_>, source: NewLegalSource, chunks: Vec<NewLegalChunk>) -> CmdResult<LegalSource> {
    state.with(|c| legal::save(c, source, chunks))
}

#[tauri::command]
pub async fn legal_source_delete(state: St<'_>, id: String) -> CmdResult<()> {
    state.with(|c| legal::remove(c, &id))
}

#[tauri::command]
pub async fn legal_search(state: St<'_>, terms: Vec<String>, kinds: Option<Vec<String>>, limit: i64) -> CmdResult<Vec<LegalHit>> {
    state.with(|c| legal::search(c, &terms, kinds.as_deref(), limit))
}

#[tauri::command]
pub async fn legal_norm(state: St<'_>, abbreviation: String, norm: String, absatz: Option<i64>) -> CmdResult<Vec<LegalHit>> {
    state.with(|c| legal::norm(c, &abbreviation, &norm, absatz))
}

#[tauri::command]
pub async fn legal_source_texts(state: St<'_>, id: String) -> CmdResult<Vec<String>> {
    state.with(|c| legal::source_texts(c, &id))
}

#[tauri::command]
pub async fn legal_chunks(state: St<'_>, ids: Vec<String>) -> CmdResult<Vec<LegalHit>> {
    state.with(|c| legal::chunks(c, &ids))
}

// ---- Verlauf (nur lokal) ----

#[tauri::command]
pub async fn ai_chats_list(state: St<'_>) -> CmdResult<Vec<AiChatMeta>> {
    state.with(ai_chats::list)
}

#[tauri::command]
pub async fn ai_chat_get(state: St<'_>, id: String) -> CmdResult<AiChat> {
    state.with(|c| ai_chats::get(c, &id))
}

#[tauri::command]
pub async fn ai_chat_save(state: St<'_>, chat: AiChatInput) -> CmdResult<AiChatMeta> {
    state.with(|c| ai_chats::save(c, chat))
}

#[tauri::command]
pub async fn ai_chat_delete(state: St<'_>, id: String) -> CmdResult<()> {
    state.with(|c| ai_chats::remove(c, &id))
}

#[tauri::command]
pub async fn ai_chats_clear(state: St<'_>) -> CmdResult<()> {
    state.with(ai_chats::clear)
}

// ---- Status ----

#[derive(Debug, Serialize)]
pub struct AiStatus {
    pub available: bool,
    pub key_source: &'static str,
    pub can_fetch_laws: bool,
}

fn api_key() -> Option<String> {
    std::env::var("ANTHROPIC_API_KEY").ok().map(|k| k.trim().to_string()).filter(|k| !k.is_empty())
}

#[tauri::command]
pub fn ai_status() -> AiStatus {
    let available = api_key().is_some();
    AiStatus { available, key_source: if available { "env" } else { "none" }, can_fetch_laws: true }
}

// ---- Weiterleitung an die Claude API ----

#[derive(Debug, Serialize)]
pub struct AiHttpResponse {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: String,
}

/// Prüft die Zieladresse: nur `https://api.anthropic.com/v1/messages` bzw.
/// `/v1/messages/count_tokens`, höchstens mit `?beta=true`.
pub fn check_api_url(url: &str) -> Result<Url, &'static str> {
    const BAD: &str = "Diese Adresse darf nicht aufgerufen werden.";
    let u = Url::parse(url).map_err(|_| BAD)?;
    let ok = u.scheme() == "https"
        && u.host_str() == Some(API_HOST)
        && u.port().is_none()
        && u.username().is_empty()
        && u.password().is_none()
        && u.fragment().is_none()
        && API_PATHS.contains(&u.path())
        && matches!(u.query(), None | Some("") | Some("beta=true"));
    if ok {
        Ok(u)
    } else {
        Err(BAD)
    }
}

/// Nur erlaubte Kopfzeilen übernehmen; Schlüssel aus der Oberfläche werden verworfen.
pub fn forward_headers(headers: &[(String, String)]) -> Result<HeaderMap, &'static str> {
    let mut map = HeaderMap::new();
    for (name, value) in headers {
        let name = name.trim().to_ascii_lowercase();
        if !FORWARD_HEADERS.contains(&name.as_str()) {
            continue;
        }
        let name = HeaderName::from_bytes(name.as_bytes()).map_err(|_| "Ungültige Kopfzeile.")?;
        let value = HeaderValue::from_str(value).map_err(|_| "Ungültige Kopfzeile.")?;
        map.append(name, value);
    }
    Ok(map)
}

fn api_client() -> Result<&'static Client, CmdError> {
    static CLIENT: OnceLock<Client> = OnceLock::new();
    if let Some(c) = CLIENT.get() {
        return Ok(c);
    }
    // Keine Weiterleitungen: Der Schlüssel darf nur an api.anthropic.com gehen.
    let c = Client::builder()
        .redirect(redirect::Policy::none())
        .timeout(API_TIMEOUT)
        .connect_timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| {
            log::error!("HTTP-Client konnte nicht erstellt werden: {e}");
            CmdError::new("network", "Die Netzwerkverbindung konnte nicht vorbereitet werden.")
        })?;
    Ok(CLIENT.get_or_init(|| c))
}

#[tauri::command]
pub async fn ai_http(url: String, method: String, headers: Vec<(String, String)>, body: String) -> CmdResult<AiHttpResponse> {
    if method != "POST" {
        return Err(CmdError::new("invalid", "Nur POST-Anfragen sind erlaubt."));
    }
    let target = check_api_url(&url).map_err(|m| CmdError::new("invalid", m))?;
    if body.len() > MAX_API_BODY {
        return Err(CmdError::new("invalid", "Die Anfrage ist zu groß."));
    }
    let mut hdrs = forward_headers(&headers).map_err(|m| CmdError::new("invalid", m))?;
    let key = api_key().ok_or_else(|| CmdError::new("no_api_key", NO_KEY))?;
    let mut key = HeaderValue::from_str(&key).map_err(|_| CmdError::new("no_api_key", NO_KEY))?;
    key.set_sensitive(true);
    hdrs.insert(HeaderName::from_static("x-api-key"), key);

    let path = target.path().to_string();
    let started = Instant::now();
    let result = api_client()?.post(target).headers(hdrs).body(body).send().await;
    let resp = match result {
        Ok(r) => r,
        Err(e) => {
            log::warn!("ai_http POST {path} fehlgeschlagen nach {} ms ({})", started.elapsed().as_millis(), error_kind(&e));
            return Err(api_net_error(&e));
        }
    };
    let status = resp.status().as_u16();
    let headers: Vec<(String, String)> = resp
        .headers()
        .iter()
        .map(|(k, v)| (k.as_str().to_ascii_lowercase(), String::from_utf8_lossy(v.as_bytes()).into_owned()))
        .collect();
    let body = match resp.text().await {
        Ok(b) => b,
        Err(e) => {
            log::warn!("ai_http POST {path} Antwort abgebrochen nach {} ms ({})", started.elapsed().as_millis(), error_kind(&e));
            return Err(api_net_error(&e));
        }
    };
    log::info!("ai_http POST {path} -> {status} in {} ms", started.elapsed().as_millis());
    Ok(AiHttpResponse { status, headers, body })
}

fn error_kind(e: &reqwest::Error) -> &'static str {
    if e.is_timeout() {
        "Zeitüberschreitung"
    } else if e.is_connect() {
        "Verbindung"
    } else if e.is_body() || e.is_decode() {
        "Antwort"
    } else {
        "Netzwerk"
    }
}

fn api_net_error(e: &reqwest::Error) -> CmdError {
    if e.is_timeout() {
        CmdError::new("network", "Die Claude API hat nicht rechtzeitig geantwortet.")
    } else {
        CmdError::new("network", "Keine Verbindung zur Claude API.")
    }
}

// ---- Gesetze von gesetze-im-internet.de ----

/// Gesetzesabkürzung prüfen und vereinheitlichen (Kleinbuchstaben, `[a-z0-9_]{1,40}`).
pub fn check_law_abbreviation(abbreviation: &str) -> Result<String, &'static str> {
    let a = abbreviation.trim().to_lowercase();
    let ok = (1..=40).contains(&a.len()) && a.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_');
    if ok {
        Ok(a)
    } else {
        Err("Ungültige Gesetzesabkürzung.")
    }
}

pub fn law_url(abbr: &str) -> String {
    format!("https://{LAW_HOST}/{abbr}/xml.zip")
}

fn law_client() -> Result<&'static Client, CmdError> {
    static CLIENT: OnceLock<Client> = OnceLock::new();
    if let Some(c) = CLIENT.get() {
        return Ok(c);
    }
    // Weiterleitungen nur innerhalb von gesetze-im-internet.de über HTTPS.
    let policy = redirect::Policy::custom(|a| {
        let u = a.url();
        if a.previous().len() >= 5 {
            a.error("zu viele Weiterleitungen")
        } else if u.scheme() == "https" && matches!(u.host_str(), Some(LAW_HOST) | Some("gesetze-im-internet.de")) {
            a.follow()
        } else {
            a.stop()
        }
    });
    let c = Client::builder()
        .redirect(policy)
        .timeout(LAW_TIMEOUT)
        .connect_timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| {
            log::error!("HTTP-Client konnte nicht erstellt werden: {e}");
            CmdError::new("network", LAW_OFFLINE)
        })?;
    Ok(CLIENT.get_or_init(|| c))
}

#[tauri::command]
pub async fn law_fetch(abbreviation: String) -> CmdResult<Response> {
    let abbr = check_law_abbreviation(&abbreviation).map_err(|m| CmdError::new("invalid", m))?;
    let started = Instant::now();
    let offline = |e: reqwest::Error| {
        log::warn!("law_fetch {abbr} fehlgeschlagen ({})", error_kind(&e));
        CmdError::new("network", LAW_OFFLINE)
    };
    let mut resp = law_client()?.get(law_url(&abbr)).send().await.map_err(offline)?;
    let status = resp.status().as_u16();
    if status != 200 {
        log::info!("law_fetch {abbr} -> {status}");
        return Err(CmdError::new(
            "not_found",
            format!("Das Gesetz „{abbr}“ wurde bei gesetze-im-internet.de nicht gefunden (HTTP {status})."),
        ));
    }
    let too_big = || CmdError::new("invalid", "Das Gesetz ist zu groß zum Herunterladen.");
    if resp.content_length().is_some_and(|n| n > MAX_LAW_BYTES as u64) {
        return Err(too_big());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = resp.chunk().await.map_err(offline)? {
        if bytes.len() + chunk.len() > MAX_LAW_BYTES {
            return Err(too_big());
        }
        bytes.extend_from_slice(&chunk);
    }
    log::info!("law_fetch {abbr} -> {status}, {} Bytes in {} ms", bytes.len(), started.elapsed().as_millis());
    Ok(Response::new(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn api_url_is_restricted() {
        assert!(check_api_url("https://api.anthropic.com/v1/messages").is_ok());
        assert!(check_api_url("https://api.anthropic.com/v1/messages?beta=true").is_ok());
        assert!(check_api_url("https://api.anthropic.com/v1/messages?").is_ok());
        assert!(check_api_url("https://API.Anthropic.com/v1/messages/count_tokens").is_ok());
        for bad in [
            "http://api.anthropic.com/v1/messages",
            "https://api.anthropic.com.evil.com/v1/messages",
            "https://evil.com/v1/messages",
            "https://api.anthropic.com./v1/messages",
            "https://api.anthropic.com:8443/v1/messages",
            "https://user:pw@api.anthropic.com/v1/messages",
            "https://evil.com@api.anthropic.com/v1/messages?x=1",
            "https://api.anthropic.com/v1/models",
            "https://api.anthropic.com/v1/messages/batches",
            "https://api.anthropic.com/v1/messages/",
            "https://api.anthropic.com/v1/messages?beta=false",
            "https://api.anthropic.com/v1/messages?beta=true&x=1",
            "https://api.anthropic.com/v1/messages#x",
            "https://api.anthropic.com/v1/%6Dessages",
            "api.anthropic.com/v1/messages",
            "",
        ] {
            assert!(check_api_url(bad).is_err(), "{bad}");
        }
        // Pfadnormalisierung ergibt die erlaubte Adresse – gesendet wird die normalisierte.
        assert_eq!(check_api_url("https://api.anthropic.com/v1/x/../messages").unwrap().path(), "/v1/messages");
    }

    #[test]
    fn only_allowed_headers_are_forwarded() {
        let h = forward_headers(&[
            ("Content-Type".into(), "application/json".into()),
            ("anthropic-version".into(), "2023-06-01".into()),
            ("anthropic-beta".into(), "x".into()),
            ("Accept".into(), "application/json".into()),
            ("x-api-key".into(), "geheim".into()),
            ("Authorization".into(), "Bearer geheim".into()),
            ("x-stainless-os".into(), "Linux".into()),
            ("host".into(), "evil.com".into()),
        ])
        .unwrap();
        assert_eq!(h.len(), 4);
        assert!(h.get("x-api-key").is_none() && h.get("authorization").is_none() && h.get("host").is_none());
        assert_eq!(h.get("content-type").unwrap(), "application/json");
        assert!(forward_headers(&[("accept".into(), "a\r\nx-api-key: b".into())]).is_err());
    }

    #[test]
    fn law_abbreviation_is_restricted() {
        assert_eq!(check_law_abbreviation("BGB").unwrap(), "bgb");
        assert_eq!(check_law_abbreviation(" stgb ").unwrap(), "stgb");
        assert_eq!(check_law_abbreviation("bgbeg_2").unwrap(), "bgbeg_2");
        assert_eq!(law_url("gg"), "https://www.gesetze-im-internet.de/gg/xml.zip");
        assert!(check_law_abbreviation(&"a".repeat(40)).is_ok());
        for bad in ["", " ", "../etc", "b/g", "bgb?x", "bgb.zip", "bgb-eg", "Bürgerlich", "a b", &"a".repeat(41)] {
            assert_eq!(check_law_abbreviation(bad).unwrap_err(), "Ungültige Gesetzesabkürzung.", "{bad}");
        }
    }
}
