//! Operations on a vault, shared by the CLI (which prints them) and the MCP
//! server (which returns them as JSON). Every op returns data, never output,
//! and goes through cortex-core, so the semantics are the app's own.

use cortex_core::agents::{self, AgentCli};
use cortex_core::comments::{self, Anchor, Thread};
use cortex_core::assets::AssetEntry;
use cortex_core::data::{self};

/// What `cortex view` / MCP `query_collection` ask for.
#[derive(Debug, Default, Clone)]
pub struct ViewQuery {
    /// A saved view of the collection, by name.
    pub view: Option<String>,
    pub filter: Option<String>,
    pub sort: Vec<String>,
    pub columns: Option<Vec<String>>,
    pub group: Option<String>,
    pub bucket: Option<String>,
    pub limit: Option<usize>,
    pub summary: Vec<(String, String)>,
}

/// A view's result, by its type.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(untagged)]
pub enum ViewRun {
    Table(data::ResolvedTable),
    Chart(data::ChartResult),
    Stats(data::StatsResult),
}
use cortex_core::db::Db;
use cortex_core::git::{self, AgentBranch, CommitDiff, CommitEntry, VaultStatus};
use cortex_core::note::{self, Note, NoteEntry};
use cortex_core::rename::{self, RenameReport};
use cortex_core::schema::{PropertyChange, TypeSchema};
use cortex_core::search::SearchHit;
use cortex_core::settings::Settings;
use cortex_core::tags::{self, TagNode};
use cortex_core::tracker::{self, TrackerResult};
use cortex_core::{index, schema, settings, vault};
use serde::Serialize;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

pub type Result<T> = std::result::Result<T, Box<dyn std::error::Error + Send + Sync>>;

pub struct Vault {
    pub root: PathBuf,
}

#[derive(Debug, Default)]
pub struct NewNote {
    pub title: String,
    /// Folder to create in; default `notes`.
    pub dir: Option<String>,
    pub note_type: Option<String>,
    pub tags: Vec<String>,
    /// Seed from `templates/<name>.md` ({{date}}, {{time}}, {{title}}, {{uuid}}).
    pub template: Option<String>,
    pub body: Option<String>,
}

/// One `key=value` pair's meaning on the command line.
#[derive(Debug, Clone)]
pub enum PairOp {
    /// `key=value`; a null value (from `key=`) removes the key.
    Set(serde_json::Value),
    /// `key+=value`: append to a list property, no duplicates.
    Add(serde_json::Value),
    /// `key-=value`: remove from a list property.
    Remove(serde_json::Value),
}

/// A list property's items, tolerating the comma-joined string a text edit may leave.
fn list_of(v: Option<&serde_json::Value>) -> Vec<serde_json::Value> {
    match v {
        Some(serde_json::Value::Array(a)) => a.clone(),
        Some(serde_json::Value::String(s)) if !s.trim().is_empty() => s.split(',').map(|x| serde_json::Value::String(x.trim().to_string())).collect(),
        Some(serde_json::Value::Null) | None => vec![],
        Some(other) => vec![other.clone()],
    }
}

/// A top-level `key: value` line of a small YAML spec.
fn spec_field(spec: &str, key: &str) -> Option<String> {
    spec.lines().find_map(|l| l.strip_prefix(&format!("{key}:")).map(|v| v.trim().to_string())).filter(|v| !v.is_empty())
}

/// A tracker view found in a collection's `_index.md`.
#[derive(Debug, Clone, Serialize)]
pub struct TrackerView {
    pub collection: String,
    pub view: String,
    /// `collections/<name>` holding one row per day.
    pub log: String,
    /// The cortex-view spec, ready for `run_tracker`.
    pub spec: String,
}

/// What `track` did, with the streak as it stands afterwards.
#[derive(Debug, Clone, Serialize)]
pub struct TrackEvent {
    pub collection: String,
    pub item: String,
    pub date: String,
    pub done: bool,
    pub current_streak: u32,
    pub longest_streak: u32,
    pub streak_unit: String,
    pub week_done: u32,
    pub target: u32,
}

#[derive(Debug, Serialize)]
pub struct Link {
    /// The note the link names — `[[Note|alias]]` and `[[Note#Section]]` both give `Note`.
    pub target: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub alias: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub section: Option<String>,
    /// Resolved note path, if the link points at an existing note.
    pub path: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct FmtReport {
    pub checked: usize,
    pub rewritten: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct StatusReport {
    pub status: VaultStatus,
    pub log: Vec<CommitEntry>,
    pub proposals: Vec<AgentBranch>,
}

/// Scaffold a new vault at `dir` from the bundled template — the same files
/// the app's "New vault" writes — as a fresh git repository with an initial
/// commit, plus the `VAULT.md` / `AGENTS.md` / settings the app would add on
/// first open, so an agent can hand over a vault that is complete at once.
/// Returns the absolute path.
pub fn init(dir: PathBuf, template: Option<String>) -> Result<PathBuf> {
    use cortex_core::template::{self, TemplateSource};
    let source = match template.as_deref() {
        Some(spec) => template::parse_source(spec)?,
        None => TemplateSource::Bundled,
    };
    template::scaffold_from(&source, &dir)?;
    let root = dir.canonicalize()?;
    // The docs are the app's, versioned with it — written fresh even when the
    // template ships copies. Settings keep whatever the template set and gain
    // every key it did not.
    std::fs::write(root.join("VAULT.md"), vault::vault_md())?;
    std::fs::write(root.join("AGENTS.md"), vault::agents_md())?;
    settings::ensure_complete(&root)?;
    let repo = git::open_or_init(&root)?;
    // Best-effort: without a git identity the repo still exists and works.
    let _ = git::stage_all_and_commit(&repo, "Initial vault");
    Ok(root)
}

impl Vault {
    /// `root` if given, else the nearest vault above the working directory.
    pub fn open(root: Option<PathBuf>) -> Result<Self> {
        let root = match root {
            Some(r) => r,
            None => vault::find_root(&std::env::current_dir()?).ok_or(
                "not inside a vault — run from one, or pass --vault DIR / set CORTEX_VAULT",
            )?,
        };
        if !root.is_dir() {
            return Err(format!("vault directory not found: {}", root.display()).into());
        }
        Ok(Self { root })
    }

    // ── Access ──────────────────────────────────────────────────────────────

    pub fn notes(&self) -> Vec<NoteEntry> {
        vault::list_notes(&self.root)
    }

    /// The search/link index, brought up to date first. A full walk is fine
    /// for a vault of thousands of notes, and keeps the CLI correct even when
    /// the app isn't running.
    fn db(&self) -> Result<Db> {
        let db = Db::open(&self.root)?;
        index::index_vault(&self.root, &db)?;
        Ok(db)
    }

    fn repo(&self) -> Result<git::Repository> {
        Ok(git::open(&self.root)?)
    }

    /// Resolve like a `[[wiki link]]`: exact path, then title, then filename stem.
    pub fn resolve(&self, target: &str) -> Result<NoteEntry> {
        let notes = self.notes();
        vault::resolve(&notes, target)
            .cloned()
            .ok_or_else(|| format!("no note matches '{target}'").into())
    }

    pub fn read(&self, target: &str) -> Result<Note> {
        let rel = self.resolve(target)?.path;
        self.read_path(&rel)
    }

    fn read_path(&self, rel: &str) -> Result<Note> {
        let content = std::fs::read_to_string(self.root.join(rel))?;
        Ok(note::parse_note(rel, &content)?)
    }

    pub fn raw(&self, target: &str) -> Result<String> {
        let rel = self.resolve(target)?.path;
        Ok(std::fs::read_to_string(self.root.join(rel))?)
    }

    fn write(&self, n: &Note) -> Result<()> {
        let abs = self.root.join(&n.path);
        if let Some(parent) = abs.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(abs, note::serialize_note(n)?)?;
        Ok(())
    }

    /// Write a note back and, if its title changed, point every `[[Old Title]]`
    /// at the new one — a title change is a rename as far as links go.
    fn write_relinking(&self, n: &Note, old_title: &str) -> Result<()> {
        self.write(n)?;
        let new_title = note::infer_title(n);
        if new_title != old_title {
            rename::title_changed(&self.root, &self.db()?, &n.path, old_title, &new_title)?;
        }
        Ok(())
    }

    // ── Notes ───────────────────────────────────────────────────────────────

    pub fn list(&self, dir: Option<&str>, note_type: Option<&str>, tag: Option<&str>) -> Vec<NoteEntry> {
        let prefix = dir.map(|d| format!("{}/", d.trim_end_matches('/')));
        self.notes()
            .into_iter()
            // Templates are seeds, not notes — only listed when asked for by folder.
            .filter(|n| match &prefix {
                Some(p) => n.path.starts_with(p),
                None => !n.path.starts_with("templates/"),
            })
            .filter(|n| note_type.map_or(true, |t| n.note_type.as_deref() == Some(t)))
            // Frontmatter and inline `#tags` alike; a parent tag matches its children.
            .filter(|n| tag.map_or(true, |t| tags::has_tag(&n.tags, t)))
            .collect()
    }

    /// The tag tree with counts, nested by `/` (templates excluded).
    pub fn tags(&self) -> Vec<TagNode> {
        vault::list_tags(&self.root)
    }

    /// Every file under `assets/` with its size, MIME type and how many
    /// notes reference it (0 = orphan); see `cortex_core::assets`.
    pub fn assets(&self) -> Result<Vec<AssetEntry>> {
        Ok(cortex_core::assets::list_assets(&self.root)?)
    }


    /// Full-text search with operators (`"phrase"`, `-word`, `OR`, `tag:`,
    /// `type:`, `path:`); see `cortex_core::search`.
    pub fn search(&self, query: &str) -> Result<Vec<SearchHit>> {
        Ok(self.db()?.search(query)?)
    }

    pub fn create(&self, req: NewNote) -> Result<Note> {
        let now = chrono::Local::now();
        let date = now.format("%Y-%m-%d").to_string();
        let time = now.format("%H:%M").to_string();
        let defaults = settings::load(&self.root)?;

        // Same naming as the app: <dir>/<slug>-<date>.md, suffixed until free.
        let slug = match git::slugify(&req.title) {
            s if s.is_empty() => "untitled".to_string(),
            s => s,
        };
        let dir = req.dir.as_deref().unwrap_or("notes").trim_end_matches('/').to_string();
        let mut path = format!("{dir}/{slug}-{date}.md");
        let mut n = 2;
        while self.root.join(&path).exists() {
            path = format!("{dir}/{slug}-{date}-{n}.md");
            n += 1;
        }

        let mut note = match &req.template {
            Some(t) => {
                let name = if t.ends_with(".md") { t.clone() } else { format!("{t}.md") };
                let tpl = std::fs::read_to_string(self.root.join("templates").join(&name))
                    .map_err(|_| format!("template not found: templates/{name}"))?;
                let uuid = uuid();
                let vars = [("date", date.as_str()), ("time", time.as_str()), ("title", req.title.as_str()), ("uuid", uuid.as_str())];
                let mut content = tpl;
                for (k, v) in vars {
                    content = content.replace(&format!("{{{{{k}}}}}"), v);
                }
                let mut note = note::parse_note(&path, &content)?;
                if let Some(b) = &req.body {
                    if !b.is_empty() {
                        note.body = b.clone();
                    }
                }
                note
            }
            None => {
                let mut fm: BTreeMap<String, serde_json::Value> = BTreeMap::new();
                fm.insert("title".into(), req.title.clone().into());
                fm.insert("type".into(), defaults.default_note_type.clone().into());
                fm.insert("created".into(), date.clone().into());
                fm.insert("tags".into(), serde_json::Value::Array(vec![]));
                Note { path: path.clone(), frontmatter: fm, body: req.body.clone().unwrap_or_default() }
            }
        };
        if let Some(t) = req.note_type {
            note.frontmatter.insert("type".into(), t.into());
        }
        if !req.tags.is_empty() {
            note.frontmatter.insert("tags".into(), req.tags.into());
        }

        self.write(&note)?;
        Ok(note)
    }

    /// Merge properties into a note's frontmatter; a null value removes the key.
    pub fn set_properties(&self, target: &str, props: BTreeMap<String, serde_json::Value>) -> Result<Note> {
        let mut note = self.read(target)?;
        let old_title = note::infer_title(&note);
        let changed: Vec<String> = props.keys().cloned().collect();
        for (k, v) in props {
            if v.is_null() {
                note.frontmatter.remove(&k);
            } else {
                note.frontmatter.insert(k, v);
            }
        }
        self.write_relinking(&note, &old_title)?;
        // Auto-stamped dates and repeats follow, as they do in the app.
        if !data::apply_row_effects(&self.root, &note.path, &changed)?.is_empty() {
            return self.read_path(&note.path);
        }
        Ok(note)
    }

    /// `key=value`, `key+=value` (append to a list) or `key-=value` (remove from
    /// it), YAML-typed like `parse_pairs`; `key=` removes the key.
    pub fn parse_pair_ops(pairs: &[String]) -> Result<Vec<(String, PairOp)>> {
        let typed = |raw: &str| -> serde_json::Value {
            serde_yaml::from_str(raw).unwrap_or_else(|_| serde_json::Value::String(raw.to_string()))
        };
        let mut out = Vec::new();
        for pair in pairs {
            let eq = pair.find('=').ok_or_else(|| format!("expected key=value, got '{pair}'"))?;
            let (key, raw) = (&pair[..eq], &pair[eq + 1..]);
            let op = match key.chars().last() {
                Some('+') => PairOp::Add(typed(raw)),
                Some('-') => PairOp::Remove(typed(raw)),
                _ => PairOp::Set(if raw.is_empty() { serde_json::Value::Null } else { typed(raw) }),
            };
            let key = key.trim_end_matches(['+', '-']).to_string();
            if key.is_empty() { return Err(format!("missing key in '{pair}'").into()); }
            if raw.is_empty() && !matches!(op, PairOp::Set(_)) { return Err(format!("'{pair}' needs a value").into()); }
            out.push((key, op));
        }
        Ok(out)
    }

    /// Apply `key=value` / `key+=value` / `key-=value` pairs to a note and write
    /// it. A collection row that does not exist yet is created first (see
    /// `read_or_create_row`). Returns the note and whether it was created.
    pub fn apply_pairs(&self, target: &str, pairs: &[String]) -> Result<(Note, bool)> {
        let ops = Self::parse_pair_ops(pairs)?;
        let (mut note, created) = self.read_or_create_row(target)?;
        let old_title = note::infer_title(&note);
        for (k, op) in ops {
            match op {
                PairOp::Set(v) => {
                    if v.is_null() { note.frontmatter.remove(&k); } else { note.frontmatter.insert(k, v); }
                }
                PairOp::Add(v) => {
                    let mut list = list_of(note.frontmatter.get(&k));
                    if !list.contains(&v) { list.push(v); }
                    note.frontmatter.insert(k, serde_json::Value::Array(list));
                }
                PairOp::Remove(v) => {
                    let mut list = list_of(note.frontmatter.get(&k));
                    list.retain(|x| *x != v);
                    note.frontmatter.insert(k, serde_json::Value::Array(list));
                }
            }
        }
        self.write_relinking(&note, &old_title)?;
        // The same consequences as an edit in the app: auto-stamped dates, the
        // next occurrence of a repeating row.
        let changed: Vec<String> = Self::parse_pair_ops(pairs)?.into_iter().map(|(k, _)| k).collect();
        if !data::apply_row_effects(&self.root, &note.path, &changed)?.is_empty() {
            return Ok((self.read_path(&note.path)?, created));
        }
        Ok((note, created))
    }

    /// `read`, except a missing row under `collections/<c>/` is created first —
    /// from the collection's row template when it has one — so
    /// `cortex set collections/habit-log/2026-09-08 done+=Read` works on a day
    /// that has no file yet. An id that is a date also becomes the row's `date`.
    pub fn read_or_create_row(&self, target: &str) -> Result<(Note, bool)> {
        let first = match self.read(target) { Ok(n) => return Ok((n, false)), Err(e) => e };
        let rel = target.trim_start_matches("./");
        let rel = rel.strip_suffix(".md").unwrap_or(rel);
        if let Some((coll, id)) = rel.strip_prefix("collections/").and_then(|r| r.split_once('/')) {
            let ok_id = !id.is_empty() && !id.contains('/') && !id.contains("..") && !id.starts_with('_');
            if ok_id && self.root.join("collections").join(coll).is_dir() {
                // `collections/<c>/<id>` without `.md` names the row file directly.
                let file = format!("collections/{coll}/{id}.md");
                if self.root.join(&file).is_file() { return Ok((self.read_path(&file)?, false)); }
                let is_date = chrono::NaiveDate::parse_from_str(id, "%Y-%m-%d").is_ok();
                let mut fields = BTreeMap::new();
                fields.insert("title".to_string(), id.to_string());
                fields.insert("created".to_string(), if is_date { id.to_string() } else { chrono::Local::now().format("%Y-%m-%d").to_string() });
                if is_date { fields.insert("date".to_string(), id.to_string()); }
                data::ensure_row(&self.root, &format!("collections/{coll}"), id, &fields)?;
                return Ok((self.read_path(&format!("collections/{coll}/{id}.md"))?, true));
            }
        }
        Err(first)
    }

    // ── Trackers ────────────────────────────────────────────────────────────

    /// Every tracker view in the vault (habits and the like).
    pub fn trackers(&self) -> Vec<TrackerView> {
        tracker::tracker_specs(&self.root).into_iter().map(|(collection, view, spec)| {
            let log = spec_field(&spec, "log").unwrap_or_default();
            TrackerView { collection, view, log, spec }
        }).collect()
    }

    fn tracker_view(&self, collection: &str, view: Option<&str>) -> Result<TrackerView> {
        let all: Vec<TrackerView> = self.trackers().into_iter().filter(|t| t.collection == collection).collect();
        if all.is_empty() {
            return Err(format!("collections/{collection} has no tracker view (add one to its _index.md, or install a pack that has one)").into());
        }
        match view {
            None => Ok(all.into_iter().next().unwrap()),
            Some(name) => all.into_iter().find(|t| t.view.eq_ignore_ascii_case(name))
                .ok_or_else(|| format!("collections/{collection} has no tracker view named '{name}'").into()),
        }
    }

    /// Run a collection's tracker view (its first, or the named one), optionally
    /// with another `range` and anchored on a date other than today.
    pub fn tracker(&self, collection: &str, view: Option<&str>, range: Option<&str>, at: Option<&str>) -> Result<TrackerResult> {
        let t = self.tracker_view(collection, view)?;
        let mut spec = t.spec.clone();
        if let Some(r) = range {
            spec = spec.lines().filter(|l| !l.starts_with("range:")).collect::<Vec<_>>().join("\n");
            spec.push_str(&format!("\nrange: {r}\n"));
        }
        Ok(tracker::run_tracker(&self.root, &spec, at)?)
    }

    /// Tick (or untick) one item for a day — the way an agent logs "I ran today".
    /// `item` matches a title exactly, then case-insensitively, then as a unique prefix.
    pub fn track(&self, collection: &str, item: &str, date: Option<&str>, on: Option<bool>) -> Result<TrackEvent> {
        let t = self.tracker_view(collection, None)?;
        let today = tracker::run_tracker(&self.root, &t.spec, date)?;
        let titles: Vec<&str> = today.items.iter().map(|i| i.title.as_str()).collect();
        let lower = item.trim().to_lowercase();
        let title = titles.iter().find(|t| **t == item.trim())
            .or_else(|| titles.iter().find(|t| t.to_lowercase() == lower))
            .or_else(|| {
                let hits: Vec<&&str> = titles.iter().filter(|t| t.to_lowercase().starts_with(&lower)).collect();
                if hits.len() == 1 { Some(hits[0]) } else { None }
            })
            .ok_or_else(|| format!("no item '{item}' in collections/{collection}; items: {}", titles.join(", ")))?
            .to_string();
        let day = date.map(String::from).unwrap_or_else(|| today.today.clone());
        let (_, done) = tracker::toggle(&self.root, &today.log_source, &today.date_field, &today.done_field, &day, &title, on)?;
        let after = tracker::run_tracker(&self.root, &t.spec, None)?;
        let it = after.items.iter().find(|i| i.title == title);
        Ok(TrackEvent {
            collection: collection.to_string(),
            item: title,
            date: day,
            done,
            current_streak: it.map(|i| i.current_streak).unwrap_or(0),
            longest_streak: it.map(|i| i.longest_streak).unwrap_or(0),
            streak_unit: it.map(|i| i.streak_unit).unwrap_or("days").to_string(),
            week_done: it.map(|i| i.week_done).unwrap_or(0),
            target: it.map(|i| i.target).unwrap_or(0),
        })
    }

    /// Replace a note's body, keeping its frontmatter.
    pub fn write_body(&self, target: &str, body: &str) -> Result<Note> {
        let mut note = self.read(target)?;
        note.body = body.to_string();
        self.write(&note)?;
        Ok(note)
    }

    /// Rewrite notes in canonical form (sorted frontmatter keys). All notes if
    /// `targets` is empty.
    pub fn fmt(&self, targets: &[String]) -> Result<FmtReport> {
        let paths: Vec<String> = if targets.is_empty() {
            self.notes().into_iter().map(|n| n.path).collect()
        } else {
            targets.iter().map(|t| self.resolve(t).map(|e| e.path)).collect::<Result<_>>()?
        };
        let mut rewritten = Vec::new();
        for rel in &paths {
            let before = std::fs::read_to_string(self.root.join(rel))?;
            let Ok(parsed) = note::parse_note(rel, &before) else { continue };
            let after = note::serialize_note(&parsed)?;
            if after != before {
                std::fs::write(self.root.join(rel), after)?;
                rewritten.push(rel.clone());
            }
        }
        Ok(FmtReport { checked: paths.len(), rewritten })
    }

    pub fn links(&self, target: &str) -> Result<Vec<Link>> {
        let note = self.read(target)?;
        let notes = self.notes();
        Ok(note::extract_wiki_links(&note.body)
            .into_iter()
            .map(|l| Link {
                path: vault::resolve(&notes, &l.target).map(|n| n.path.clone()),
                target: l.target,
                alias: l.alias,
                section: l.section,
            })
            .collect())
    }

    pub fn backlinks(&self, target: &str) -> Result<Vec<NoteEntry>> {
        let rel = self.resolve(target)?.path;
        Ok(self.db()?.get_backlinks(&rel)?)
    }

    /// Rename or move a note and rewrite every inbound link. `dest` is a new
    /// path (`.md` added if missing) or, with a trailing `/` or naming an
    /// existing folder, the folder to move into. Commits when auto_commit is on.
    pub fn mv(&self, target: &str, dest: &str, title: Option<&str>) -> Result<RenameReport> {
        let old_path = self.resolve(target)?.path;
        let dest = dest.trim().replace('\\', "/");
        let new_path = if dest.ends_with('/') || self.root.join(&dest).is_dir() {
            let name = Path::new(&old_path).file_name().and_then(|f| f.to_str()).unwrap_or("note.md");
            let dir = dest.trim_end_matches('/');
            if dir.is_empty() { name.to_string() } else { format!("{dir}/{name}") }
        } else if dest.ends_with(".md") {
            dest
        } else {
            format!("{dest}.md")
        };
        Ok(rename::rename_note(&self.root, &self.db()?, &old_path, &new_path, title)?)
    }

    // ── Collections ─────────────────────────────────────────────────────────

    pub fn collections(&self) -> Vec<String> {
        let mut names: Vec<String> = std::fs::read_dir(self.root.join("collections"))
            .map(|rd| {
                rd.flatten()
                    .filter(|e| e.path().is_dir())
                    .filter_map(|e| e.file_name().to_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default();
        names.sort();
        names
    }

    /// Query a collection with the same spec an embedded view block carries.
    /// Run a view: the ad-hoc query the flags describe, or with `view` one of
    /// the collection's saved views by name (case-insensitive; a unique prefix
    /// will do), the flags overriding its keys. A table view answers with the
    /// resolved table (groups and summaries included), a chart with its
    /// points, a stats view with its tiles.
    pub fn view(&self, collection: &str, q: &ViewQuery) -> Result<ViewRun> {
        let coll = collection.trim_end_matches('/');
        let mut spec = match &q.view {
            Some(name) => {
                let views = data::collection_view_specs(&self.root, coll);
                let want = name.trim().to_lowercase();
                let found = views.iter().find(|(n, _, _)| n.to_lowercase() == want)
                    .or_else(|| { let m: Vec<_> = views.iter().filter(|(n, _, _)| n.to_lowercase().starts_with(&want)).collect(); if m.len() == 1 { Some(m[0]) } else { None } });
                let Some((_, _, yaml)) = found else {
                    let names: Vec<&str> = views.iter().map(|(n, _, _)| n.as_str()).collect();
                    return Err(format!("no view '{name}' in {coll} (have: {})", if names.is_empty() { "none".to_string() } else { names.join(", ") }).into());
                };
                match serde_yaml::from_str::<serde_yaml::Value>(yaml)? { serde_yaml::Value::Mapping(m) => m, _ => serde_yaml::Mapping::new() }
            }
            None => serde_yaml::Mapping::new(),
        };
        let mut set = |k: &str, v: serde_yaml::Value| { spec.insert(serde_yaml::Value::String(k.into()), v); };
        set("source", format!("collections/{coll}").into());
        if let Some(f) = &q.filter { set("filter", f.as_str().into()); }
        if !q.sort.is_empty() { set("sort", serde_yaml::Value::Sequence(q.sort.iter().map(|s| s.as_str().into()).collect())); }
        if let Some(c) = &q.columns { set("columns", serde_yaml::Value::Sequence(c.iter().map(|s| s.as_str().into()).collect())); }
        if let Some(g) = &q.group { set("group", g.as_str().into()); }
        if let Some(b) = &q.bucket { set("bucket", b.as_str().into()); }
        if let Some(l) = q.limit { set("limit", (l as u64).into()); }
        if !q.summary.is_empty() {
            let m: serde_yaml::Mapping = q.summary.iter().map(|(f, func)| (serde_yaml::Value::String(f.clone()), serde_yaml::Value::String(func.clone()))).collect();
            set("summary", serde_yaml::Value::Mapping(m));
        }
        let yaml = serde_yaml::to_string(&serde_yaml::Value::Mapping(spec))?;
        // The same results the app shows: schema attached, rollups and formulas computed.
        Ok(match data::spec_kind(&yaml).as_str() {
            "chart" => ViewRun::Chart(data::run_chart(&self.root, &cortex_core::members::resolve_me(&yaml, &self.root))?),
            "stats" => ViewRun::Stats(data::run_stats(&self.root, &yaml)?),
            _ => ViewRun::Table(data::resolve_view(&self.root, &yaml)?),
        })
    }

    pub fn schema(&self, key: &str) -> Result<TypeSchema> {
        Ok(schema::load(&self.root, key)?.ok_or_else(|| format!("no schema for '{key}'"))?)
    }

    /// Rename a property in the schema, every row, the collection's views and
    /// the rollups / formulas that reference it (see `cortex_core::schema`).
    pub fn rename_property(&self, key: &str, old: &str, new: &str) -> Result<PropertyChange> {
        Ok(schema::rename_property(&self.root, key, old, new)?)
    }

    /// Delete a property from the schema, every row and every view; refused
    /// while a rollup or formula depends on it.
    pub fn delete_property(&self, key: &str, name: &str) -> Result<PropertyChange> {
        Ok(schema::delete_property(&self.root, key, name)?)
    }

    pub fn schemas(&self) -> Vec<String> {
        let mut keys: Vec<String> = std::fs::read_dir(self.root.join(".cortex").join("schemas"))
            .map(|rd| {
                rd.flatten()
                    .filter_map(|e| e.file_name().to_str().map(str::to_string))
                    .filter_map(|f| f.strip_suffix(".yaml").map(str::to_string))
                    .collect()
            })
            .unwrap_or_default();
        keys.sort();
        keys
    }

    // ── Settings & agents ───────────────────────────────────────────────────

    /// The vault's settings, defaults filled in for any key the file omits.
    pub fn settings(&self) -> Result<Settings> {
        Ok(settings::load(&self.root)?)
    }

    /// One setting by key (`keybindings.<id>` reaches into the map).
    pub fn setting(&self, key: &str) -> Result<serde_yaml::Value> {
        Ok(settings::get_field(&self.settings()?, key)?)
    }

    /// Apply `key=value` edits in order and write the file back. Values are
    /// typed per field (see `settings::set_field`); every key is validated
    /// before anything is written, so a typo leaves the file untouched.
    pub fn update_settings<'a>(&self, edits: impl IntoIterator<Item = (&'a str, &'a str)>) -> Result<Settings> {
        let mut current = self.settings()?;
        for (key, raw) in edits {
            settings::set_field(&mut current, key, raw)?;
        }
        settings::save(&self.root, &current)?;
        Ok(current)
    }

    /// Merge JSON properties (the MCP shape) into the settings. Strings are
    /// passed as-is; anything else is re-serialised, which set_field reads as
    /// YAML — JSON being valid YAML, `{"toggle-sidebar": "mod+shift+b"}` and
    /// `true` land in the right fields.
    pub fn merge_settings(&self, props: BTreeMap<String, serde_json::Value>) -> Result<Settings> {
        let edits: Vec<(String, String)> = props
            .into_iter()
            .map(|(k, v)| {
                let raw = match v {
                    serde_json::Value::String(s) => s,
                    serde_json::Value::Null => String::new(),
                    other => other.to_string(),
                };
                (k, raw)
            })
            .collect();
        self.update_settings(edits.iter().map(|(k, v)| (k.as_str(), v.as_str())))
    }

    /// Known agent CLIs and whether each is installed on this machine.
    pub fn agents(&self) -> Vec<AgentCli> {
        agents::detect()
    }

    // ── Template packs ──────────────────────────────────────────────────────

    /// Where fetched marketplace indexes are cached for this user.
    pub fn packs_cache_dir() -> Option<PathBuf> {
        let base = std::env::var_os("XDG_CACHE_HOME").map(PathBuf::from)
            .or_else(|| std::env::var_os("LOCALAPPDATA").map(PathBuf::from))
            .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".cache")))?;
        Some(base.join("cortex").join("marketplace"))
    }

    pub fn packs_catalog(&self, refresh: bool) -> Result<cortex_core::marketplace::Catalog> {
        Ok(cortex_core::marketplace::catalog(&self.root, Self::packs_cache_dir().as_deref(), refresh, true))
    }

    pub fn packs_resolve(&self, id: &str) -> Result<cortex_core::marketplace::Pack> {
        Ok(cortex_core::marketplace::resolve(&self.root, Self::packs_cache_dir().as_deref(), id, true)?)
    }

    pub fn packs_install(&self, pack: &cortex_core::marketplace::Pack, force: bool) -> Result<Vec<cortex_core::marketplace::InstallReport>> {
        let root = self.root.clone();
        let cache = Self::packs_cache_dir();
        Ok(cortex_core::marketplace::install(&self.root, pack, force, &move |id| cortex_core::marketplace::resolve(&root, cache.as_deref(), id, true).ok())?)
    }

    /// Update one pack, or every installed pack that has a newer version.
    pub fn packs_update(&self, id: Option<&str>) -> Result<Vec<cortex_core::marketplace::UpdateReport>> {
        use cortex_core::marketplace as mk;
        let cat = self.packs_catalog(false)?;
        let mut reports = Vec::new();
        for e in cat.entries.iter().filter(|e| e.installed_version.is_some()) {
            if let Some(want) = id { if e.manifest.id != want { continue } } else if !e.update_available { continue }
            let pack = self.packs_resolve(&e.manifest.id)?;
            reports.push(mk::update(&self.root, &pack)?);
        }
        if let Some(want) = id { if reports.is_empty() { return Err(format!("'{want}' is not installed").into()); } }
        Ok(reports)
    }

    /// The notes that `cortex publish` would put on a site — a read-only look.
    /// Building or pushing a site is deliberately not an op here: publishing
    /// is the person's decision, made in the CLI or the app, never by an
    /// agent through MCP.
    // ── Comments ────────────────────────────────────────────────────────────
    // Threads live in `notes/foo.comments.yaml` beside the note; the note
    // itself is never touched. Each write commits when auto_commit is on, like
    // any other change made from the terminal.

    /// Every comment thread on a note, plus the note's body so callers can
    /// tell which anchors still point somewhere.
    pub fn comments(&self, target: &str) -> Result<(Note, Vec<Thread>)> {
        let note = self.read(target)?;
        let threads = comments::load(&self.root, &note.path)?;
        Ok((note, threads))
    }

    /// Open a thread; with `quote`, anchored to that passage (which must be in
    /// the note, so the anchor never points nowhere from the start).
    pub fn comment(&self, target: &str, text: &str, quote: Option<&str>, occurrence: usize) -> Result<Thread> {
        let note = self.read(target)?;
        let anchor = match quote.map(str::trim).filter(|q| !q.is_empty()) {
            Some(q) => {
                let anchor = Anchor { quote: q.to_string(), occurrence };
                if comments::locate(&note.body, &anchor).is_none() {
                    return Err(format!("'{q}' (occurrence {occurrence}) is not in {}", note.path).into());
                }
                Some(anchor)
            }
            None => None,
        };
        let thread = comments::add(&self.root, &note.path, anchor, text, None)?;
        rename::commit_if_auto(&self.root, &format!("Comment on {}", note::infer_title(&note)))?;
        Ok(thread)
    }

    pub fn reply_comment(&self, target: &str, id: &str, text: &str) -> Result<Thread> {
        let note = self.read(target)?;
        let thread = comments::reply(&self.root, &note.path, id, text, None)?;
        rename::commit_if_auto(&self.root, &format!("Reply on {}", note::infer_title(&note)))?;
        Ok(thread)
    }

    pub fn resolve_comment(&self, target: &str, id: &str, resolved: bool) -> Result<Thread> {
        let note = self.read(target)?;
        let thread = comments::resolve(&self.root, &note.path, id, resolved)?;
        let verb = if resolved { "Resolve" } else { "Reopen" };
        rename::commit_if_auto(&self.root, &format!("{verb} comment on {}", note::infer_title(&note)))?;
        Ok(thread)
    }

    pub fn publish_preview(&self) -> Result<Vec<cortex_core::publish::PublishEntry>> {
        Ok(cortex_core::publish::preview(&self.root)?)
    }

    // ── Import ──────────────────────────────────────────────────────────────

    /// `--map` arguments (`Header=property[:type]`, `Header=` to skip) as column overrides.
    pub fn csv_options(collection: &str, title: Option<&str>, maps: &[String]) -> Result<cortex_core::import::CsvOptions> {
        let mut columns = Vec::new();
        for m in maps {
            let (header, rest) = m.split_once('=').ok_or_else(|| format!("--map needs HEADER=property[:type], got '{m}'"))?;
            let (property, ty) = rest.split_once(':').unwrap_or((rest, ""));
            columns.push(cortex_core::import::ColumnMap { header: header.to_string(), property: property.to_string(), ty: ty.to_string(), options: vec![] });
        }
        Ok(cortex_core::import::CsvOptions { collection: collection.to_string(), title_column: title.map(str::to_string), columns })
    }

    /// What importing a CSV would write, without writing it.
    pub fn import_csv_plan(&self, file: &std::path::Path, opts: &cortex_core::import::CsvOptions) -> Result<cortex_core::import::CsvPlan> {
        Ok(cortex_core::import::plan_csv(&self.root, file, opts)?)
    }

    /// Import a CSV as rows of a collection and index them.
    pub fn import_csv(&self, file: &std::path::Path, opts: &cortex_core::import::CsvOptions) -> Result<cortex_core::import::CsvReport> {
        let r = cortex_core::import::import_csv(&self.root, file, opts)?;
        let db = self.db()?;
        for p in &r.written { let _ = index::index_file(&self.root, &self.root.join(p), &db); }
        Ok(r)
    }

    /// Copy a folder of Markdown under `notes/<into>/` (images into `assets/`) and index it.
    pub fn import_markdown(&self, dir: &std::path::Path, into: &str, dry_run: bool) -> Result<cortex_core::import::MarkdownReport> {
        let r = cortex_core::import::import_markdown(&self.root, dir, into, dry_run)?;
        if !dry_run {
            let db = self.db()?;
            for p in &r.notes { let _ = index::index_file(&self.root, &self.root.join(p), &db); }
        }
        Ok(r)
    }

    /// Import a Notion export (zip or folder): pages, collections, assets, report; index what was written.
    pub fn import_notion(&self, src: &std::path::Path, into: &str, dry_run: bool) -> Result<cortex_core::import::notion::NotionReport> {
        let r = cortex_core::import::notion::import_notion(&self.root, src, into, dry_run)?;
        if !dry_run {
            let db = self.db()?;
            let rows = r.collections.iter().flat_map(|c| c.written.iter());
            for p in r.notes.iter().chain(rows).chain(r.report.iter()) { let _ = index::index_file(&self.root, &self.root.join(p), &db); }
        }
        Ok(r)
    }

    // ── Git & proposals ─────────────────────────────────────────────────────

    pub fn status(&self) -> Result<StatusReport> {
        let repo = self.repo()?;
        Ok(StatusReport {
            status: git::get_status(&repo)?,
            log: git::get_log(&repo, 5).unwrap_or_default(),
            proposals: git::list_agent_branches(&repo).unwrap_or_default(),
        })
    }

    /// Package changes as a proposal branch; returns its name.
    pub fn propose(&self, name: &str, message: Option<&str>, paths: &[String], all: bool) -> Result<String> {
        let message = message.unwrap_or(name);
        Ok(git::propose(&self.repo()?, name, message, paths, all)?)
    }

    pub fn proposals(&self) -> Result<Vec<AgentBranch>> {
        Ok(git::list_agent_branches(&self.repo()?)?)
    }

    pub fn diff(&self, name: &str) -> Result<CommitDiff> {
        Ok(git::get_branch_diff(&self.repo()?, &branch_name(name))?)
    }

    pub fn apply(&self, name: &str) -> Result<String> {
        let b = branch_name(name);
        git::apply_agent_branch(&self.repo()?, &b)?;
        Ok(b)
    }

    pub fn discard(&self, name: &str) -> Result<String> {
        let b = branch_name(name);
        git::discard_agent_branch(&self.repo()?, &b)?;
        Ok(b)
    }
}

/// Accept either "agent/x" or just "x".
pub fn branch_name(name: &str) -> String {
    if name.starts_with("agent/") { name.to_string() } else { format!("agent/{}", git::slugify(name)) }
}

/// A v4-shaped UUID from the OS-seeded hasher — unique enough for note ids
/// without a crate for one template variable.
fn uuid() -> String {
    use std::hash::{BuildHasher, Hasher};
    let mut bytes = [0u8; 16];
    for chunk in bytes.chunks_mut(8) {
        let mut h = std::collections::hash_map::RandomState::new().build_hasher();
        h.write_u64(
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos() as u64)
                .unwrap_or(0),
        );
        chunk.copy_from_slice(&h.finish().to_le_bytes());
    }
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    let h: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    format!("{}-{}-{}-{}-{}", &h[..8], &h[8..12], &h[12..16], &h[16..20], &h[20..])
}
