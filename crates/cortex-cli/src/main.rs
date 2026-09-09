//! cortex — the command-line face of a vault, for people and agents.
//!
//! Built on the same crate as the app, so whoever drives this sees exactly
//! what the user sees: the same frontmatter rules, the same link resolution,
//! the same views over collections. Every command takes `--json` for
//! machines; the default output is for people. `cortex mcp` serves the same
//! operations to an agent over the Model Context Protocol. The app follows
//! the filesystem, so anything written here shows up in it immediately.

mod mcp;
mod ops;

use clap::{Parser, Subcommand};
use cortex_core::note::NoteEntry;
use ops::{NewNote, Vault};
use std::io::Read;
use std::path::PathBuf;

#[derive(Parser)]
#[command(name = "cortex", version, about = "Work with a Cortex vault from the terminal")]
struct Cli {
    /// Vault root (default: walk up from the current directory)
    #[arg(long, global = true, env = "CORTEX_VAULT", value_name = "DIR")]
    vault: Option<PathBuf>,
    /// Machine-readable output
    #[arg(long, global = true)]
    json: bool,
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// Create a new vault from the bundled starter template (offline) and print its path
    Init {
        /// Directory to create; must be empty or absent (default: current directory)
        dir: Option<PathBuf>,
    },
    /// List notes, newest first
    Ls {
        /// Only notes under this folder, e.g. notes/work
        dir: Option<String>,
        #[arg(long = "type")]
        note_type: Option<String>,
        #[arg(long)]
        tag: Option<String>,
    },
    /// Full-text search over titles and bodies
    Search { query: Vec<String> },
    /// Print a note — by path, title, or filename stem
    Show {
        target: String,
        /// Body only, without frontmatter
        #[arg(long)]
        body: bool,
    },
    /// Create a note and print its path
    New {
        title: String,
        /// Folder to create it in
        #[arg(long, default_value = "notes")]
        dir: String,
        #[arg(long = "type")]
        note_type: Option<String>,
        /// Tag (repeatable)
        #[arg(long = "tag")]
        tags: Vec<String>,
        /// Seed from templates/<name>.md ({{date}}, {{time}}, {{title}}, {{uuid}})
        #[arg(long)]
        template: Option<String>,
        /// Body text, or "-" to read it from stdin
        #[arg(long)]
        body: Option<String>,
    },
    /// Set frontmatter properties: key=value (YAML-typed); key+=v / key-=v add to or remove from a list; `key=` removes it.
    /// A missing collection row is created first (from its row template), so a tracker's day file needs no setup.
    Set {
        target: String,
        #[arg(required = true)]
        pairs: Vec<String>,
    },
    /// Trackers: habits and anything else logged per day. No collection: list the tracker views; with one: print its grid
    Tracker {
        /// Collection with a tracker view, e.g. habits
        collection: Option<String>,
        /// today | week | month | year (default: the view's own)
        #[arg(long)]
        range: Option<String>,
        /// Anchor the grid on this date instead of today (YYYY-MM-DD)
        #[arg(long, value_name = "DATE")]
        at: Option<String>,
        /// Which tracker view of the collection (default: the first)
        #[arg(long)]
        view: Option<String>,
        /// Tick this item (by title; a unique prefix will do) for --date or today, and print its streak
        #[arg(long, value_name = "ITEM")]
        log: Option<String>,
        /// Day to log for (default: today)
        #[arg(long, value_name = "DATE")]
        date: Option<String>,
        /// With --log: untick instead of tick
        #[arg(long)]
        off: bool,
    },
    /// Replace a note's body from stdin, keeping its frontmatter
    Write { target: String },
    /// Rewrite notes in canonical form (sorted frontmatter keys) — all notes if none given
    Fmt { targets: Vec<String> },
    /// Outgoing [[wiki links]] of a note, resolved
    Links { target: String },
    /// Notes that link to this one
    Backlinks { target: String },
    /// List collections (databases)
    Collections,
    /// Query a collection the way the app's table view does
    View {
        collection: String,
        /// e.g. 'status == active and priority > 2'
        #[arg(long)]
        filter: Option<String>,
        /// field, or 'field desc' (repeatable)
        #[arg(long = "sort")]
        sort: Vec<String>,
        /// Comma-separated columns to show
        #[arg(long, value_delimiter = ',')]
        columns: Option<Vec<String>>,
        #[arg(long)]
        limit: Option<usize>,
    },
    /// Show a property schema (collection name or note type); lists them if none given
    Schema {
        key: Option<String>,
        #[command(subcommand)]
        action: Option<SchemaCmd>,
    },
    /// Working tree, sync state, recent commits and pending proposals
    Status,
    /// Package changes as a proposal: an agent/<name> branch the user reviews in the app
    Propose {
        name: String,
        /// Commit message (default: the name)
        #[arg(short, long)]
        message: Option<String>,
        /// Include every change in the working tree
        #[arg(long)]
        all: bool,
        /// Vault-relative paths to include
        paths: Vec<String>,
    },
    /// List pending proposals
    Proposals,
    /// Show what a proposal would change
    Diff { name: String },
    /// Merge a proposal into the current branch
    Apply { name: String },
    /// Delete a proposal without merging
    Discard { name: String },
    /// Show or change vault settings (.cortex/settings.yaml); prints them all if no subcommand
    Settings {
        #[command(subcommand)]
        action: Option<SettingsCmd>,
    },
    /// Which agent CLIs (claude, hermes, openclaw, …) are installed, for `terminal_command`
    Agents,
    /// Build a static site from the notes marked `publish: true` (or tagged `public`)
    ///
    /// Nothing is ever published on its own: this command is the act. With no
    /// target it only lists what would be published.
    Publish {
        /// Write the site into this directory (refuses a non-empty one it did not write, see --force)
        #[arg(long, value_name = "DIR", conflicts_with = "gh_pages")]
        out: Option<PathBuf>,
        /// Build and force-push the site as the `gh-pages` branch of the remote
        #[arg(long, conflicts_with = "out")]
        gh_pages: bool,
        /// Remote to push to with --gh-pages
        #[arg(long, default_value = "origin")]
        remote: String,
        /// Branch to push to with --gh-pages
        #[arg(long, default_value = "gh-pages")]
        branch: String,
        /// Write into a non-empty --out directory anyway (never deletes files it did not write)
        #[arg(long)]
        force: bool,
        /// Write .github/workflows/publish.yml — a manual "Run workflow" deploy to GitHub Pages
        #[arg(long)]
        github_action: bool,
    },
    /// Template packs: browse, install, update, remove, lint, author (see docs/marketplace.md)
    Packs {
        #[command(subcommand)]
        action: PacksCmd,
    },
    /// Serve the vault to an agent over MCP (stdio)
    Mcp,
}

#[derive(Subcommand)]
enum PacksCmd {
    /// Packs available to this vault: bundled plus the configured indexes
    List {
        /// Only packs of this tier: official | verified | community
        #[arg(long)]
        tier: Option<String>,
        /// Only installed packs
        #[arg(long)]
        installed: bool,
        /// Re-fetch the remote index instead of using the cache
        #[arg(long)]
        refresh: bool,
    },
    /// A pack's manifest, files, and what installing it would write here
    Show { id: String },
    /// Install a pack (never overwrites your files unless --force; schemas merge)
    Install {
        id: String,
        /// Overwrite templates that exist and are not from this pack
        #[arg(long)]
        force: bool,
        /// Print the plan and write nothing
        #[arg(long)]
        dry_run: bool,
    },
    /// Update installed packs to the newest version the indexes offer; files you edited are kept
    Update {
        /// One pack; default is every installed pack with an update
        id: Option<String>,
    },
    /// Remove a pack: deletes only the files it installed that you have not changed
    Remove { id: String },
    /// Check a pack directory (or every pack under packs/) against the format rules
    Lint {
        /// A pack directory, or a marketplace checkout containing packs/
        #[arg(default_value = ".")]
        path: PathBuf,
    },
    /// Start a pack from something in this vault: --from templates/x.md or --from collections/name
    New {
        id: String,
        #[arg(long, value_name = "PATH")]
        from: String,
        /// Where to write the pack directory (default: current directory)
        #[arg(long, default_value = ".")]
        out: PathBuf,
    },
    /// Regenerate index.json from packs/ and tiers.yaml (what the marketplace repo's CI runs)
    Index {
        /// Marketplace checkout (contains packs/)
        #[arg(default_value = ".")]
        path: PathBuf,
        /// Where pack files are served from, absolute or relative to index.json
        #[arg(long, default_value = "packs/")]
        base: String,
    },
    /// Re-fetch the remote index now
    Refresh,
}

#[derive(Subcommand)]
enum SchemaCmd {
    /// Rename a property everywhere: the schema, every row, the views, and the rollups / formulas that use it
    Rename {
        /// Collection name or note type
        key: String,
        old: String,
        new: String,
    },
    /// Delete a property from the schema, every row and every view (refused while a rollup or formula uses it)
    Rm {
        /// Collection name or note type
        key: String,
        name: String,
    },
}

#[derive(Subcommand)]
enum SettingsCmd {
    /// Print one setting; `keybindings.<id>` reads a single override
    Get { key: String },
    /// Set settings: key=value (typed per key; `keybindings.<id>=<keys>`, empty value removes); prints the file
    Set {
        #[arg(required = true)]
        pairs: Vec<String>,
    },
    /// Every setting with its default and meaning
    Describe,
}

type Result<T> = ops::Result<T>;

fn main() {
    if let Err(e) = run() {
        eprintln!("error: {e}");
        std::process::exit(1);
    }
}

fn run() -> Result<()> {
    let cli = Cli::parse();
    let out = Out { json: cli.json };

    // `init` is the one command that runs outside a vault: it makes one.
    if let Cmd::Init { dir } = &cli.cmd {
        let dir = dir.clone().or_else(|| cli.vault.clone()).unwrap_or_else(|| PathBuf::from("."));
        let root = ops::init(dir)?;
        if out.json { return out.emit(&serde_json::json!({ "path": root })); }
        println!("{}", root.display());
        return Ok(());
    }

    // `packs lint` and `packs index` work on a directory — a pack, or a
    // marketplace checkout — and need no vault: CI and contributors run them
    // outside one.
    if let Cmd::Packs { action: PacksCmd::Lint { path } } = &cli.cmd {
        return packs_lint(&out, path.clone());
    }
    if let Cmd::Packs { action: PacksCmd::Index { path, base } } = &cli.cmd {
        return packs_index(&out, path.clone(), base.clone());
    }

    let v = Vault::open(cli.vault)?;

    match cli.cmd {
        Cmd::Init { .. } => unreachable!("handled above"),
        Cmd::Ls { dir, note_type, tag } => {
            out.notes(&v.list(dir.as_deref(), note_type.as_deref(), tag.as_deref()))
        }
        Cmd::Search { query } => out.notes(&v.search(&query.join(" "))?),
        Cmd::Show { target, body } => {
            if out.json { out.emit(&v.read(&target)?) }
            else if body { print!("{}", v.read(&target)?.body); Ok(()) }
            else { print!("{}", v.raw(&target)?); Ok(()) }
        }
        Cmd::New { title, dir, note_type, tags, template, body } => {
            let body = match body.as_deref() {
                Some("-") => Some(read_stdin()?),
                other => other.map(str::to_string),
            };
            let note = v.create(NewNote { title, dir: Some(dir), note_type, tags, template, body })?;
            if out.json { out.emit(&note) } else { println!("{}", note.path); Ok(()) }
        }
        Cmd::Set { target, pairs } => {
            let (note, created) = v.apply_pairs(&target, &pairs)?;
            if created && !out.json { eprintln!("created {}", note.path); }
            if out.json { out.emit(&note.frontmatter) }
            else { print!("{}", serde_yaml::to_string(&note.frontmatter)?); Ok(()) }
        }
        Cmd::Tracker { collection, range, at, view, log, date, off } => tracker(&v, &out, collection, range, at, view, log, date, off),
        Cmd::Write { target } => {
            let note = v.write_body(&target, &read_stdin()?)?;
            if out.json { out.emit(&note) } else { println!("{}", note.path); Ok(()) }
        }
        Cmd::Fmt { targets } => {
            let report = v.fmt(&targets)?;
            if out.json { out.emit(&report) }
            else {
                for p in &report.rewritten { println!("{p}"); }
                eprintln!("{} of {} rewritten", report.rewritten.len(), report.checked);
                Ok(())
            }
        }
        Cmd::Links { target } => {
            let links = v.links(&target)?;
            if out.json { return out.emit(&links); }
            table(&["LINK", "PATH"], links.iter().map(|l| vec![
                l.target.clone(), l.path.clone().unwrap_or_else(|| "(unresolved)".into()),
            ]).collect());
            Ok(())
        }
        Cmd::Backlinks { target } => out.notes(&v.backlinks(&target)?),
        Cmd::Collections => {
            let names = v.collections();
            if out.json { out.emit(&names) } else { for n in names { println!("{n}"); } Ok(()) }
        }
        Cmd::View { collection, filter, sort, columns, limit } => {
            let t = v.view(&collection, filter.as_deref(), &sort, columns.as_deref(), limit)?;
            if out.json { return out.emit(&t); }
            let headers: Vec<&str> = std::iter::once("ID").chain(t.columns.iter().map(|c| c.key.as_str())).collect();
            let rows = t.rows.iter().map(|r| {
                std::iter::once(r.id.clone())
                    .chain(t.columns.iter().map(|c| r.cells.get(&c.key).map(json_text).unwrap_or_default()))
                    .collect()
            }).collect();
            table(&headers, rows);
            Ok(())
        }
        Cmd::Schema { key, action } => match (action, key) {
            (Some(SchemaCmd::Rename { key, old, new }), _) => {
                let c = v.rename_property(&key, &old, &new)?;
                if out.json { out.emit(&c) } else { println!("renamed {key}.{old} → {new}: {}", property_change(&c)); Ok(()) }
            }
            (Some(SchemaCmd::Rm { key, name }), _) => {
                let c = v.delete_property(&key, &name)?;
                if out.json { out.emit(&c) } else { println!("removed {key}.{name}: {}", property_change(&c)); Ok(()) }
            }
            (None, Some(k)) => {
                let s = v.schema(&k)?;
                if out.json { out.emit(&s) } else { print!("{}", serde_yaml::to_string(&s)?); Ok(()) }
            }
            (None, None) => {
                let keys = v.schemas();
                if out.json { out.emit(&keys) } else { for k in keys { println!("{k}"); } Ok(()) }
            }
        },
        Cmd::Status => {
            let r = v.status()?;
            if out.json { return out.emit(&r); }
            let s = &r.status;
            let changed = s.staged.len() + s.unstaged.len() + s.untracked.len();
            if changed == 0 { println!("clean"); } else {
                println!("{changed} changed:");
                for f in s.staged.iter().chain(&s.unstaged).chain(&s.untracked) { println!("  {f}"); }
            }
            if s.ahead + s.behind > 0 { println!("sync: {} to push, {} to pull", s.ahead, s.behind); }
            if !r.proposals.is_empty() {
                println!("proposals:");
                for p in &r.proposals {
                    println!("  {} — {} ({} commit{}{})", p.name, p.description, p.commit_count,
                        if p.commit_count == 1 { "" } else { "s" }, if p.remote { ", on origin" } else { "" });
                }
            }
            if !r.log.is_empty() {
                println!("recent:");
                for c in &r.log { println!("  {} {}", c.hash.get(..7).unwrap_or(&c.hash), c.message); }
            }
            Ok(())
        }
        Cmd::Propose { name, message, all, paths } => {
            let branch = v.propose(&name, message.as_deref(), &paths, all)?;
            if out.json { out.emit(&serde_json::json!({ "branch": branch })) } else {
                println!("{branch}");
                eprintln!("Proposal created. The user reviews it in the app (or: cortex diff / apply / discard).");
                Ok(())
            }
        }
        Cmd::Proposals => {
            let list = v.proposals()?;
            if out.json { return out.emit(&list); }
            table(&["BRANCH", "DESCRIPTION", "COMMITS", "WHERE"], list.iter().map(|p| vec![
                p.name.clone(), p.description.clone(), p.commit_count.to_string(),
                if p.remote { "origin".into() } else { "local".into() },
            ]).collect());
            Ok(())
        }
        Cmd::Diff { name } => {
            let d = v.diff(&name)?;
            if out.json { return out.emit(&d); }
            println!("# {} — {} ({})\n", d.message, d.author, d.hash);
            print!("{}", d.patch);
            Ok(())
        }
        Cmd::Apply { name } => {
            let b = v.apply(&name)?;
            if out.json { out.emit(&serde_json::json!({ "applied": b })) } else { println!("applied {b}"); Ok(()) }
        }
        Cmd::Discard { name } => {
            let b = v.discard(&name)?;
            if out.json { out.emit(&serde_json::json!({ "discarded": b })) } else { println!("discarded {b}"); Ok(()) }
        }
        Cmd::Settings { action } => match action {
            None => out.settings(&v.settings()?),
            Some(SettingsCmd::Get { key }) => {
                let value = v.setting(&key)?;
                if out.json { return out.emit(&value); }
                match &value {
                    serde_yaml::Value::Null => println!(),
                    serde_yaml::Value::String(s) => println!("{s}"),
                    serde_yaml::Value::Mapping(_) | serde_yaml::Value::Sequence(_) => print!("{}", serde_yaml::to_string(&value)?),
                    other => println!("{}", serde_yaml::to_string(other)?.trim_end()),
                }
                Ok(())
            }
            Some(SettingsCmd::Set { pairs }) => {
                let edits = pairs
                    .iter()
                    .map(|p| p.split_once('=').ok_or_else(|| format!("expected key=value, got '{p}'")))
                    .collect::<std::result::Result<Vec<_>, _>>()?;
                out.settings(&v.update_settings(edits)?)
            }
            Some(SettingsCmd::Describe) => {
                let defaults = cortex_core::settings::to_value(&cortex_core::settings::Settings::default())?;
                let rows: Vec<(&str, String, &str)> = cortex_core::settings::describe()
                    .into_iter()
                    .map(|(k, d)| {
                        let dv = defaults.get(k).cloned().unwrap_or(serde_yaml::Value::Null);
                        (k, yaml_scalar(&dv), d)
                    })
                    .collect();
                if out.json {
                    return out.emit(&rows.iter().map(|(k, dv, d)| serde_json::json!({ "key": k, "default": dv, "description": d })).collect::<Vec<_>>());
                }
                table(&["KEY", "DEFAULT", "DESCRIPTION"], rows.into_iter().map(|(k, dv, d)| vec![k.into(), dv, d.into()]).collect());
                Ok(())
            }
        },
        Cmd::Agents => {
            let agents = v.agents();
            if out.json { return out.emit(&agents); }
            table(&["ID", "LABEL", "COMMAND", "FOUND", "PATH"], agents.iter().map(|a| vec![
                a.id.clone(), a.label.clone(), a.command.clone(),
                if a.found { "yes".into() } else { "no".into() }, a.path.clone().unwrap_or_default(),
            ]).collect());
            Ok(())
        }
        Cmd::Publish { out: out_dir, gh_pages, remote, branch, force, github_action } => {
            use cortex_core::publish;
            if github_action {
                let p = publish::write_github_action(&v.root)?;
                if out.json { return out.emit(&serde_json::json!({ "written": p })); }
                println!("wrote {}\nEnable it: GitHub → Settings → Pages → Source: GitHub Actions, then Actions → Publish → Run workflow.", p.display());
                return Ok(());
            }
            let pages_table = |pages: &[publish::PublishEntry]| {
                table(&["PATH", "TITLE", "URL"], pages.iter().map(|e| vec![e.path.clone(), e.title.clone(), e.url.clone()]).collect());
            };
            if let Some(dir) = out_dir {
                let r = publish::build(&v.root, &dir, force)?;
                if out.json { return out.emit(&r); }
                pages_table(&r.pages);
                println!("\n{} page(s), {} asset(s) → {}{}", r.pages.len(), r.assets.len(), r.out_dir.display(),
                    if r.removed.is_empty() { String::new() } else { format!(" ({} stale file(s) removed)", r.removed.len()) });
                Ok(())
            } else if gh_pages {
                let r = publish::push_gh_pages(&v.root, &remote, &branch)?;
                if out.json { return out.emit(&r); }
                pages_table(&r.report.pages);
                println!("\n{} page(s) pushed to {} ({})", r.report.pages.len(), r.branch, r.remote_url);
                match r.url {
                    Some(u) => println!("GitHub Pages (once enabled for the {} branch): {u}", r.branch),
                    None => println!("Point your static host at the {} branch.", r.branch),
                }
                Ok(())
            } else {
                let pages = v.publish_preview()?;
                if out.json { return out.emit(&pages); }
                if pages.is_empty() {
                    println!("Nothing is marked for publishing. Add `publish: true` to a note's frontmatter (or the `public` tag), then run `cortex publish --out DIR`.");
                } else {
                    pages_table(&pages);
                    println!("\n{} note(s) would be published. Run with --out DIR or --gh-pages to build.", pages.len());
                }
                Ok(())
            }
        }
        Cmd::Packs { action } => packs(&v, &out, action),
        Cmd::Mcp => tokio::runtime::Runtime::new()?.block_on(mcp::serve(v)),
    }
}

fn packs(v: &Vault, out: &Out, action: PacksCmd) -> Result<()> {
    use cortex_core::marketplace as mk;
    let tier_label = |t: mk::Tier| match t { mk::Tier::Official => "official", mk::Tier::Verified => "verified", mk::Tier::Community => "community" };
    match action {
        PacksCmd::List { tier, installed, refresh } => {
            let cat = v.packs_catalog(refresh)?;
            let rows: Vec<&mk::CatalogEntry> = cat.entries.iter()
                .filter(|e| tier.as_deref().map_or(true, |t| tier_label(e.tier) == t))
                .filter(|e| !installed || e.installed_version.is_some())
                .collect();
            if out.json { return out.emit(&rows); }
            table(&["ID", "NAME", "KIND", "TIER", "VERSION", "INSTALLED", "SUMMARY"], rows.iter().map(|e| vec![
                e.manifest.id.clone(), e.manifest.name.clone(), format!("{:?}", e.manifest.kind).to_lowercase(), tier_label(e.tier).into(),
                e.manifest.version.clone(),
                match (&e.installed_version, e.update_available) { (Some(v), true) => format!("{v} → update"), (Some(v), false) => v.clone(), _ => String::new() },
                e.manifest.summary.clone(),
            ]).collect());
            for (url, err) in &cat.errors { eprintln!("warning: {url}: {err} (showing bundled packs)"); }
            Ok(())
        }
        PacksCmd::Show { id } => {
            let pack = v.packs_resolve(&id)?;
            let plan = mk::plan(&v.root, &pack, false);
            if out.json { return out.emit(&serde_json::json!({ "pack": pack, "plan": plan })); }
            let m = &pack.manifest;
            println!("{} ({})  v{}  {:?}  {}  {}", m.name, m.id, m.version, m.kind, tier_label(pack.tier), m.license);
            println!("{}\n", m.summary);
            if !m.description.trim().is_empty() { println!("{}\n", m.description.trim()); }
            if !m.credits.is_empty() { println!("Credits: {}\n", m.credits); }
            println!("Installing here would:");
            for s in &plan.steps {
                let what = match &s.action { mk::Action::Write => "write".to_string(), mk::Action::Overwrite => "overwrite (ours)".into(), mk::Action::Merge => "merge schema".into(), mk::Action::Skip { reason } => format!("skip — {reason}") };
                println!("  {:<44} {}", s.dest, what);
            }
            Ok(())
        }
        PacksCmd::Install { id, force, dry_run } => {
            let pack = v.packs_resolve(&id)?;
            if dry_run {
                let plan = mk::plan(&v.root, &pack, force);
                if out.json { return out.emit(&plan); }
                for s in &plan.steps { println!("{:<44} {:?}", s.dest, s.action); }
                return Ok(());
            }
            let reports = v.packs_install(&pack, force)?;
            if out.json { return out.emit(&reports); }
            for r in &reports {
                println!("installed {} {}", r.id, r.version);
                for w in &r.written { println!("  + {w}"); }
                for m in &r.merged { println!("  ~ {m} (schema merged)"); }
                for (s, why) in &r.skipped { println!("  - {s} (skipped: {why})"); }
            }
            Ok(())
        }
        PacksCmd::Update { id } => {
            let reports = v.packs_update(id.as_deref())?;
            if out.json { return out.emit(&reports); }
            if reports.is_empty() { println!("everything is up to date"); }
            for r in &reports {
                println!("updated {} {} → {}", r.id, r.from, r.to);
                for f in &r.replaced { println!("  ~ {f}"); }
                for f in &r.added { println!("  + {f}"); }
                for f in &r.kept { println!("  = {f} (kept your version)"); }
            }
            Ok(())
        }
        PacksCmd::Remove { id } => {
            let r = mk::remove(&v.root, &id)?;
            if out.json { return out.emit(&r); }
            println!("removed {}", r.id);
            for f in &r.removed { println!("  - {f}"); }
            for f in &r.kept { println!("  = {f} (edited since install, kept)"); }
            Ok(())
        }
        PacksCmd::Lint { path } => packs_lint(out, path),
        PacksCmd::New { id, from, out: out_dir } => {
            let dir = mk::export(&v.root, &id, &from, &out_dir)?;
            if out.json { return out.emit(&serde_json::json!({ "path": dir })); }
            println!("wrote {}\nEdit manifest.yaml (summary, description, tags), add seeds if you like, then: cortex packs lint {}", dir.display(), dir.display());
            Ok(())
        }
        PacksCmd::Index { path, base } => packs_index(out, path, base),
        PacksCmd::Refresh => {
            let cat = v.packs_catalog(true)?;
            if out.json { return out.emit(&serde_json::json!({ "packs": cat.entries.len(), "errors": cat.errors, "generated": cat.fetched_at })); }
            println!("{} packs available{}", cat.entries.len(), cat.fetched_at.map(|g| format!(" (index generated {g})")).unwrap_or_default());
            for (url, err) in &cat.errors { eprintln!("warning: {url}: {err}"); }
            Ok(())
        }
    }
}

/// Lint one pack directory, or every pack under a checkout's `packs/`.
fn packs_lint(out: &Out, path: PathBuf) -> Result<()> {
    use cortex_core::marketplace as mk;
    let dirs: Vec<PathBuf> = if path.join("manifest.yaml").exists() { vec![path] }
        else if path.join("packs").is_dir() { let mut d: Vec<_> = std::fs::read_dir(path.join("packs"))?.flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect(); d.sort(); d }
        else { return Err(format!("{}: neither a pack (manifest.yaml) nor a marketplace checkout (packs/)", path.display()).into()) };
    let mut all = Vec::new();
    let mut errors = 0;
    for d in dirs {
        let id = d.file_name().unwrap().to_string_lossy().into_owned();
        let findings = match mk::load_dir(&d) { Ok(p) => mk::lint(&p), Err(e) => vec![mk::Finding { severity: mk::Severity::Error, file: None, message: e.to_string() }] };
        for f in &findings {
            if f.severity == mk::Severity::Error { errors += 1; }
            if !out.json { println!("{}: {}: {}{}", id, if f.severity == mk::Severity::Error { "error" } else { "warning" }, f.file.as_deref().map(|x| format!("{x}: ")).unwrap_or_default(), f.message); }
        }
        all.push(serde_json::json!({ "id": id, "findings": findings }));
    }
    if out.json { out.emit(&all)?; }
    else if errors == 0 { println!("ok"); }
    if errors > 0 { std::process::exit(1); }
    Ok(())
}

/// Regenerate a checkout's index.json — what the marketplace repo's CI runs.
fn packs_index(out: &Out, path: PathBuf, base: String) -> Result<()> {
    use cortex_core::marketplace as mk;
    let index = mk::generate_index(&path, &base)?;
    let dest = path.join("index.json");
    std::fs::write(&dest, serde_json::to_string_pretty(&index)?)?;
    if out.json { return out.emit(&index); }
    println!("{}: {} packs", dest.display(), index.packs.len());
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn tracker(v: &Vault, out: &Out, collection: Option<String>, range: Option<String>, at: Option<String>, view: Option<String>, log: Option<String>, date: Option<String>, off: bool) -> Result<()> {
    let Some(collection) = collection else {
        let all = v.trackers();
        if out.json { return out.emit(&all); }
        table(&["COLLECTION", "VIEW", "LOG"], all.iter().map(|t| vec![t.collection.clone(), t.view.clone(), t.log.clone()]).collect());
        if all.is_empty() { eprintln!("no tracker views — install the habit-tracker pack, or add `type: tracker` to a database's views"); }
        return Ok(());
    };
    if let Some(item) = log {
        let e = v.track(&collection, &item, date.as_deref(), Some(!off))?;
        if out.json { return out.emit(&e); }
        let streak = match (e.current_streak, e.streak_unit.as_str()) {
            (0, _) => String::new(),
            (n, "weeks") => format!(" ({n}-week streak)"),
            (n, _) => format!(" ({n}-day streak)"),
        };
        let week = if e.streak_unit == "weeks" { format!(" · {}/{} this week", e.week_done, e.target) } else { String::new() };
        println!("{} {} — {}{}{}", if e.done { "✓" } else { "✗" }, e.item, e.date, streak, week);
        return Ok(());
    }
    let r = v.tracker(&collection, view.as_deref(), range.as_deref(), at.as_deref())?;
    if out.json { return out.emit(&r); }
    print_tracker(&r);
    Ok(())
}

/// The grid as text: one row per item, a glyph per day, streak and week at the
/// right. Ranges wider than a month keep the numbers and drop the cells.
fn print_tracker(r: &cortex_core::tracker::TrackerResult) {
    use cortex_core::tracker::Cell;
    const DOW: [&str; 7] = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
    let glyph = |c: Cell| match c { Cell::Done => "●", Cell::Missed => "○", Cell::Pending => "◌", Cell::Free => "·", Cell::Off => "-", Cell::Future => " " };
    let name = |i: &cortex_core::tracker::TrackerItem| match &i.icon { Some(ic) => format!("{ic} {}", i.title), None => i.title.clone() };
    let width = r.items.iter().map(|i| name(i).chars().count()).max().unwrap_or(4).clamp(4, 28);
    let pad = |s: &str| { let n = s.chars().count(); if n >= width { s.chars().take(width).collect() } else { format!("{s}{}", " ".repeat(width - n)) } };
    let streak = |i: &cortex_core::tracker::TrackerItem| format!("{}{}", i.current_streak, if i.streak_unit == "weeks" { "w" } else { "d" });
    let show_cells = r.days.len() <= 31;

    println!("{} · {} → {}", r.range, r.start, r.end);
    if show_cells {
        let head: Vec<String> = r.days.iter().map(|d| {
            let day = chrono::NaiveDate::parse_from_str(&d.date, "%Y-%m-%d").ok();
            let label = if r.range == "week" {
                day.map(|x| { use chrono::Datelike; format!("{}{}", DOW[x.weekday().num_days_from_monday() as usize], if d.date == r.today { "*" } else { "" }) }).unwrap_or_default()
            } else {
                format!("{}{}", &d.date[8..], if d.date == r.today { "*" } else { "" })
            };
            format!("{label:<3}")
        }).collect();
        println!("{}  {}  streak  week", pad(""), head.join(""));
        for i in &r.items {
            let cells: String = i.cells.iter().map(|c| format!("{:<3}", glyph(*c))).collect();
            println!("{}  {}  {:<6}  {}/{}", pad(&name(i)), cells, streak(i), i.week_done, i.target);
        }
        let scores: String = r.days.iter().map(|d| format!("{:<3}", if d.expected > 0 { format!("{}", d.done) } else { String::new() })).collect();
        println!("{}  {}", pad("done"), scores);
    } else {
        println!("{}  {:>6}  {:>7}  {:>9}", pad(""), "streak", "longest", "done");
        for i in &r.items {
            println!("{}  {:>6}  {:>6}{}  {:>4}/{}", pad(&name(i)), streak(i), i.longest_streak, if i.streak_unit == "weeks" { "w" } else { "d" }, i.range_done, i.range_expected);
        }
    }
    let perfect = r.days.iter().filter(|d| d.perfect).count();
    match r.days.iter().find(|d| d.date == r.today) {
        Some(t) => println!("Today: {} of {}{}", t.done, t.expected, if t.perfect { " — perfect day" } else { "" }),
        None => println!("Perfect days: {perfect} of {}", r.days.iter().filter(|d| d.expected > 0).count()),
    }
}

// ── Output ──────────────────────────────────────────────────────────────────

/// "3 rows, 1 view, schemas tasks, projects" — what a property edit touched.
fn property_change(c: &cortex_core::schema::PropertyChange) -> String {
    let plural = |n: usize, w: &str| format!("{n} {w}{}", if n == 1 { "" } else { "s" });
    let mut parts = vec![plural(c.rows, "row"), plural(c.views, "view")];
    if !c.schemas.is_empty() { parts.push(format!("schemas {}", c.schemas.join(", "))); }
    parts.join(", ")
}

struct Out {
    json: bool,
}

impl Out {
    fn emit<T: serde::Serialize>(&self, value: &T) -> Result<()> {
        println!("{}", serde_json::to_string_pretty(value)?);
        Ok(())
    }

    /// The settings file as it is on disk (YAML), or JSON.
    fn settings(&self, s: &cortex_core::settings::Settings) -> Result<()> {
        if self.json { self.emit(s) } else { print!("{}", serde_yaml::to_string(s)?); Ok(()) }
    }

    fn notes(&self, notes: &[NoteEntry]) -> Result<()> {
        if self.json {
            return self.emit(&notes);
        }
        table(&["PATH", "TITLE", "TYPE", "TAGS"], notes.iter().map(|n| vec![
            n.path.clone(), n.title.clone(), n.note_type.clone().unwrap_or_default(), n.tags.join(","),
        ]).collect());
        Ok(())
    }
}

/// A YAML value on one line, as it would look in the file (`''`, `30`, `{}`).
fn yaml_scalar(v: &serde_yaml::Value) -> String {
    match v {
        serde_yaml::Value::String(s) if s.is_empty() => "''".into(),
        serde_yaml::Value::String(s) => s.clone(),
        serde_yaml::Value::Mapping(m) if m.is_empty() => "{}".into(),
        other => serde_yaml::to_string(other).unwrap_or_default().trim_end().to_string(),
    }
}

fn read_stdin() -> Result<String> {
    let mut s = String::new();
    std::io::stdin().read_to_string(&mut s)?;
    Ok(s)
}

fn json_text(v: &serde_json::Value) -> String {
    match v {
        serde_json::Value::Null => String::new(),
        serde_json::Value::String(t) => t.clone(),
        serde_json::Value::Number(n) => match n.as_f64() { Some(f) if f.fract() == 0.0 => format!("{}", f as i64), Some(f) => f.to_string(), None => n.to_string() },
        serde_json::Value::Bool(b) => b.to_string(),
        serde_json::Value::Array(items) => items.iter().map(json_text).collect::<Vec<_>>().join(", "),
        other => other.to_string(),
    }
}

/// Aligned columns for terminals; the last column is never padded.
fn table(headers: &[&str], rows: Vec<Vec<String>>) {
    if rows.is_empty() {
        eprintln!("(none)");
        return;
    }
    let n = headers.len();
    let mut widths: Vec<usize> = headers.iter().map(|h| h.chars().count()).collect();
    for r in &rows {
        for (i, c) in r.iter().enumerate().take(n) {
            widths[i] = widths[i].max(c.chars().count());
        }
    }
    let line = |cells: Vec<&str>| {
        let mut out = String::new();
        for (i, c) in cells.iter().enumerate() {
            if i + 1 == n {
                out.push_str(c);
            } else {
                out.push_str(&format!("{:<w$}  ", c, w = widths[i]));
            }
        }
        println!("{}", out.trim_end());
    };
    line(headers.to_vec());
    for r in &rows {
        line(r.iter().map(String::as_str).collect());
    }
}
