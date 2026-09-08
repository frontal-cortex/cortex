//! Tracker view — items × days with a mark per cell.
//!
//! One collection holds the *items* (habits, plants to water, medications…)
//! and another the *log*: one row per day whose `done` list names the items
//! completed that day. The view lays items against a range of days and works
//! out streaks and scores on read. Nothing derived is ever written: the only
//! write is [`toggle`], which adds or removes one title in one day's list,
//! creating that day's row from the collection's row template when the day
//! has no file yet. A missing day is simply a day with nothing done, so
//! "today" always exists without any scheduler.
//!
//! ```yaml
//! # collections/habits/_index.md
//! views:
//! - name: This week
//!   type: tracker
//!   log: collections/habit-log      # the days
//!   date: date                      # the log's date property (default `date`)
//!   done: done                      # the log's list of item titles (default `done`)
//!   range: week                     # today | week | month | year
//! ```
//!
//! Item rows may carry a frequency (`daily` | `weekdays` | `weekly` |
//! `custom`), a target (days per week, for weekly/custom), a start date, an
//! archived flag, an icon and a category-like select for colour. The spec
//! names the properties that play those roles — `frequency: cadence`,
//! `target: per_week`, `start: since`, `archived: retired`, `icon: emoji`,
//! `color: area` — and defaults to the property of the same name (colour:
//! `category`, else the first select). Everything is optional; a bare row is
//! a daily item.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use chrono::{Datelike, Duration, Local, NaiveDate, Weekday};
use serde::Serialize;

use crate::data::{self, CellValue, Query, ViewSpec};
use crate::error::{AppError, Result};

// ── Result shape ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Cell {
    /// Done that day.
    Done,
    /// Expected, not done, and the day is over.
    Missed,
    /// Expected, not done, and the day is today — nothing is lost yet.
    Pending,
    /// A flexible (target-per-week) habit's unchecked past day: not a miss.
    Free,
    /// Not expected: a weekend for a weekdays habit, or before its start.
    Off,
    /// Beyond today.
    Future,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackerItem {
    pub id: String,
    pub title: String,
    pub icon: Option<String>,
    /// Palette name (gray, blue, …) from the item's category-like select, for its accent.
    pub color: Option<String>,
    pub frequency: String,
    /// Days per week the habit asks for: 7 daily, 5 weekdays, `target` otherwise.
    pub target: u32,
    /// One entry per day of the range, aligned with `TrackerResult::days`.
    pub cells: Vec<Cell>,
    pub current_streak: u32,
    pub longest_streak: u32,
    /// `days` for daily/weekdays habits, `weeks` for target-per-week ones.
    pub streak_unit: &'static str,
    /// Done so far in the current ISO week, against `target`.
    pub week_done: u32,
    /// Done / expected over the visible range.
    pub range_done: u32,
    pub range_expected: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackerDay {
    pub date: String,
    pub done: u32,
    pub expected: u32,
    pub perfect: bool,
    /// The log row for this day, if one exists.
    pub log_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackerResult {
    pub range: String,
    pub anchor: String,
    pub start: String,
    pub end: String,
    pub today: String,
    pub log_source: String,
    pub date_field: String,
    pub done_field: String,
    pub items: Vec<TrackerItem>,
    pub days: Vec<TrackerDay>,
}

// ── Dates ────────────────────────────────────────────────────────────────────

pub(crate) fn parse_date(s: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(&s[..s.len().min(10)], "%Y-%m-%d").ok()
}

fn monday(d: NaiveDate) -> NaiveDate {
    d - Duration::days(d.weekday().num_days_from_monday() as i64)
}

fn iso(d: NaiveDate) -> String {
    d.format("%Y-%m-%d").to_string()
}

fn today() -> NaiveDate {
    Local::now().date_naive()
}

/// The first and last day a range shows around `anchor`. `year` is a rolling
/// 52 weeks ending with the anchor's week, so it is never empty in January.
pub fn range_bounds(range: &str, anchor: NaiveDate) -> (NaiveDate, NaiveDate) {
    match range {
        "today" => (anchor, anchor),
        "month" => {
            let first = anchor.with_day(1).unwrap_or(anchor);
            let next = if first.month() == 12 {
                NaiveDate::from_ymd_opt(first.year() + 1, 1, 1)
            } else {
                NaiveDate::from_ymd_opt(first.year(), first.month() + 1, 1)
            }.unwrap_or(first);
            (first, next - Duration::days(1))
        }
        "year" => {
            let end = monday(anchor) + Duration::days(6);
            (end - Duration::days(52 * 7 - 1), end)
        }
        _ => {
            let m = monday(anchor);
            (m, m + Duration::days(6))
        }
    }
}

/// The anchor one step back or forward for a range.
pub fn step(range: &str, anchor: NaiveDate, forward: bool) -> NaiveDate {
    let sign = if forward { 1 } else { -1 };
    match range {
        "today" => anchor + Duration::days(sign),
        "week" => anchor + Duration::days(7 * sign),
        "year" => anchor + Duration::days(52 * 7 * sign),
        _ => {
            let first = anchor.with_day(1).unwrap_or(anchor);
            let (y, m) = if forward {
                if first.month() == 12 { (first.year() + 1, 1) } else { (first.year(), first.month() + 1) }
            } else if first.month() == 1 { (first.year() - 1, 12) } else { (first.year(), first.month() - 1) };
            NaiveDate::from_ymd_opt(y, m, 1).unwrap_or(anchor)
        }
    }
}

// ── Habits ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Freq { Daily, Weekdays, Weekly }

/// Which item properties play which role — from the spec, defaulting to the
/// property of the same name.
pub struct ItemFields {
    pub frequency: String,
    pub target: String,
    pub start: String,
    pub archived: String,
    pub icon: String,
    /// The select whose option colour tints the item; empty = `category`, else the first select.
    pub color: String,
}

impl ItemFields {
    pub fn from_spec(spec: &ViewSpec) -> Self {
        let pick = |k: &str| spec.option(k).unwrap_or_else(|| k.to_string());
        ItemFields { frequency: pick("frequency"), target: pick("target"), start: pick("start"), archived: pick("archived"), icon: pick("icon"), color: spec.option("color").unwrap_or_default() }
    }
}

struct Habit {
    id: String,
    title: String,
    freq: Freq,
    freq_label: String,
    target: u32,
    start: Option<NaiveDate>,
}

impl Habit {
    fn from_row(row: &data::Row, f: &ItemFields) -> Option<Self> {
        let text = |k: &str| row.cells.get(k).map(CellValue::as_text).unwrap_or_default();
        if matches!(row.cells.get(f.archived.as_str()), Some(CellValue::Bool(true))) { return None; }
        let title = { let t = text("title"); if t.is_empty() { row.id.clone() } else { t } };
        let freq_label = { let f = text(&f.frequency).to_lowercase(); if f.is_empty() { "daily".into() } else { f } };
        let freq = match freq_label.as_str() {
            "weekdays" | "workdays" => Freq::Weekdays,
            "daily" | "every day" | "everyday" => Freq::Daily,
            _ => Freq::Weekly, // weekly, custom, "3x a week" — anything with a target per week
        };
        let target_cell = row.cells.get(f.target.as_str()).and_then(CellValue::as_num).map(|n| n.max(1.0) as u32);
        let target = match freq {
            Freq::Daily => 7,
            Freq::Weekdays => 5,
            Freq::Weekly => target_cell.unwrap_or(1).min(7),
        };
        let start = row.cells.get(f.start.as_str()).and_then(|c| parse_date(&c.as_text()));
        Some(Habit { id: row.id.clone(), title, freq, freq_label, target, start })
    }

    /// Whether the habit asks for this day at all.
    fn expected(&self, d: NaiveDate) -> bool {
        if let Some(s) = self.start { if d < s { return false; } }
        match self.freq {
            Freq::Daily | Freq::Weekly => true,
            Freq::Weekdays => !matches!(d.weekday(), Weekday::Sat | Weekday::Sun),
        }
    }
}

/// `date → (row id, titles done)` for a log table.
fn log_map(table: &data::Table, date_field: &str, done_field: &str) -> BTreeMap<NaiveDate, (String, BTreeSet<String>)> {
    let mut out = BTreeMap::new();
    for row in &table.rows {
        let date = row.cells.get(date_field).and_then(|c| parse_date(&c.as_text())).or_else(|| parse_date(&row.id));
        let Some(date) = date else { continue };
        let done: BTreeSet<String> = match row.cells.get(done_field) {
            Some(CellValue::List(items)) => items.iter().map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect(),
            Some(CellValue::Text(t)) if !t.trim().is_empty() => t.split(',').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect(),
            _ => BTreeSet::new(),
        };
        out.insert(date, (row.id.clone(), done));
    }
    out
}

/// A daily/weekdays habit's streaks in days: the run ending today (today itself
/// only counts once done — an unticked today never breaks a streak) and the
/// longest run since `first`.
fn day_streaks(h: &Habit, done: &dyn Fn(NaiveDate) -> bool, first: NaiveDate, today: NaiveDate) -> (u32, u32) {
    let mut d = today;
    if h.expected(d) && !done(d) { d -= Duration::days(1); }
    let mut current = 0;
    while d >= first {
        if h.expected(d) {
            if done(d) { current += 1; } else { break; }
        }
        d -= Duration::days(1);
    }
    let (mut run, mut best) = (0u32, 0u32);
    let mut d = first;
    while d <= today {
        if h.expected(d) {
            if done(d) { run += 1; best = best.max(run); }
            else if d != today { run = 0; }
        }
        d += Duration::days(1);
    }
    (current, best)
}

/// A target-per-week habit's streaks in ISO weeks. The current week counts
/// once its target is met; until then it is pending, not broken.
fn week_streaks(h: &Habit, done_in_week: &dyn Fn(NaiveDate) -> u32, first: NaiveDate, today: NaiveDate) -> (u32, u32) {
    let this_week = monday(today);
    let complete = |m: NaiveDate| done_in_week(m) >= h.target;
    let mut m = this_week;
    if !complete(m) { m -= Duration::days(7); }
    let mut current = 0;
    while m + Duration::days(6) >= first {
        if complete(m) { current += 1; } else { break; }
        m -= Duration::days(7);
    }
    let (mut run, mut best) = (0u32, 0u32);
    let mut m = monday(first);
    while m <= this_week {
        if complete(m) { run += 1; best = best.max(run); }
        else if m != this_week { run = 0; }
        m += Duration::days(7);
    }
    (current, best)
}

/// The palette colour of an item's select value: the property the spec names
/// (`color:`), else one named `category`, else the first select/status.
fn item_color(schema: Option<&crate::schema::TypeSchema>, row: &data::Row, field: &str) -> Option<String> {
    let s = schema?;
    let is_select = |p: &crate::schema::PropertyDef| matches!(p.ty, crate::schema::PropType::Select | crate::schema::PropType::Status);
    let prop = (!field.is_empty()).then(|| s.properties.iter().find(|p| p.name == field && is_select(p))).flatten()
        .or_else(|| s.properties.iter().find(|p| p.name == "category" && is_select(p)))
        .or_else(|| s.properties.iter().find(|p| is_select(p)))?;
    let value = row.cells.get(&prop.name)?.as_text();
    prop.options.iter().find(|o| o.name == value).map(|o| o.color.clone())
}

// ── The view ─────────────────────────────────────────────────────────────────

/// Run a tracker spec: items from `source`, days from `log`, the grid for
/// `range` around `anchor` (today when absent), streaks over the whole log.
pub fn run_tracker(root: &Path, spec_yaml: &str, anchor: Option<&str>) -> Result<TrackerResult> {
    let spec: ViewSpec = serde_yaml::from_str(spec_yaml)?;
    let log_source = spec.option("log")
        .ok_or_else(|| AppError::Other("A tracker needs `log: collections/<name>` — the collection with one row per day".into()))?;
    let date_field = spec.date.clone().filter(|d| !d.is_empty()).unwrap_or_else(|| "date".into());
    let done_field = spec.option("done").unwrap_or_else(|| "done".into());
    let range = spec.option("range").unwrap_or_else(|| "week".into());
    let fields = ItemFields::from_spec(&spec);

    let today = today();
    let anchor = anchor.and_then(parse_date).unwrap_or(today);
    let (start, end) = range_bounds(&range, anchor);

    // Items: the spec's filter/sort apply to them, as in a table.
    let items_table = data::resolve_source(root, &spec.source)?;
    let query = Query {
        filter: match &spec.filter { Some(f) if !f.trim().is_empty() => Some(data::parse_filter(f)?), _ => None },
        sort: spec.sort.clone().unwrap_or_default().iter().map(|s| data::parse_sort(s)).collect(),
        columns: None,
        limit: spec.limit,
    };
    let items_table = query.apply(&items_table);
    let schema = spec.source.strip_prefix("collections/")
        .and_then(|c| crate::schema::load(root, c.trim_end_matches('/')).ok().flatten());

    // The log: read whole, so streaks see all history, not just the range.
    let log_table = match data::resolve_source(root, &log_source) {
        Ok(t) => t,
        Err(_) => data::Table { name: log_source.clone(), columns: vec![], rows: vec![] }, // no days yet
    };
    let log = log_map(&log_table, &date_field, &done_field);
    let first_log = log.keys().next().copied();

    let mut dates = Vec::new();
    let mut d = start;
    while d <= end { dates.push(d); d += Duration::days(1); }

    let mut items = Vec::new();
    let mut day_done = vec![0u32; dates.len()];
    let mut day_expected = vec![0u32; dates.len()];

    for row in &items_table.rows {
        let Some(h) = Habit::from_row(row, &fields) else { continue };
        let done_on = |d: NaiveDate| -> bool {
            log.get(&d).map(|(_, set)| set.contains(&h.title) || set.contains(&h.id)).unwrap_or(false)
        };
        let done_in_week = |m: NaiveDate| -> u32 { (0..7).filter(|i| done_on(m + Duration::days(*i))).count() as u32 };
        let first = [h.start, first_log].into_iter().flatten().min().unwrap_or(today);

        let (current_streak, longest_streak, streak_unit) = match h.freq {
            Freq::Weekly => { let (c, l) = week_streaks(&h, &done_in_week, first, today); (c, l, "weeks") }
            _ => { let (c, l) = day_streaks(&h, &done_on, first, today); (c, l, "days") }
        };

        let mut cells = Vec::with_capacity(dates.len());
        let (mut range_done, mut range_expected) = (0u32, 0u32);
        for (i, d) in dates.iter().enumerate() {
            let d = *d;
            let cell = if done_on(d) {
                Cell::Done // an extra workout on a rest day still counts
            } else if !h.expected(d) {
                if d > today { Cell::Future } else { Cell::Off }
            } else if d > today {
                Cell::Future
            } else if d == today {
                Cell::Pending
            } else if h.freq == Freq::Weekly {
                Cell::Free
            } else {
                Cell::Missed
            };
            // A day's score counts what the habit asked for up to today; a
            // weekly habit asks for `target` days a week, spread as "any day".
            if d <= today && (h.expected(d) || cell == Cell::Done) {
                let counts = match h.freq { Freq::Weekly => done_on(d), _ => true };
                if counts { day_expected[i] += 1; range_expected += 1; }
                if cell == Cell::Done { day_done[i] += 1; range_done += 1; }
            }
            cells.push(cell);
        }
        if h.freq == Freq::Weekly {
            // Expected for a flexible habit over the range = target × weeks touched, capped at days shown.
            let weeks = ((end - start).num_days() / 7 + 1) as u32;
            range_expected = (h.target * weeks).min(dates.iter().filter(|d| **d <= today).count() as u32).max(range_done);
        }

        items.push(TrackerItem {
            id: h.id.clone(),
            title: h.title.clone(),
            icon: row.cells.get(fields.icon.as_str()).map(CellValue::as_text).filter(|s| !s.is_empty()),
            color: item_color(schema.as_ref(), row, &fields.color),
            frequency: h.freq_label.clone(),
            target: h.target,
            cells,
            current_streak,
            longest_streak,
            streak_unit,
            week_done: done_in_week(monday(today)),
            range_done,
            range_expected,
        });
    }

    let days = dates.iter().enumerate().map(|(i, d)| TrackerDay {
        date: iso(*d),
        done: day_done[i],
        expected: day_expected[i],
        perfect: day_expected[i] > 0 && day_done[i] == day_expected[i],
        log_id: log.get(d).map(|(id, _)| id.clone()),
    }).collect();

    Ok(TrackerResult {
        range,
        anchor: iso(anchor),
        start: iso(start),
        end: iso(end),
        today: iso(today),
        log_source,
        date_field,
        done_field,
        items,
        days,
    })
}

/// Add (`on: Some(true)`), remove (`Some(false)`) or flip (`None`) one item in
/// one day's `done` list. The day's row is created from the log collection's
/// row template if it does not exist. Returns the row's path and the new state.
pub fn toggle(root: &Path, log_source: &str, date_field: &str, done_field: &str, date: &str, item: &str, on: Option<bool>) -> Result<(PathBuf, bool)> {
    let day = parse_date(date).ok_or_else(|| AppError::Other(format!("'{date}' is not a date (YYYY-MM-DD)")))?;
    let date = iso(day);
    let item = item.trim();
    if item.is_empty() { return Err(AppError::Other("nothing to log".into())); }

    // The day's row: the one whose date property is this day, else `<date>.md`.
    let existing = data::resolve_source(root, log_source).ok().and_then(|t| {
        t.rows.iter().find(|r| r.cells.get(date_field).map(|c| c.as_text().starts_with(&date)).unwrap_or(false)).map(|r| r.id.clone())
    });
    let id = existing.unwrap_or_else(|| date.clone());
    let mut fields = BTreeMap::new();
    fields.insert("title".to_string(), date.clone());
    fields.insert("created".to_string(), date.clone());
    fields.insert(date_field.to_string(), date.clone());
    let path = data::ensure_row(root, log_source, &id, &fields)?;

    let content = std::fs::read_to_string(&path)?;
    let mut note = crate::note::parse_note(&id, &content)?;
    let mut list: Vec<String> = match note.frontmatter.get(done_field) {
        Some(serde_json::Value::Array(a)) => a.iter().filter_map(|v| v.as_str().map(String::from)).collect(),
        Some(serde_json::Value::String(s)) if !s.trim().is_empty() => s.split(',').map(|x| x.trim().to_string()).collect(),
        _ => vec![],
    };
    let has = list.iter().any(|x| x == item);
    let want = on.unwrap_or(!has);
    if want && !has { list.push(item.to_string()); }
    if !want { list.retain(|x| x != item); }
    note.frontmatter.insert(done_field.to_string(), serde_json::Value::Array(list.into_iter().map(serde_json::Value::String).collect()));
    std::fs::write(&path, crate::note::serialize_note(&note)?)?;
    Ok((path, want))
}

/// Every tracker view declared in the vault: `(collection, view name, spec)`.
/// The palette's "Log today…" and `cortex tracker` start from this.
pub fn tracker_specs(root: &Path) -> Vec<(String, String, String)> {
    let mut out = Vec::new();
    let Ok(entries) = std::fs::read_dir(root.join("collections")) else { return out };
    let mut dirs: Vec<_> = entries.flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect();
    dirs.sort();
    for dir in dirs {
        let Some(coll) = dir.file_name().and_then(|s| s.to_str()).map(String::from) else { continue };
        let Ok(text) = std::fs::read_to_string(dir.join("_index.md")) else { continue };
        let Ok(note) = crate::note::parse_note("_index.md", &text) else { continue };
        let Some(views) = note.frontmatter.get("views").and_then(|v| v.as_array()) else { continue };
        for v in views {
            if v.get("type").and_then(|t| t.as_str()) != Some("tracker") { continue; }
            let name = v.get("name").and_then(|n| n.as_str()).unwrap_or("Tracker").to_string();
            let mut spec = format!("source: collections/{coll}\ntype: tracker\n");
            if let Some(obj) = v.as_object() {
                for (key, val) in obj {
                    if key == "name" || key == "type" { continue; }
                    match val {
                        serde_json::Value::String(s) => spec.push_str(&format!("{key}: {s}\n")),
                        serde_json::Value::Number(n) => spec.push_str(&format!("{key}: {n}\n")),
                        serde_json::Value::Bool(b) => spec.push_str(&format!("{key}: {b}\n")),
                        serde_json::Value::Array(a) => {
                            let parts: Vec<&str> = a.iter().filter_map(|x| x.as_str()).collect();
                            if !parts.is_empty() { spec.push_str(&format!("{key}: [{}]\n", parts.join(", "))); }
                        }
                        _ => {}
                    }
                }
            }
            out.push((coll.clone(), name, spec));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vault(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("cortex-tracker-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("collections/habits")).unwrap();
        std::fs::create_dir_all(root.join("collections/habit-log")).unwrap();
        std::fs::create_dir_all(root.join(".cortex/schemas")).unwrap();
        std::fs::write(root.join(".cortex/schemas/habits.yaml"), "properties:\n  - name: category\n    type: select\n    options:\n      - name: health\n        color: green\n  - name: frequency\n    type: select\n  - name: target\n    type: number\n").unwrap();
        std::fs::write(root.join("collections/habits/exercise.md"), "---\ntitle: Exercise\ncategory: health\nfrequency: daily\n---\n").unwrap();
        std::fs::write(root.join("collections/habits/read.md"), "---\ntitle: Read\nfrequency: weekly\ntarget: 3\n---\n").unwrap();
        std::fs::write(root.join("collections/habits/gym.md"), "---\ntitle: Gym\nfrequency: weekdays\n---\n").unwrap();
        std::fs::write(root.join("collections/habits/old.md"), "---\ntitle: Old\narchived: true\n---\n").unwrap();
        std::fs::write(root.join("collections/habit-log/_template-habit-log.md"), "---\ntitle: \"{{date}}\"\ndate: \"{{date}}\"\ndone: []\n---\n").unwrap();
        root
    }

    fn log(root: &Path, d: NaiveDate, done: &[&str]) {
        let list = done.iter().map(|s| format!("\"{s}\"")).collect::<Vec<_>>().join(", ");
        std::fs::write(root.join(format!("collections/habit-log/{}.md", iso(d))), format!("---\ntitle: {}\ndate: {}\ndone: [{list}]\n---\n", iso(d), iso(d))).unwrap();
    }

    const SPEC: &str = "source: collections/habits\ntype: tracker\nlog: collections/habit-log\nrange: week\n";

    #[test]
    fn streaks_scores_and_cells() {
        let root = vault("streaks");
        let t = today();
        // Exercise: done the last 3 days including today. Gym: done every weekday for 10 days but not today. Read: 3 days this week and last.
        for i in 0..3 { log(&root, t - Duration::days(i), &["Exercise"]); }
        for i in 0..14 {
            let d = t - Duration::days(i);
            if i > 0 && !matches!(d.weekday(), Weekday::Sat | Weekday::Sun) {
                let mut done: Vec<&str> = vec!["Gym"];
                if i < 3 { done.push("Exercise"); }
                if [1, 2, 3, 8, 9, 10].contains(&i) { done.push("Read"); }
                log(&root, d, &done);
            }
        }
        // Re-log today with Exercise only (loop above skipped i == 0).
        log(&root, t, &["Exercise"]);
        let r = run_tracker(&root, SPEC, None).unwrap();
        assert_eq!(r.days.len(), 7);
        assert!(!r.items.iter().any(|i| i.title == "Old"), "archived habits are hidden");
        let ex = r.items.iter().find(|i| i.title == "Exercise").unwrap();
        assert_eq!(ex.current_streak, 3, "{ex:?}");
        assert_eq!(ex.color.as_deref(), Some("green"));
        let gym = r.items.iter().find(|i| i.title == "Gym").unwrap();
        // Today is pending, so the streak is the weekdays before it, weekends skipped.
        assert!(gym.current_streak >= 9, "{gym:?}");
        assert_eq!(gym.streak_unit, "days");
        let today_idx = r.days.iter().position(|d| d.date == r.today).unwrap();
        assert_eq!(gym.cells[today_idx], if matches!(t.weekday(), Weekday::Sat | Weekday::Sun) { Cell::Off } else { Cell::Pending });
        let read = r.items.iter().find(|i| i.title == "Read").unwrap();
        assert_eq!(read.streak_unit, "weeks");
        assert_eq!(read.target, 3);
        assert!(r.days[today_idx].expected >= 1);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn toggle_creates_the_day_from_the_template_and_flips() {
        let root = vault("toggle");
        let (path, on) = toggle(&root, "collections/habit-log", "date", "done", "2026-03-04", "Exercise", None).unwrap();
        assert!(on);
        let text = std::fs::read_to_string(&path).unwrap();
        assert!(text.contains("date: \"2026-03-04\"") || text.contains("date: 2026-03-04"), "{text}");
        assert!(text.contains("- Exercise"), "{text}");
        assert!(text.contains("title: \"2026-03-04\"") || text.contains("title: 2026-03-04"), "{text}");
        let (_, on) = toggle(&root, "collections/habit-log", "date", "done", "2026-03-04", "Read", Some(true)).unwrap();
        assert!(on);
        let (_, on) = toggle(&root, "collections/habit-log", "date", "done", "2026-03-04", "Exercise", None).unwrap();
        assert!(!on);
        let text = std::fs::read_to_string(&path).unwrap();
        assert!(!text.contains("Exercise") && text.contains("- Read"), "{text}");
        let r = run_tracker(&root, "source: collections/habits\ntype: tracker\nlog: collections/habit-log\nrange: today\n", Some("2026-03-04")).unwrap();
        assert_eq!(r.days.len(), 1);
        assert_eq!(r.days[0].log_id.as_deref(), Some("2026-03-04"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn item_fields_are_configurable() {
        let root = vault("fields");
        std::fs::write(root.join("collections/habits/water.md"), "---\ntitle: Water plants\ncadence: weekdays\nretired: false\nemoji: 🪴\n---\n").unwrap();
        std::fs::write(root.join("collections/habits/gone.md"), "---\ntitle: Gone\nretired: true\n---\n").unwrap();
        let spec = "source: collections/habits\ntype: tracker\nlog: collections/habit-log\nrange: week\nfrequency: cadence\narchived: retired\nicon: emoji\nfilter: title contains 'plants'\n";
        let r = run_tracker(&root, spec, None).unwrap();
        assert_eq!(r.items.len(), 1, "{:?}", r.items.iter().map(|i| &i.title).collect::<Vec<_>>());
        assert_eq!(r.items[0].frequency, "weekdays");
        assert_eq!(r.items[0].target, 5);
        assert_eq!(r.items[0].icon.as_deref(), Some("🪴"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn ranges_and_steps() {
        let d = NaiveDate::from_ymd_opt(2026, 9, 9).unwrap(); // a Wednesday
        assert_eq!(range_bounds("week", d), (NaiveDate::from_ymd_opt(2026, 9, 7).unwrap(), NaiveDate::from_ymd_opt(2026, 9, 13).unwrap()));
        assert_eq!(range_bounds("month", d), (NaiveDate::from_ymd_opt(2026, 9, 1).unwrap(), NaiveDate::from_ymd_opt(2026, 9, 30).unwrap()));
        let (s, e) = range_bounds("year", d);
        assert_eq!((e - s).num_days(), 52 * 7 - 1);
        assert_eq!(step("month", d, true), NaiveDate::from_ymd_opt(2026, 10, 1).unwrap());
        assert_eq!(step("month", NaiveDate::from_ymd_opt(2026, 1, 15).unwrap(), false), NaiveDate::from_ymd_opt(2025, 12, 1).unwrap());
    }

    #[test]
    fn specs_are_found_in_index_files() {
        let root = vault("specs");
        std::fs::write(root.join("collections/habits/_index.md"), "---\ntitle: Habits\ntype: database\nviews:\n- name: Week\n  type: tracker\n  log: collections/habit-log\n  range: week\n- name: Table\n  type: table\n---\n").unwrap();
        let specs = tracker_specs(&root);
        assert_eq!(specs.len(), 1);
        assert_eq!(specs[0].0, "habits");
        assert!(specs[0].2.contains("log: collections/habit-log"));
        assert!(run_tracker(&root, &specs[0].2, None).is_ok());
        let _ = std::fs::remove_dir_all(&root);
    }
}
