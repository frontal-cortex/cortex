//! Tags: the frontmatter `tags:` list plus inline `#tags` in the body, merged
//! into one set per note, and a vault-wide tree of them with counts.
//!
//! Nothing here is stored. A note's tags are re-derived from its file every
//! time it is read or indexed, and the tree is computed from the note list —
//! so `rm -rf .brain/` loses nothing, and no `.md` file is ever touched.
//!
//! A tag is `#` followed by letters, digits, `_`, `-` and `/`, with at least
//! one non-digit (so `#1` and `#2024` are not tags), preceded by whitespace,
//! the start of a line, or `(`. That one rule keeps `# Heading`, `## H2`,
//! `https://x.y/#frag`, `[[Note#Section]]`, `&#39;` and `\#escaped` out.
//! Fenced code blocks and inline code spans are never scanned. `parent/child`
//! nests: a note tagged `project/alpha` counts for `project` too, and
//! `--tag project` matches it.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

use crate::note::Note;

/// One node of the tag tree: `path` is the full tag (`project/alpha`),
/// `name` its last segment, `count` the notes carrying it or any child.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TagNode {
    pub name: String,
    pub path: String,
    pub count: usize,
    pub children: Vec<TagNode>,
}

fn is_tag_char(c: char) -> bool {
    c.is_alphanumeric() || c == '_' || c == '-' || c == '/'
}

/// Strip a leading `#` and trailing `/` from a tag written by hand.
fn clean(tag: &str) -> Option<String> {
    let t = tag.trim().trim_start_matches('#').trim_matches('/').trim();
    if t.is_empty() || t.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    Some(t.to_string())
}

/// Every `#tag` in a Markdown body, in order of first appearance, without
/// duplicates. Code fences, inline code, headings and URLs are skipped.
pub fn extract_inline_tags(body: &str) -> Vec<String> {
    let mut tags: Vec<String> = Vec::new();
    let mut in_fence: Option<(char, usize)> = None;

    for line in body.lines() {
        let trimmed = line.trim_start();
        // ``` or ~~~ opens a fence; the same marker (at least as long) closes it.
        if let Some(fence) = fence_marker(trimmed) {
            match in_fence {
                Some((ch, n)) if fence.0 == ch && fence.1 >= n => in_fence = None,
                Some(_) => {}
                None => in_fence = Some(fence),
            }
            continue;
        }
        if in_fence.is_some() {
            continue;
        }
        scan_line(line, &mut tags);
    }
    tags
}

fn fence_marker(trimmed: &str) -> Option<(char, usize)> {
    let ch = trimmed.chars().next()?;
    if ch != '`' && ch != '~' {
        return None;
    }
    let n = trimmed.chars().take_while(|c| *c == ch).count();
    (n >= 3).then_some((ch, n))
}

fn scan_line(line: &str, tags: &mut Vec<String>) {
    let chars: Vec<char> = line.chars().collect();
    let len = chars.len();
    let mut i = 0;
    while i < len {
        let c = chars[i];
        if c == '`' {
            // Skip an inline code span: a run of n backticks closes on the
            // next run of exactly n. Without a close, the backticks are text.
            let n = chars[i..].iter().take_while(|c| **c == '`').count();
            let mut j = i + n;
            let mut closed = None;
            while j < len {
                if chars[j] == '`' {
                    let m = chars[j..].iter().take_while(|c| **c == '`').count();
                    if m == n {
                        closed = Some(j + m);
                        break;
                    }
                    j += m;
                } else {
                    j += 1;
                }
            }
            i = closed.unwrap_or(i + n);
            continue;
        }
        if c == '#' {
            let boundary = i == 0 || chars[i - 1].is_whitespace() || chars[i - 1] == '(';
            if boundary {
                let start = i + 1;
                let mut end = start;
                while end < len && is_tag_char(chars[end]) {
                    end += 1;
                }
                if end > start {
                    let raw: String = chars[start..end].iter().collect();
                    if let Some(tag) = clean(&raw) {
                        if !tags.iter().any(|t| t.eq_ignore_ascii_case(&tag)) {
                            tags.push(tag);
                        }
                    }
                    i = end;
                    continue;
                }
            }
        }
        i += 1;
    }
}

/// The frontmatter `tags:` list — a YAML list of strings, or a single string.
/// A stray leading `#` is dropped so `- #foo` and `- foo` are the same tag.
pub fn frontmatter_tags(frontmatter: &BTreeMap<String, serde_json::Value>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut push = |s: &str| {
        if let Some(t) = clean(s) {
            if !out.iter().any(|x| x.eq_ignore_ascii_case(&t)) {
                out.push(t);
            }
        }
    };
    match frontmatter.get("tags") {
        Some(serde_json::Value::Array(items)) => {
            for v in items {
                if let Some(s) = v.as_str() {
                    push(s);
                }
            }
        }
        Some(serde_json::Value::String(s)) => push(s),
        _ => {}
    }
    out
}

/// A note's tags: frontmatter first, then inline `#tags` not already listed.
/// This is what the index stores and what every listing reports.
pub fn note_tags(note: &Note) -> Vec<String> {
    let mut tags = frontmatter_tags(&note.frontmatter);
    for t in extract_inline_tags(&note.body) {
        if !tags.iter().any(|x| x.eq_ignore_ascii_case(&t)) {
            tags.push(t);
        }
    }
    tags
}

/// Does this tag list carry `tag`? Case-insensitive, and a parent matches
/// its children: `project` matches `project/alpha`.
pub fn has_tag(tags: &[String], tag: &str) -> bool {
    let Some(want) = clean(tag) else { return false };
    let want = want.to_lowercase();
    tags.iter().any(|t| {
        let t = t.to_lowercase();
        t == want || t.starts_with(&format!("{want}/"))
    })
}

/// The vault's tag tree with counts, nested by `/`, sorted A→Z at every
/// level. Each `(path, tags)` pair is one note; a note counts once per tag
/// path even when several of its tags share a parent. Templates are seeds,
/// not notes, and are left out.
pub fn list_tags<'a, I>(notes: I) -> Vec<TagNode>
where
    I: IntoIterator<Item = (&'a str, &'a [String])>,
{
    // lowercase path → (display path, count)
    let mut counts: BTreeMap<String, (String, usize)> = BTreeMap::new();
    for (path, tags) in notes {
        if path.starts_with("templates/") {
            continue;
        }
        let mut seen: Vec<String> = Vec::new();
        for tag in tags {
            let parts: Vec<&str> = tag.split('/').filter(|p| !p.is_empty()).collect();
            for depth in 1..=parts.len() {
                let display = parts[..depth].join("/");
                let key = display.to_lowercase();
                if seen.contains(&key) {
                    continue;
                }
                seen.push(key.clone());
                let entry = counts.entry(key).or_insert((display, 0));
                entry.1 += 1;
            }
        }
    }

    let mut roots: Vec<TagNode> = Vec::new();
    for (key, (display, count)) in counts {
        let segments: Vec<&str> = key.split('/').collect();
        let name = display.rsplit('/').next().unwrap_or(&display).to_string();
        let node = TagNode { name, path: display.clone(), count, children: Vec::new() };
        // Parents are shorter keys, so BTreeMap order guarantees they exist.
        let mut level = &mut roots;
        for depth in 1..segments.len() {
            let prefix = segments[..depth].join("/");
            let idx = level.iter().position(|n| n.path.to_lowercase() == prefix).expect("parent tag inserted first");
            level = &mut level[idx].children;
        }
        level.push(node);
    }
    sort_tree(&mut roots);
    roots
}

fn sort_tree(nodes: &mut [TagNode]) {
    nodes.sort_by_key(|n| n.name.to_lowercase());
    for n in nodes.iter_mut() {
        sort_tree(&mut n.children);
    }
}

/// The tree flattened depth-first — what a picker or a terminal table wants.
pub fn flatten(nodes: &[TagNode]) -> Vec<&TagNode> {
    let mut out = Vec::new();
    fn walk<'a>(nodes: &'a [TagNode], out: &mut Vec<&'a TagNode>) {
        for n in nodes {
            out.push(n);
            walk(&n.children, out);
        }
    }
    walk(nodes, &mut out);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(v: &[&str]) -> Vec<String> {
        v.iter().map(|x| x.to_string()).collect()
    }

    #[test]
    fn finds_tags_in_prose() {
        let body = "Plan for #project/alpha this week. Also #urgent, (#draft) and #q3-2026.\n#leading works too.";
        assert_eq!(extract_inline_tags(body), s(&["project/alpha", "urgent", "draft", "q3-2026", "leading"]));
    }

    #[test]
    fn skips_headings_urls_links_and_escapes() {
        let body = "# Heading\n## Another #real\nSee https://example.com/a#frag and [[Note#Section]] and [x](u#y)\n&#39; \\#no";
        assert_eq!(extract_inline_tags(body), s(&["real"]));
    }

    #[test]
    fn skips_code_fences_and_spans() {
        let body = "before #one\n```sh\necho #notatag\n```\nmiddle `#inline` #two ``a #b`` #three\n~~~\n#nope\n~~~\nafter #four";
        assert_eq!(extract_inline_tags(body), s(&["one", "two", "three", "four"]));
    }

    #[test]
    fn unterminated_backtick_is_text() {
        assert_eq!(extract_inline_tags("a ` b #tag"), s(&["tag"]));
    }

    #[test]
    fn numbers_and_duplicates() {
        assert_eq!(extract_inline_tags("#1 #2024 #v1 #Foo #foo #foo/"), s(&["v1", "Foo"]));
    }

    #[test]
    fn merges_frontmatter_and_body() {
        let note = crate::note::parse_note(
            "notes/a.md",
            "---\ntags: [alpha, '#beta']\n---\nBody with #beta and #gamma/delta.",
        )
        .unwrap();
        assert_eq!(note_tags(&note), s(&["alpha", "beta", "gamma/delta"]));

        let single = crate::note::parse_note("notes/b.md", "---\ntags: solo\n---\n").unwrap();
        assert_eq!(note_tags(&single), s(&["solo"]));
    }

    #[test]
    fn has_tag_matches_children_case_insensitively() {
        let tags = s(&["Project/Alpha", "urgent"]);
        assert!(has_tag(&tags, "project"));
        assert!(has_tag(&tags, "#project/alpha"));
        assert!(has_tag(&tags, "URGENT"));
        assert!(!has_tag(&tags, "proj"));
        assert!(!has_tag(&tags, "alpha"));
        assert!(!has_tag(&tags, ""));
    }

    #[test]
    fn tree_counts_and_nesting() {
        let a = s(&["project/alpha", "project/beta", "urgent"]);
        let b = s(&["project/alpha"]);
        let c = s(&["Urgent"]);
        let t = s(&["ignored"]);
        let tree = list_tags(vec![
            ("notes/a.md", a.as_slice()),
            ("notes/b.md", b.as_slice()),
            ("notes/c.md", c.as_slice()),
            ("templates/t.md", t.as_slice()),
        ]);
        assert_eq!(tree.len(), 2);
        let project = &tree[0];
        assert_eq!(project.path, "project");
        assert_eq!(project.count, 2, "a note with two children counts once for the parent");
        assert_eq!(project.children.iter().map(|c| (c.path.as_str(), c.count)).collect::<Vec<_>>(), vec![("project/alpha", 2), ("project/beta", 1)]);
        assert_eq!(project.children[0].name, "alpha");
        let urgent = &tree[1];
        assert_eq!((urgent.path.as_str(), urgent.count), ("urgent", 2), "case folds into one tag");
        assert_eq!(flatten(&tree).iter().map(|n| n.path.as_str()).collect::<Vec<_>>(), vec!["project", "project/alpha", "project/beta", "urgent"]);
    }

    #[test]
    fn empty_vault_has_no_tags() {
        assert!(list_tags(Vec::<(&str, &[String])>::new()).is_empty());
    }
}
