//! Operations on a vault, shared by the CLI (which prints them) and the MCP
//! server (which returns them as JSON). Every op returns data, never output,
//! and goes through cortex-core, so the semantics are the app's own.

use cortex_core::agents::{self, AgentCli};
use cortex_core::data::{self};
use cortex_core::db::Db;
use cortex_core::git::{self, AgentBranch, CommitDiff, CommitEntry, VaultStatus};
use cortex_core::note::{self, Note, NoteEntry};
use cortex_core::schema::TypeSchema;
use cortex_core::settings::Settings;
use cortex_core::tracker::{self, TrackerResult};
use cortex_core::{index, schema, settings, vault};
use serde::Serialize;
use std::collections::BTreeMap;
use std::path::PathBuf;

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
    pub target: String,
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
pub fn init(dir: PathBuf) -> Result<PathBuf> {
    cortex_core::template::scaffold(&dir)?;
    let root = dir.canonicalize()?;
    std::fs::write(root.join("VAULT.md"), vault::VAULT_MD)?;
    std::fs::write(root.join("AGENTS.md"), vault::AGENTS_MD)?;
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
            .filter(|n| tag.map_or(true, |t| n.tags.iter().any(|x| x == t)))
            .collect()
    }

    pub fn search(&self, query: &str) -> Result<Vec<NoteEntry>> {
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
        let changed: Vec<String> = props.keys().cloned().collect();
        for (k, v) in props {
            if v.is_null() {
                note.frontmatter.remove(&k);
            } else {
                note.frontmatter.insert(k, v);
            }
        }
        self.write(&note)?;
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
        self.write(&note)?;
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
            .map(|t| Link { path: vault::resolve(&notes, &t).map(|n| n.path.clone()), target: t })
            .collect())
    }

    pub fn backlinks(&self, target: &str) -> Result<Vec<NoteEntry>> {
        let rel = self.resolve(target)?.path;
        Ok(self.db()?.get_backlinks(&rel)?)
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
    pub fn view(
        &self,
        collection: &str,
        filter: Option<&str>,
        sort: &[String],
        columns: Option<&[String]>,
        limit: Option<usize>,
    ) -> Result<data::ResolvedTable> {
        let mut spec = serde_json::Map::new();
        spec.insert("source".into(), format!("collections/{}", collection.trim_end_matches('/')).into());
        if let Some(f) = filter { spec.insert("filter".into(), f.into()); }
        if !sort.is_empty() { spec.insert("sort".into(), sort.into()); }
        if let Some(c) = columns { spec.insert("columns".into(), c.into()); }
        if let Some(l) = limit { spec.insert("limit".into(), l.into()); }
        let yaml = serde_yaml::to_string(&serde_json::Value::Object(spec))?;
        // The same table the app shows: schema attached, rollups and formulas computed.
        Ok(data::resolve_view(&self.root, &yaml)?)
    }

    pub fn schema(&self, key: &str) -> Result<TypeSchema> {
        Ok(schema::load(&self.root, key)?.ok_or_else(|| format!("no schema for '{key}'"))?)
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
    pub fn publish_preview(&self) -> Result<Vec<cortex_core::publish::PublishEntry>> {
        Ok(cortex_core::publish::preview(&self.root)?)
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
