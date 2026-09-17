//! Backlinks with the line they sit on, and unlinked mentions.
//!
//! The `links` table says *which* notes link here; this module says *where*,
//! by reading each referrer's indexed body and returning the lines that carry
//! the link. It also finds the opposite: notes that name this one in plain
//! text without a `[[link]]` — Obsidian's "unlinked mentions" — and can turn
//! those mentions into links. Nothing here writes; callers own the file.

use serde::{Deserialize, Serialize};

use crate::db::Db;
use crate::error::Result;
use crate::note::{self, NoteEntry};
use crate::vault::stem;

/// A note that refers to this one, with the body lines where it does so.
/// Used both for linked backlinks and for plain-text mentions.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Backlink {
    #[serde(flatten)]
    pub entry: NoteEntry,
    /// Each body line holding a link (or mention), in document order, with
    /// the link (or mention) wrapped in `<mark>…</mark>` and long lines cut
    /// to a window around the first match.
    pub contexts: Vec<String>,
}

/// Shortest title that is worth searching for as a plain-text mention;
/// anything shorter names nothing in particular.
const MIN_MENTION_TITLE: usize = 3;
/// Referrers to inspect for mentions, at most: a common word as a title
/// should not turn into a scan of the whole vault.
const MENTION_CANDIDATES: usize = 200;
/// Context lines to keep per referrer.
const MAX_CONTEXTS: usize = 8;

/// The notes that link to `path`, each with the lines the links are on.
pub fn backlinks(db: &Db, path: &str) -> Result<Vec<Backlink>> {
    let names = names_of(db, path);
    let mut out = Vec::new();
    for entry in db.get_backlinks(path)? {
        let body = db.body(&entry.path)?.unwrap_or_default();
        let contexts = contexts(&body, |line, _| link_ranges(line, &names));
        out.push(Backlink { entry, contexts });
    }
    Ok(out)
}

/// The notes whose body names `path`'s title in plain text without linking
/// to it. Whole-word, case-insensitive; text inside a `[[link]]`, inline
/// code or a code fence does not count. Notes that already link here are
/// left out even if they also mention the title elsewhere.
pub fn unlinked_mentions(db: &Db, path: &str) -> Result<Vec<Backlink>> {
    let title = db.title_of(path)?.filter(|t| !t.trim().is_empty()).unwrap_or_else(|| stem(path).to_string());
    let title = title.trim();
    if title.chars().count() < MIN_MENTION_TITLE || !title.chars().any(char::is_alphanumeric) {
        return Ok(vec![]);
    }
    let linked: std::collections::HashSet<String> =
        db.get_backlinks(path)?.into_iter().map(|n| n.path).collect();
    let mut out = Vec::new();
    for entry in db.notes_mentioning(title, path, MENTION_CANDIDATES)? {
        if linked.contains(&entry.path) {
            continue;
        }
        let body = db.body(&entry.path)?.unwrap_or_default();
        let contexts = contexts(&body, |line, in_code| {
            if in_code { vec![] } else { mention_ranges(line, title) }
        });
        if !contexts.is_empty() {
            out.push(Backlink { entry, contexts });
        }
    }
    Ok(out)
}

/// Turn every plain-text mention of `title` in `body` into a `[[link]]`,
/// using the same rules as [`unlinked_mentions`]. A mention written in
/// another case keeps its spelling as the alias: `the plan` → `[[Plan|the plan]]`.
/// Returns the new body and how many mentions were linked.
pub fn link_mentions(body: &str, title: &str) -> (String, usize) {
    let title = title.trim();
    if title.chars().count() < MIN_MENTION_TITLE {
        return (body.to_string(), 0);
    }
    let mut out = String::with_capacity(body.len() + 16);
    let mut linked = 0;
    let mut in_fence = false;
    for line in body.split_inclusive('\n') {
        let text = line.trim_end_matches(['\n', '\r']);
        if is_fence(text) {
            in_fence = !in_fence;
        }
        let ranges = if in_fence || is_fence(text) { vec![] } else { mention_ranges(text, title) };
        let mut pos = 0;
        for (s, e) in ranges {
            out.push_str(&line[pos..s]);
            let found = &line[s..e];
            out.push_str("[[");
            out.push_str(title);
            if found != title {
                out.push('|');
                out.push_str(found);
            }
            out.push_str("]]");
            pos = e;
            linked += 1;
        }
        out.push_str(&line[pos..]);
    }
    (out, linked)
}

/// What a `[[link]]` may be written as to reach this note: its title and
/// its filename stem, lowercased.
fn names_of(db: &Db, path: &str) -> Vec<String> {
    let mut names = vec![stem(path).to_lowercase()];
    if let Ok(Some(title)) = db.title_of(path) {
        let t = title.trim().to_lowercase();
        if !t.is_empty() && !names.contains(&t) {
            names.push(t);
        }
    }
    names
}

/// Walk the body line by line, collecting an excerpt for every line where
/// `find` returns byte ranges to highlight. `find` is told whether the line
/// sits inside a code fence.
fn contexts(body: &str, find: impl Fn(&str, bool) -> Vec<(usize, usize)>) -> Vec<String> {
    let mut out = Vec::new();
    let mut in_fence = false;
    for raw in body.lines() {
        let line = raw.trim();
        if is_fence(line) {
            in_fence = !in_fence;
            continue;
        }
        let ranges = find(line, in_fence);
        if !ranges.is_empty() {
            out.push(excerpt(line, &ranges));
            if out.len() >= MAX_CONTEXTS {
                break;
            }
        }
    }
    out
}

fn is_fence(line: &str) -> bool {
    let t = line.trim_start();
    t.starts_with("```") || t.starts_with("~~~")
}

/// Byte spans of every `[[…]]` (or `![[…]]`) in a line, with the parsed link.
fn link_spans(line: &str) -> Vec<(usize, usize, note::WikiLink)> {
    let bytes = line.as_bytes();
    let len = bytes.len();
    let mut spans = Vec::new();
    let mut i = 0;
    while i + 1 < len {
        if bytes[i] == b'[' && bytes[i + 1] == b'[' {
            let open = if i > 0 && bytes[i - 1] == b'!' { i - 1 } else { i };
            let start = i + 2;
            let mut j = start;
            while j + 1 < len && !(bytes[j] == b']' && bytes[j + 1] == b']') {
                j += 1;
            }
            if j + 1 < len {
                let inner = line[start..j].trim();
                if !inner.is_empty() {
                    spans.push((open, j + 2, note::parse_wiki_link(inner)));
                }
                i = j + 2;
                continue;
            }
        }
        i += 1;
    }
    spans
}

/// Byte spans of the links in a line whose target is one of `names`.
fn link_ranges(line: &str, names: &[String]) -> Vec<(usize, usize)> {
    link_spans(line)
        .into_iter()
        .filter(|(_, _, l)| names.iter().any(|n| *n == l.target.to_lowercase()))
        .map(|(s, e, _)| (s, e))
        .collect()
}

/// Byte spans of `` `inline code` `` in a line.
fn code_spans(line: &str) -> Vec<(usize, usize)> {
    let mut spans = Vec::new();
    let mut open: Option<usize> = None;
    for (i, c) in line.char_indices() {
        if c == '`' {
            match open.take() {
                Some(s) => spans.push((s, i + 1)),
                None => open = Some(i),
            }
        }
    }
    spans
}

/// Byte spans of Markdown links `[text](url)` and autolinks `<http://…>`
/// in a line: a mention inside either cannot become a `[[link]]` without
/// breaking it. Wiki links are handled separately by [`link_spans`].
fn markdown_link_spans(line: &str) -> Vec<(usize, usize)> {
    let bytes = line.as_bytes();
    let len = bytes.len();
    let mut spans = Vec::new();
    let mut i = 0;
    while i < len {
        match bytes[i] {
            b'[' if i + 1 < len && bytes[i + 1] != b'[' => {
                let mut depth = 0;
                let mut j = i;
                while j < len {
                    match bytes[j] {
                        b'[' => depth += 1,
                        b']' => {
                            depth -= 1;
                            if depth == 0 { break; }
                        }
                        _ => {}
                    }
                    j += 1;
                }
                if j + 1 < len && bytes[j + 1] == b'(' {
                    if let Some(close) = line[j + 1..].find(')') {
                        spans.push((i, j + 1 + close + 1));
                        i = j + 1 + close + 1;
                        continue;
                    }
                }
                i += 1;
            }
            b'<' => {
                if let Some(close) = line[i..].find('>') {
                    let inner = &line[i + 1..i + close];
                    if inner.contains("://") || inner.contains('@') {
                        spans.push((i, i + close + 1));
                        i += close + 1;
                        continue;
                    }
                }
                i += 1;
            }
            _ => i += 1,
        }
    }
    spans
}

fn fold(c: char) -> char {
    c.to_lowercase().next().unwrap_or(c)
}

/// Byte spans where `title` appears in `line` as a whole word, ignoring
/// case, outside any `[[link]]` or inline code.
fn mention_ranges(line: &str, title: &str) -> Vec<(usize, usize)> {
    let lc: Vec<(usize, char)> = line.char_indices().map(|(b, c)| (b, fold(c))).collect();
    let tc: Vec<char> = title.chars().map(fold).collect();
    if tc.is_empty() || lc.len() < tc.len() {
        return vec![];
    }
    let mut skip: Vec<(usize, usize)> = link_spans(line).into_iter().map(|(s, e, _)| (s, e)).collect();
    skip.extend(code_spans(line));
    skip.extend(markdown_link_spans(line));
    let mut out = Vec::new();
    let mut i = 0;
    while i + tc.len() <= lc.len() {
        let hit = lc[i..i + tc.len()].iter().map(|(_, c)| *c).eq(tc.iter().copied());
        if hit {
            let end_i = i + tc.len();
            let start = lc[i].0;
            let end = lc.get(end_i).map(|(b, _)| *b).unwrap_or(line.len());
            let before_ok = i == 0 || !lc[i - 1].1.is_alphanumeric();
            let after_ok = end_i == lc.len() || !lc[end_i].1.is_alphanumeric();
            let inside = skip.iter().any(|&(s, e)| start < e && end > s);
            if before_ok && after_ok && !inside {
                out.push((start, end));
                i = end_i;
                continue;
            }
        }
        i += 1;
    }
    out
}

/// One context line: `line` with `ranges` wrapped in `<mark>`, cut to a
/// window around the first range when the line is long. Cuts fall on
/// character boundaries, and a range can never be split by the cut.
fn excerpt(line: &str, ranges: &[(usize, usize)]) -> String {
    const BEFORE: usize = 80;
    const TOTAL: usize = 200;
    let chars: Vec<usize> = line.char_indices().map(|(b, _)| b).collect();
    let n = chars.len();
    let first = ranges[0].0;
    let first_ci = chars.iter().position(|&b| b >= first).unwrap_or(0);
    let (start_ci, end_ci) = if n <= TOTAL {
        (0, n)
    } else {
        let end = (first_ci.saturating_sub(BEFORE) + TOTAL).min(n);
        (end.saturating_sub(TOTAL), end)
    };
    let start_b = chars.get(start_ci).copied().unwrap_or(0);
    let end_b = chars.get(end_ci).copied().unwrap_or(line.len());
    let mut out = String::with_capacity(end_b - start_b + 32);
    if start_ci > 0 {
        out.push('…');
    }
    let mut pos = start_b;
    let mut cut_end = end_b;
    for &(s, e) in ranges {
        if e <= start_b || s >= end_b {
            continue;
        }
        // Keep a range whole even if it runs past the window.
        cut_end = cut_end.max(e);
        out.push_str(&line[pos..s.max(pos)]);
        out.push_str("<mark>");
        out.push_str(&line[s.max(pos)..e]);
        out.push_str("</mark>");
        pos = e;
    }
    out.push_str(&line[pos..cut_end.max(pos)]);
    if cut_end < line.len() {
        out.push('…');
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn link_ranges_match_title_and_stem_in_any_form() {
        let names = vec!["plan".to_string(), "the plan".to_string()];
        let line = "See [[The Plan|our plan]], then ![[plan#Goals]] and [[Other]].";
        let ranges = link_ranges(line, &names);
        let found: Vec<&str> = ranges.iter().map(|&(s, e)| &line[s..e]).collect();
        assert_eq!(found, vec!["[[The Plan|our plan]]", "![[plan#Goals]]"]);
    }

    #[test]
    fn mentions_are_whole_words_outside_links_and_code() {
        let t = "Plan";
        assert_eq!(mention_ranges("The plan is set", t), vec![(4, 8)]);
        assert!(mention_ranges("Planning ahead", t).is_empty());
        assert!(mention_ranges("See [[Plan]] here", t).is_empty());
        assert!(mention_ranges("See [[Other|the plan]] here", t).is_empty());
        assert!(mention_ranges("Run `plan` now", t).is_empty());
        assert_eq!(mention_ranges("plan, plan", t), vec![(0, 4), (6, 10)]);
    }

    #[test]
    fn mentions_skip_markdown_links_and_autolinks() {
        let t = "Second Brain";
        assert!(mention_ranges("A [Second Brain](https://x.y/second-brain) vault", t).is_empty());
        assert!(mention_ranges("see <https://x.y/Second Brain>", t).is_empty());
        assert_eq!(mention_ranges("A [site](https://x.y) about Second Brain", t), vec![(28, 40)]);
        assert_eq!(mention_ranges("[[Other]] and Second Brain", t), vec![(14, 26)]);
    }

    #[test]
    fn mentions_handle_unicode_titles() {
        let t = "Café Notes";
        let line = "Meet at CAFÉ NOTES — cafe notes is different";
        let r = mention_ranges(line, t);
        assert_eq!(r.len(), 1);
        assert_eq!(&line[r[0].0..r[0].1], "CAFÉ NOTES");
    }

    #[test]
    fn excerpt_marks_and_windows() {
        let line = "a [[Plan]] b";
        assert_eq!(excerpt(line, &[(2, 10)]), "a <mark>[[Plan]]</mark> b");

        let long = format!("{}[[Plan]]{}", "x".repeat(300), "y".repeat(300));
        let s = excerpt(&long, &[(300, 308)]);
        assert!(s.starts_with('…') && s.ends_with('…'));
        assert!(s.contains("<mark>[[Plan]]</mark>"));
        assert!(s.chars().count() < 230);
    }

    #[test]
    fn excerpt_never_splits_a_multibyte_char() {
        let long = format!("{}[[Plan]]{}", "é".repeat(300), "ü".repeat(300));
        let s = excerpt(&long, &[(600, 608)]);
        assert!(s.contains("<mark>[[Plan]]</mark>"));
    }

    #[test]
    fn contexts_skip_fences_and_keep_order() {
        let body = "first [[Plan]]\n```\n[[Plan]] in code\n```\nlast [[plan]]\n";
        let names = vec!["plan".to_string()];
        let c = contexts(body, |l, in_code| if in_code { vec![] } else { link_ranges(l, &names) });
        assert_eq!(c, vec!["first <mark>[[Plan]]</mark>", "last <mark>[[plan]]</mark>"]);
    }

    #[test]
    fn link_mentions_rewrites_plain_text_only() {
        let body = "The plan is [[Plan]]-adjacent.\nSee `plan` and Plan.\n```\nplan\n```\nplanning\n";
        let (out, n) = link_mentions(body, "Plan");
        assert_eq!(n, 2);
        assert_eq!(out, "The [[Plan|plan]] is [[Plan]]-adjacent.\nSee `plan` and [[Plan]].\n```\nplan\n```\nplanning\n");
        let (again, m) = link_mentions(&out, "Plan");
        assert_eq!(m, 0);
        assert_eq!(again, out);
    }

    #[test]
    fn backlinks_and_mentions_over_an_index() {
        let db = Db::open_in_memory().unwrap();
        let entry = |path: &str, title: &str| NoteEntry {
            path: path.into(), title: title.into(), note_type: None, icon: None, parent: None,
            tags: vec![], modified: 0, created: None,
        };
        db.upsert_note(&entry("notes/plan.md", "The Plan"), "body").unwrap();
        db.upsert_note(&entry("notes/a.md", "A"), "intro\nread [[the plan|it]] today\n").unwrap();
        db.upsert_links("notes/a.md", &["the plan".into()]).unwrap();
        db.upsert_note(&entry("notes/b.md", "B"), "the plan is plain text here\nand `the plan` in code\n").unwrap();
        db.upsert_links("notes/b.md", &[]).unwrap();
        db.upsert_note(&entry("notes/c.md", "C"), "links [[plan]] and says the plan too\n").unwrap();
        db.upsert_links("notes/c.md", &["plan".into()]).unwrap();

        let back = backlinks(&db, "notes/plan.md").unwrap();
        let mut paths: Vec<&str> = back.iter().map(|b| b.entry.path.as_str()).collect();
        paths.sort();
        assert_eq!(paths, vec!["notes/a.md", "notes/c.md"]);
        let a = back.iter().find(|b| b.entry.path == "notes/a.md").unwrap();
        assert_eq!(a.contexts, vec!["read <mark>[[the plan|it]]</mark> today"]);

        let mentions = unlinked_mentions(&db, "notes/plan.md").unwrap();
        assert_eq!(mentions.len(), 1, "c links already; a links; only b mentions");
        assert_eq!(mentions[0].entry.path, "notes/b.md");
        assert_eq!(mentions[0].contexts, vec!["<mark>the plan</mark> is plain text here"]);
    }

    #[test]
    fn link_mentions_leaves_short_titles_alone() {
        let (out, n) = link_mentions("go go go", "go");
        assert_eq!((out.as_str(), n), ("go go go", 0));
    }
}
