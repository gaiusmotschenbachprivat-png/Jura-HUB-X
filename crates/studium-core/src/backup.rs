//! Vollständige Backups: erstellen, prüfen, wiederherstellen.
//!
//! Format: ZIP-Datei mit `manifest.json`, `studium.sqlite` (konsistenter
//! Schnappschuss via `VACUUM INTO`) und `files/<xx>/<sha256>`.
//!
//! Sicherheitsregeln:
//! * Ein Backup wird zuerst als `.partial` geschrieben, geprüft und erst dann
//!   umbenannt. Ein abgebrochenes Backup erscheint nie als gültig.
//! * Vor dem Wiederherstellen wird das Backup vollständig geprüft
//!   (Hashes, Vollständigkeit, Datenbank-Integrität, Schemaversion).
//! * Der aktuelle Stand wird vor dem Ersetzen als `pre-restore-…` beiseitegelegt.
//! * Nur bekannte Eintragsnamen werden entpackt (Schutz vor „Zip Slip“).

use std::collections::{BTreeMap, HashSet};
use std::fs::{self, File};
use std::io::{self, BufWriter, Read, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

use crate::db::{self, DB_FILE, SCHEMA_VERSION};
use crate::files::{is_sha256_hex, sha256_file, sha256_reader};
use crate::util::{file_stamp, new_id, now};
use crate::{Error, Result};

pub const FORMAT_VERSION: u32 = 1;
pub const EXTENSION: &str = "studiumbackup";
const MANIFEST: &str = "manifest.json";
const DB_ENTRY: &str = "studium.sqlite";

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ManifestEntry {
    pub path: String,
    pub sha256: String,
    pub size: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Manifest {
    pub format: String,
    pub format_version: u32,
    pub app_version: String,
    pub schema_version: i64,
    pub created_at: String,
    pub kind: String,
    pub entries: Vec<ManifestEntry>,
}

#[derive(Debug, Serialize, Clone)]
pub struct BackupInfo {
    pub path: String,
    pub size: u64,
    pub sha256: String,
    pub created_at: String,
    pub file_count: usize,
    pub kind: String,
    /// Pfad der zweiten Kopie, falls angelegt
    pub second_copy: Option<String>,
    /// Fehler bei der zweiten Kopie (das Hauptbackup ist trotzdem gültig)
    pub second_copy_error: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct VerifyReport {
    pub ok: bool,
    pub created_at: Option<String>,
    pub schema_version: Option<i64>,
    pub app_version: Option<String>,
    pub file_count: usize,
    pub total_size: u64,
    pub problems: Vec<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct RestoreResult {
    /// Hier liegt der Stand von vor der Wiederherstellung
    pub previous_state_dir: String,
    pub created_at: String,
}

pub struct BackupOptions<'a> {
    pub kind: &'a str,
    pub app_version: &'a str,
    pub second_dir: Option<&'a Path>,
}

fn backup_name(kind: &str) -> String {
    let prefix = if kind == "auto" { "Studium-OS-Auto-Backup" } else { "Studium-OS-Backup" };
    format!("{prefix}-{}", file_stamp())
}

struct HashingWriter<W: Write> {
    inner: W,
    hasher: Sha256,
    size: u64,
}

impl<W: Write> Write for HashingWriter<W> {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        let n = self.inner.write(buf)?;
        self.hasher.update(&buf[..n]);
        self.size += n as u64;
        Ok(n)
    }
    fn flush(&mut self) -> io::Result<()> {
        self.inner.flush()
    }
}

fn add_file<W: Write + io::Seek>(
    zip: &mut ZipWriter<W>,
    name: &str,
    src: &Path,
    method: CompressionMethod,
) -> Result<ManifestEntry> {
    let opts = SimpleFileOptions::default().compression_method(method).large_file(true);
    zip.start_file(name, opts)?;
    let mut f = File::open(src)?;
    let mut hw = HashingWriter { inner: &mut *zip, hasher: Sha256::new(), size: 0 };
    io::copy(&mut f, &mut hw)?;
    Ok(ManifestEntry { path: name.to_string(), sha256: hex::encode(hw.hasher.finalize()), size: hw.size })
}

/// Erstellt ein vollständiges Backup des Datenordners in `dest_dir`.
/// Öffnet eine eigene, nur lesende Verbindung – die App kann weiterarbeiten.
pub fn create(data_dir: &Path, dest_dir: &Path, opts: &BackupOptions) -> Result<BackupInfo> {
    fs::create_dir_all(dest_dir).map_err(|e| {
        Error::invalid(format!("Der Backup-Ordner ist nicht beschreibbar oder nicht verfügbar ({e})."))
    })?;
    let tmp = data_dir.join("tmp");
    fs::create_dir_all(&tmp)?;
    let snap = tmp.join(format!("snapshot-{}.sqlite", new_id()));
    let created_at = now();

    let result = (|| -> Result<BackupInfo> {
        {
            let conn = db::open_readonly(&db::db_path(data_dir))?;
            conn.execute("VACUUM INTO ?1", [snap.to_string_lossy().as_ref()])?;
        }
        let snap_conn = db::open_readonly(&snap)?;
        db::integrity_check(&snap_conn)?;
        let schema = db::schema_version(&snap_conn)?;
        let mut stmt = snap_conn.prepare("SELECT sha256 FROM blobs ORDER BY sha256")?;
        let blobs: Vec<String> = stmt.query_map([], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?;
        drop(stmt);
        drop(snap_conn);

        let name = backup_name(opts.kind);
        let final_path = unique(dest_dir, &name);
        let partial = final_path.with_extension(format!("{EXTENSION}.partial"));
        let file = File::create(&partial).map_err(|e| {
            Error::invalid(format!("Das Backup konnte im gewählten Ordner nicht angelegt werden ({e})."))
        })?;
        let mut zip = ZipWriter::new(BufWriter::new(file));
        let mut entries = vec![add_file(&mut zip, DB_ENTRY, &snap, CompressionMethod::Deflated)?];
        let mut missing = Vec::new();
        for sha in &blobs {
            let src = data_dir.join("files").join(&sha[..2]).join(sha);
            if !src.is_file() {
                missing.push(sha.clone());
                continue;
            }
            let name = format!("files/{}/{}", &sha[..2], sha);
            // Dokumente sind meist schon komprimiert (PDF, DOCX, Bilder).
            entries.push(add_file(&mut zip, &name, &src, CompressionMethod::Stored)?);
        }
        let manifest = Manifest {
            format: "studium-os-backup".into(),
            format_version: FORMAT_VERSION,
            app_version: opts.app_version.into(),
            schema_version: schema,
            created_at: created_at.clone(),
            kind: opts.kind.into(),
            entries,
        };
        zip.start_file(MANIFEST, SimpleFileOptions::default().compression_method(CompressionMethod::Deflated))?;
        zip.write_all(&serde_json::to_vec_pretty(&manifest)?)?;
        let buf = zip.finish()?;
        let file = buf.into_inner().map_err(|e| Error::Io(e.into_error()))?;
        file.sync_all()?;
        drop(file);

        let report = verify(&partial)?;
        if !report.ok {
            let _ = fs::remove_file(&partial);
            return Err(Error::BackupCorrupt(format!(
                "Die Prüfung direkt nach dem Schreiben ist fehlgeschlagen: {}",
                report.problems.join("; ")
            )));
        }
        fs::rename(&partial, &final_path)?;
        if !missing.is_empty() {
            log::warn!("Backup: {} Datei(en) fehlten im Dokumentenspeicher", missing.len());
        }
        let size = fs::metadata(&final_path)?.len();
        let sha256 = sha256_file(&final_path)?;
        let mut info = BackupInfo {
            path: final_path.to_string_lossy().into(),
            size,
            sha256: sha256.clone(),
            created_at: created_at.clone(),
            file_count: manifest.entries.len() - 1,
            kind: opts.kind.into(),
            second_copy: None,
            second_copy_error: None,
        };
        if let Some(second) = opts.second_dir {
            match copy_verified(&final_path, second, &sha256) {
                Ok(p) => info.second_copy = Some(p.to_string_lossy().into()),
                Err(e) => info.second_copy_error = Some(e.to_string()),
            }
        }
        Ok(info)
    })();
    let _ = fs::remove_file(&snap);
    result
}

fn unique(dir: &Path, name: &str) -> PathBuf {
    let mut p = dir.join(format!("{name}.{EXTENSION}"));
    let mut i = 2;
    while p.exists() {
        p = dir.join(format!("{name}-{i}.{EXTENSION}"));
        i += 1;
    }
    p
}

fn copy_verified(src: &Path, dir: &Path, sha: &str) -> Result<PathBuf> {
    fs::create_dir_all(dir)
        .map_err(|e| Error::invalid(format!("Zweiter Backup-Ordner nicht verfügbar ({e}).")))?;
    let name = src.file_name().expect("Backup hat einen Dateinamen");
    let dest = dir.join(name);
    let partial = dest.with_extension(format!("{EXTENSION}.partial"));
    fs::copy(src, &partial)?;
    File::open(&partial)?.sync_all()?;
    if sha256_file(&partial)? != sha {
        let _ = fs::remove_file(&partial);
        return Err(Error::BackupCorrupt("Die zweite Kopie stimmt nicht mit dem Original überein.".into()));
    }
    fs::rename(&partial, &dest)?;
    Ok(dest)
}

/// Erlaubte Eintragsnamen im Archiv.
fn is_allowed_entry(name: &str) -> bool {
    if name == MANIFEST || name == DB_ENTRY {
        return true;
    }
    let parts: Vec<&str> = name.split('/').collect();
    parts.len() == 3
        && parts[0] == "files"
        && is_sha256_hex(parts[2])
        && parts[1] == &parts[2][..2]
}

fn read_manifest<R: Read + io::Seek>(zip: &mut ZipArchive<R>) -> Result<Manifest> {
    let mut f = zip
        .by_name(MANIFEST)
        .map_err(|_| Error::BackupCorrupt("Die Inhaltsliste (manifest.json) fehlt.".into()))?;
    if f.size() > 64 * 1024 * 1024 {
        return Err(Error::BackupCorrupt("Die Inhaltsliste ist unplausibel groß.".into()));
    }
    let mut s = String::new();
    f.read_to_string(&mut s)?;
    let m: Manifest = serde_json::from_str(&s)
        .map_err(|_| Error::BackupCorrupt("Die Inhaltsliste ist unlesbar.".into()))?;
    if m.format != "studium-os-backup" {
        return Err(Error::BackupCorrupt("Die Datei ist kein Studium-OS-Backup.".into()));
    }
    Ok(m)
}

/// Prüft ein Backup vollständig, ohne etwas zu verändern.
pub fn verify(path: &Path) -> Result<VerifyReport> {
    let mut report = VerifyReport {
        ok: false,
        created_at: None,
        schema_version: None,
        app_version: None,
        file_count: 0,
        total_size: 0,
        problems: vec![],
    };
    let file = File::open(path).map_err(|_| Error::not_found("Die Backup-Datei wurde nicht gefunden."))?;
    let mut zip = match ZipArchive::new(file) {
        Ok(z) => z,
        Err(_) => {
            report.problems.push("Die Datei ist kein lesbares Archiv (abgebrochen oder beschädigt).".into());
            return Ok(report);
        }
    };
    let manifest = match read_manifest(&mut zip) {
        Ok(m) => m,
        Err(e) => {
            report.problems.push(e.to_string());
            return Ok(report);
        }
    };
    report.created_at = Some(manifest.created_at.clone());
    report.schema_version = Some(manifest.schema_version);
    report.app_version = Some(manifest.app_version.clone());
    if manifest.format_version > FORMAT_VERSION {
        report.problems.push("Das Backup stammt von einer neueren Version von Studium OS.".into());
    }
    if manifest.schema_version > SCHEMA_VERSION {
        report.problems.push(format!(
            "Das Backup nutzt Datenbankschema {}, diese App kennt nur bis {}. Bitte App aktualisieren.",
            manifest.schema_version, SCHEMA_VERSION
        ));
    }

    let listed: HashSet<&str> = manifest.entries.iter().map(|e| e.path.as_str()).collect();
    for i in 0..zip.len() {
        let name = zip.by_index_raw(i)?.name()?.to_string();
        if !is_allowed_entry(&name) {
            report.problems.push(format!("Unerwarteter Eintrag im Archiv: {}", name.chars().take(80).collect::<String>()));
        } else if name != MANIFEST && !listed.contains(name.as_str()) {
            report.problems.push(format!("Eintrag nicht in der Inhaltsliste: {name}"));
        }
    }
    if !listed.contains(DB_ENTRY) {
        report.problems.push("Die Datenbank fehlt im Backup.".into());
    }
    for e in &manifest.entries {
        if !is_allowed_entry(&e.path) {
            report.problems.push("Die Inhaltsliste enthält einen ungültigen Pfad.".into());
            continue;
        }
        match zip.by_name(&e.path) {
            Err(_) => report.problems.push(format!("Fehlt im Archiv: {}", e.path)),
            Ok(mut f) => {
                match sha256_reader(&mut f) {
                    Ok((sha, n)) if n == e.size && sha == e.sha256 => {
                        report.total_size += n;
                    }
                    Ok(_) => report.problems.push(format!("Prüfsumme stimmt nicht: {}", e.path)),
                    Err(_) => report.problems.push(format!("Beschädigt, Prüfsumme stimmt nicht: {}", e.path)),
                }
            }
        }
    }
    report.file_count = manifest.entries.len().saturating_sub(1);

    // Datenbank prüfen, wenn bis hierhin alles stimmt.
    if report.problems.is_empty() {
        let tmp = std::env::temp_dir().join(format!("studium-verify-{}.sqlite", new_id()));
        let res = (|| -> Result<()> {
            let mut out = File::create(&tmp)?;
            io::copy(&mut zip.by_name(DB_ENTRY)?, &mut out)?;
            drop(out);
            let c = db::open_readonly(&tmp)?;
            db::integrity_check(&c)?;
            let v = db::schema_version(&c)?;
            if v != manifest.schema_version {
                return Err(Error::BackupCorrupt("Schemaversion passt nicht zur Inhaltsliste.".into()));
            }
            Ok(())
        })();
        let _ = fs::remove_file(&tmp);
        if let Err(e) = res {
            report.problems.push(e.to_string());
        }
    }
    report.ok = report.problems.is_empty();
    Ok(report)
}

/// Stellt ein Backup wieder her. **Die Datenbankverbindung der App muss vorher
/// geschlossen sein.** Danach `db::open` erneut aufrufen.
pub fn restore(path: &Path, data_dir: &Path) -> Result<RestoreResult> {
    let report = verify(path)?;
    if !report.ok {
        return Err(Error::BackupCorrupt(report.problems.join("; ")));
    }
    let staging = data_dir.join("tmp").join(format!("restore-{}", new_id()));
    fs::create_dir_all(staging.join("files"))?;

    let extract = (|| -> Result<()> {
        let mut zip = ZipArchive::new(File::open(path)?)?;
        let manifest = read_manifest(&mut zip)?;
        let expected: BTreeMap<&str, &ManifestEntry> = manifest.entries.iter().map(|e| (e.path.as_str(), e)).collect();
        for (name, entry) in expected {
            if !is_allowed_entry(name) {
                return Err(Error::BackupCorrupt("Ungültiger Pfad im Backup.".into()));
            }
            // Zielpfad nur aus geprüften Bestandteilen zusammensetzen.
            let dest = if name == DB_ENTRY {
                staging.join(DB_FILE)
            } else {
                let sha = &name[name.len() - 64..];
                let d = staging.join("files").join(&sha[..2]);
                fs::create_dir_all(&d)?;
                d.join(sha)
            };
            let mut out = File::create(&dest)?;
            let mut h = Sha256::new();
            let mut src = zip.by_name(name)?;
            let mut buf = vec![0u8; 256 * 1024];
            loop {
                let k = src.read(&mut buf)?;
                if k == 0 {
                    break;
                }
                h.update(&buf[..k]);
                out.write_all(&buf[..k])?;
            }
            out.sync_all()?;
            if hex::encode(h.finalize()) != entry.sha256 {
                return Err(Error::BackupCorrupt(format!("Prüfsumme stimmt beim Entpacken nicht: {name}")));
            }
        }
        Ok(())
    })();
    if let Err(e) = extract {
        let _ = fs::remove_dir_all(&staging);
        return Err(e);
    }

    // Aktuellen Stand beiseitelegen, dann austauschen.
    let previous = data_dir.join(format!("pre-restore-{}", file_stamp()));
    fs::create_dir_all(&previous)?;
    let movable = [DB_FILE.to_string(), format!("{DB_FILE}-wal"), format!("{DB_FILE}-shm"), "files".to_string()];
    let mut moved: Vec<String> = Vec::new();
    let swap = (|| -> Result<()> {
        for name in &movable {
            let p = data_dir.join(name);
            if p.exists() {
                fs::rename(&p, previous.join(name))?;
                moved.push(name.clone());
            }
        }
        fs::rename(staging.join(DB_FILE), data_dir.join(DB_FILE))?;
        fs::rename(staging.join("files"), data_dir.join("files"))?;
        Ok(())
    })();
    if let Err(e) = swap {
        // Zurückrollen: alten Stand wieder an seinen Platz.
        let _ = fs::remove_file(data_dir.join(DB_FILE));
        for name in &moved {
            let _ = fs::rename(previous.join(name), data_dir.join(name));
        }
        let _ = fs::remove_dir_all(&staging);
        return Err(Error::invalid(format!(
            "Die Wiederherstellung ist fehlgeschlagen. Dein bisheriger Stand wurde zurückgelegt. ({e})"
        )));
    }
    let _ = fs::remove_dir_all(&staging);
    Ok(RestoreResult { previous_state_dir: previous.to_string_lossy().into(), created_at: report.created_at.unwrap_or_default() })
}

/// Löscht ältere **automatische** Backups in `dir`, sodass `keep` übrig bleiben.
/// Manuelle Backups werden nie automatisch gelöscht.
pub fn prune_auto(dir: &Path, keep: usize) -> Result<usize> {
    let mut autos: Vec<PathBuf> = fs::read_dir(dir)?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| {
            p.file_name().and_then(|n| n.to_str()).is_some_and(|n| {
                n.starts_with("Studium-OS-Auto-Backup-") && n.ends_with(&format!(".{EXTENSION}"))
            })
        })
        .collect();
    autos.sort();
    let mut removed = 0;
    while autos.len() > keep.max(1) {
        let p = autos.remove(0);
        fs::remove_file(&p)?;
        removed += 1;
    }
    Ok(removed)
}

/// Merkt sich ein erstelltes Backup in der Datenbank.
pub fn record(conn: &rusqlite::Connection, info: &BackupInfo, status: &str, message: Option<&str>) -> Result<()> {
    conn.execute(
        "INSERT INTO backups (id, path, created_at, size, sha256, kind, status, message) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
        rusqlite::params![new_id(), info.path, info.created_at, info.size as i64, info.sha256, info.kind, status, message],
    )?;
    Ok(())
}

#[derive(Debug, Serialize, Clone)]
pub struct BackupRecord {
    pub path: String,
    pub created_at: String,
    pub size: i64,
    pub kind: String,
    pub status: String,
    pub message: Option<String>,
    pub exists: bool,
}

pub fn history(conn: &rusqlite::Connection, limit: i64) -> Result<Vec<BackupRecord>> {
    let mut stmt = conn.prepare(
        "SELECT path, created_at, size, kind, status, message FROM backups ORDER BY created_at DESC LIMIT ?1",
    )?;
    let rows = stmt.query_map([limit], |r| {
        let path: String = r.get(0)?;
        Ok(BackupRecord {
            exists: Path::new(&path).is_file(),
            path,
            created_at: r.get(1)?,
            size: r.get(2)?,
            kind: r.get(3)?,
            status: r.get(4)?,
            message: r.get(5)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn entry_names_are_restricted() {
        let sha = "ab".to_string() + &"0".repeat(62);
        assert!(is_allowed_entry(&format!("files/ab/{sha}")));
        assert!(!is_allowed_entry(&format!("files/cd/{sha}")));
        assert!(!is_allowed_entry("../studium.sqlite"));
        assert!(!is_allowed_entry("files/ab/../../x"));
        assert!(!is_allowed_entry("/etc/passwd"));
    }
}
