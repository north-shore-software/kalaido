use serde::Serialize;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

/// Reads a file off disk and returns its raw bytes to the frontend as an
/// ArrayBuffer (via `ipc::Response`, avoiding base64 bloat). Used by the data
/// import flow to upload a user-selected file to a cloud kalaidoscope's remote backend
/// (local kalaidoscopes pass the path to the sidecar instead, which reads it directly).
#[tauri::command]
pub(crate) fn read_file_bytes(path: String) -> Result<tauri::ipc::Response, String> {
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// The detected kind of a single leaf file. Containers (directories, zip
/// archives) are never reported as a kind — they are expanded into their
/// contents — so the only values are these three leaves. Mirrors the sidecar's
/// import contract (see `open/kalaidoscope/internal/ingest/ingest.go`).
#[derive(Serialize, Clone, Copy, PartialEq, Debug)]
#[serde(rename_all = "lowercase")]
enum FileKind {
    Text,
    /// A Word document (a zip whose body lives in `word/document.xml`).
    Docx,
    Other,
}

#[derive(Serialize)]
pub(crate) struct FileEntry {
    /// Full filesystem path for an on-disk file, or `"<archive>!<entry>"` for a
    /// file living inside a zip/docx-style archive. The archive form is an
    /// enumeration identifier only — it is not openable by `read_file_bytes`.
    path: String,
    kind: FileKind,
}

/// How deeply we descend into nested archives (a zip inside a zip inside …).
/// Guards against zip bombs and pathological nesting. Filesystem directory
/// recursion is not capped (symlinks are skipped, so it can't cycle), but
/// archive nesting beyond this depth is reported as `other` rather than walked.
const MAX_ARCHIVE_DEPTH: usize = 16;

const SAMPLE_SIZE: usize = 8192;

/// Walks `path` — a file *or* a directory — and returns a flat list of every
/// leaf file with its detected type. Directories and zip archives are expanded
/// (a zip is treated like a directory); a docx is reported as a single `docx`
/// leaf, not expanded. Always returns a list (a lone text file yields one
/// element). Best-effort: unreadable children are skipped; only a missing
/// top-level path is a hard error.
#[tauri::command]
pub(crate) fn classify_path(path: String) -> Result<Vec<FileEntry>, String> {
    let mut out = Vec::new();
    classify_fs(Path::new(&path), &mut out)?;
    Ok(out)
}

fn classify_fs(path: &Path, out: &mut Vec<FileEntry>) -> Result<(), String> {
    let meta = std::fs::metadata(path).map_err(|e| e.to_string())?;
    if !meta.is_dir() {
        let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
        classify_reader(file, path.to_string_lossy().into_owned(), out, 0);
        return Ok(());
    }

    // Read the root directory here so a failure to read the top-level
    // directory surfaces as an error immediately (children below are walked
    // best-effort and swallow their own errors).
    let _ = std::fs::read_dir(path).map_err(|e| e.to_string())?;

    let mut stack = vec![path.to_path_buf()];

    while let Some(current) = stack.pop() {
        let entries = match std::fs::read_dir(&current) {
            Ok(dir) => dir,
            Err(_) => continue,
        };

        let mut valid_entries: Vec<_> = entries.filter_map(|r| r.ok()).collect();
        // Sort in reverse order so we pop them in lexicographical order.
        valid_entries.sort_by_key(|e| std::cmp::Reverse(e.file_name()));

        for entry in valid_entries {
            match entry.file_type() {
                Ok(ft) if ft.is_symlink() => continue,
                Err(_) => continue,
                Ok(ft) => {
                    let entry_path = entry.path();
                    if ft.is_dir() {
                        stack.push(entry_path);
                    } else if let Ok(file) = std::fs::File::open(&entry_path) {
                        classify_reader(file, entry_path.to_string_lossy().into_owned(), out, 0);
                    }
                }
            }
        }
    }

    Ok(())
}

fn classify_reader<R: Read + Seek>(
    mut reader: R,
    display: String,
    out: &mut Vec<FileEntry>,
    depth: usize,
) {
    let mut magic = [0u8; 4];
    let n = read_up_to(&mut reader, &mut magic);

    if n == 4 && is_zip_signature(&magic) {
        // If the signature matched but the archive won't open (truncated /
        // corrupt), `reader` was consumed — fall through to `other`.
        if depth <= MAX_ARCHIVE_DEPTH
            && reader.seek(SeekFrom::Start(0)).is_ok()
            && let Ok(mut archive) = zip::ZipArchive::new(reader)
        {
            expand_archive(&mut archive, &display, out, depth);
            return;
        }
        out.push(FileEntry {
            path: display,
            kind: FileKind::Other,
        });
        return;
    }

    let mut sample = vec![0u8; SAMPLE_SIZE];
    let read = if reader.seek(SeekFrom::Start(0)).is_ok() {
        read_up_to(&mut reader, &mut sample)
    } else {
        // Non-seekable shouldn't happen here, but degrade to the magic bytes.
        magic
            .iter()
            .take(n)
            .enumerate()
            .for_each(|(i, b)| sample[i] = *b);
        n
    };
    sample.truncate(read);

    let kind = if looks_like_text(&sample) {
        FileKind::Text
    } else {
        FileKind::Other
    };
    out.push(FileEntry {
        path: display,
        kind,
    });
}

fn expand_archive<R: Read + Seek>(
    archive: &mut zip::ZipArchive<R>,
    display: &str,
    out: &mut Vec<FileEntry>,
    depth: usize,
) {
    // A Word document is a zip whose body lives in word/document.xml — matches
    // the sidecar's parseDocx contract. Treat it as a single leaf.
    if archive.by_name("word/document.xml").is_ok() {
        out.push(FileEntry {
            path: display.to_string(),
            kind: FileKind::Docx,
        });
        return;
    }

    for i in 0..archive.len() {
        let (name, bytes) = match archive.by_index(i) {
            Ok(mut entry) => {
                if entry.is_dir() {
                    continue;
                }
                let name = entry.name().to_string();
                let mut bytes = Vec::new();
                if entry.read_to_end(&mut bytes).is_err() {
                    continue;
                }
                (name, bytes)
            }
            Err(_) => continue,
        };
        let child = format!("{display}!{name}");
        classify_reader(std::io::Cursor::new(bytes), child, out, depth + 1);
    }
}

/// True for the local-file-header, empty-archive, and spanned-archive zip
/// signatures. A docx is a zip, so it matches here too and is disambiguated by
/// [`expand_archive`].
fn is_zip_signature(magic: &[u8; 4]) -> bool {
    matches!(magic, b"PK\x03\x04" | b"PK\x05\x06" | b"PK\x07\x08")
}

fn read_up_to<R: Read>(r: &mut R, buf: &mut [u8]) -> usize {
    let mut total = 0;
    while total < buf.len() {
        match r.read(&mut buf[total..]) {
            Ok(0) => break,
            Ok(n) => total += n,
            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(_) => break,
        }
    }
    total
}

/// Heuristic "does this look like UTF-8 or something similar?" An empty sample
/// is text; an embedded NUL byte means binary; otherwise valid UTF-8 (or a
/// sample merely truncated mid-character) is text, and as a last resort a low
/// ratio of control bytes accepts Latin-1-ish text while rejecting binaries.
fn looks_like_text(sample: &[u8]) -> bool {
    if sample.is_empty() {
        return true;
    }
    if sample.contains(&0) {
        return false;
    }
    match std::str::from_utf8(sample) {
        Ok(_) => true,
        Err(e) => {
            // A multi-byte char chopped off at the sample boundary is fine.
            if e.error_len().is_none() && e.valid_up_to() >= sample.len().saturating_sub(3) {
                return true;
            }
            let bad = sample.iter().filter(|&&b| is_control_byte(b)).count();
            (bad as f64) / (sample.len() as f64) < 0.30
        }
    }
}

/// Control bytes that don't appear in normal text. Common whitespace is
/// excluded; high bytes (0x80–0xFF) are treated as text-ish (Latin-1, UTF-8).
fn is_control_byte(b: u8) -> bool {
    match b {
        b'\t' | b'\n' | b'\r' | 0x0C => false,
        0x00..=0x1F | 0x7F => true,
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn build_zip(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut cursor = std::io::Cursor::new(Vec::new());
        {
            let mut zw = zip::ZipWriter::new(&mut cursor);
            let opts = zip::write::SimpleFileOptions::default();
            for (name, data) in entries {
                zw.start_file(*name, opts).unwrap();
                zw.write_all(data).unwrap();
            }
            zw.finish().unwrap();
        }
        cursor.into_inner()
    }

    fn temp_path(suffix: &str) -> std::path::PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("kalaido_files_test_{nanos}{suffix}"))
    }

    fn classify(bytes: &[u8], suffix: &str) -> Vec<FileEntry> {
        let path = temp_path(suffix);
        std::fs::write(&path, bytes).unwrap();
        let out = classify_path(path.to_string_lossy().into_owned()).unwrap();
        let _ = std::fs::remove_file(&path);
        out
    }

    #[test]
    fn detects_text_and_binary() {
        let text = classify(b"hello, world\nsecond line", ".txt");
        assert_eq!(text.len(), 1);
        assert_eq!(text[0].kind, FileKind::Text);

        let binary = classify(&[0x00, 0x01, 0x02, 0xFF, 0xFE, 0x00], ".bin");
        assert_eq!(binary.len(), 1);
        assert_eq!(binary[0].kind, FileKind::Other);
    }

    #[test]
    fn looks_like_text_cases() {
        assert!(looks_like_text(b""));
        assert!(looks_like_text("plain ascii".as_bytes()));
        assert!(looks_like_text("café résumé — über".as_bytes()));
        assert!(looks_like_text(&[b'c', b'a', b'f', 0xE9])); // Latin-1 "café"
        assert!(!looks_like_text(&[b'h', b'i', 0x00, b'x']));
    }

    #[test]
    fn expands_zip_and_detects_nested_docx() {
        let docx = build_zip(&[("word/document.xml", b"<w:document/>")]);
        let outer = build_zip(&[
            ("notes/a.txt", b"hello world" as &[u8]),
            ("doc.docx", &docx),
        ]);

        let out = classify(&outer, ".zip");
        assert_eq!(out.len(), 2, "zip should expand to two leaves");

        let txt = out
            .iter()
            .find(|e| e.path.ends_with("!notes/a.txt"))
            .unwrap();
        assert_eq!(txt.kind, FileKind::Text);

        let doc = out.iter().find(|e| e.path.ends_with("!doc.docx")).unwrap();
        assert_eq!(
            doc.kind,
            FileKind::Docx,
            "nested docx detected via word/document.xml"
        );
    }

    #[test]
    fn top_level_docx_is_a_single_leaf() {
        let docx = build_zip(&[("word/document.xml", b"<w:document/>")]);
        let out = classify(&docx, ".docx");
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].kind, FileKind::Docx);
    }

    #[test]
    fn walks_a_directory_recursively() {
        let dir = temp_path("_dir");
        std::fs::create_dir_all(dir.join("sub")).unwrap();
        std::fs::write(dir.join("top.txt"), b"top").unwrap();
        std::fs::write(dir.join("sub/nested.md"), b"# nested").unwrap();

        let out = classify_path(dir.to_string_lossy().into_owned()).unwrap();
        let _ = std::fs::remove_dir_all(&dir);

        assert_eq!(out.len(), 2);
        assert!(out.iter().all(|e| e.kind == FileKind::Text));
        assert!(out.iter().any(|e| e.path.ends_with("top.txt")));
        assert!(out.iter().any(|e| e.path.ends_with("nested.md")));
    }

    #[test]
    fn missing_path_errors() {
        assert!(classify_path("/no/such/path/here".into()).is_err());
    }
}
