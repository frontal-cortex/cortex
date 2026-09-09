//! Publishing: a static site built from the notes the user chose to share.
//!
//! Nothing here runs on its own. A note becomes eligible only when its
//! frontmatter says `publish: true` (or it carries the `public` tag), and a
//! site is built only when someone runs `cortex publish` or the app's
//! Publish command — a conscious act each time, never a side effect of
//! saving or syncing. Both hosting models (your own static host, or a
//! service that builds on push) consume this one output.
//!
//! What comes out: one page per published note at `<path-sans-.md>/index.html`,
//! an `index.html` listing them (with the optional home note on top and a
//! small client-side search over `search.json`), the assets those pages
//! reference, and `.cortex-site.json` — a manifest of every file written, so
//! a later build can remove what it wrote before and nothing else. Wiki links
//! to published notes become relative links; links to anything unpublished
//! degrade to plain text, so the site never reveals what stayed private.
//! Database views (`cortex-view` fences and a collection page's own views)
//! become static tables through the same `resolve_view` the app uses, and
//! `search.json` carries the start of each body so the index page's search
//! finds words inside pages. Read-only: no comments, no presence, no editing.

use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use crate::error::{AppError, Result};
use crate::note::{self, Note, NoteEntry};
use crate::{settings, vault};

/// Files a build writes are recorded here, inside the output directory.
pub const MANIFEST: &str = ".cortex-site.json";

/// One note that will be (or was) published.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PublishEntry {
    pub path: String,
    pub title: String,
    /// Site-relative URL of the page, e.g. `notes/ideas/second-brain/`.
    pub url: String,
    pub created: Option<String>,
    pub tags: Vec<String>,
}

/// What a build produced.
#[derive(Debug, Clone, Serialize)]
pub struct Report {
    pub out_dir: PathBuf,
    pub pages: Vec<PublishEntry>,
    pub assets: Vec<String>,
    /// Files removed because a previous build wrote them and this one did not.
    pub removed: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct Manifest {
    files: Vec<String>,
}

// ── Selection ───────────────────────────────────────────────────────────────

/// The user's explicit choice: `publish: true`, or the `public` tag.
pub fn is_published(note: &Note) -> bool {
    if note.frontmatter.get("publish").and_then(|v| v.as_bool()) == Some(true) {
        return true;
    }
    note.frontmatter
        .get("tags")
        .and_then(|v| v.as_array())
        .map(|tags| tags.iter().any(|t| t.as_str() == Some("public")))
        .unwrap_or(false)
}

/// Never publishable regardless of frontmatter: templates and the vault's own docs.
fn is_publishable_path(path: &str) -> bool {
    !(path.starts_with("templates/") || path == "VAULT.md" || path == "AGENTS.md" || path == "README.md")
}

/// The page URL (site-relative, trailing slash) for a note path.
pub fn url_for(path: &str) -> String {
    let stem = path.strip_suffix(".md").unwrap_or(path);
    // A collection's `_index` page lives at the collection's own URL.
    let stem = stem.strip_suffix("/_index").unwrap_or(stem);
    format!("{stem}/")
}

struct Published {
    note: Note,
    entry: PublishEntry,
}

fn load_published(root: &Path) -> Result<(Vec<NoteEntry>, Vec<Published>)> {
    let all = vault::list_notes(root);
    let mut published = Vec::new();
    for e in &all {
        if !is_publishable_path(&e.path) {
            continue;
        }
        let Ok(content) = std::fs::read_to_string(root.join(&e.path)) else { continue };
        let Ok(note) = note::parse_note(&e.path, &content) else { continue };
        if !is_published(&note) {
            continue;
        }
        let created = note.frontmatter.get("created").and_then(|v| v.as_str()).map(str::to_string);
        published.push(Published {
            entry: PublishEntry {
                path: e.path.clone(),
                title: note::infer_title(&note),
                url: url_for(&e.path),
                created,
                tags: e.tags.clone(),
            },
            note,
        });
    }
    // Newest first by created date, then title — the order the index lists them.
    published.sort_by(|a, b| b.entry.created.cmp(&a.entry.created).then_with(|| a.entry.title.cmp(&b.entry.title)));
    Ok((all, published))
}

/// What `build` would publish, without writing anything.
pub fn preview(root: &Path) -> Result<Vec<PublishEntry>> {
    Ok(load_published(root)?.1.into_iter().map(|p| p.entry).collect())
}

// ── Site config ─────────────────────────────────────────────────────────────

struct Site {
    title: String,
    home: Option<String>,
}

fn site_config(root: &Path) -> Site {
    let s = settings::load(root).unwrap_or_default();
    let title = if s.site_title.trim().is_empty() {
        root.file_name().and_then(|n| n.to_str()).unwrap_or("Notes").to_string()
    } else {
        s.site_title.trim().to_string()
    };
    let home = if s.site_home.trim().is_empty() { None } else { Some(s.site_home.trim().to_string()) };
    Site { title, home }
}

// ── Build ───────────────────────────────────────────────────────────────────

/// Build the site into `out`. Refuses a non-empty directory that no earlier
/// build wrote to (no manifest) unless `force` — so a typo in `--out` cannot
/// scatter files over, say, the home directory. Files from the previous
/// build that are no longer produced are removed.
pub fn build(root: &Path, out: &Path, force: bool) -> Result<Report> {
    let (all, published) = load_published(root)?;
    let site = site_config(root);

    // Output directory safety.
    let manifest_path = out.join(MANIFEST);
    let previous: Manifest = std::fs::read_to_string(&manifest_path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    if out.exists() {
        if !out.is_dir() {
            return Err(AppError::Other(format!("not a directory: {}", out.display())));
        }
        let non_empty = std::fs::read_dir(out)?.next().is_some();
        if non_empty && !manifest_path.exists() && !force {
            return Err(AppError::Other(format!(
                "{} is not empty and was not written by a previous publish; pass --force to write into it anyway",
                out.display()
            )));
        }
    }

    let by_path: BTreeMap<&str, &PublishEntry> = published.iter().map(|p| (p.entry.path.as_str(), &p.entry)).collect();
    let mut files: BTreeMap<String, Vec<u8>> = BTreeMap::new();
    let mut assets: BTreeSet<String> = BTreeSet::new();

    // Pages.
    for p in &published {
        let depth = p.entry.url.matches('/').count();
        let rendered = render_body(root, &p.note, depth, &all, &by_path, &mut assets)?;
        let html = page_html(&site, &p.entry, &rendered, depth, &published);
        files.insert(format!("{}index.html", p.entry.url), html.into_bytes());
    }

    // Index (+ optional home note on top).
    let home_html = site.home.as_deref().and_then(|h| {
        let p = published.iter().find(|p| p.entry.path == h)?;
        render_body(root, &p.note, 0, &all, &by_path, &mut assets).ok()
    });
    files.insert("index.html".into(), index_html(&site, &published, home_html.as_deref()).into_bytes());
    let search: Vec<SearchEntry> = published.iter().map(|p| SearchEntry { entry: &p.entry, text: search_text(&p.note.body, SEARCH_TEXT_LIMIT) }).collect();
    files.insert("search.json".into(), serde_json::to_vec(&search).map_err(json_err)?);
    files.insert("style.css".into(), STYLE.as_bytes().to_vec());

    // Assets the pages reference, copied byte for byte.
    for a in &assets {
        let src = root.join(a);
        if let Ok(bytes) = std::fs::read(&src) {
            files.insert(a.clone(), bytes);
        }
    }

    // Write, then prune what the previous build wrote and this one did not.
    std::fs::create_dir_all(out)?;
    for (rel, bytes) in &files {
        let dest = out.join(rel);
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(&dest, bytes)?;
    }
    let mut removed = Vec::new();
    for old in &previous.files {
        if !files.contains_key(old) {
            let path = out.join(old);
            if path.is_file() && std::fs::remove_file(&path).is_ok() {
                removed.push(old.clone());
                // Drop directories left empty behind it.
                let mut dir = path.parent();
                while let Some(d) = dir {
                    if d == out || std::fs::remove_dir(d).is_err() { break; }
                    dir = d.parent();
                }
            }
        }
    }
    let manifest = Manifest { files: files.keys().cloned().collect() };
    std::fs::write(&manifest_path, serde_json::to_string_pretty(&manifest).map_err(json_err)?)?;

    Ok(Report {
        out_dir: out.to_path_buf(),
        pages: published.into_iter().map(|p| p.entry).collect(),
        assets: assets.into_iter().collect(),
        removed,
    })
}

fn json_err(e: serde_json::Error) -> AppError {
    AppError::Other(e.to_string())
}

// ── Markdown → HTML ─────────────────────────────────────────────────────────

/// `"../".repeat(depth)` — the way from a page at `depth` back to the site root.
fn up(depth: usize) -> String {
    "../".repeat(depth)
}

/// Rewrite `[[wiki links]]` before Markdown parsing: a link to a published
/// note becomes a relative Markdown link, a link to anything else becomes
/// its display text. Embeds (`![[note]]`) become links too — the reader can
/// follow them, and no unpublished body is ever inlined.
fn rewrite_wiki_links(body: &str, depth: usize, all: &[NoteEntry], by_path: &BTreeMap<&str, &PublishEntry>) -> String {
    let mut out = String::with_capacity(body.len());
    let mut rest = body;
    while let Some(start) = rest.find("[[") {
        let embed = rest[..start].ends_with('!');
        let before = if embed { &rest[..start - 1] } else { &rest[..start] };
        out.push_str(before);
        let Some(end) = rest[start + 2..].find("]]") else {
            out.push_str(&rest[start..]);
            rest = "";
            break;
        };
        let inner = &rest[start + 2..start + 2 + end];
        rest = &rest[start + 2 + end + 2..];
        if inner.contains('\n') || inner.trim().is_empty() {
            out.push_str("[[");
            out.push_str(inner);
            out.push_str("]]");
            continue;
        }
        let link = note::parse_wiki_link(inner);
        let label = link.label();
        let resolved = vault::resolve(all, &link.target).and_then(|e| by_path.get(e.path.as_str()));
        match resolved {
            Some(entry) => {
                let anchor = link.section.as_deref().map(|s| format!("#{}", slug(s))).unwrap_or_default();
                out.push_str(&format!("[{}]({}{}{})", escape_md(&label), up(depth), entry.url, anchor));
            }
            None => out.push_str(&label),
        }
    }
    out.push_str(rest);
    out
}

fn escape_md(s: &str) -> String {
    s.replace('[', "\\[").replace(']', "\\]")
}

/// `My Section` → `my-section`, for heading anchors.
fn slug(s: &str) -> String {
    let mut out = String::new();
    let mut dash = false;
    for c in s.chars() {
        if c.is_alphanumeric() {
            out.extend(c.to_lowercase());
            dash = false;
        } else if !dash && !out.is_empty() {
            out.push('-');
            dash = true;
        }
    }
    out.trim_end_matches('-').to_string()
}

/// A vault-relative reference a page may carry along: no scheme, no `..`,
/// nothing hidden, and the file exists.
fn local_asset(root: &Path, url: &str) -> Option<String> {
    if url.contains("://") || url.starts_with("data:") || url.starts_with('/') || url.starts_with('#') {
        return None;
    }
    let clean = url.split(['?', '#']).next().unwrap_or(url);
    let p = Path::new(clean);
    if p.components().any(|c| matches!(c, std::path::Component::ParentDir) || vault::is_hidden_component(&c)) {
        return None;
    }
    if !root.join(clean).is_file() {
        return None;
    }
    Some(clean.to_string())
}

fn render_body(
    root: &Path,
    note: &Note,
    depth: usize,
    all: &[NoteEntry],
    by_path: &BTreeMap<&str, &PublishEntry>,
    assets: &mut BTreeSet<String>,
) -> Result<String> {
    use pulldown_cmark::{html, CodeBlockKind, CowStr, Event, HeadingLevel, Options, Parser, Tag, TagEnd};

    // A collection's own page shows its views first, as the app does, unless
    // the body places them itself with a `cortex-views` fence.
    let mut out = String::new();
    if let Some(coll) = own_collection(&note.path) {
        if !note.body.contains("```cortex-views") {
            out.push_str(&render_collection_views(root, coll, depth, by_path));
        }
    }

    let md = rewrite_wiki_links(&note.body, depth, all, by_path);
    let mut opts = Options::empty();
    opts.insert(Options::ENABLE_TABLES);
    opts.insert(Options::ENABLE_STRIKETHROUGH);
    opts.insert(Options::ENABLE_TASKLISTS);
    opts.insert(Options::ENABLE_FOOTNOTES);
    // `$…$` / `$$…$$` (the editor's math syntax). The site ships no KaTeX, so
    // the source is shown as-is in a `.math` span; parsing it as math keeps
    // `_` and `*` inside an equation from being read as emphasis.
    opts.insert(Options::ENABLE_MATH);

    // Headings get ids so `[[note#section]]` links land; images and `.md`
    // links get rewritten and the assets collected.
    let mut heading_text: Option<String> = None;
    // A `cortex-view` / `cortex-views` / `cortex-chart` fence being collected,
    // to render as a table where the code block would have gone.
    let mut fence: Option<(String, String)> = None;
    let mut events: Vec<Event> = Vec::new();
    for ev in Parser::new_ext(&md, opts) {
        match ev {
            Event::Start(Tag::CodeBlock(CodeBlockKind::Fenced(ref lang))) if is_view_fence(lang) => {
                fence = Some((lang.trim().to_string(), String::new()));
            }
            Event::Text(ref t) if fence.is_some() => fence.as_mut().unwrap().1.push_str(t),
            Event::End(TagEnd::CodeBlock) if fence.is_some() => {
                let (lang, spec) = fence.take().unwrap();
                events.push(Event::Html(CowStr::from(render_fence(root, &lang, &spec, &note.path, depth, by_path))));
            }
            Event::Start(Tag::Image { link_type, dest_url, title, id }) => {
                let dest = match local_asset(root, &dest_url) {
                    Some(rel) => {
                        assets.insert(rel.clone());
                        CowStr::from(format!("{}{}", up(depth), rel))
                    }
                    None => dest_url,
                };
                events.push(Event::Start(Tag::Image { link_type, dest_url: dest, title, id }));
            }
            Event::Start(Tag::Link { link_type, dest_url, title, id }) => {
                let dest = if dest_url.ends_with(".md") && !dest_url.contains("://") {
                    match by_path.get(dest_url.as_ref()) {
                        Some(e) => CowStr::from(format!("{}{}", up(depth), e.url)),
                        None => dest_url,
                    }
                } else if let Some(rel) = local_asset(root, &dest_url) {
                    assets.insert(rel.clone());
                    CowStr::from(format!("{}{}", up(depth), rel))
                } else {
                    dest_url
                };
                events.push(Event::Start(Tag::Link { link_type, dest_url: dest, title, id }));
            }
            Event::Start(Tag::Heading { level, id, classes, attrs }) => {
                heading_text = Some(String::new());
                events.push(Event::Start(Tag::Heading { level, id, classes, attrs }));
            }
            Event::Text(ref t) if heading_text.is_some() => {
                heading_text.as_mut().unwrap().push_str(t);
                events.push(ev);
            }
            Event::End(TagEnd::Heading(level)) => {
                // Patch the id onto the Start event we pushed for this heading.
                let text = heading_text.take().unwrap_or_default();
                let id = slug(&text);
                if let Some(Event::Start(Tag::Heading { id: hid, .. })) = events.iter_mut().rev().find(|e| matches!(e, Event::Start(Tag::Heading { .. }))) {
                    if !id.is_empty() { *hid = Some(CowStr::from(id)); }
                }
                let _ = HeadingLevel::H1;
                events.push(Event::End(TagEnd::Heading(level)));
            }
            other => events.push(other),
        }
    }
    let mut body = String::new();
    html::push_html(&mut body, events.into_iter());
    out.push_str(&highlights(&callouts(&body)));
    Ok(out)
}

// ── Database views ──────────────────────────────────────────────────────────
// A `cortex-view` fence, a `cortex-views` fence, and the `views:` of a
// collection's `_index.md` all render as static tables through the same
// `data::resolve_view` the app's table uses — columns, filter, sort, summary
// and number formats included. Other view types (board, calendar, gallery,
// chart, timeline, tracker) degrade to that table with a note saying which
// view they were. Rows link to their own page when that row is published.

fn is_view_fence(lang: &str) -> bool {
    matches!(lang.trim(), "cortex-view" | "cortex-views" | "cortex-chart")
}

/// `collections/<name>/_index.md` → `<name>`.
fn own_collection(path: &str) -> Option<&str> {
    path.strip_prefix("collections/")?.strip_suffix("/_index.md").filter(|c| !c.is_empty() && !c.contains('/'))
}

fn render_fence(root: &Path, lang: &str, spec: &str, note_path: &str, depth: usize, by_path: &BTreeMap<&str, &PublishEntry>) -> String {
    match lang {
        "cortex-views" => {
            let named = spec.lines().find_map(|l| l.trim().strip_prefix("collection:")).map(str::trim).filter(|c| !c.is_empty());
            match named.or_else(|| own_collection(note_path)) {
                Some(coll) => render_collection_views(root, coll, depth, by_path),
                None => String::new(),
            }
        }
        "cortex-chart" if !spec.lines().any(|l| l.starts_with("type:")) => {
            render_view(root, &format!("type: chart\n{spec}"), None, depth, by_path)
        }
        _ => render_view(root, spec, None, depth, by_path),
    }
}

/// The views a collection's `_index.md` declares, each as `(name, spec)` —
/// the frontmatter entry with the collection's `source:` added, the same
/// spec the app builds for its tabs.
fn collection_views(root: &Path, coll: &str) -> Vec<(String, String)> {
    let Ok(text) = std::fs::read_to_string(root.join("collections").join(coll).join("_index.md")) else { return vec![] };
    let Ok(note) = note::parse_note("_index.md", &text) else { return vec![] };
    let Some(views) = note.frontmatter.get("views").and_then(|v| v.as_array()) else { return vec![] };
    views.iter().filter_map(|v| {
        let mut obj = v.as_object()?.clone();
        let name = obj.remove("name").and_then(|n| n.as_str().map(str::to_string))
            .or_else(|| obj.get("type").and_then(|t| t.as_str()).map(str::to_string))
            .unwrap_or_else(|| "Table".into());
        obj.insert("source".into(), serde_json::Value::String(format!("collections/{coll}")));
        let spec = serde_yaml::to_string(&serde_json::Value::Object(obj)).ok()?;
        Some((name, spec))
    }).collect()
}

fn render_collection_views(root: &Path, coll: &str, depth: usize, by_path: &BTreeMap<&str, &PublishEntry>) -> String {
    collection_views(root, coll).iter().map(|(name, spec)| render_view(root, spec, Some(name), depth, by_path)).collect()
}

/// One view as a `<section class="view">`: its name (when it has one), a
/// note when the type is not a table, and the table itself.
fn render_view(root: &Path, spec_yaml: &str, name: Option<&str>, depth: usize, by_path: &BTreeMap<&str, &PublishEntry>) -> String {
    let mut out = String::from("<section class=\"view\">\n");
    if let Some(n) = name {
        out.push_str(&format!("<h3 class=\"view-name\">{}</h3>\n", esc(n)));
    }
    let spec: crate::data::ViewSpec = match serde_yaml::from_str(spec_yaml) {
        Ok(s) => s,
        Err(e) => {
            out.push_str(&format!("<p class=\"view-note\">View not rendered: {}</p>\n</section>\n", esc(&e.to_string())));
            return out;
        }
    };
    let kind = spec.kind.as_deref().map(str::trim).filter(|k| !k.is_empty()).unwrap_or("table");
    if kind != "table" {
        out.push_str(&format!("<p class=\"view-note\">A {} view, shown here as a table.</p>\n", esc(kind)));
    }
    let table = if kind == "chart" {
        crate::data::run_chart(root, spec_yaml).map(|c| chart_table(&c))
    } else {
        crate::data::resolve_view(root, spec_yaml).map(|t| view_table(&t, &spec, depth, by_path))
    };
    match table {
        Ok(html) => out.push_str(&html),
        Err(e) => out.push_str(&format!("<p class=\"view-note\">View not rendered: {}</p>\n", esc(&e.to_string()))),
    }
    out.push_str("</section>\n");
    out
}

/// A chart's aggregated points as a table: one row per x, one column per series.
fn chart_table(c: &crate::data::ChartResult) -> String {
    let mut out = format!("<table class=\"view-table\">\n<thead><tr><th>{}</th>", esc(&c.x_label));
    if c.series.is_empty() {
        out.push_str(&format!("<th>{}</th>", esc(&c.y_label)));
    } else {
        for s in &c.series { out.push_str(&format!("<th>{}</th>", esc(&s.name))); }
    }
    out.push_str("</tr></thead>\n<tbody>\n");
    let xs: Vec<&str> = if c.series.is_empty() { c.points.iter().map(|p| p.x.as_str()).collect() } else {
        let mut xs: Vec<&str> = Vec::new();
        for s in &c.series { for p in &s.points { if !xs.contains(&p.x.as_str()) { xs.push(&p.x); } } }
        xs
    };
    for x in xs {
        out.push_str(&format!("<tr><td>{}</td>", esc(x)));
        if c.series.is_empty() {
            let y = c.points.iter().find(|p| p.x == x).map(|p| fmt_num(p.y)).unwrap_or_default();
            out.push_str(&format!("<td>{y}</td>"));
        } else {
            for s in &c.series {
                let y = s.points.iter().find(|p| p.x == x).map(|p| fmt_num(p.y)).unwrap_or_default();
                out.push_str(&format!("<td>{y}</td>"));
            }
        }
        out.push_str("</tr>\n");
    }
    out.push_str("</tbody></table>\n");
    out
}

/// The rows of a resolved view as HTML: grouped sections when the spec asks,
/// a summary footer when it asks, the title cell (else the first) linking to
/// the row's page when that row is published.
fn view_table(t: &crate::data::ResolvedTable, spec: &crate::data::ViewSpec, depth: usize, by_path: &BTreeMap<&str, &PublishEntry>) -> String {
    use crate::data::ResolvedRow;
    let cols = &t.columns;
    if cols.is_empty() {
        return "<p class=\"view-note\">No rows.</p>\n".to_string();
    }
    let link_col = cols.iter().position(|c| c.key == "title").unwrap_or(0);
    let coll = spec.source.strip_prefix("collections/").map(|c| c.trim_end_matches('/'));
    let href = |row: &ResolvedRow| -> Option<String> {
        let path = format!("collections/{}/{}.md", coll?, row.id);
        by_path.get(path.as_str()).map(|e| format!("{}{}", up(depth), e.url))
    };

    let mut out = String::from("<table class=\"view-table\">\n<thead><tr>");
    for c in cols { out.push_str(&format!("<th>{}</th>", esc(&c.key))); }
    out.push_str("</tr></thead>\n");

    let row_html = |row: &ResolvedRow| -> String {
        let mut s = String::from("<tr>");
        for (i, c) in cols.iter().enumerate() {
            let v = row.cells.get(&c.key).unwrap_or(&serde_json::Value::Null);
            let cell = cell_html(v, c.schema.as_ref());
            match (i == link_col, href(row)) {
                (true, Some(url)) => s.push_str(&format!("<td><a href=\"{}\">{}</a></td>", esc(&url), cell)),
                _ => s.push_str(&format!("<td>{cell}</td>")),
            }
        }
        s.push_str("</tr>\n");
        s
    };

    match spec.group.as_deref().map(str::trim).filter(|g| !g.is_empty()) {
        Some(field) => {
            let options = cols.iter().find(|c| c.key == field).and_then(|c| c.schema.as_ref()).map(|s| s.options.iter().map(|o| o.name.clone()).collect::<Vec<_>>()).unwrap_or_default();
            for (key, rows) in group_rows(&t.rows, field, &options) {
                let label = if key == "—" { format!("No {}", esc(field)) } else { esc(&key) };
                out.push_str(&format!(
                    "<tbody class=\"group\">\n<tr class=\"group-row\"><th colspan=\"{}\">{label} <span class=\"count\">{}</span></th></tr>\n",
                    cols.len(), rows.len()
                ));
                for r in rows { out.push_str(&row_html(r)); }
                out.push_str("</tbody>\n");
            }
        }
        None => {
            out.push_str("<tbody>\n");
            for r in &t.rows { out.push_str(&row_html(r)); }
            out.push_str("</tbody>\n");
        }
    }

    if !t.summary.is_empty() {
        out.push_str("<tfoot><tr class=\"summary\">");
        for c in cols {
            match (spec.summary.get(&c.key).map(|f| f.trim()).filter(|f| !f.is_empty()), t.summary.get(&c.key)) {
                (Some(func), Some(v)) => out.push_str(&format!(
                    "<td><span class=\"summary-label\">{}</span> {}</td>",
                    summary_label(func), summary_html(v, func, c.schema.as_ref())
                )),
                _ => out.push_str("<td></td>"),
            }
        }
        out.push_str("</tr></tfoot>\n");
    }
    out.push_str("</table>\n");
    out
}

/// Rows bucketed by `field`: the property's option order first, then other
/// values alphabetically, then the rows with none (`—`) — the app's buckets.
fn group_rows<'a>(rows: &'a [crate::data::ResolvedRow], field: &str, options: &[String]) -> Vec<(String, Vec<&'a crate::data::ResolvedRow>)> {
    let mut groups: BTreeMap<String, Vec<&crate::data::ResolvedRow>> = BTreeMap::new();
    for r in rows {
        let key = r.cells.get(field).map(json_text).unwrap_or_default();
        groups.entry(if key.is_empty() { "—".into() } else { key }).or_default().push(r);
    }
    let mut ordered = Vec::new();
    for o in options {
        if let Some(rs) = groups.remove(o) { ordered.push((o.clone(), rs)); }
    }
    let none = groups.remove("—");
    ordered.extend(groups);
    if let Some(rs) = none { ordered.push(("—".into(), rs)); }
    ordered
}

/// A cell's raw text: lists joined, numbers without a trailing `.0`.
fn json_text(v: &serde_json::Value) -> String {
    match v {
        serde_json::Value::Null => String::new(),
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Number(n) => n.as_f64().map(fmt_num).unwrap_or_default(),
        serde_json::Value::Bool(b) => b.to_string(),
        serde_json::Value::Array(a) => a.iter().map(json_text).collect::<Vec<_>>().join(", "),
        other => other.to_string(),
    }
}

fn as_number(v: &serde_json::Value) -> Option<f64> {
    match v {
        serde_json::Value::Number(n) => n.as_f64().filter(|f| f.is_finite()),
        serde_json::Value::String(s) if !s.trim().is_empty() => s.trim().parse::<f64>().ok().filter(|f| f.is_finite()),
        _ => None,
    }
}

/// `12` / `3.5` — an integer plainly, anything else to one decimal.
fn fmt_num(n: f64) -> String {
    if !n.is_finite() { return "—".into(); }
    if n.fract() == 0.0 { format!("{}", n as i64) } else { format!("{n:.1}") }
}

/// `1234567.89` with `decimals` → `1,234,567.89`.
fn grouped(n: f64, decimals: usize) -> String {
    let s = format!("{:.*}", decimals, n.abs());
    let (int, frac) = s.split_once('.').map(|(i, f)| (i, Some(f))).unwrap_or((&s, None));
    let mut out = String::new();
    for (i, c) in int.chars().enumerate() {
        if i > 0 && (int.len() - i) % 3 == 0 { out.push(','); }
        out.push(c);
    }
    if let Some(f) = frac { out.push('.'); out.push_str(f); }
    if n < 0.0 { format!("-{out}") } else { out }
}

/// The text of a number under a schema's `format:` — what the app shows.
fn format_number(n: f64, schema: Option<&crate::schema::PropertyDef>) -> String {
    let unit = schema.and_then(|s| s.unit.as_deref()).unwrap_or("");
    match schema.and_then(|s| s.format.as_deref()) {
        Some("percent") => format!("{}%", fmt_num(n)),
        Some("currency") => format!("{unit}{}", grouped(n, 2)),
        Some("integer") => grouped(n.round(), 0),
        Some("decimal") => grouped(n, 1),
        Some("progress") => {
            // A bare 0–100 bar is a share, so it reads as one; a custom range or unit reads as itself.
            let bare = schema.map_or(true, |s| s.min.is_none() && s.max.is_none()) && unit.is_empty();
            format!("{}{}", fmt_num(n), if bare { "%" } else { unit })
        }
        _ => fmt_num(n),
    }
}

/// One cell at rest: `—` for nothing, Yes/No, lists joined, and numbers
/// drawn as the column's format asks (stars, a progress bar, a unit).
fn cell_html(v: &serde_json::Value, schema: Option<&crate::schema::PropertyDef>) -> String {
    let format = schema.and_then(|s| s.format.as_deref());
    if let (Some("stars"), Some(s)) = (format, schema) {
        let max = s.max.map(|m| m.round().max(1.0) as usize).unwrap_or(5);
        let n = as_number(v);
        let filled = n.map(|n| (n.round().max(0.0) as usize).min(max)).unwrap_or(0);
        let title = n.map(|n| format!("{} of {max}", fmt_num(n))).unwrap_or_else(|| "—".into());
        return format!("<span class=\"stars\" title=\"{title}\">{}{}</span>", "★".repeat(filled), "☆".repeat(max - filled));
    }
    let n = match v {
        serde_json::Value::Null => return "—".into(),
        serde_json::Value::Bool(b) => return if *b { "Yes" } else { "No" }.into(),
        serde_json::Value::Array(a) if a.is_empty() => return "—".into(),
        serde_json::Value::Array(_) => return esc(&json_text(v)),
        serde_json::Value::String(s) if s.is_empty() => return "—".into(),
        _ if format.is_some() => as_number(v),
        serde_json::Value::Number(_) => as_number(v),
        _ => None,
    };
    let Some(n) = n else { return esc(&json_text(v)) };
    if let (Some("progress"), Some(s)) = (format, schema) {
        let (lo, hi) = (s.min.unwrap_or(0.0), s.max.unwrap_or(100.0));
        let pct = if hi > lo { ((n - lo) / (hi - lo) * 100.0).clamp(0.0, 100.0) } else { 0.0 };
        return format!(
            "<span class=\"progress\"><span class=\"progress-track\"><span class=\"progress-fill\" style=\"width:{}%\"></span></span> {}</span>",
            fmt_num(pct), esc(&format_number(n, schema))
        );
    }
    esc(&format_number(n, schema))
}

fn summary_label(func: &str) -> &'static str {
    match func {
        "count" => "Count",
        "empty" => "Empty",
        "not_empty" => "Not empty",
        "percent_checked" => "Checked",
        "sum" => "Sum",
        "avg" => "Average",
        "min" => "Min",
        "max" => "Max",
        _ => "Summary",
    }
}

/// A footer value: a share as `n%`, counts plain, arithmetic in the column's
/// number format (bars and stars make no sense for a total).
fn summary_html(v: &serde_json::Value, func: &str, schema: Option<&crate::schema::PropertyDef>) -> String {
    let Some(n) = as_number(v) else { return cell_html(v, None) };
    match func {
        "percent_checked" => format!("{}%", fmt_num(n)),
        "count" | "empty" | "not_empty" => fmt_num(n),
        _ => match schema.and_then(|s| s.format.as_deref()) {
            Some("stars") | Some("progress") | None => fmt_num(n),
            Some(_) => esc(&format_number(n, schema)),
        },
    }
}

// ── Search index ────────────────────────────────────────────────────────────

/// How much of a body `search.json` carries per page.
const SEARCH_TEXT_LIMIT: usize = 2048;

/// One `search.json` entry: the page's listing plus the start of its body as
/// plain text, so the index page's search can find a word in a body and show
/// where it was. Only published pages are indexed — nothing private leaks.
#[derive(Debug, Clone, Serialize)]
struct SearchEntry<'a> {
    #[serde(flatten)]
    entry: &'a PublishEntry,
    text: String,
}

/// The body as plain text: Markdown stripped, wiki links reduced to their
/// label, view fences and raw HTML dropped, whitespace collapsed, and cut at
/// `limit` characters.
fn search_text(body: &str, limit: usize) -> String {
    use pulldown_cmark::{CodeBlockKind, Event, Options, Parser, Tag, TagEnd};
    let md = rewrite_wiki_links(body, 0, &[], &BTreeMap::new());
    let mut opts = Options::empty();
    opts.insert(Options::ENABLE_TABLES);
    opts.insert(Options::ENABLE_STRIKETHROUGH);
    opts.insert(Options::ENABLE_TASKLISTS);
    opts.insert(Options::ENABLE_FOOTNOTES);
    opts.insert(Options::ENABLE_MATH);
    let mut words: Vec<String> = Vec::new();
    let mut skipping = false;
    for ev in Parser::new_ext(&md, opts) {
        match ev {
            Event::Start(Tag::CodeBlock(CodeBlockKind::Fenced(ref lang))) if is_view_fence(lang) => skipping = true,
            Event::End(TagEnd::CodeBlock) => skipping = false,
            _ if skipping => {}
            Event::Text(t) | Event::Code(t) | Event::InlineMath(t) | Event::DisplayMath(t) => {
                words.extend(t.split_whitespace().map(str::to_string));
            }
            _ => {}
        }
    }
    let mut out = String::new();
    for w in words {
        if out.len() + w.len() + 1 > limit {
            // Keep a legible start even when the first word alone is oversized.
            if out.is_empty() {
                let mut end = limit.min(w.len());
                while !w.is_char_boundary(end) { end -= 1; }
                out.push_str(&w[..end]);
            }
            break;
        }
        if !out.is_empty() { out.push(' '); }
        out.push_str(&w);
    }
    out
}

/// `==text==` (the editor's highlight syntax, as in Obsidian) → `<mark>`.
/// Works on the rendered HTML so a span may cross inline tags
/// (`==<strong>a</strong> b==`); `<code>` runs are left alone and the
/// markers must hug their text, so `a == b` in prose is not a highlight.
fn highlights(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut rest = html;
    loop {
        // Copy code runs through untouched, then mark up the prose before the next one.
        let (prose, code, tail) = match rest.find("<code") {
            Some(i) => match rest[i..].find("</code>") {
                Some(j) => (&rest[..i], &rest[i..i + j + "</code>".len()], &rest[i + j + "</code>".len()..]),
                None => (rest, "", ""),
            },
            None => (rest, "", ""),
        };
        out.push_str(&mark_spans(prose));
        out.push_str(code);
        if tail.is_empty() {
            return out;
        }
        rest = tail;
    }
}

fn mark_spans(prose: &str) -> String {
    let hugs = |c: char| !c.is_whitespace();
    let mut out = String::with_capacity(prose.len());
    let mut rest = prose;
    while let Some(open) = rest.find("==") {
        let inner = &rest[open + 2..];
        // Opening marker must be followed by text, closing marker preceded by it.
        let close = inner.chars().next().filter(|&c| hugs(c) && c != '=').and_then(|_| {
            inner.match_indices("==").find(|(k, _)| inner[..*k].chars().last().is_some_and(hugs)).map(|(k, _)| k)
        });
        match close {
            Some(k) => {
                out.push_str(&rest[..open]);
                out.push_str("<mark>");
                out.push_str(&inner[..k]);
                out.push_str("</mark>");
                rest = &inner[k + 2..];
            }
            None => {
                out.push_str(&rest[..open + 2]);
                rest = inner;
            }
        }
    }
    out.push_str(rest);
    out
}

/// `> [!tip] text` blockquotes (the editor's callout syntax) → a styled aside.
fn callouts(html: &str) -> String {
    const KINDS: [&str; 8] = ["note", "tip", "info", "warning", "caution", "important", "question", "example"];
    let mut out = String::with_capacity(html.len());
    let mut rest = html;
    while let Some(i) = rest.find("<blockquote>\n<p>[!") {
        out.push_str(&rest[..i]);
        let after = &rest[i + "<blockquote>\n<p>[!".len()..];
        let Some(close) = after.find(']') else {
            out.push_str("<blockquote>\n<p>[!");
            rest = after;
            continue;
        };
        let kind_raw = after[..close].to_lowercase();
        let kind = if KINDS.contains(&kind_raw.as_str()) { kind_raw.clone() } else { "note".to_string() };
        let mut label = kind_raw.clone();
        if let Some(f) = label.get_mut(0..1) { f.make_ascii_uppercase(); }
        let body = after[close + 1..].trim_start();
        out.push_str(&format!("<blockquote class=\"callout callout-{kind}\"><p><strong class=\"callout-label\">{label}</strong> "));
        rest = body;
    }
    out.push_str(rest);
    out
}

// ── HTML ────────────────────────────────────────────────────────────────────

fn esc(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

fn meta_line(entry: &PublishEntry) -> String {
    let mut parts = Vec::new();
    if let Some(c) = &entry.created {
        parts.push(format!("<time datetime=\"{0}\">{0}</time>", esc(c)));
    }
    for t in entry.tags.iter().filter(|t| t.as_str() != "public") {
        parts.push(format!("<span class=\"tag\">{}</span>", esc(t)));
    }
    if parts.is_empty() { String::new() } else { format!("<p class=\"meta\">{}</p>", parts.join(" ")) }
}

fn shell(site: &Site, title: &str, depth: usize, body: &str) -> String {
    let root = up(depth);
    format!(
        "<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n<title>{title} · {site}</title>\n<link rel=\"stylesheet\" href=\"{root}style.css\">\n</head>\n<body>\n<header class=\"site\"><a href=\"{root}\">{site}</a></header>\n<main>\n{body}\n</main>\n<footer class=\"site\">Published from a <a href=\"https://github.com/frontal-cortex/cortex\">Cortex</a> vault.</footer>\n</body>\n</html>\n",
        title = esc(title),
        site = esc(&site.title),
        root = root,
        body = body,
    )
}

fn page_html(site: &Site, entry: &PublishEntry, body: &str, depth: usize, _all: &[Published]) -> String {
    let inner = format!(
        "<article>\n<h1>{}</h1>\n{}\n{}\n</article>",
        esc(&entry.title),
        meta_line(entry),
        body,
    );
    shell(site, &entry.title, depth, &inner)
}

fn index_html(site: &Site, published: &[Published], home: Option<&str>) -> String {
    let mut inner = String::new();
    if let Some(h) = home {
        inner.push_str(&format!("<article class=\"home\">\n{h}\n</article>\n"));
    } else {
        inner.push_str(&format!("<h1>{}</h1>\n", esc(&site.title)));
    }
    inner.push_str("<section class=\"notes\">\n<input id=\"q\" type=\"search\" placeholder=\"Search notes\" autocomplete=\"off\">\n<ul id=\"list\">\n");
    for p in published {
        let e = &p.entry;
        let tags: Vec<String> = e.tags.iter().filter(|t| t.as_str() != "public").map(|t| esc(t)).collect();
        inner.push_str(&format!(
            "<li data-text=\"{search}\" data-url=\"{url}\"><a href=\"{url}\">{title}</a>{date}{tags}</li>\n",
            search = esc(&format!("{} {}", e.title, e.tags.join(" ")).to_lowercase()),
            url = esc(&e.url),
            title = esc(&e.title),
            date = e.created.as_deref().map(|c| format!(" <time>{}</time>", esc(c))).unwrap_or_default(),
            tags = if tags.is_empty() { String::new() } else { format!(" <span class=\"tags\">{}</span>", tags.join(" ")) },
        ));
    }
    inner.push_str("</ul>\n<p id=\"none\" hidden>Nothing matches.</p>\n</section>\n");
    inner.push_str(SEARCH_SCRIPT);
    shell(site, "Notes", 0, &inner)
}

const SEARCH_SCRIPT: &str = r#"<script>
(function(){var q=document.getElementById('q'),items=[].slice.call(document.querySelectorAll('#list li')),none=document.getElementById('none'),idx=null,loading=false;
// Titles and tags are inline; body text comes from search.json, fetched on the first keystroke (a file:// page falls back to titles).
function load(cb){if(idx){cb();return}if(loading)return;loading=true;
fetch('search.json').then(function(r){return r.json()}).then(function(d){idx={};d.forEach(function(e){var t=e.text||'';idx[e.url]={t:t,l:t.toLowerCase()}})}).catch(function(){idx={}}).then(function(){loading=false;cb()})}
function snippet(li,body,w){var s=li.querySelector('.snippet');if(!s){s=document.createElement('span');s.className='snippet';li.appendChild(s)}
var hit=-1,len=0;if(body)w.forEach(function(x){var i=body.l.indexOf(x);if(i>=0&&(hit<0||i<hit)){hit=i;len=x.length}});
if(hit<0){s.textContent='';s.hidden=true;return}
var src=body.t.length===body.l.length?body.t:body.l,a=Math.max(0,hit-40),b=Math.min(src.length,hit+len+80);
s.textContent=(a>0?'…':'')+src.slice(a,b)+(b<src.length?'…':'');s.hidden=false}
function run(){var w=q.value.trim().toLowerCase().split(/\s+/).filter(Boolean),n=0;
items.forEach(function(li){var t=li.getAttribute('data-text'),body=idx&&idx[li.getAttribute('data-url')],ok=w.every(function(x){return t.indexOf(x)>=0||(body&&body.l.indexOf(x)>=0)});li.hidden=!ok;if(ok)n++;snippet(li,ok&&w.length?body:null,w)});none.hidden=n>0||!w.length}
q.addEventListener('input',function(){run();if(q.value.trim())load(run)});})();
</script>"#;

const STYLE: &str = r#":root{--bg:#fbfaf8;--fg:#1f1e1c;--muted:#6f6c66;--line:#e6e3dd;--accent:#2d6bd1;--code:#f1efea;--font:"iA Writer Quattro S","Ysabeau",Georgia,"Times New Roman",serif;--sans:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;--mono:ui-monospace,SFMono-Regular,Menlo,monospace}
@media (prefers-color-scheme:dark){:root{--bg:#191918;--fg:#e8e6e0;--muted:#928f87;--line:#2a2927;--accent:#7fb0ff;--code:#232220}}
html{background:var(--bg);color:var(--fg)}body{margin:0;font-family:var(--font);font-size:18px;line-height:1.6;-webkit-font-smoothing:antialiased}
header.site,footer.site{font-family:var(--sans);font-size:14px;color:var(--muted);max-width:720px;margin:0 auto;padding:20px 24px}
header.site a{color:var(--muted);text-decoration:none;font-weight:600;letter-spacing:.01em}header.site a:hover{color:var(--fg)}
footer.site{border-top:1px solid var(--line);margin-top:48px}footer.site a{color:var(--muted)}
main{max-width:720px;margin:0 auto;padding:8px 24px 24px}
h1{font-size:2.1em;line-height:1.15;letter-spacing:-.02em;margin:.4em 0 .3em}h2{font-size:1.45em;margin:1.6em 0 .5em;line-height:1.25}h3{font-size:1.15em;margin:1.4em 0 .4em}
h2[id],h3[id]{scroll-margin-top:24px}
p.meta{font-family:var(--sans);font-size:13px;color:var(--muted);margin:0 0 1.8em;display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center}
.tag,.tags span{font-family:var(--sans);font-size:12px;background:var(--code);color:var(--muted);border-radius:4px;padding:1px 7px}
a{color:var(--accent)}a:hover{text-decoration-thickness:2px}
img{max-width:100%;height:auto;border-radius:6px}
code{font-family:var(--mono);font-size:.88em;background:var(--code);padding:2px 5px;border-radius:4px}pre{background:var(--code);padding:14px 16px;border-radius:8px;overflow:auto;line-height:1.45}pre code{background:none;padding:0}
blockquote{border-left:3px solid var(--line);margin:1.2em 0;padding:0 0 0 18px;color:var(--muted)}
blockquote.callout{border-left-color:var(--accent);color:var(--fg);background:var(--code);padding:12px 18px;border-radius:0 8px 8px 0}
.callout-label{font-family:var(--sans);font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:var(--accent);display:block;margin-bottom:4px}
.callout-warning,.callout-caution{border-left-color:#d9822b}.callout-warning .callout-label,.callout-caution .callout-label{color:#d9822b}
table{border-collapse:collapse;width:100%;font-family:var(--sans);font-size:15px;margin:1.2em 0}th,td{border-bottom:1px solid var(--line);padding:8px 10px;text-align:left;vertical-align:top}th{font-weight:600;color:var(--muted)}
hr{border:0;border-top:1px solid var(--line);margin:2em 0}
.math{font-family:var(--mono);font-size:.88em;background:var(--code);padding:2px 5px;border-radius:4px;white-space:pre-wrap}.math-display{display:block;text-align:center;padding:14px 16px;border-radius:8px;margin:1.2em 0;overflow:auto}
input[type=checkbox]{accent-color:var(--accent)}
.notes{font-family:var(--sans)}#q{width:100%;box-sizing:border-box;font:inherit;font-size:15px;padding:9px 12px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--fg);margin:8px 0 16px}#q:focus{outline:none;border-color:var(--accent)}
#list{list-style:none;padding:0;margin:0}#list li{display:flex;flex-wrap:wrap;gap:4px 12px;align-items:baseline;padding:10px 0;border-bottom:1px solid var(--line)}#list a{font-size:17px;text-decoration:none;color:var(--fg)}#list a:hover{color:var(--accent)}#list time{font-size:13px;color:var(--muted)}
article.home{margin-bottom:2.5em}#none{color:var(--muted)}
#list .snippet{flex-basis:100%;font-size:13px;color:var(--muted);line-height:1.4}
.view{margin:1.4em 0}.view-name{margin:0 0 .3em}.view-note{font-family:var(--sans);font-size:13px;color:var(--muted);margin:0 0 .5em}
.view-table{overflow-wrap:anywhere}.view-table td a{text-decoration:none;font-weight:600;color:var(--fg)}.view-table td a:hover{color:var(--accent)}
.view-table tr.group-row th{padding-top:18px;color:var(--fg);border-bottom-width:2px}.view-table .count{color:var(--muted);font-weight:400;margin-left:6px}
.view-table tfoot td{color:var(--muted);border-bottom:0;font-size:13px}.summary-label{text-transform:uppercase;letter-spacing:.05em;font-size:11px;margin-right:4px}
.stars{letter-spacing:1px;color:#d9a520;white-space:nowrap}
.progress{display:inline-flex;align-items:center;gap:8px;white-space:nowrap}.progress-track{display:inline-block;width:80px;height:6px;border-radius:3px;background:var(--line);overflow:hidden}.progress-fill{display:block;height:100%;background:var(--accent)}
"#;

// ── GitHub Pages ────────────────────────────────────────────────────────────

/// Where a gh-pages publish went.
#[derive(Debug, Clone, Serialize)]
pub struct PagesPush {
    pub remote: String,
    pub remote_url: String,
    pub branch: String,
    /// Best guess at the public URL for github.com remotes.
    pub url: Option<String>,
    pub report: Report,
}

/// Build into a scratch directory and force-push it as the sole commit on
/// `branch` of `remote` (an orphan branch: the site's history is not worth
/// keeping, and the vault's history must never ride along). Uses the
/// system `git` so the user's credentials work, like sync does.
pub fn push_gh_pages(root: &Path, remote: &str, branch: &str) -> Result<PagesPush> {
    let remote_url = git_out(root, &["remote", "get-url", remote])
        .map_err(|_| AppError::Other(format!("no git remote named '{remote}' — add one with: git remote add {remote} <url>")))?;

    let scratch = std::env::temp_dir().join(format!("cortex-publish-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&scratch);
    std::fs::create_dir_all(&scratch)?;
    let report = build(root, &scratch, true)?;
    // The manifest is a build-tool detail; the branch needs only the site.
    let _ = std::fs::remove_file(scratch.join(MANIFEST));
    // GitHub Pages runs Jekyll by default, which drops files starting with `_`.
    std::fs::write(scratch.join(".nojekyll"), "")?;

    let identity_name = git_out(root, &["config", "user.name"]).unwrap_or_else(|_| "cortex".into());
    let identity_email = git_out(root, &["config", "user.email"]).unwrap_or_else(|_| "cortex@localhost".into());
    let steps: [&[&str]; 5] = [
        &["init", "-q", "-b", branch],
        &["-c", "user.name=cortex", "-c", "user.email=cortex@localhost", "add", "-A"],
        &["-c", &format!("user.name={identity_name}"), "-c", &format!("user.email={identity_email}"), "commit", "-q", "-m", "Publish"],
        &["remote", "add", "origin", &remote_url],
        &["push", "-q", "--force", "origin", &format!("HEAD:refs/heads/{branch}")],
    ];
    for args in steps {
        let out = std::process::Command::new("git").args(args).current_dir(&scratch).output()?;
        if !out.status.success() {
            let _ = std::fs::remove_dir_all(&scratch);
            return Err(AppError::Other(format!("git {}: {}", args[0], String::from_utf8_lossy(&out.stderr).trim())));
        }
    }
    let _ = std::fs::remove_dir_all(&scratch);

    Ok(PagesPush { remote: remote.into(), remote_url: remote_url.clone(), branch: branch.into(), url: pages_url(&remote_url), report })
}

fn git_out(dir: &Path, args: &[&str]) -> Result<String> {
    let out = std::process::Command::new("git").args(args).current_dir(dir).output()?;
    if !out.status.success() {
        return Err(AppError::Other(String::from_utf8_lossy(&out.stderr).trim().to_string()));
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// `git@github.com:owner/repo.git` or `https://github.com/owner/repo` → `https://owner.github.io/repo/`.
pub fn pages_url(remote_url: &str) -> Option<String> {
    let rest = remote_url
        .strip_prefix("git@github.com:")
        .or_else(|| remote_url.strip_prefix("https://github.com/"))
        .or_else(|| remote_url.strip_prefix("ssh://git@github.com/"))?;
    let rest = rest.trim_end_matches('/').trim_end_matches(".git");
    let (owner, repo) = rest.split_once('/')?;
    if repo.eq_ignore_ascii_case(&format!("{owner}.github.io")) {
        Some(format!("https://{owner}.github.io/"))
    } else {
        Some(format!("https://{owner}.github.io/{repo}/"))
    }
}

// ── GitHub Action ───────────────────────────────────────────────────────────

/// A workflow that publishes to GitHub Pages **on demand** (Run workflow in
/// the Actions tab). The push trigger is included commented out: turning it
/// on means every sync republishes the flagged notes — a choice to make
/// deliberately, not a default.
pub const GITHUB_ACTION: &str = r#"# Publish the notes marked `publish: true` to GitHub Pages.
#
# Runs when you press "Run workflow" in the Actions tab. To publish on every
# push instead, uncomment the `push:` trigger — note that this makes every
# sync a publish of whatever is flagged at that moment.
#
# One-time setup: Settings → Pages → Source: "GitHub Actions".
name: Publish
on:
  workflow_dispatch:
  # push:
  #   branches: [main]
permissions:
  contents: read
  pages: write
  id-token: write
concurrency:
  group: pages
  cancel-in-progress: true
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - uses: Swatinem/rust-cache@v2
      - name: Install cortex
        run: cargo install --git https://github.com/frontal-cortex/cortex cortex-cli --locked
      - name: Build site
        run: cortex publish --out _site --force
      - uses: actions/upload-pages-artifact@v3
        with:
          path: _site
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
"#;

pub const GITHUB_ACTION_PATH: &str = ".github/workflows/publish.yml";

/// Write the workflow into the vault. Refuses to overwrite an existing one.
pub fn write_github_action(root: &Path) -> Result<PathBuf> {
    let path = root.join(GITHUB_ACTION_PATH);
    if path.exists() {
        return Err(AppError::Other(format!("{} already exists", GITHUB_ACTION_PATH)));
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&path, GITHUB_ACTION)?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn highlights_render_as_mark() {
        assert_eq!(highlights("<p>Some ==hot== text</p>"), "<p>Some <mark>hot</mark> text</p>");
        assert_eq!(highlights("<p>==<strong>a</strong> b== and ==c==</p>"), "<p><mark><strong>a</strong> b</mark> and <mark>c</mark></p>");
        // Markers must hug their text: comparisons in prose are not highlights.
        assert_eq!(highlights("<p>if a == b and c == d</p>"), "<p>if a == b and c == d</p>");
        // An unmatched marker is left alone.
        assert_eq!(highlights("<p>==open only</p>"), "<p>==open only</p>");
        // Code spans and fences are never touched, before or after a real highlight.
        assert_eq!(highlights("<p><code>a ==b== c</code> ==x==</p>"), "<p><code>a ==b== c</code> <mark>x</mark></p>");
        assert_eq!(highlights("<pre><code>if (==x==) {}\n</code></pre>"), "<pre><code>if (==x==) {}\n</code></pre>");
    }

    #[test]
    fn rich_formats_survive_publish() {
        let root = vault("rich");
        std::fs::write(root.join("notes/rich.md"), "---\ntitle: Rich\npublish: true\n---\n\nA ==mark== and <u>under</u>.\n\n<details><summary>More</summary>\n\nhidden\n\n</details>\n\n<img src=\"assets/pic.png\" alt=\"pic\" width=\"480\">\n").unwrap();
        let out = root.join("site");
        let report = build(&root, &out, false).unwrap();
        assert_eq!(report.assets, vec!["assets/pic.png"]);
        let page = std::fs::read_to_string(out.join("notes/rich/index.html")).unwrap();
        assert!(page.contains("A <mark>mark</mark> and <u>under</u>."), "{page}");
        assert!(page.contains("<details><summary>More</summary>"), "{page}");
        assert!(page.contains("<img src=\"assets/pic.png\" alt=\"pic\" width=\"480\">"), "{page}");
        let _ = std::fs::remove_dir_all(&root);
    }

    fn vault(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("cortex-publish-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("notes/ideas")).unwrap();
        std::fs::create_dir_all(dir.join("assets")).unwrap();
        std::fs::create_dir_all(dir.join("templates")).unwrap();
        std::fs::create_dir_all(dir.join(".cortex")).unwrap();
        let w = |rel: &str, s: &str| std::fs::write(dir.join(rel), s).unwrap();
        w("notes/public.md", "---\ntitle: Public Note\npublish: true\ncreated: 2026-09-01\ntags: [ideas]\n---\n\n# Intro\n\nSee [[Secret Note]] and [[Also Public|the other one]] and [[Also Public#Second]].\n\n![pic](assets/pic.png)\n\n> [!tip] Keep it short.\n\n![[Secret Note]]\n");
        w("notes/ideas/also-public.md", "---\ntitle: Also Public\ntags: [public, ideas]\ncreated: 2026-09-02\n---\n\nHello.\n\n## Second\n\nBody.\n");
        w("notes/secret.md", "---\ntitle: Secret Note\ncreated: 2026-09-03\n---\n\nDo not publish. TOPSECRET\n");
        w("templates/note.md", "---\ntitle: T\npublish: true\n---\n\nnever\n");
        w("assets/pic.png", "PNG");
        w("assets/unused.png", "PNG");
        dir
    }

    #[test]
    fn preview_selects_only_flagged_notes() {
        let root = vault("preview");
        let p = preview(&root).unwrap();
        let paths: Vec<&str> = p.iter().map(|e| e.path.as_str()).collect();
        assert_eq!(paths, ["notes/ideas/also-public.md", "notes/public.md"]);
        assert_eq!(p[1].url, "notes/public/");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn build_links_published_degrades_private_and_copies_only_used_assets() {
        let root = vault("build");
        let out = root.join("site");
        let report = build(&root, &out, false).unwrap();
        assert_eq!(report.pages.len(), 2);
        assert_eq!(report.assets, vec!["assets/pic.png"]);

        let page = std::fs::read_to_string(out.join("notes/public/index.html")).unwrap();
        assert!(page.contains("<a href=\"../../notes/ideas/also-public/\">the other one</a>"), "{page}");
        assert!(page.contains("href=\"../../notes/ideas/also-public/#second\""), "{page}");
        assert!(page.contains("Secret Note"), "link text survives");
        assert!(!page.contains("secret/"), "no link to the unpublished note");
        assert!(!page.contains("TOPSECRET"), "embed of a private note is not inlined");
        assert!(page.contains("src=\"../../assets/pic.png\""), "{page}");
        assert!(page.contains("callout callout-tip"), "{page}");
        assert!(page.contains("<h1 id=\"intro\">") || page.contains("id=\"intro\""), "{page}");
        assert!(page.contains("<span class=\"tag\">ideas</span>"));

        let other = std::fs::read_to_string(out.join("notes/ideas/also-public/index.html")).unwrap();
        assert!(!other.contains("public</span>"), "the `public` tag itself is not shown");

        assert!(out.join("assets/pic.png").exists());
        assert!(!out.join("assets/unused.png").exists());
        assert!(!out.join("notes/secret").exists());
        assert!(out.join("search.json").exists() && out.join("style.css").exists());
        let index = std::fs::read_to_string(out.join("index.html")).unwrap();
        assert!(index.contains("Public Note") && index.contains("Also Public") && !index.contains("Secret"));

        // Unflag a note and rebuild: its page goes away, nothing else is touched.
        std::fs::write(root.join("notes/ideas/also-public.md"), "---\ntitle: Also Public\n---\n\nHello.\n").unwrap();
        let report = build(&root, &out, false).unwrap();
        assert_eq!(report.pages.len(), 1);
        assert!(report.removed.contains(&"notes/ideas/also-public/index.html".to_string()));
        assert!(!out.join("notes/ideas").exists(), "emptied directories are pruned");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn build_refuses_a_foreign_non_empty_directory() {
        let root = vault("refuse");
        let out = root.join("stuff");
        std::fs::create_dir_all(&out).unwrap();
        std::fs::write(out.join("mine.txt"), "keep").unwrap();
        assert!(build(&root, &out, false).is_err());
        assert!(!out.join("index.html").exists());
        build(&root, &out, true).unwrap();
        assert!(out.join("mine.txt").exists(), "force never deletes what it did not write");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn home_note_and_site_title_come_from_settings() {
        let root = vault("home");
        std::fs::write(root.join(".cortex/settings.yaml"), "site_title: My Garden\nsite_home: notes/public.md\n").unwrap();
        let out = root.join("site");
        build(&root, &out, false).unwrap();
        let index = std::fs::read_to_string(out.join("index.html")).unwrap();
        assert!(index.contains("My Garden"));
        assert!(index.contains("class=\"home\"") && index.contains("Keep it short"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn math_is_kept_as_visible_source() {
        let root = vault("math");
        std::fs::write(
            root.join("notes/math.md"),
            "---\ntitle: Math\npublish: true\n---\n\nInline $x_1 + y_2$ and $\\{a,b\\}$ here; it costs $5 and $10.\n\n$$\n\\int_0^1 x\\,dx = \\frac{1}{2}\n$$\n",
        )
        .unwrap();
        let out = root.join("site");
        build(&root, &out, false).unwrap();
        let page = std::fs::read_to_string(out.join("notes/math/index.html")).unwrap();
        assert!(page.contains("<span class=\"math math-inline\">x_1 + y_2</span>"), "{page}");
        assert!(page.contains("<span class=\"math math-inline\">\\{a,b\\}</span>"), "{page}");
        assert!(page.contains("costs $5 and $10."), "dollar amounts stay prose: {page}");
        assert!(page.contains("<span class=\"math math-display\">\n\\int_0^1 x\\,dx = \\frac{1}{2}\n</span>"), "{page}");
        assert!(!page.contains("<em>"), "no emphasis inside equations: {page}");
        let css = std::fs::read_to_string(out.join("style.css")).unwrap();
        assert!(css.contains(".math-display"));
        let _ = std::fs::remove_dir_all(&root);
    }

    /// A `tasks` collection with a typed schema (currency, checkbox, stars,
    /// progress, status options), a published `_index.md` with a grouped and
    /// summarised table plus a board, one published row and one private row.
    fn database_vault(name: &str) -> PathBuf {
        let root = vault(name);
        let w = |rel: &str, s: &str| {
            let p = root.join(rel);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(p, s).unwrap();
        };
        w(".cortex/schemas/tasks.yaml", "properties:\n- name: status\n  type: status\n  options:\n  - name: todo\n    color: gray\n  - name: done\n    color: green\n- name: hours\n  type: number\n  format: currency\n  unit: €\n- name: done_flag\n  type: checkbox\n- name: rating\n  type: number\n  format: stars\n  max: 5\n- name: progress\n  type: number\n  format: progress\n");
        w("collections/tasks/_index.md", "---\ntitle: Tasks\ntype: database\npublish: true\nviews:\n- name: Table\n  type: table\n  columns: [title, status, hours, done_flag, rating, progress]\n  sort: [title]\n  group: status\n  summary: {hours: sum, done_flag: percent_checked, title: count}\n- name: Board\n  type: board\n  group: status\n---\n\nWhat we are working on.\n");
        w("collections/tasks/a.md", "---\ndone_flag: true\nhours: 3\nprogress: 40\npublish: true\nrating: 4\nstatus: done\ntitle: Alpha\n---\n\nAlpha body.\n");
        w("collections/tasks/b.md", "---\ndone_flag: false\nhours: 1234.5\nstatus: todo\ntitle: Beta\n---\n\nPrivate row body.\n");
        w("collections/tasks/c.md", "---\nhours: 2\ntitle: Gamma\n---\n");
        root
    }

    #[test]
    fn collection_page_renders_its_views_as_tables() {
        let root = database_vault("dbindex");
        let out = root.join("site");
        build(&root, &out, false).unwrap();
        let page = std::fs::read_to_string(out.join("collections/tasks/index.html")).unwrap();
        // Views come first, then the body prose.
        assert!(page.find("<h3 class=\"view-name\">Table</h3>").unwrap() < page.find("What we are working on").unwrap(), "{page}");
        assert!(page.contains("<h3 class=\"view-name\">Board</h3>"), "{page}");
        assert!(page.contains("A board view, shown here as a table."), "{page}");
        assert!(!page.contains("language-cortex"), "no raw fence: {page}");
        // Columns as the spec orders them.
        assert!(page.contains("<thead><tr><th>title</th><th>status</th><th>hours</th><th>done_flag</th><th>rating</th><th>progress</th></tr></thead>"), "{page}");
        // Groups in the status option order, the rows without one last.
        let todo = page.find("todo <span class=\"count\">1</span>").expect("todo group");
        let done = page.find("done <span class=\"count\">1</span>").expect("done group");
        let none = page.find("No status <span class=\"count\">1</span>").expect("empty group");
        assert!(todo < done && done < none, "{page}");
        // The published row links to its page; the private ones are plain text.
        assert!(page.contains("<td><a href=\"../../collections/tasks/a/\">Alpha</a></td>"), "{page}");
        assert!(page.contains("<td>Beta</td>") && page.contains("<td>Gamma</td>"), "{page}");
        assert!(!page.contains("tasks/b/"), "{page}");
        // Number formats: currency with unit and grouping, checkbox, stars, progress bar.
        assert!(page.contains("<td>€3.00</td>") && page.contains("<td>€1,234.50</td>"), "{page}");
        assert!(page.contains("<td>Yes</td>") && page.contains("<td>No</td>"), "{page}");
        assert!(page.contains("<span class=\"stars\" title=\"4 of 5\">★★★★☆</span>"), "{page}");
        assert!(page.contains("style=\"width:40%\"></span></span> 40%</span>"), "{page}");
        // Summary footer: labelled, in the column's format; a share as a percent.
        assert!(page.contains("<td><span class=\"summary-label\">Sum</span> €1,239.50</td>"), "{page}");
        assert!(page.contains("<td><span class=\"summary-label\">Checked</span> 33%</td>"), "{page}");
        assert!(page.contains("<td><span class=\"summary-label\">Count</span> 3</td>"), "{page}");
        let css = std::fs::read_to_string(out.join("style.css")).unwrap();
        assert!(css.contains(".view-table") && css.contains(".progress-fill"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn view_fences_in_notes_render_as_tables() {
        let root = database_vault("dbfence");
        std::fs::write(
            root.join("notes/views.md"),
            "---\ntitle: Views\npublish: true\n---\n\nDone so far:\n\n```cortex-view\nsource: collections/tasks\nfilter: status == done\ncolumns: [title, hours]\n```\n\nAll of them:\n\n```cortex-views\ncollection: tasks\n```\n\n```cortex-view\nsource: collections/nowhere\n```\n",
        )
        .unwrap();
        let out = root.join("site");
        build(&root, &out, false).unwrap();
        let page = std::fs::read_to_string(out.join("notes/views/index.html")).unwrap();
        // The filtered fence: one row, linked, only the asked-for columns.
        assert!(page.contains("<thead><tr><th>title</th><th>hours</th></tr></thead>"), "{page}");
        assert!(page.contains("<td><a href=\"../../collections/tasks/a/\">Alpha</a></td><td>€3.00</td>"), "{page}");
        let first = &page[..page.find("<h3 class=\"view-name\">Table</h3>").unwrap()];
        assert!(first.contains("Alpha") && !first.contains("Beta"), "filtered out: {first}");
        // The collection's own views, by name, from a `cortex-views` fence.
        assert!(page.contains("<h3 class=\"view-name\">Board</h3>"), "{page}");
        // A broken spec explains itself instead of failing the build.
        assert!(page.contains("class=\"view-note\">View not rendered: "), "{page}");
        assert!(!page.contains("language-cortex-view"), "{page}");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn search_json_carries_body_text() {
        let root = vault("search");
        let long = "lorem ".repeat(1000);
        std::fs::write(
            root.join("notes/long.md"),
            format!("---\ntitle: Long\npublish: true\n---\n\nUnique **needle** here, see [[Secret Note|the link]].\n\n```cortex-view\nsource: collections/tasks\n```\n\n<details><summary>More</summary>\n\n{long}\n\n</details>\n"),
        )
        .unwrap();
        let out = root.join("site");
        build(&root, &out, false).unwrap();
        let json: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(out.join("search.json")).unwrap()).unwrap();
        let entries = json.as_array().unwrap();
        assert_eq!(entries.len(), 3);
        let long_entry = entries.iter().find(|e| e["title"] == "Long").unwrap();
        let text = long_entry["text"].as_str().unwrap();
        assert!(text.starts_with("Unique needle here, see the link. lorem lorem"), "{text}");
        assert!(!text.contains("source:") && !text.contains("<details>") && !text.contains("**"), "{text}");
        assert!(text.len() <= SEARCH_TEXT_LIMIT && text.len() > SEARCH_TEXT_LIMIT - 20, "{}", text.len());
        assert_eq!(long_entry["url"], "notes/long/");
        assert!(entries.iter().all(|e| e["title"] != "Secret Note"));
        assert!(!std::fs::read_to_string(out.join("search.json")).unwrap().contains("TOPSECRET"));
        // The index page carries the hook the script keys on, and the script fetches the index.
        let index = std::fs::read_to_string(out.join("index.html")).unwrap();
        assert!(index.contains("data-url=\"notes/long/\"") && index.contains("fetch('search.json')") && index.contains("snippet"), "{index}");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn number_formats_and_cells() {
        use crate::schema::{PropType, PropertyDef};
        let def = |format: &str, unit: Option<&str>, min: Option<f64>, max: Option<f64>| PropertyDef {
            name: "n".into(), ty: PropType::Number, format: Some(format.into()), unit: unit.map(String::from), min, max, ..Default::default()
        };
        assert_eq!(fmt_num(3.0), "3");
        assert_eq!(fmt_num(2.25), "2.2");
        assert_eq!(grouped(-1234567.891, 2), "-1,234,567.89");
        assert_eq!(grouped(999.0, 0), "999");
        assert_eq!(format_number(0.5, None), "0.5");
        assert_eq!(format_number(12.5, Some(&def("percent", None, None, None))), "12.5%");
        assert_eq!(format_number(1500.0, Some(&def("currency", Some("$"), None, None))), "$1,500.00");
        assert_eq!(format_number(1500.7, Some(&def("integer", None, None, None))), "1,501");
        assert_eq!(format_number(2.0, Some(&def("decimal", None, None, None))), "2.0");
        assert_eq!(format_number(40.0, Some(&def("progress", None, None, None))), "40%");
        assert_eq!(format_number(4.0, Some(&def("progress", Some("kg"), Some(0.0), Some(10.0)))), "4kg");

        use serde_json::json as j;
        assert_eq!(cell_html(&j!(null), None), "—");
        assert_eq!(cell_html(&j!(""), None), "—");
        assert_eq!(cell_html(&j!(true), None), "Yes");
        assert_eq!(cell_html(&j!(["a", "b"]), None), "a, b");
        assert_eq!(cell_html(&j!("<b>"), None), "&lt;b&gt;");
        assert_eq!(cell_html(&j!(2.5), None), "2.5");
        assert_eq!(cell_html(&j!("3"), Some(&def("stars", None, None, Some(4.0)))), "<span class=\"stars\" title=\"3 of 4\">★★★☆</span>");
        assert_eq!(cell_html(&j!(null), Some(&def("stars", None, None, None))), "<span class=\"stars\" title=\"—\">☆☆☆☆☆</span>");
        assert!(cell_html(&j!(5), Some(&def("progress", None, Some(0.0), Some(10.0)))).contains("width:50%"));
        // A text cell in a formatted column is shown as it is.
        assert_eq!(cell_html(&j!("tbd"), Some(&def("currency", None, None, None))), "tbd");

        assert_eq!(summary_html(&j!(50), "percent_checked", None), "50%");
        assert_eq!(summary_html(&j!(7), "count", Some(&def("currency", Some("€"), None, None))), "7");
        assert_eq!(summary_html(&j!(7), "sum", Some(&def("currency", Some("€"), None, None))), "€7.00");
        assert_eq!(summary_html(&j!(3.5), "avg", Some(&def("stars", None, None, None))), "3.5");
    }

    #[test]
    fn groups_follow_option_order_then_alpha_then_empty() {
        use crate::data::ResolvedRow;
        let row = |id: &str, status: serde_json::Value| ResolvedRow { id: id.into(), cells: [("status".to_string(), status)].into_iter().collect() };
        let rows = vec![row("a", serde_json::json!("zeta")), row("b", serde_json::json!(null)), row("c", serde_json::json!("done")), row("d", serde_json::json!("alpha")), row("e", serde_json::json!("todo"))];
        let groups = group_rows(&rows, "status", &["todo".into(), "done".into()]);
        let keys: Vec<&str> = groups.iter().map(|(k, _)| k.as_str()).collect();
        assert_eq!(keys, ["todo", "done", "alpha", "zeta", "—"]);
        assert_eq!(groups[4].1[0].id, "b");
    }

    #[test]
    fn pages_url_guesses_github_io() {
        assert_eq!(pages_url("git@github.com:me/notes.git").as_deref(), Some("https://me.github.io/notes/"));
        assert_eq!(pages_url("https://github.com/me/me.github.io").as_deref(), Some("https://me.github.io/"));
        assert_eq!(pages_url("https://gitlab.com/me/notes.git"), None);
    }

    #[test]
    fn github_action_is_manual_by_default() {
        let root = vault("action");
        let p = write_github_action(&root).unwrap();
        let text = std::fs::read_to_string(&p).unwrap();
        assert!(text.contains("workflow_dispatch:"));
        assert!(text.contains("# push:"), "push trigger is commented out");
        assert!(write_github_action(&root).is_err(), "never overwrites");
        let _ = std::fs::remove_dir_all(&root);
    }
}
