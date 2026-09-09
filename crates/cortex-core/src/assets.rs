//! Assets: the files under `assets/` that notes reference by relative path
//! (`![alt](assets/pic.png)`, `<video src="assets/clip.mp4">`,
//! `[Spec](assets/spec.pdf)`, a `cover:` or `icon:` value).
//!
//! Two things live here so the app, the CLI and MCP agree: the MIME type an
//! asset is served with (the app reads assets as `data:` URIs, so a wrong
//! label means a video shown as a broken image), and the reference scan
//! behind `cortex assets --unused`. Nothing is stored and nothing is deleted:
//! the report is computed from the files every time it is asked for.

use serde::{Deserialize, Serialize};
use std::path::Path;
use walkdir::WalkDir;

use crate::error::Result;
use crate::vault;

/// MIME type for an asset, from its extension. Anything unknown is
/// `application/octet-stream` — a browser will offer it for download rather
/// than mis-render it.
pub fn mime_for_path(path: &str) -> &'static str {
    let ext = Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();
    match ext.as_str() {
        // images
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "avif" => "image/avif",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        "tif" | "tiff" => "image/tiff",
        // video
        "mp4" | "m4v" => "video/mp4",
        "webm" => "video/webm",
        "ogv" => "video/ogg",
        "mov" => "video/quicktime",
        "mkv" => "video/x-matroska",
        "avi" => "video/x-msvideo",
        // audio
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "ogg" | "oga" => "audio/ogg",
        "m4a" => "audio/mp4",
        "aac" => "audio/aac",
        "flac" => "audio/flac",
        "opus" => "audio/opus",
        "weba" => "audio/webm",
        // documents and text
        "pdf" => "application/pdf",
        "json" => "application/json",
        "zip" => "application/zip",
        "txt" | "log" => "text/plain",
        "md" | "markdown" => "text/markdown",
        "csv" => "text/csv",
        "html" | "htm" => "text/html",
        "css" => "text/css",
        "xml" => "application/xml",
        "yaml" | "yml" => "application/yaml",
        _ => "application/octet-stream",
    }
}

/// One file under `assets/` and how many notes mention it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AssetEntry {
    /// Vault-relative path, `assets/...`.
    pub path: String,
    pub size: u64,
    pub mime: String,
    /// Notes (any `.md` in the vault, the trash included) whose text mentions
    /// the path — by relative path in any form, or as a `[[file.ext]]` embed.
    pub references: usize,
}

/// Every file under `assets/` (sub-folders included) with its reference
/// count, sorted by path. A count of 0 means no note mentions the file: the
/// `cortex assets --unused` report. Nothing is deleted here or anywhere else.
pub fn list_assets(root: &Path) -> Result<Vec<AssetEntry>> {
    let dir = root.join("assets");
    if !dir.is_dir() {
        return Ok(Vec::new());
    }

    let mut entries: Vec<AssetEntry> = WalkDir::new(&dir)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .filter(|e| !e.path().components().any(|c| vault::is_hidden_component(&c)))
        .map(|e| {
            let rel = e.path().strip_prefix(root).unwrap_or(e.path()).to_string_lossy().replace('\\', "/");
            let size = e.metadata().map(|m| m.len()).unwrap_or(0);
            AssetEntry { mime: mime_for_path(&rel).to_string(), path: rel, size, references: 0 }
        })
        .collect();
    entries.sort_by(|a, b| a.path.cmp(&b.path));
    if entries.is_empty() {
        return Ok(entries);
    }

    // The trash is walked too: a soft-deleted note still holds its assets,
    // so restoring it never brings back a broken image.
    for note in WalkDir::new(root)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().and_then(|s| s.to_str()) == Some("md"))
        .filter(|e| !e.path().components().any(|c| vault::is_hidden_component(&c) && c.as_os_str() != ".trash"))
    {
        let Ok(content) = std::fs::read_to_string(note.path()) else { continue };
        for a in entries.iter_mut() {
            if references_asset(&content, &a.path) {
                a.references += 1;
            }
        }
    }
    Ok(entries)
}

/// Does a note's text mention `rel` (an `assets/...` path)? Any form counts:
/// a Markdown image or link, an HTML `src`, a frontmatter value, the
/// URL-encoded spelling a browser writes, or an Obsidian `[[file.ext]]`
/// embed of the bare filename.
pub fn references_asset(content: &str, rel: &str) -> bool {
    if content.contains(rel) {
        return true;
    }
    let encoded = rel.replace(' ', "%20");
    if encoded != rel && content.contains(&encoded) {
        return true;
    }
    match rel.rsplit('/').next() {
        Some(name) if !name.is_empty() => content.contains(&format!("[[{name}]]")) || content.contains(&format!("[[{name}|")),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mime_table_covers_every_kind_and_falls_back() {
        assert_eq!(mime_for_path("assets/pic.png"), "image/png");
        assert_eq!(mime_for_path("assets/PHOTO.JPG"), "image/jpeg");
        assert_eq!(mime_for_path("assets/anim.gif"), "image/gif");
        assert_eq!(mime_for_path("assets/logo.svg"), "image/svg+xml");
        assert_eq!(mime_for_path("assets/clip.mp4"), "video/mp4");
        assert_eq!(mime_for_path("assets/clip.webm"), "video/webm");
        assert_eq!(mime_for_path("assets/clip.mov"), "video/quicktime");
        assert_eq!(mime_for_path("assets/song.mp3"), "audio/mpeg");
        assert_eq!(mime_for_path("assets/voice.m4a"), "audio/mp4");
        assert_eq!(mime_for_path("assets/take.wav"), "audio/wav");
        assert_eq!(mime_for_path("assets/spec.pdf"), "application/pdf");
        assert_eq!(mime_for_path("assets/notes.txt"), "text/plain");
        assert_eq!(mime_for_path("assets/data.csv"), "text/csv");
        assert_eq!(mime_for_path("assets/readme.md"), "text/markdown");
        assert_eq!(mime_for_path("assets/archive.zip"), "application/zip");
        assert_eq!(mime_for_path("assets/blob.xyz"), "application/octet-stream");
        assert_eq!(mime_for_path("assets/noext"), "application/octet-stream");
    }

    #[test]
    fn reference_forms() {
        let rel = "assets/pic one.png";
        assert!(references_asset("![](assets/pic one.png)", rel));
        assert!(references_asset("<img src=\"assets/pic%20one.png\">", rel));
        assert!(references_asset("cover: assets/pic one.png", rel));
        assert!(references_asset("see ![[pic one.png]] here", rel));
        assert!(references_asset("see [[pic one.png|the pic]] here", rel));
        assert!(!references_asset("![](assets/pic.png)", rel));
        assert!(!references_asset("[[pic one]]", rel));
        assert!(references_asset("<video src=\"assets/clip.mp4\" controls></video>", "assets/clip.mp4"));
        assert!(references_asset("[Spec](assets/spec.pdf)", "assets/spec.pdf"));
    }

    fn scratch(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("cortex-assets-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn list_assets_counts_references_and_reports_orphans() {
        let dir = scratch("refs");
        let root = dir.as_path();
        let w = |p: &str, s: &str| {
            let path = root.join(p);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, s).unwrap();
        };
        w("assets/pic.png", "PNG");
        w("assets/clip.mp4", "MP4MP4");
        w("assets/spec.pdf", "PDF");
        w("assets/orphan.bin", "?");
        w("assets/sub/deep.wav", "WAV");
        w("assets/trashed.png", "PNG");
        w("notes/a.md", "---\ntitle: A\ncover: assets/pic.png\n---\n\n![pic](assets/pic.png)\n\n<figure><video src=\"assets/clip.mp4\" controls></video><figcaption>c</figcaption></figure>\n");
        w("notes/b.md", "---\ntitle: B\n---\n\n[Spec](assets/spec.pdf) and <audio src=\"assets/sub/deep.wav\" controls></audio> and ![pic](assets/pic.png)\n");
        w(".trash/old.md", "---\ntitle: Old\n---\n\n![](assets/trashed.png)\n");
        w(".brain/cache.md", "assets/orphan.bin");

        let got = list_assets(root).unwrap();
        let by: std::collections::BTreeMap<&str, &AssetEntry> = got.iter().map(|a| (a.path.as_str(), a)).collect();
        assert_eq!(got.len(), 6);
        assert_eq!(by["assets/pic.png"].references, 2);
        assert_eq!(by["assets/clip.mp4"].references, 1);
        assert_eq!(by["assets/clip.mp4"].mime, "video/mp4");
        assert_eq!(by["assets/clip.mp4"].size, 6);
        assert_eq!(by["assets/spec.pdf"].references, 1);
        assert_eq!(by["assets/sub/deep.wav"].references, 1);
        assert_eq!(by["assets/trashed.png"].references, 1, "a trashed note still holds its asset");
        assert_eq!(by["assets/orphan.bin"].references, 0, ".brain/ is a cache, not a referrer");

        let unused: Vec<&str> = got.iter().filter(|a| a.references == 0).map(|a| a.path.as_str()).collect();
        assert_eq!(unused, vec!["assets/orphan.bin"]);
        assert!(root.join("assets/orphan.bin").exists(), "the report never deletes");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn no_assets_dir_is_empty() {
        let dir = scratch("empty");
        assert!(list_assets(&dir).unwrap().is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
