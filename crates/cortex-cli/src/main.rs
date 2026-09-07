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
use cortex_core::data::CellValue;
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
    /// Set frontmatter properties: key=value (YAML-typed); `key=` removes it
    Set {
        target: String,
        #[arg(required = true)]
        pairs: Vec<String>,
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
    Schema { key: Option<String> },
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
    /// Serve the vault to an agent over MCP (stdio)
    Mcp,
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
            let note = v.set_properties(&target, Vault::parse_pairs(&pairs)?)?;
            if out.json { out.emit(&note.frontmatter) }
            else { print!("{}", serde_yaml::to_string(&note.frontmatter)?); Ok(()) }
        }
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
                    .chain(t.columns.iter().map(|c| r.cells.get(&c.key).map(cell_text).unwrap_or_default()))
                    .collect()
            }).collect();
            table(&headers, rows);
            Ok(())
        }
        Cmd::Schema { key } => match key {
            Some(k) => {
                let s = v.schema(&k)?;
                if out.json { out.emit(&s) } else { print!("{}", serde_yaml::to_string(&s)?); Ok(()) }
            }
            None => {
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
        Cmd::Mcp => tokio::runtime::Runtime::new()?.block_on(mcp::serve(v)),
    }
}

// ── Output ──────────────────────────────────────────────────────────────────

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

fn cell_text(v: &CellValue) -> String {
    match v {
        CellValue::Null => String::new(),
        CellValue::Text(t) | CellValue::Date(t) => t.clone(),
        CellValue::Num(n) => if n.fract() == 0.0 { format!("{}", *n as i64) } else { n.to_string() },
        CellValue::Bool(b) => b.to_string(),
        CellValue::List(items) => items.join(", "),
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
