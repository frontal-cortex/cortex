use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::Path;

/// Parsed representation of a markdown note with YAML frontmatter.
///
/// BTreeMap keeps keys in alphabetical order so every serialization produces
/// the same output — critical for clean, readable git diffs.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Note {
    pub path: String,
    pub frontmatter: BTreeMap<String, serde_json::Value>,
    pub body: String,
}

/// Lightweight note entry for list views — no body content.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NoteEntry {
    pub path: String,
    pub title: String,
    pub note_type: Option<String>,
    pub tags: Vec<String>,
    pub modified: u64,
    pub icon: Option<String>,
    /// Frontmatter `parent:` — a collection name or a `notes/<folder>` path.
    /// A collection's page nests under it in the sidebar, the way a child
    /// database sits inside a page; rows never move on disk.
    pub parent: Option<String>,
}

fn split_frontmatter(content: &str) -> (Option<&str>, &str) {
    let content = content.trim_start();
    if !content.starts_with("---") {
        return (None, content);
    }
    let after_open = &content[3..];
    if let Some(close) = after_open.find("\n---") {
        let yaml = &after_open[..close];
        let body = &after_open[close + 4..];
        (Some(yaml), body.trim_start())
    } else {
        (None, content)
    }
}

pub fn parse_note(path: &str, content: &str) -> crate::error::Result<Note> {
    let (yaml_str, body) = split_frontmatter(content);

    let frontmatter: BTreeMap<String, serde_json::Value> = match yaml_str {
        Some(y) => serde_yaml::from_str(y)?,
        None => BTreeMap::new(),
    };

    Ok(Note {
        path: path.to_string(),
        frontmatter,
        body: body.to_string(),
    })
}

pub fn serialize_note(note: &Note) -> crate::error::Result<String> {
    let mut out = String::new();

    if !note.frontmatter.is_empty() {
        out.push_str("---\n");
        out.push_str(&serde_yaml::to_string(&note.frontmatter)?);
        out.push_str("---\n\n");
    }

    out.push_str(&note.body);
    Ok(out)
}

pub fn infer_title(note: &Note) -> String {
    if let Some(v) = note.frontmatter.get("title") {
        if let Some(s) = v.as_str() {
            return s.to_string();
        }
    }
    Path::new(&note.path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Untitled")
        .to_string()
}

/// Extract all [[wiki link]] targets from a body string without a regex dep.
pub fn extract_wiki_links(body: &str) -> Vec<String> {
    let mut links = Vec::new();
    let bytes = body.as_bytes();
    let len = bytes.len();
    let mut i = 0;
    while i + 1 < len {
        if bytes[i] == b'[' && bytes[i + 1] == b'[' {
            i += 2;
            let start = i;
            while i + 1 < len && !(bytes[i] == b']' && bytes[i + 1] == b']') {
                i += 1;
            }
            if i + 1 < len {
                let link = body[start..i].trim();
                if !link.is_empty() && !link.contains('\n') {
                    links.push(link.to_string());
                }
            }
        }
        i += 1;
    }
    links
}
