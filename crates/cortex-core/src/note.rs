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
    /// Frontmatter `created:` as written (`YYYY-MM-DD`), for sorting; the
    /// index does not carry it, so entries from a search are `None`.
    pub created: Option<String>,
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

/// One `[[wiki link]]`, split into its parts. The written form is always
/// `[[target#section|alias]]` (section and alias both optional); an embed is
/// the same with a leading `!`. Only `target` identifies the note — backlinks,
/// resolution and the graph match on it alone — while `alias` is what the
/// reader sees and `section` is the heading inside the note.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WikiLink {
    pub target: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub alias: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub section: Option<String>,
}

impl WikiLink {
    /// The text a reader should see: the alias when there is one, otherwise
    /// `Target › Section` or just `Target`.
    pub fn label(&self) -> String {
        match (&self.alias, &self.section) {
            (Some(a), _) => a.clone(),
            (None, Some(s)) if self.target.is_empty() => s.clone(),
            (None, Some(s)) => format!("{} › {s}", self.target),
            (None, None) => self.target.clone(),
        }
    }
}

/// Parse one wiki link. Accepts the inner text (`Note#Section|alias`) or the
/// whole form with brackets and an optional embed bang (`![[Note#Section]]`).
/// Parts are trimmed; empty alias / section become `None`. Never fails: an
/// unparseable string is a link whose target is the string itself.
pub fn parse_wiki_link(raw: &str) -> WikiLink {
    let mut inner = raw.trim();
    inner = inner.strip_prefix('!').unwrap_or(inner);
    inner = inner.strip_prefix("[[").unwrap_or(inner);
    inner = inner.strip_suffix("]]").unwrap_or(inner);
    let (head, alias) = match inner.split_once('|') {
        Some((h, a)) => (h, Some(a.trim()).filter(|a| !a.is_empty())),
        None => (inner, None),
    };
    let (target, section) = match head.split_once('#') {
        Some((t, s)) => (t, Some(s.trim()).filter(|s| !s.is_empty())),
        None => (head, None),
    };
    WikiLink {
        target: target.trim().to_string(),
        alias: alias.map(str::to_string),
        section: section.map(str::to_string),
    }
}

/// Extract every `[[wiki link]]` (and `![[embed]]`) in a body, parsed, in
/// document order. No regex dep.
pub fn extract_wiki_links(body: &str) -> Vec<WikiLink> {
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
                    links.push(parse_wiki_link(link));
                }
            }
        }
        i += 1;
    }
    links
}

impl WikiLink {
    /// The inner text of this link as it is written: `target#section|alias`.
    pub fn inner(&self) -> String {
        let mut s = self.target.clone();
        if let Some(sec) = &self.section {
            s.push('#');
            s.push_str(sec);
        }
        if let Some(a) = &self.alias {
            s.push('|');
            s.push_str(a);
        }
        s
    }
}

/// Point every link at `old_target` to `new_target` instead, keeping the
/// alias, the section and the embed `!`: `[[old|x]]` → `[[new|x]]`,
/// `![[old#h]]` → `![[new#h]]`. Targets compare case-insensitively, the way
/// `vault::resolve` matches them; links to anything else are copied through
/// untouched, byte for byte. Returns the new text and how many links changed.
pub fn rewrite_wiki_links(text: &str, old_target: &str, new_target: &str) -> (String, usize) {
    let old_lower = old_target.trim().to_lowercase();
    if old_lower.is_empty() {
        return (text.to_string(), 0);
    }
    let mut out = String::with_capacity(text.len());
    let mut changed = 0;
    let bytes = text.as_bytes();
    let len = bytes.len();
    let mut i = 0;
    let mut copied = 0; // everything before this offset is already in `out`
    while i + 1 < len {
        if bytes[i] == b'[' && bytes[i + 1] == b'[' {
            let start = i + 2;
            let mut j = start;
            while j + 1 < len && !(bytes[j] == b']' && bytes[j + 1] == b']') {
                j += 1;
            }
            if j + 1 < len {
                let inner = &text[start..j];
                if !inner.contains('\n') {
                    let mut link = parse_wiki_link(inner);
                    if link.target.to_lowercase() == old_lower {
                        link.target = new_target.trim().to_string();
                        out.push_str(&text[copied..start]);
                        out.push_str(&link.inner());
                        copied = j;
                        changed += 1;
                    }
                }
                i = j + 2;
                continue;
            }
        }
        i += 1;
    }
    out.push_str(&text[copied..]);
    (out, changed)
}

/// The passage around one `[[link]]`, as a reader would see it: `link` is the
/// link's label (alias, or `Target › Section`), `before` and `after` the
/// surrounding text of the same paragraph (a list item or heading stands on
/// its own), other wiki links reduced to their labels, clipped to a window
/// at word boundaries with `…` where text was cut. Markdown is otherwise
/// left as written.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LinkContext {
    pub before: String,
    pub link: String,
    pub after: String,
}

/// Roughly how much text to keep on each side of a link in a [`LinkContext`].
const CONTEXT_WINDOW: usize = 110;

/// Every `[[link]]` (or `![[embed]]`) in `body` whose target satisfies
/// `is_target`, each with its [`LinkContext`], in document order. This is what
/// a backlinks panel shows under a source note: not just *that* it links here,
/// but the sentence that does.
pub fn link_contexts(body: &str, is_target: impl Fn(&str) -> bool) -> Vec<LinkContext> {
    let lines: Vec<&str> = body.lines().collect();
    let mut out = Vec::new();
    for (idx, line) in lines.iter().enumerate() {
        for (start, end, link) in wiki_link_spans(line) {
            if !is_target(&link.target) {
                continue;
            }
            // The paragraph: neighbouring non-blank lines, stopping at a block
            // marker so a list item or heading is its own context.
            let mut first = idx;
            while first > 0 && !lines[first - 1].trim().is_empty() && !starts_block(lines[first]) {
                first -= 1;
            }
            let mut last = idx;
            while last + 1 < lines.len() && !lines[last + 1].trim().is_empty() && !starts_block(lines[last + 1]) {
                last += 1;
            }
            let mut before = String::new();
            for l in &lines[first..idx] {
                before.push_str(l.trim());
                before.push(' ');
            }
            before.push_str(&line[..start]);
            let mut after = line[end..].to_string();
            for l in &lines[idx + 1..=last] {
                after.push(' ');
                after.push_str(l.trim());
            }
            let before = strip_block_marker(&flatten_wiki_links(&before));
            let after = flatten_wiki_links(&after);
            out.push(LinkContext {
                before: clip_end(before.trim_start(), CONTEXT_WINDOW),
                link: link.label(),
                after: clip_start(after.trim_end(), CONTEXT_WINDOW),
            });
        }
    }
    out
}

/// Byte spans of every `[[link]]` in one line (the span includes a leading
/// embed `!`), with the parsed link.
fn wiki_link_spans(line: &str) -> Vec<(usize, usize, WikiLink)> {
    let bytes = line.as_bytes();
    let len = bytes.len();
    let mut spans = Vec::new();
    let mut i = 0;
    while i + 1 < len {
        if bytes[i] == b'[' && bytes[i + 1] == b'[' {
            let open = i;
            let inner_start = i + 2;
            let mut j = inner_start;
            while j + 1 < len && !(bytes[j] == b']' && bytes[j + 1] == b']') {
                j += 1;
            }
            if j + 1 < len {
                let inner = line[inner_start..j].trim();
                if !inner.is_empty() {
                    let start = if open > 0 && bytes[open - 1] == b'!' { open - 1 } else { open };
                    spans.push((start, j + 2, parse_wiki_link(inner)));
                }
                i = j + 2;
                continue;
            }
        }
        i += 1;
    }
    spans
}

/// `[[Note|alias]]` → `alias`, `![[Note#Sec]]` → `Note › Sec`: the text a
/// reader sees, for the parts of a context that are not the link itself.
fn flatten_wiki_links(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut copied = 0;
    for (start, end, link) in wiki_link_spans(text) {
        out.push_str(&text[copied..start]);
        out.push_str(&link.label());
        copied = end;
    }
    out.push_str(&text[copied..]);
    out
}

/// Does this line open a Markdown block of its own (heading, list item, task,
/// quote, table row, fence), rather than continue the paragraph above it?
fn starts_block(line: &str) -> bool {
    let t = line.trim_start();
    if t.starts_with('#') || t.starts_with('>') || t.starts_with('|') || t.starts_with("```") {
        return true;
    }
    if let Some(rest) = t.strip_prefix(['-', '*', '+']) {
        return rest.starts_with(' ') || rest.is_empty();
    }
    let digits = t.chars().take_while(|c| c.is_ascii_digit()).count();
    digits > 0 && (t[digits..].starts_with(". ") || t[digits..].starts_with(") "))
}

/// Drop the marker that opens a block (`## `, `- [ ] `, `> `, `1. `) from the
/// start of a context so the panel shows the words, not the syntax.
fn strip_block_marker(text: &str) -> String {
    let mut t = text.trim_start();
    loop {
        let before = t;
        t = t.trim_start_matches(['#', '>']).trim_start();
        if let Some(rest) = t.strip_prefix(['-', '*', '+']) {
            if rest.starts_with(' ') || rest.is_empty() {
                t = rest.trim_start();
            }
        }
        let digits = t.chars().take_while(|c| c.is_ascii_digit()).count();
        if digits > 0 && (t[digits..].starts_with(". ") || t[digits..].starts_with(") ")) {
            t = t[digits + 2..].trim_start();
        }
        if let Some(rest) = t.strip_prefix("[ ]").or_else(|| t.strip_prefix("[x]")).or_else(|| t.strip_prefix("[X]")) {
            t = rest.trim_start();
        }
        if t == before {
            return t.to_string();
        }
    }
}

/// Keep the last `max` characters of `text`, cut at a word boundary, with a
/// leading `…` when something was dropped.
fn clip_end(text: &str, max: usize) -> String {
    let n = text.chars().count();
    if n <= max {
        return text.to_string();
    }
    let tail: String = text.chars().skip(n - max).collect();
    let tail = match tail.find(' ') {
        Some(i) if i + 1 < tail.len() => tail[i + 1..].to_string(),
        _ => tail,
    };
    format!("…{tail}")
}

/// Keep the first `max` characters of `text`, cut at a word boundary, with a
/// trailing `…` when something was dropped.
fn clip_start(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        return text.to_string();
    }
    let head: String = text.chars().take(max).collect();
    let head = match head.rfind(' ') {
        Some(i) if i > 0 => head[..i].to_string(),
        _ => head,
    };
    format!("{head}…")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn link(target: &str, alias: Option<&str>, section: Option<&str>) -> WikiLink {
        WikiLink { target: target.into(), alias: alias.map(Into::into), section: section.map(Into::into) }
    }

    #[test]
    fn parses_the_three_forms_and_embeds() {
        assert_eq!(parse_wiki_link("Note"), link("Note", None, None));
        assert_eq!(parse_wiki_link("Note|alias"), link("Note", Some("alias"), None));
        assert_eq!(parse_wiki_link("Note#Section"), link("Note", None, Some("Section")));
        assert_eq!(parse_wiki_link("Note#Section|alias"), link("Note", Some("alias"), Some("Section")));
        assert_eq!(parse_wiki_link("![[embed#h]]"), link("embed", None, Some("h")));
        assert_eq!(parse_wiki_link("[[ Note | shown ]]"), link("Note", Some("shown"), None));
        // Degenerate parts are dropped rather than kept as empty strings.
        assert_eq!(parse_wiki_link("Note|"), link("Note", None, None));
        assert_eq!(parse_wiki_link("Note#"), link("Note", None, None));
        assert_eq!(parse_wiki_link("#Heading"), link("", None, Some("Heading")));
    }

    #[test]
    fn labels_prefer_alias_then_section() {
        assert_eq!(parse_wiki_link("Note").label(), "Note");
        assert_eq!(parse_wiki_link("Note|alias").label(), "alias");
        assert_eq!(parse_wiki_link("Note#Sec").label(), "Note › Sec");
        assert_eq!(parse_wiki_link("Note#Sec|alias").label(), "alias");
        assert_eq!(parse_wiki_link("#Sec").label(), "Sec");
    }

    #[test]
    fn extracts_targets_from_every_form() {
        let body = "See [[A]] and [[B|the b]] plus [[C#Top]] and\n\n![[D#h]]\n\n[[not\nclosed]] [[ ]]";
        let links = extract_wiki_links(body);
        let targets: Vec<&str> = links.iter().map(|l| l.target.as_str()).collect();
        assert_eq!(targets, ["A", "B", "C", "D"]);
        assert_eq!(links[1].alias.as_deref(), Some("the b"));
        assert_eq!(links[2].section.as_deref(), Some("Top"));
        assert_eq!(links[3].section.as_deref(), Some("h"));
    }

    #[test]
    fn rewrites_every_form_and_keeps_the_rest() {
        let body = "See [[Old]] and [[old|shown]] plus [[Old#Top|x]] and\n\n![[OLD#h]]\n\n[[Older]] [[Old\nbroken]] [[";
        let (out, n) = rewrite_wiki_links(body, "Old", "New Name");
        assert_eq!(n, 4);
        assert_eq!(out, "See [[New Name]] and [[New Name|shown]] plus [[New Name#Top|x]] and\n\n![[New Name#h]]\n\n[[Older]] [[Old\nbroken]] [[");
        // Nothing to do: the text comes back untouched.
        let (same, n) = rewrite_wiki_links(body, "Nope", "X");
        assert_eq!((same.as_str(), n), (body, 0));
        assert_eq!(rewrite_wiki_links(body, "", "X").1, 0);
    }

    #[test]
    fn inner_round_trips() {
        for s in ["Note", "Note|alias", "Note#Sec", "Note#Sec|alias"] {
            assert_eq!(parse_wiki_link(s).inner(), s);
        }
    }

    #[test]
    fn link_contexts_show_the_sentence_around_each_link() {
        let body = "# Intro\n\nSome prose that runs on\nto [[Target|the target]] and then\ncontinues here.\n\n- [ ] a task about [[Target#Sec]] to do\n- another about [[Other]]\n\n![[target]]\n\n> quoting [[Target]] with [[Other|an alias]] after\n";
        let ctx = link_contexts(body, |t| t.eq_ignore_ascii_case("Target"));
        let flat: Vec<(String, String, String)> = ctx.iter().map(|c| (c.before.clone(), c.link.clone(), c.after.clone())).collect();
        assert_eq!(flat, [
            ("Some prose that runs on to ".into(), "the target".into(), " and then continues here.".into()),
            ("a task about ".into(), "Target › Sec".into(), " to do".into()),
            ("".into(), "target".into(), "".into()),
            ("quoting ".into(), "Target".into(), " with an alias after".into()),
        ]);
        assert!(link_contexts(body, |t| t == "Nope").is_empty());
    }

    #[test]
    fn link_contexts_clip_long_paragraphs_at_words() {
        let filler = "word ".repeat(60);
        let body = format!("{filler}[[Target]] {filler}");
        let ctx = link_contexts(&body, |t| t == "Target");
        assert_eq!(ctx.len(), 1);
        assert!(ctx[0].before.starts_with("…word "), "{}", ctx[0].before);
        assert!(ctx[0].after.ends_with(" word…"), "{}", ctx[0].after);
        assert!(ctx[0].before.chars().count() <= CONTEXT_WINDOW + 1);
        assert!(ctx[0].after.chars().count() <= CONTEXT_WINDOW + 1);
    }
}
