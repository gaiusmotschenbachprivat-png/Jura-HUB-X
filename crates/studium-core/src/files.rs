//! Lokaler, inhaltsadressierter Dokumentenspeicher und sichere Dateinamen.
//!
//! Jede Datei liegt unter `files/<erste 2 Hex-Zeichen>/<SHA-256>`. Benutzerdateinamen
//! werden nie als Pfad verwendet. Dateien im Speicher werden nie verändert.

use std::fs::{self, File};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

use crate::util::new_id;
use crate::{Error, Result};

pub const MAX_IMPORT_BYTES: u64 = 500 * 1024 * 1024;

/// Dateiendungen, die importiert werden dürfen, mit MIME-Typ.
pub const ALLOWED: &[(&str, &str)] = &[
    ("pdf", "application/pdf"),
    ("docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    ("doc", "application/msword"),
    ("pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"),
    ("xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
    ("odt", "application/vnd.oasis.opendocument.text"),
    ("txt", "text/plain"),
    ("md", "text/markdown"),
    ("markdown", "text/markdown"),
    ("png", "image/png"),
    ("jpg", "image/jpeg"),
    ("jpeg", "image/jpeg"),
    ("gif", "image/gif"),
    ("webp", "image/webp"),
];

pub fn mime_for(ext: &str) -> Option<&'static str> {
    ALLOWED.iter().find(|(e, _)| *e == ext).map(|(_, m)| *m)
}

pub fn extension_of(path: &Path) -> String {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default()
}

pub fn is_sha256_hex(s: &str) -> bool {
    s.len() == 64 && s.chars().all(|c| c.is_ascii_digit() || ('a'..='f').contains(&c))
}

#[derive(Debug, Clone)]
pub struct BlobStore {
    root: PathBuf,
    tmp: PathBuf,
}

#[derive(Debug, Clone)]
pub struct StoredBlob {
    pub sha256: String,
    pub size: u64,
    pub mime: &'static str,
    pub ext: String,
}

impl BlobStore {
    pub fn new(data_dir: &Path) -> Result<Self> {
        let s = BlobStore { root: data_dir.join("files"), tmp: data_dir.join("tmp") };
        fs::create_dir_all(&s.root)?;
        fs::create_dir_all(&s.tmp)?;
        Ok(s)
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn tmp_dir(&self) -> &Path {
        &self.tmp
    }

    /// Entfernt Reste abgebrochener Vorgänge (beim Start aufgerufen).
    pub fn clean_tmp(&self) -> Result<()> {
        for e in fs::read_dir(&self.tmp)? {
            let p = e?.path();
            let _ = if p.is_dir() { fs::remove_dir_all(&p) } else { fs::remove_file(&p) };
        }
        Ok(())
    }

    pub fn path_for(&self, sha: &str) -> Result<PathBuf> {
        if !is_sha256_hex(sha) {
            return Err(Error::invalid("Ungültige Dateikennung."));
        }
        Ok(self.root.join(&sha[..2]).join(sha))
    }

    pub fn exists(&self, sha: &str) -> bool {
        self.path_for(sha).map(|p| p.is_file()).unwrap_or(false)
    }

    /// Kopiert eine Datei in den Speicher. Die Quelle wird nur gelesen.
    pub fn import(&self, src: &Path) -> Result<StoredBlob> {
        let ext = extension_of(src);
        let mime = mime_for(&ext).ok_or_else(|| {
            Error::invalid(format!(
                "Dateityp „.{ext}“ wird nicht unterstützt. Erlaubt sind PDF, Word, PowerPoint, Excel, Text, Markdown und Bilder."
            ))
        })?;
        let meta = fs::metadata(src)
            .map_err(|_| Error::not_found("Die Datei wurde nicht gefunden oder ist nicht lesbar."))?;
        if !meta.is_file() {
            return Err(Error::invalid("Nur einzelne Dateien können importiert werden, keine Ordner."));
        }
        if meta.len() > MAX_IMPORT_BYTES {
            return Err(Error::invalid("Die Datei ist größer als 500 MB und wurde nicht importiert."));
        }
        let mut input = File::open(src)?;
        let mut head = [0u8; 8];
        let n = read_up_to(&mut input, &mut head)?;
        if ext == "pdf" && !head[..n].starts_with(b"%PDF-") {
            return Err(Error::invalid("Die Datei endet auf .pdf, ist aber keine gültige PDF-Datei."));
        }
        let tmp_path = self.tmp.join(format!("import-{}", new_id()));
        let result = (|| -> Result<StoredBlob> {
            let mut out = File::create(&tmp_path)?;
            let mut hasher = Sha256::new();
            hasher.update(&head[..n]);
            out.write_all(&head[..n])?;
            let mut size = n as u64;
            let mut buf = vec![0u8; 256 * 1024];
            loop {
                let k = input.read(&mut buf)?;
                if k == 0 {
                    break;
                }
                hasher.update(&buf[..k]);
                out.write_all(&buf[..k])?;
                size += k as u64;
                if size > MAX_IMPORT_BYTES {
                    return Err(Error::invalid("Die Datei ist größer als 500 MB und wurde nicht importiert."));
                }
            }
            out.sync_all()?;
            let sha = hex::encode(hasher.finalize());
            let dest = self.path_for(&sha)?;
            if dest.is_file() {
                fs::remove_file(&tmp_path)?;
            } else {
                fs::create_dir_all(dest.parent().expect("Pfad hat einen Ordner"))?;
                fs::rename(&tmp_path, &dest)?;
                set_readonly(&dest);
            }
            Ok(StoredBlob { sha256: sha, size, mime, ext: ext.clone() })
        })();
        if result.is_err() {
            let _ = fs::remove_file(&tmp_path);
        }
        result
    }

    pub fn read(&self, sha: &str) -> Result<Vec<u8>> {
        let p = self.path_for(sha)?;
        fs::read(&p).map_err(|e| match e.kind() {
            io::ErrorKind::NotFound => Error::not_found(
                "Die Datei fehlt im Dokumentenspeicher. Stelle sie aus einem Backup wieder her.",
            ),
            _ => Error::Io(e),
        })
    }

    pub fn remove(&self, sha: &str) -> Result<()> {
        let p = self.path_for(sha)?;
        if p.is_file() {
            let mut perm = fs::metadata(&p)?.permissions();
            #[allow(clippy::permissions_set_readonly_false)]
            perm.set_readonly(false);
            let _ = fs::set_permissions(&p, perm);
            fs::remove_file(&p)?;
        }
        Ok(())
    }

    /// Kopiert eine gespeicherte Datei an einen Zielpfad (Export/„Mit … öffnen“).
    pub fn copy_out(&self, sha: &str, dest: &Path) -> Result<()> {
        let src = self.path_for(sha)?;
        if !src.is_file() {
            return Err(Error::not_found(
                "Die Datei fehlt im Dokumentenspeicher. Stelle sie aus einem Backup wieder her.",
            ));
        }
        fs::copy(&src, dest)?;
        let mut perm = fs::metadata(dest)?.permissions();
        #[allow(clippy::permissions_set_readonly_false)]
        perm.set_readonly(false);
        fs::set_permissions(dest, perm)?;
        Ok(())
    }
}

fn read_up_to(r: &mut impl Read, buf: &mut [u8]) -> io::Result<usize> {
    let mut n = 0;
    while n < buf.len() {
        let k = r.read(&mut buf[n..])?;
        if k == 0 {
            break;
        }
        n += k;
    }
    Ok(n)
}

fn set_readonly(p: &Path) {
    if let Ok(meta) = fs::metadata(p) {
        let mut perm = meta.permissions();
        perm.set_readonly(true);
        let _ = fs::set_permissions(p, perm);
    }
}

pub fn sha256_file(p: &Path) -> Result<String> {
    let mut f = File::open(p)?;
    let (sha, _) = sha256_reader(&mut f)?;
    Ok(sha)
}

/// SHA-256 und Länge eines Datenstroms.
pub fn sha256_reader(r: &mut impl Read) -> io::Result<(String, u64)> {
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 256 * 1024];
    let mut n = 0u64;
    loop {
        let k = r.read(&mut buf)?;
        if k == 0 {
            break;
        }
        h.update(&buf[..k]);
        n += k as u64;
    }
    Ok((hex::encode(h.finalize()), n))
}

const RESERVED_WIN: &[&str] = &[
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
    "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// Macht aus einem Titel einen Dateinamen, der unter macOS und Windows gültig ist.
pub fn sanitize_filename(name: &str) -> String {
    let mut s: String = name
        .chars()
        .map(|c| if c.is_control() || "/\\:*?\"<>|".contains(c) { '_' } else { c })
        .collect();
    s = s.trim().trim_start_matches('.').trim_end_matches(['.', ' ']).to_string();
    if s.is_empty() {
        s = "Unbenannt".into();
    }
    let stem = s.split('.').next().unwrap_or("").to_ascii_uppercase();
    if RESERVED_WIN.contains(&stem.as_str()) {
        s = format!("_{s}");
    }
    s.chars().take(120).collect()
}

/// Liefert einen freien Pfad `dir/name.ext`, ggf. `name (2).ext` usw.
pub fn unique_path(dir: &Path, name: &str, ext: &str) -> PathBuf {
    let base = sanitize_filename(name);
    let mut p = dir.join(format!("{base}.{ext}"));
    let mut i = 2;
    while p.exists() {
        p = dir.join(format!("{base} ({i}).{ext}"));
        i += 1;
    }
    p
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filenames_are_safe() {
        assert_eq!(sanitize_filename("../../etc/passwd"), "_.._etc_passwd");
        assert_eq!(sanitize_filename("CON"), "_CON");
        assert_eq!(sanitize_filename("  "), "Unbenannt");
        assert_eq!(sanitize_filename("BGB AT: Termin 3?"), "BGB AT_ Termin 3_");
        assert_eq!(sanitize_filename(".versteckt"), "versteckt");
    }

    #[test]
    fn rejects_bad_sha() {
        let d = tempfile::tempdir().unwrap();
        let s = BlobStore::new(d.path()).unwrap();
        assert!(s.path_for("../x").is_err());
        assert!(s.path_for(&"a".repeat(64)).is_ok());
    }
}
