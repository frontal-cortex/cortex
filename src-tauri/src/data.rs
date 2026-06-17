//! Slice 0 — the shared data-table engine.
//!
//! Two storage sources collapse into ONE unified `Table` shape, and one
//! `Query` type runs against either. This is the contract every downstream
//! view/chart depends on:
//!
//! ```text
//!   collections/<name>/*.md  ─┐
//!                             ├─► Table { columns, rows } ─► Query ─► Table
//!   data/<name>.csv          ─┘
//! ```
//!
//! Slice 0 queries in-memory (correct for personal-scale data and a clean
//! reference). A SQLite-backed index for large tables is a later perf layer —
//! the `Table`/`Query` contract here does not change when that lands.

use std::collections::BTreeMap;
use std::path::Path;

use crate::error::{AppError, Result};

// ── Unified value/column/row/table model ──────────────────────────────────────

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(tag = "kind", content = "value", rename_all = "lowercase")]
pub enum CellValue {
    Null,
    Text(String),
    Num(f64),
    Bool(bool),
    Date(String),       // ISO YYYY-MM-DD, kept as text but typed for sorting/filtering
    List(Vec<String>),
}

impl CellValue {
    /// Best-effort scalar for comparison/sorting.
    fn as_num(&self) -> Option<f64> {
        match self {
            CellValue::Num(n) => Some(*n),
            CellValue::Text(t) | CellValue::Date(t) => t.parse::<f64>().ok(),
            CellValue::Bool(b) => Some(if *b { 1.0 } else { 0.0 }),
            _ => None,
        }
    }

    fn as_text(&self) -> String {
        match self {
            CellValue::Null => String::new(),
            CellValue::Text(t) | CellValue::Date(t) => t.clone(),
            CellValue::Num(n) => {
                if n.fract() == 0.0 { format!("{}", *n as i64) } else { n.to_string() }
            }
            CellValue::Bool(b) => b.to_string(),
            CellValue::List(items) => items.join(", "),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ColumnType {
    Text,
    Number,
    Bool,
    Date,
    List,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct Column {
    pub key: String,
    pub ty: ColumnType,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct Row {
    pub id: String,
    pub cells: BTreeMap<String, CellValue>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct Table {
    pub name: String,
    pub columns: Vec<Column>,
    pub rows: Vec<Row>,
}

// ── Source adapters ────────────────────────────────────────────────────────────

fn looks_like_date(s: &str) -> bool {
    let b = s.as_bytes();
    s.len() == 10
        && b[4] == b'-'
        && b[7] == b'-'
        && b.iter().enumerate().all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit())
}

fn json_to_cell(v: &serde_json::Value) -> CellValue {
    match v {
        serde_json::Value::Null => CellValue::Null,
        serde_json::Value::Bool(b) => CellValue::Bool(*b),
        serde_json::Value::Number(n) => n.as_f64().map(CellValue::Num).unwrap_or(CellValue::Null),
        serde_json::Value::String(s) => {
            if looks_like_date(s) { CellValue::Date(s.clone()) } else { CellValue::Text(s.clone()) }
        }
        serde_json::Value::Array(a) => {
            CellValue::List(a.iter().map(|x| match x {
                serde_json::Value::String(s) => s.clone(),
                other => other.to_string(),
            }).collect())
        }
        serde_json::Value::Object(_) => CellValue::Text(v.to_string()),
    }
}

fn col_type(v: &CellValue) -> ColumnType {
    match v {
        CellValue::Num(_) => ColumnType::Number,
        CellValue::Bool(_) => ColumnType::Bool,
        CellValue::Date(_) => ColumnType::Date,
        CellValue::List(_) => ColumnType::List,
        _ => ColumnType::Text,
    }
}

/// Infer columns from the union of row keys, first-seen order, type from the
/// first non-null cell seen for that key.
fn infer_columns(rows: &[Row]) -> Vec<Column> {
    let mut order: Vec<String> = Vec::new();
    let mut types: BTreeMap<String, ColumnType> = BTreeMap::new();
    for row in rows {
        for (k, v) in &row.cells {
            if !types.contains_key(k) {
                order.push(k.clone());
            }
            let entry = types.entry(k.clone()).or_insert(ColumnType::Text);
            if matches!(entry, ColumnType::Text) && !matches!(v, CellValue::Null | CellValue::Text(_)) {
                *entry = col_type(v);
            }
        }
    }
    order.into_iter().map(|key| {
        let ty = types.get(&key).copied().unwrap_or(ColumnType::Text);
        Column { key, ty }
    }).collect()
}

/// `collections/<name>/*.md` — each file is a row, frontmatter is its fields,
/// id is the filename stem. Body is exposed as `$body`.
pub fn read_collection(root: &Path, name: &str) -> Result<Table> {
    let dir = root.join("collections").join(name);
    let mut rows = Vec::new();

    let entries = std::fs::read_dir(&dir)
        .map_err(|_| AppError::Other(format!("Collection not found: {name}")))?;

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("md") {
            continue;
        }
        let id = path.file_stem().and_then(|s| s.to_str()).unwrap_or("").to_string();
        // `_`-prefixed files (e.g. `_index.md`, the collection's view note) are
        // not rows.
        if id.starts_with('_') {
            continue;
        }
        let content = std::fs::read_to_string(&path)?;
        let note = match crate::note::parse_note(&id, &content) {
            Ok(n) => n,
            Err(_) => continue, // skip unparseable rows rather than failing the table
        };

        let mut cells: BTreeMap<String, CellValue> = BTreeMap::new();
        for (k, v) in &note.frontmatter {
            cells.insert(k.clone(), json_to_cell(v));
        }
        cells.insert("$body".into(), CellValue::Text(note.body.trim().to_string()));
        rows.push(Row { id, cells });
    }

    // Default order: creation date ascending, then id as a stable tiebreak.
    // This puts freshly added rows (seeded with today's `created`) at the END,
    // which is what "+ New row" implies — a plain id sort scattered them
    // alphabetically among existing rows. An explicit `sort:` in a view spec
    // still overrides this via Query::apply. Deterministic, so git-diff friendly.
    rows.sort_by(|a, b| {
        let ca = a.cells.get("created").map(CellValue::as_text).unwrap_or_default();
        let cb = b.cells.get("created").map(CellValue::as_text).unwrap_or_default();
        ca.cmp(&cb).then_with(|| a.id.cmp(&b.id))
    });
    let columns = infer_columns(&rows);
    Ok(Table { name: name.to_string(), columns, rows })
}

fn split_csv_record(line: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut in_quotes = false;
    let mut chars = line.chars().peekable();
    while let Some(c) = chars.next() {
        if in_quotes {
            if c == '"' {
                if chars.peek() == Some(&'"') {
                    cur.push('"');
                    chars.next();
                } else {
                    in_quotes = false;
                }
            } else {
                cur.push(c);
            }
        } else {
            match c {
                '"' => in_quotes = true,
                ',' => out.push(std::mem::take(&mut cur)),
                _ => cur.push(c),
            }
        }
    }
    out.push(cur);
    out
}

fn infer_cell(raw: &str) -> CellValue {
    let t = raw.trim();
    if t.is_empty() {
        return CellValue::Null;
    }
    if t.eq_ignore_ascii_case("true") {
        return CellValue::Bool(true);
    }
    if t.eq_ignore_ascii_case("false") {
        return CellValue::Bool(false);
    }
    if looks_like_date(t) {
        return CellValue::Date(t.to_string());
    }
    if let Ok(n) = t.parse::<f64>() {
        return CellValue::Num(n);
    }
    CellValue::Text(t.to_string())
}

/// `data/<name>.csv` — header row defines columns; id is the `id` column if
/// present, else the 0-based row index. Types are inferred per cell.
/// (Slice 0 limitation: no embedded newlines inside quoted fields.)
pub fn read_csv(root: &Path, name: &str) -> Result<Table> {
    let file = root.join("data").join(format!("{name}.csv"));
    let content = std::fs::read_to_string(&file)
        .map_err(|_| AppError::Other(format!("CSV not found: {name}")))?;

    let mut lines = content.lines().filter(|l| !l.trim().is_empty());
    let header = match lines.next() {
        Some(h) => split_csv_record(h),
        None => return Ok(Table { name: name.to_string(), columns: vec![], rows: vec![] }),
    };
    let id_idx = header.iter().position(|h| h == "id");

    let mut rows = Vec::new();
    for (i, line) in lines.enumerate() {
        let fields = split_csv_record(line);
        let mut cells: BTreeMap<String, CellValue> = BTreeMap::new();
        for (j, col) in header.iter().enumerate() {
            let raw = fields.get(j).map(|s| s.as_str()).unwrap_or("");
            cells.insert(col.clone(), infer_cell(raw));
        }
        let id = id_idx
            .and_then(|idx| fields.get(idx))
            .map(|s| s.trim().to_string())
            .unwrap_or_else(|| i.to_string());
        rows.push(Row { id, cells });
    }

    let columns = infer_columns(&rows);
    Ok(Table { name: name.to_string(), columns, rows })
}

// ── Query ──────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Op {
    Eq,
    Ne,
    Gt,
    Ge,
    Lt,
    Le,
    Contains,
}

#[derive(Debug, Clone)]
pub enum Condition {
    Cmp { field: String, op: Op, value: String },
    And(Box<Condition>, Box<Condition>),
    Or(Box<Condition>, Box<Condition>),
}

#[derive(Debug, Clone)]
pub struct Sort {
    pub field: String,
    pub desc: bool,
}

#[derive(Debug, Clone, Default)]
pub struct Query {
    pub filter: Option<Condition>,
    pub sort: Vec<Sort>,
    pub columns: Option<Vec<String>>,
    pub limit: Option<usize>,
}

impl Condition {
    fn eval(&self, row: &Row) -> bool {
        match self {
            Condition::And(a, b) => a.eval(row) && b.eval(row),
            Condition::Or(a, b) => a.eval(row) || b.eval(row),
            Condition::Cmp { field, op, value } => {
                let cell = row.cells.get(field).cloned().unwrap_or(CellValue::Null);
                eval_cmp(&cell, *op, value)
            }
        }
    }
}

fn eval_cmp(cell: &CellValue, op: Op, literal: &str) -> bool {
    // Numeric comparison when both sides look numeric, else string comparison.
    if let (Some(a), Ok(b)) = (cell.as_num(), literal.parse::<f64>()) {
        return match op {
            Op::Eq => a == b,
            Op::Ne => a != b,
            Op::Gt => a > b,
            Op::Ge => a >= b,
            Op::Lt => a < b,
            Op::Le => a <= b,
            Op::Contains => cell.as_text().contains(literal),
        };
    }
    if let CellValue::List(items) = cell {
        return match op {
            Op::Contains | Op::Eq => items.iter().any(|i| i == literal),
            Op::Ne => !items.iter().any(|i| i == literal),
            _ => false,
        };
    }
    let a = cell.as_text();
    match op {
        Op::Eq => a == literal,
        Op::Ne => a != literal,
        Op::Gt => a.as_str() > literal,
        Op::Ge => a.as_str() >= literal,
        Op::Lt => a.as_str() < literal,
        Op::Le => a.as_str() <= literal,
        Op::Contains => a.contains(literal),
    }
}

impl Query {
    pub fn apply(&self, table: &Table) -> Table {
        let mut rows: Vec<Row> = table.rows.iter()
            .filter(|r| self.filter.as_ref().map(|c| c.eval(r)).unwrap_or(true))
            .cloned()
            .collect();

        // Multi-key stable sort (apply keys in reverse so the first key wins).
        for key in self.sort.iter().rev() {
            rows.sort_by(|a, b| {
                let av = a.cells.get(&key.field).cloned().unwrap_or(CellValue::Null);
                let bv = b.cells.get(&key.field).cloned().unwrap_or(CellValue::Null);
                let ord = match (av.as_num(), bv.as_num()) {
                    (Some(x), Some(y)) => x.partial_cmp(&y).unwrap_or(std::cmp::Ordering::Equal),
                    _ => av.as_text().cmp(&bv.as_text()),
                };
                if key.desc { ord.reverse() } else { ord }
            });
        }

        if let Some(n) = self.limit {
            rows.truncate(n);
        }

        let columns = match &self.columns {
            Some(keys) => keys.iter().filter_map(|k| {
                table.columns.iter().find(|c| &c.key == k).cloned()
                    .or(Some(Column { key: k.clone(), ty: ColumnType::Text }))
            }).collect(),
            None => table.columns.clone(),
        };

        Table { name: table.name.clone(), columns, rows }
    }
}

// ── Minimal filter parser: `field op 'value'` joined by `and` / `or` ───────────
// Left-to-right, no precedence (good enough for Slice 0; documented).

pub fn parse_filter(input: &str) -> Result<Condition> {
    let tokens = tokenize(input);
    let mut pos = 0;
    let cond = parse_expr(&tokens, &mut pos)?;
    if pos != tokens.len() {
        return Err(AppError::Other(format!("Unexpected token in filter: {:?}", tokens.get(pos))));
    }
    Ok(cond)
}

fn tokenize(s: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '\'' | '"' => {
                let quote = c;
                let mut lit = String::new();
                while let Some(&n) = chars.peek() {
                    chars.next();
                    if n == quote { break; }
                    lit.push(n);
                }
                out.push(format!("\u{1}{lit}")); // \u1 prefix marks a string literal
            }
            c if c.is_whitespace() => {
                if !cur.is_empty() { out.push(std::mem::take(&mut cur)); }
            }
            '=' | '!' | '<' | '>' => {
                if !cur.is_empty() { out.push(std::mem::take(&mut cur)); }
                let mut ops = c.to_string();
                if chars.peek() == Some(&'=') { ops.push('='); chars.next(); }
                out.push(ops);
            }
            _ => cur.push(c),
        }
    }
    if !cur.is_empty() { out.push(cur); }
    out
}

fn parse_expr(tokens: &[String], pos: &mut usize) -> Result<Condition> {
    let mut left = parse_cmp(tokens, pos)?;
    while let Some(tok) = tokens.get(*pos) {
        let connector = tok.to_lowercase();
        if connector == "and" || connector == "or" {
            *pos += 1;
            let right = parse_cmp(tokens, pos)?;
            left = if connector == "and" {
                Condition::And(Box::new(left), Box::new(right))
            } else {
                Condition::Or(Box::new(left), Box::new(right))
            };
        } else {
            break;
        }
    }
    Ok(left)
}

fn parse_cmp(tokens: &[String], pos: &mut usize) -> Result<Condition> {
    let field = tokens.get(*pos).ok_or_else(|| AppError::Other("Expected field".into()))?.clone();
    let op_tok = tokens.get(*pos + 1).ok_or_else(|| AppError::Other("Expected operator".into()))?;
    let val_tok = tokens.get(*pos + 2).ok_or_else(|| AppError::Other("Expected value".into()))?;
    *pos += 3;

    let op = match op_tok.to_lowercase().as_str() {
        "==" | "=" => Op::Eq,
        "!=" => Op::Ne,
        ">" => Op::Gt,
        ">=" => Op::Ge,
        "<" => Op::Lt,
        "<=" => Op::Le,
        "contains" => Op::Contains,
        other => return Err(AppError::Other(format!("Unknown operator: {other}"))),
    };
    // strip the \u1 string-literal marker if present
    let value = val_tok.strip_prefix('\u{1}').unwrap_or(val_tok).to_string();
    Ok(Condition::Cmp { field, op, value })
}

// ── Wire helpers (for the Tauri command layer) ────────────────────────────────

impl ColumnType {
    pub fn as_str(&self) -> &'static str {
        match self {
            ColumnType::Text => "text",
            ColumnType::Number => "number",
            ColumnType::Bool => "bool",
            ColumnType::Date => "date",
            ColumnType::List => "list",
        }
    }
}

impl CellValue {
    /// Plain JSON for the frontend (typing lives on the Column, so cells stay simple).
    pub fn to_json(&self) -> serde_json::Value {
        match self {
            CellValue::Null => serde_json::Value::Null,
            CellValue::Text(t) | CellValue::Date(t) => serde_json::Value::String(t.clone()),
            CellValue::Num(n) => serde_json::Number::from_f64(*n)
                .map(serde_json::Value::Number)
                .unwrap_or(serde_json::Value::Null),
            CellValue::Bool(b) => serde_json::Value::Bool(*b),
            CellValue::List(items) => {
                serde_json::Value::Array(items.iter().cloned().map(serde_json::Value::String).collect())
            }
        }
    }
}

// ── View spec → resolved Table ────────────────────────────────────────────────

#[derive(Debug, Default, serde::Deserialize)]
pub struct ViewSpec {
    pub source: String,
    // Read by the frontend to route table vs chart; the backend query path is
    // shared, so Slice 1 doesn't branch on it. Slice 2 (charts) will.
    #[serde(rename = "type", default)]
    #[allow(dead_code)]
    pub kind: Option<String>,
    #[serde(default)]
    pub filter: Option<String>,
    #[serde(default)]
    pub sort: Option<Vec<String>>,
    #[serde(default)]
    pub columns: Option<Vec<String>>,
    #[serde(default)]
    pub group: Option<String>,
    /// Calendar views: which date property positions a row on the grid.
    #[serde(default)]
    pub date: Option<String>,
    #[serde(default)]
    pub limit: Option<usize>,
    // Chart-only fields.
    #[serde(default)]
    pub x: Option<String>,
    #[serde(default)]
    pub y: Option<String>,
    #[serde(default)]
    pub agg: Option<String>,
    #[serde(rename = "chartType", default)]
    pub chart_type: Option<String>,
}

fn parse_sort(entry: &str) -> Sort {
    let mut it = entry.split_whitespace();
    let field = it.next().unwrap_or("").to_string();
    let desc = it.next().map(|d| d.eq_ignore_ascii_case("desc")).unwrap_or(false);
    Sort { field, desc }
}

/// Resolve a spec `source:` string to a concrete in-memory table.
fn resolve_source(root: &Path, source: &str) -> Result<Table> {
    if let Some(name) = source.strip_prefix("collections/") {
        read_collection(root, name.trim_end_matches('/'))
    } else if let Some(rest) = source.strip_prefix("data/") {
        read_csv(root, rest.trim_end_matches(".csv"))
    } else {
        Err(AppError::Other(format!(
            "Unknown source '{source}' (expected collections/<name> or data/<name>.csv)"
        )))
    }
}

/// All field names a source offers (the `$body` pseudo-column excluded), before
/// any column projection. The toolbar needs this so a hidden column can still be
/// re-shown and so filter/sort dropdowns aren't limited to visible columns.
pub fn source_columns(root: &Path, source: &str) -> Result<Vec<String>> {
    let table = resolve_source(root, source)?;
    Ok(table.columns.into_iter().map(|c| c.key).filter(|k| k != "$body").collect())
}

/// Parse a `cortex-view` YAML spec, resolve its source, and run its query.
pub fn run_view(root: &Path, spec_yaml: &str) -> Result<Table> {
    let spec: ViewSpec = serde_yaml::from_str(spec_yaml)?;
    let table = resolve_source(root, &spec.source)?;

    let query = Query {
        filter: match spec.filter {
            Some(f) if !f.trim().is_empty() => Some(parse_filter(&f)?),
            _ => None,
        },
        sort: spec.sort.unwrap_or_default().iter().map(|s| parse_sort(s)).collect(),
        columns: spec.columns,
        limit: spec.limit,
    };

    Ok(query.apply(&table))
}

// ── Structured spec ⇄ YAML (the GUI filter/sort/group builder talks to this) ──
//
// The YAML spec stays the on-disk source of truth. The toolbar edits this
// structured form and serializes it straight back, so a view authored in the
// UI is byte-identical to one hand-written, and a hand-written one round-trips
// without surprises. A filter that mixes `and`/`or` (which the flat UI can't
// represent) is flagged `filter_complex` and kept verbatim — the UI then defers
// to raw editing rather than mangling it.

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct FilterClause {
    pub field: String,
    pub op: String,
    pub value: String,
}

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct SortClause {
    pub field: String,
    #[serde(default)]
    pub desc: bool,
}

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StructuredSpec {
    pub source: String,
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub filters: Vec<FilterClause>,
    #[serde(default)]
    pub filter_join: String, // "and" | "or"
    #[serde(default)]
    pub filter_complex: bool,
    #[serde(default)]
    pub filter_raw: Option<String>,
    #[serde(default)]
    pub sort: Vec<SortClause>,
    #[serde(default)]
    pub columns: Option<Vec<String>>,
    #[serde(default)]
    pub group: Option<String>,
    #[serde(default)]
    pub date: Option<String>,
    #[serde(default)]
    pub limit: Option<usize>,
    #[serde(default)]
    pub x: Option<String>,
    #[serde(default)]
    pub y: Option<String>,
    #[serde(default)]
    pub agg: Option<String>,
    #[serde(default)]
    pub chart_type: Option<String>,
}

fn normalize_op(tok: &str) -> Option<&'static str> {
    match tok.to_lowercase().as_str() {
        "==" | "=" => Some("=="),
        "!=" => Some("!="),
        ">" => Some(">"),
        ">=" => Some(">="),
        "<" => Some("<"),
        "<=" => Some("<="),
        "contains" => Some("contains"),
        _ => None,
    }
}

/// Flatten a filter string into clauses joined by a single connector. `None`
/// when it mixes `and`/`or` or isn't a clean `field op value …` chain.
fn flatten_filter(filter: &str) -> Option<(Vec<FilterClause>, String)> {
    let tokens = tokenize(filter);
    if tokens.is_empty() {
        return Some((vec![], "and".into()));
    }
    let mut clauses = Vec::new();
    let mut join: Option<String> = None;
    let mut i = 0;
    loop {
        let field = tokens.get(i)?;
        if field.starts_with('\u{1}') {
            return None; // a literal where a field name belongs
        }
        let op = normalize_op(tokens.get(i + 1)?)?;
        let raw_val = tokens.get(i + 2)?;
        let value = raw_val.strip_prefix('\u{1}').unwrap_or(raw_val).to_string();
        clauses.push(FilterClause { field: field.clone(), op: op.to_string(), value });
        i += 3;
        match tokens.get(i) {
            None => break,
            Some(conn) => {
                let conn = conn.to_lowercase();
                if conn != "and" && conn != "or" {
                    return None;
                }
                match &join {
                    Some(j) if *j != conn => return None, // mixed → complex
                    _ => join = Some(conn),
                }
                i += 1;
            }
        }
    }
    Some((clauses, join.unwrap_or_else(|| "and".into())))
}

/// String values get quoted; bare numbers/bools don't — matching the spec style
/// the engine already parses (`status == 'reading'`, `rating > 3`).
fn build_filter(clauses: &[FilterClause], join: &str) -> String {
    let render = |c: &FilterClause| {
        let is_scalar = c.value.parse::<f64>().is_ok()
            || matches!(c.value.to_ascii_lowercase().as_str(), "true" | "false");
        let v = if is_scalar {
            c.value.clone()
        } else {
            format!("'{}'", c.value.replace('\'', ""))
        };
        format!("{} {} {}", c.field, c.op, v)
    };
    clauses.iter().map(render).collect::<Vec<_>>().join(&format!(" {join} "))
}

/// Parse a YAML view spec into its structured (UI-editable) form.
pub fn parse_view_spec(spec_yaml: &str) -> Result<StructuredSpec> {
    let vs: ViewSpec = serde_yaml::from_str(spec_yaml)?;
    let mut out = StructuredSpec {
        source: vs.source,
        kind: vs.kind,
        filter_join: "and".into(),
        sort: vs.sort.unwrap_or_default().iter().map(|s| {
            let p = parse_sort(s);
            SortClause { field: p.field, desc: p.desc }
        }).collect(),
        columns: vs.columns,
        group: vs.group,
        date: vs.date,
        limit: vs.limit,
        x: vs.x,
        y: vs.y,
        agg: vs.agg,
        chart_type: vs.chart_type,
        ..Default::default()
    };
    if let Some(f) = vs.filter.filter(|f| !f.trim().is_empty()) {
        match flatten_filter(&f) {
            Some((clauses, join)) => {
                out.filters = clauses;
                out.filter_join = join;
            }
            None => {
                out.filter_complex = true;
                out.filter_raw = Some(f);
            }
        }
    }
    Ok(out)
}

/// Serialize a structured spec back to the canonical YAML form. Field order is
/// fixed so output is deterministic and git-diff friendly.
pub fn serialize_view_spec(s: &StructuredSpec) -> String {
    let mut out = String::new();
    out.push_str(&format!("source: {}\n", s.source));
    if let Some(k) = s.kind.as_deref().filter(|k| !k.is_empty()) {
        out.push_str(&format!("type: {k}\n"));
    }
    let filter = if s.filter_complex {
        s.filter_raw.clone().unwrap_or_default()
    } else {
        let join = if s.filter_join.is_empty() { "and" } else { &s.filter_join };
        build_filter(&s.filters, join)
    };
    if !filter.trim().is_empty() {
        out.push_str(&format!("filter: {filter}\n"));
    }
    if !s.sort.is_empty() {
        let parts: Vec<String> = s.sort.iter()
            .map(|c| if c.desc { format!("{} desc", c.field) } else { c.field.clone() })
            .collect();
        out.push_str(&format!("sort: [{}]\n", parts.join(", ")));
    }
    if let Some(cols) = &s.columns {
        if !cols.is_empty() {
            out.push_str(&format!("columns: [{}]\n", cols.join(", ")));
        }
    }
    if let Some(g) = s.group.as_deref().filter(|g| !g.is_empty()) {
        out.push_str(&format!("group: {g}\n"));
    }
    if let Some(d) = s.date.as_deref().filter(|d| !d.is_empty()) {
        out.push_str(&format!("date: {d}\n"));
    }
    if let Some(l) = s.limit {
        out.push_str(&format!("limit: {l}\n"));
    }
    if let Some(x) = s.x.as_deref().filter(|v| !v.is_empty()) {
        out.push_str(&format!("x: {x}\n"));
    }
    if let Some(y) = s.y.as_deref().filter(|v| !v.is_empty()) {
        out.push_str(&format!("y: {y}\n"));
    }
    if let Some(a) = s.agg.as_deref().filter(|v| !v.is_empty()) {
        out.push_str(&format!("agg: {a}\n"));
    }
    if let Some(ct) = s.chart_type.as_deref().filter(|v| !v.is_empty()) {
        out.push_str(&format!("chartType: {ct}\n"));
    }
    out
}

// ── Write-back: edit one cell at its source ───────────────────────────────────

/// Coerce an edited string into a typed JSON value for note frontmatter,
/// matching the column's declared type so frontmatter stays clean and typed.
fn coerce(value: &str, ty: &str) -> serde_json::Value {
    let v = value.trim();
    match ty {
        "number" => v.parse::<f64>().ok()
            .and_then(serde_json::Number::from_f64)
            .map(serde_json::Value::Number)
            .unwrap_or_else(|| serde_json::Value::String(value.to_string())),
        "bool" => match v.to_ascii_lowercase().as_str() {
            "true" => serde_json::Value::Bool(true),
            "false" => serde_json::Value::Bool(false),
            _ => serde_json::Value::String(value.to_string()),
        },
        "list" => serde_json::Value::Array(
            v.split(',').map(|s| s.trim()).filter(|s| !s.is_empty())
                .map(|s| serde_json::Value::String(s.to_string())).collect(),
        ),
        _ => serde_json::Value::String(value.to_string()), // text, date
    }
}

fn csv_escape(s: &str) -> String {
    if s.contains(',') || s.contains('"') || s.contains('\n') {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s.to_string()
    }
}

fn read_csv_raw(path: &Path) -> Result<(Vec<String>, Vec<Vec<String>>)> {
    let content = std::fs::read_to_string(path)?;
    let mut lines = content.lines().filter(|l| !l.trim().is_empty());
    let header = lines.next().map(split_csv_record).unwrap_or_default();
    let records = lines.map(split_csv_record).collect();
    Ok((header, records))
}

fn write_csv_raw(path: &Path, header: &[String], mut records: Vec<Vec<String>>, id_idx: Option<usize>) -> Result<()> {
    // Stable row order by id keeps cell edits to a one-line diff.
    if let Some(i) = id_idx {
        records.sort_by(|a, b| {
            a.get(i).map(String::as_str).unwrap_or("").cmp(b.get(i).map(String::as_str).unwrap_or(""))
        });
    }
    let mut out = String::new();
    out.push_str(&header.iter().map(|h| csv_escape(h)).collect::<Vec<_>>().join(","));
    out.push('\n');
    for rec in &records {
        out.push_str(&rec.iter().map(|c| csv_escape(c)).collect::<Vec<_>>().join(","));
        out.push('\n');
    }
    std::fs::write(path, out)?;
    Ok(())
}

/// Write one edited cell back to its source file. Returns the path of a written
/// collection note (so the caller can re-index it) or `None` for CSV.
pub fn set_cell(root: &Path, source: &str, row_id: &str, field: &str, value: &str, ty: &str) -> Result<Option<std::path::PathBuf>> {
    if field == "id" || field == "$body" {
        return Err(AppError::Other(format!("Field '{field}' is not editable")));
    }
    if row_id.contains('/') || row_id.contains("..") {
        return Err(AppError::Other("Invalid row id".into()));
    }

    if let Some(name) = source.strip_prefix("collections/") {
        let name = name.trim_end_matches('/');
        let path = root.join("collections").join(name).join(format!("{row_id}.md"));
        let content = std::fs::read_to_string(&path)
            .map_err(|_| AppError::Other(format!("Row not found: {row_id}")))?;
        let mut note = crate::note::parse_note(row_id, &content)?;
        note.frontmatter.insert(field.to_string(), coerce(value, ty));
        std::fs::write(&path, crate::note::serialize_note(&note)?)?;
        Ok(Some(path))
    } else if let Some(rest) = source.strip_prefix("data/") {
        let name = rest.trim_end_matches(".csv");
        let path = root.join("data").join(format!("{name}.csv"));
        let (header, mut records) = read_csv_raw(&path)?;
        let id_idx = header.iter().position(|h| h == "id");
        let field_idx = header.iter().position(|h| h == field)
            .ok_or_else(|| AppError::Other(format!("No column '{field}'")))?;

        let pos = match id_idx {
            Some(i) => records.iter().position(|r| r.get(i).map(String::as_str) == Some(row_id)),
            None => row_id.parse::<usize>().ok().filter(|&n| n < records.len()),
        }.ok_or_else(|| AppError::Other(format!("Row not found: {row_id}")))?;

        let rec = &mut records[pos];
        while rec.len() <= field_idx {
            rec.push(String::new());
        }
        rec[field_idx] = value.to_string();

        write_csv_raw(&path, &header, records, id_idx)?;
        Ok(None)
    } else {
        Err(AppError::Other(format!("Unknown source '{source}'")))
    }
}

/// Append a new row to a source. For collections this creates a note from the
/// given fields (title/type/created + any seed values such as a board group);
/// for CSV it appends a record (id-sorted on write). Frontend supplies `id` and
/// `created` so date/id generation stays in one place. Returns the new note path
/// for collections (to re-index) or `None` for CSV.
pub fn add_row(root: &Path, source: &str, id: &str, fields: &BTreeMap<String, String>) -> Result<Option<std::path::PathBuf>> {
    if id.is_empty() || id.contains('/') || id.contains("..") {
        return Err(AppError::Other("Invalid row id".into()));
    }

    if let Some(name) = source.strip_prefix("collections/") {
        let dir = root.join("collections").join(name.trim_end_matches('/'));
        std::fs::create_dir_all(&dir)?;
        let path = dir.join(format!("{id}.md"));
        if path.exists() {
            return Err(AppError::Other(format!("Row already exists: {id}")));
        }

        let mut fm: BTreeMap<String, serde_json::Value> = BTreeMap::new();
        fm.insert("title".into(), serde_json::Value::String(
            fields.get("title").cloned().unwrap_or_else(|| "Untitled".into())));
        fm.insert("type".into(), serde_json::Value::String(
            fields.get("type").cloned().unwrap_or_else(|| "note".into())));
        if let Some(created) = fields.get("created") {
            fm.insert("created".into(), serde_json::Value::String(created.clone()));
        }
        for (k, v) in fields {
            if !matches!(k.as_str(), "title" | "type" | "created") {
                fm.insert(k.clone(), serde_json::Value::String(v.clone()));
            }
        }

        let note = crate::note::Note { path: format!("{id}.md"), frontmatter: fm, body: String::new() };
        std::fs::write(&path, crate::note::serialize_note(&note)?)?;
        Ok(Some(path))
    } else if let Some(rest) = source.strip_prefix("data/") {
        let path = root.join("data").join(format!("{}.csv", rest.trim_end_matches(".csv")));
        let (header, mut records) = read_csv_raw(&path)?;
        let id_idx = header.iter().position(|h| h == "id");

        let mut rec = vec![String::new(); header.len()];
        for (k, v) in fields {
            if let Some(i) = header.iter().position(|h| h == k) {
                rec[i] = v.clone();
            }
        }
        if let Some(i) = id_idx {
            rec[i] = id.to_string();
        }
        records.push(rec);
        write_csv_raw(&path, &header, records, id_idx)?;
        Ok(None)
    } else {
        Err(AppError::Other(format!("Unknown source '{source}'")))
    }
}

/// Remove a row from a CSV source (collections delete via the trash system in
/// the command layer). Rewrites id-sorted.
pub fn delete_csv_row(root: &Path, source: &str, row_id: &str) -> Result<()> {
    let rest = source.strip_prefix("data/")
        .ok_or_else(|| AppError::Other(format!("Not a CSV source: {source}")))?;
    let path = root.join("data").join(format!("{}.csv", rest.trim_end_matches(".csv")));
    let (header, mut records) = read_csv_raw(&path)?;
    let id_idx = header.iter().position(|h| h == "id");

    let pos = match id_idx {
        Some(i) => records.iter().position(|r| r.get(i).map(String::as_str) == Some(row_id)),
        None => row_id.parse::<usize>().ok().filter(|&n| n < records.len()),
    }.ok_or_else(|| AppError::Other(format!("Row not found: {row_id}")))?;

    records.remove(pos);
    write_csv_raw(&path, &header, records, id_idx)?;
    Ok(())
}

// ── Row templates ───────────────────────────────────────────────────────────────
//
// A template is a `collections/<name>/_template-<slug>.md` file — already skipped
// from rows (the `_` prefix). New rows can copy a template's frontmatter + body,
// so a "Bug report" template can pre-fill type/status/priority and a checklist.

fn collection_dir(root: &Path, source: &str) -> Result<(String, std::path::PathBuf)> {
    let name = source
        .strip_prefix("collections/")
        .ok_or_else(|| AppError::Other("Templates are only for collections".into()))?
        .trim_end_matches('/')
        .to_string();
    let dir = root.join("collections").join(&name);
    Ok((name, dir))
}

fn slugify(s: &str) -> String {
    let mut out = String::new();
    let mut dash = false;
    for c in s.to_lowercase().chars() {
        if c.is_ascii_alphanumeric() { out.push(c); dash = false; }
        else if !dash && !out.is_empty() { out.push('-'); dash = true; }
    }
    let s = out.trim_matches('-').to_string();
    if s.is_empty() { "template".into() } else { s }
}

/// Template names available for a collection (the `<slug>` of each `_template-<slug>.md`).
pub fn list_row_templates(root: &Path, source: &str) -> Result<Vec<String>> {
    let (_name, dir) = collection_dir(root, source)?;
    let mut out = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for e in entries.flatten() {
            let p = e.path();
            if p.extension().and_then(|s| s.to_str()) != Some("md") { continue; }
            if let Some(stem) = p.file_stem().and_then(|s| s.to_str()) {
                if let Some(t) = stem.strip_prefix("_template-") {
                    if !t.is_empty() { out.push(t.to_string()); }
                }
            }
        }
    }
    out.sort();
    Ok(out)
}

/// Create a row from a template: the template's frontmatter + body, with
/// title/created (and any seed fields, e.g. a board group) overridden.
pub fn add_row_from_template(
    root: &Path,
    source: &str,
    id: &str,
    template: &str,
    fields: &BTreeMap<String, String>,
) -> Result<Option<std::path::PathBuf>> {
    if id.is_empty() || id.contains('/') || id.contains("..") {
        return Err(AppError::Other("Invalid row id".into()));
    }
    let (name, dir) = collection_dir(root, source)?;
    let tpl_path = dir.join(format!("_template-{template}.md"));
    let content = std::fs::read_to_string(&tpl_path)
        .map_err(|_| AppError::Other(format!("Template not found: {template}")))?;
    let tpl = crate::note::parse_note(&format!("_template-{template}.md"), &content)?;

    let path = dir.join(format!("{id}.md"));
    if path.exists() {
        return Err(AppError::Other(format!("Row already exists: {id}")));
    }

    let mut fm = tpl.frontmatter.clone();
    fm.insert("title".into(), serde_json::Value::String(
        fields.get("title").cloned().unwrap_or_else(|| "Untitled".into())));
    if let Some(c) = fields.get("created") {
        fm.insert("created".into(), serde_json::Value::String(c.clone()));
    }
    for (k, v) in fields {
        if !matches!(k.as_str(), "title" | "created") {
            fm.insert(k.clone(), serde_json::Value::String(v.clone()));
        }
    }

    let note = crate::note::Note {
        path: format!("collections/{name}/{id}.md"),
        frontmatter: fm,
        body: tpl.body.clone(),
    };
    std::fs::write(&path, crate::note::serialize_note(&note)?)?;
    Ok(Some(path))
}

/// Save an existing row as a reusable template (its title/created are dropped —
/// a template holds defaults, not one row's identity).
pub fn save_row_as_template(root: &Path, source: &str, row_id: &str, template_name: &str) -> Result<()> {
    let (name, dir) = collection_dir(root, source)?;
    let row_path = dir.join(format!("{row_id}.md"));
    let content = std::fs::read_to_string(&row_path)
        .map_err(|_| AppError::Other(format!("Row not found: {row_id}")))?;
    let mut note = crate::note::parse_note(row_id, &content)?;
    note.frontmatter.remove("title");
    note.frontmatter.remove("created");
    let slug = slugify(template_name);
    note.path = format!("collections/{name}/_template-{slug}.md");
    std::fs::write(dir.join(format!("_template-{slug}.md")), crate::note::serialize_note(&note)?)?;
    Ok(())
}

// ── Relations & rollups ──────────────────────────────────────────────────────────

/// Fill each `relation` property's options from its target collection's row
/// titles, so the frontend can render + link them as chips.
pub fn fill_relation_options(root: &Path, schema: &mut crate::schema::TypeSchema) {
    for p in &mut schema.properties {
        if p.ty == crate::schema::PropType::Relation {
            if let Some(coll) = p.collection.clone() {
                if let Ok(t) = read_collection(root, &coll) {
                    p.options = t.rows.iter()
                        .filter_map(|r| r.cells.get("title").map(CellValue::as_text))
                        .filter(|s| !s.is_empty())
                        .map(|name| crate::schema::SelectOption { name, color: "blue".into() })
                        .collect();
                }
            }
        }
    }
}

fn rollup_value(rows: &[&Row], prop: &str, func: &str) -> CellValue {
    match func {
        "count" => CellValue::Num(rows.len() as f64),
        "values" => CellValue::List(
            rows.iter().filter_map(|r| r.cells.get(prop).map(CellValue::as_text)).filter(|s| !s.is_empty()).collect(),
        ),
        "sum" | "avg" | "min" | "max" => {
            let nums: Vec<f64> = rows.iter().filter_map(|r| r.cells.get(prop).and_then(CellValue::as_num)).collect();
            if nums.is_empty() {
                return CellValue::Null;
            }
            let v = match func {
                "sum" => nums.iter().sum(),
                "avg" => nums.iter().sum::<f64>() / nums.len() as f64,
                "min" => nums.iter().cloned().fold(f64::INFINITY, f64::min),
                _ => nums.iter().cloned().fold(f64::NEG_INFINITY, f64::max),
            };
            CellValue::Num(v)
        }
        _ => CellValue::Null,
    }
}

/// Compute each `rollup` property: follow its relation to the target collection,
/// aggregate the chosen target property, and inject the result into every row.
pub fn apply_rollups(root: &Path, table: &mut Table, schema: &crate::schema::TypeSchema) {
    for p in &schema.properties {
        if p.ty != crate::schema::PropType::Rollup {
            continue;
        }
        let (Some(rel_name), Some(func)) = (p.relation.clone(), p.function.clone()) else { continue };
        let target_prop = p.property.clone().unwrap_or_default();
        let Some(rel) = schema.property(&rel_name) else { continue };
        let Some(coll) = rel.collection.clone() else { continue };
        let Ok(target) = read_collection(root, &coll) else { continue };

        let mut by_title: std::collections::HashMap<String, &Row> = std::collections::HashMap::new();
        for r in &target.rows {
            if let Some(t) = r.cells.get("title") {
                by_title.insert(t.as_text(), r);
            }
        }
        for row in &mut table.rows {
            let titles: Vec<String> = match row.cells.get(&rel_name) {
                Some(CellValue::List(items)) => items.clone(),
                Some(other) => {
                    let t = other.as_text();
                    if t.is_empty() { vec![] } else { vec![t] }
                }
                None => vec![],
            };
            let related: Vec<&Row> = titles.iter().filter_map(|t| by_title.get(t).copied()).collect();
            row.cells.insert(p.name.clone(), rollup_value(&related, &target_prop, &func));
        }
    }
}

// ── Export ───────────────────────────────────────────────────────────────────────

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

const EXPORT_STYLE: &str = "<style>body{font-family:-apple-system,BlinkMacSystemFont,system-ui,sans-serif;max-width:820px;margin:48px auto;padding:0 24px;line-height:1.6;color:#1a1a1a}h1,h2,h3{line-height:1.25}code{background:#f0f0ef;padding:2px 5px;border-radius:4px;font-size:.9em}pre{background:#f6f6f5;padding:12px 14px;border-radius:8px;overflow:auto}table{border-collapse:collapse;width:100%;font-size:14px}th,td{border:1px solid #e3e1dc;padding:7px 10px;text-align:left;vertical-align:top}th{background:#fafafa}blockquote{border-left:3px solid #e3e1dc;margin:0;padding-left:16px;color:#555}a{color:#2383e2;text-decoration:none}img{max-width:100%}</style>";

fn html_doc(title: &str, body: &str) -> String {
    format!(
        "<!doctype html>\n<html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>{}</title>{}</head>\n<body>\n{}\n</body></html>\n",
        html_escape(title), EXPORT_STYLE, body,
    )
}

fn md_to_html(md: &str) -> String {
    use pulldown_cmark::{html, Options, Parser};
    let mut opts = Options::empty();
    opts.insert(Options::ENABLE_TABLES);
    opts.insert(Options::ENABLE_STRIKETHROUGH);
    opts.insert(Options::ENABLE_TASKLISTS);
    let parser = Parser::new_ext(md, opts);
    let mut out = String::new();
    html::push_html(&mut out, parser);
    out
}

/// A note as a standalone, shareable HTML document.
pub fn export_note_html(root: &Path, path: &str) -> Result<String> {
    let content = std::fs::read_to_string(root.join(path))?;
    let note = crate::note::parse_note(path, &content)?;
    let title = crate::note::infer_title(&note);
    let body = format!("<h1>{}</h1>\n{}", html_escape(&title), md_to_html(&note.body));
    Ok(html_doc(&title, &body))
}

/// A database's rows as CSV (columns in display order, `$body` excluded).
pub fn export_collection_csv(root: &Path, source: &str) -> Result<String> {
    let (name, _) = collection_dir(root, source)?;
    let table = read_collection(root, &name)?;
    let cols: Vec<&Column> = table.columns.iter().filter(|c| c.key != "$body").collect();

    let mut out = String::new();
    out.push_str(&cols.iter().map(|c| csv_escape(&c.key)).collect::<Vec<_>>().join(","));
    out.push('\n');
    for row in &table.rows {
        let line: Vec<String> = cols.iter()
            .map(|c| csv_escape(&row.cells.get(&c.key).map(CellValue::as_text).unwrap_or_default()))
            .collect();
        out.push_str(&line.join(","));
        out.push('\n');
    }
    Ok(out)
}

/// A database's rows as a standalone HTML table.
pub fn export_collection_html(root: &Path, source: &str) -> Result<String> {
    let (name, _) = collection_dir(root, source)?;
    let table = read_collection(root, &name)?;
    let cols: Vec<&Column> = table.columns.iter().filter(|c| c.key != "$body").collect();

    let mut body = format!("<h1>{}</h1>\n<table>\n<thead><tr>", html_escape(&name));
    for c in &cols {
        body.push_str(&format!("<th>{}</th>", html_escape(&c.key)));
    }
    body.push_str("</tr></thead>\n<tbody>\n");
    for row in &table.rows {
        body.push_str("<tr>");
        for c in &cols {
            body.push_str(&format!("<td>{}</td>", html_escape(&row.cells.get(&c.key).map(CellValue::as_text).unwrap_or_default())));
        }
        body.push_str("</tr>\n");
    }
    body.push_str("</tbody></table>\n");
    Ok(html_doc(&name, &body))
}

// ── Charts ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, serde::Serialize)]
pub struct ChartPoint {
    pub x: String,
    pub y: f64,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChartResult {
    pub chart_type: String,
    pub x_label: String,
    pub y_label: String,
    pub points: Vec<ChartPoint>,
}

#[derive(Default)]
struct Acc {
    vals: Vec<f64>,
    rows: usize,
}

fn aggregate(table: &Table, x: &str, y: &str, agg: &str) -> Result<Vec<ChartPoint>> {
    // BTreeMap keeps groups sorted by x (correct for dates/text; numeric x is
    // lexical — acceptable for Slice 2, revisit with typed x buckets later).
    let mut groups: BTreeMap<String, Acc> = BTreeMap::new();
    for row in &table.rows {
        let xv = row.cells.get(x).map(|c| c.as_text()).unwrap_or_default();
        let acc = groups.entry(xv).or_default();
        acc.rows += 1;
        if let Some(n) = row.cells.get(y).and_then(|c| c.as_num()) {
            acc.vals.push(n);
        }
    }

    let mut points = Vec::with_capacity(groups.len());
    for (x, acc) in groups {
        let y = match agg {
            "count" => acc.rows as f64,
            "sum" => acc.vals.iter().sum(),
            "avg" => if acc.vals.is_empty() { 0.0 } else { acc.vals.iter().sum::<f64>() / acc.vals.len() as f64 },
            "min" => acc.vals.iter().cloned().fold(f64::INFINITY, f64::min),
            "max" => acc.vals.iter().cloned().fold(f64::NEG_INFINITY, f64::max),
            other => return Err(AppError::Other(format!("Unknown agg '{other}' (sum|avg|count|min|max)"))),
        };
        points.push(ChartPoint { x, y });
    }
    Ok(points)
}

/// Parse a `cortex-chart` spec, resolve + filter its source, and produce a
/// single series of `{x, y}` points (aggregated if `agg` is set).
pub fn run_chart(root: &Path, spec_yaml: &str) -> Result<ChartResult> {
    let spec: ViewSpec = serde_yaml::from_str(spec_yaml)?;
    let table = resolve_source(root, &spec.source)?;

    let x = spec.x.clone().ok_or_else(|| AppError::Other("Chart requires an `x` field".into()))?;
    let y = spec.y.clone().ok_or_else(|| AppError::Other("Chart requires a `y` field".into()))?;
    let chart_type = spec.chart_type.clone().unwrap_or_else(|| "line".into());

    // Apply filter (and any sort) first.
    let query = Query {
        filter: match &spec.filter {
            Some(f) if !f.trim().is_empty() => Some(parse_filter(f)?),
            _ => None,
        },
        sort: spec.sort.clone().unwrap_or_default().iter().map(|s| parse_sort(s)).collect(),
        columns: None,
        limit: None,
    };
    let filtered = query.apply(&table);

    let mut points = match &spec.agg {
        Some(agg) if !agg.trim().is_empty() => aggregate(&filtered, &x, &y, agg)?,
        _ => filtered.rows.iter().filter_map(|r| {
            let yv = r.cells.get(&y).and_then(|c| c.as_num())?;
            let xv = r.cells.get(&x).map(|c| c.as_text()).unwrap_or_default();
            Some(ChartPoint { x: xv, y: yv })
        }).collect(),
    };

    // Order points along x (numeric when possible, else lexical).
    points.sort_by(|a, b| match (a.x.parse::<f64>(), b.x.parse::<f64>()) {
        (Ok(p), Ok(q)) => p.partial_cmp(&q).unwrap_or(std::cmp::Ordering::Equal),
        _ => a.x.cmp(&b.x),
    });

    Ok(ChartResult { chart_type, x_label: x, y_label: y, points })
}

// ── Tests: the contract — one Query type, two sources ──────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("cortex-data-{}-{}", tag, std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write(path: &Path, body: &str) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, body).unwrap();
    }

    #[test]
    fn collection_source_filters_and_sorts() {
        let root = scratch("coll");
        write(&root.join("collections/books/dune.md"),
            "---\ntitle: Dune\nauthor: Herbert\nrating: 5\nstatus: reading\n---\nGreat.");
        write(&root.join("collections/books/neuromancer.md"),
            "---\ntitle: Neuromancer\nauthor: Gibson\nrating: 4\nstatus: done\n---\n");
        write(&root.join("collections/books/snowcrash.md"),
            "---\ntitle: Snow Crash\nauthor: Stephenson\nrating: 3\nstatus: reading\n---\n");

        let table = read_collection(&root, "books").unwrap();
        assert_eq!(table.rows.len(), 3);
        assert!(table.columns.iter().any(|c| c.key == "rating" && c.ty == ColumnType::Number));

        let q = Query {
            filter: Some(parse_filter("status == 'reading'").unwrap()),
            sort: vec![Sort { field: "rating".into(), desc: true }],
            columns: Some(vec!["title".into(), "rating".into()]),
            limit: None,
        };
        let out = q.apply(&table);
        assert_eq!(out.rows.len(), 2);
        assert_eq!(out.rows[0].cells.get("title").unwrap().as_text(), "Dune");      // rating 5
        assert_eq!(out.rows[1].cells.get("title").unwrap().as_text(), "Snow Crash"); // rating 3
        assert_eq!(out.columns.iter().map(|c| c.key.as_str()).collect::<Vec<_>>(), vec!["title", "rating"]);

        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn collection_default_order_is_created_then_id() {
        let root = scratch("order");
        // `aaa` sorts first alphabetically but was created earliest; a row whose
        // id sorts late but is older should still precede a newer one.
        write(&root.join("collections/log/zebra.md"),
            "---\ntitle: Zebra\ncreated: 2026-01-01\n---\n");
        write(&root.join("collections/log/apple.md"),
            "---\ntitle: Apple\ncreated: 2026-06-08\n---\n"); // newest → should be last
        write(&root.join("collections/log/mango.md"),
            "---\ntitle: Mango\ncreated: 2026-03-01\n---\n");

        let table = read_collection(&root, "log").unwrap();
        let order: Vec<&str> = table.rows.iter().map(|r| r.id.as_str()).collect();
        assert_eq!(order, vec!["zebra", "mango", "apple"]); // by created asc, not id

        // Rows sharing a created date fall back to id order (stable).
        write(&root.join("collections/log/apple.md"),
            "---\ntitle: Apple\ncreated: 2026-03-01\n---\n");
        let table = read_collection(&root, "log").unwrap();
        let order: Vec<&str> = table.rows.iter().map(|r| r.id.as_str()).collect();
        assert_eq!(order, vec!["zebra", "apple", "mango"]); // mango & apple tie → a<m

        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn csv_source_answers_the_same_query_type() {
        let root = scratch("csv");
        write(&root.join("data/weight.csv"),
            "id,date,weight\n2024-01-01,2024-01-01,82.5\n2024-01-02,2024-01-02,81.0\n2024-01-03,2024-01-03,79.4\n");

        let table = read_csv(&root, "weight").unwrap();
        assert_eq!(table.rows.len(), 3);
        assert!(table.columns.iter().any(|c| c.key == "weight" && c.ty == ColumnType::Number));
        assert!(table.columns.iter().any(|c| c.key == "date" && c.ty == ColumnType::Date));

        // EXACT same Query type as the collection test — that's the shared contract.
        let q = Query {
            filter: Some(parse_filter("weight > 80").unwrap()),
            sort: vec![Sort { field: "weight".into(), desc: false }],
            columns: None,
            limit: None,
        };
        let out = q.apply(&table);
        assert_eq!(out.rows.len(), 2);
        assert_eq!(out.rows[0].cells.get("weight").unwrap().as_num(), Some(81.0));
        assert_eq!(out.rows[1].cells.get("weight").unwrap().as_num(), Some(82.5));

        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn run_view_resolves_spec_end_to_end() {
        let root = scratch("view");
        write(&root.join("collections/books/dune.md"),
            "---\ntitle: Dune\nrating: 5\nstatus: reading\n---\n");
        write(&root.join("collections/books/nm.md"),
            "---\ntitle: Neuromancer\nrating: 4\nstatus: done\n---\n");
        write(&root.join("collections/books/sc.md"),
            "---\ntitle: Snow Crash\nrating: 4\nstatus: reading\n---\n");

        let spec = "source: collections/books\ntype: table\nfilter: status == 'reading'\nsort: [rating desc]\ncolumns: [title, rating]\n";
        let out = run_view(&root, spec).unwrap();
        assert_eq!(out.rows.len(), 2);
        assert_eq!(out.rows[0].cells.get("title").unwrap().as_text(), "Dune"); // rating 5 first
        assert_eq!(out.columns.iter().map(|c| c.key.as_str()).collect::<Vec<_>>(), vec!["title", "rating"]);

        // Same entry point, CSV source.
        write(&root.join("data/weight.csv"), "id,weight\na,82\nb,79\n");
        let csv_out = run_view(&root, "source: data/weight.csv\nfilter: weight > 80\n").unwrap();
        assert_eq!(csv_out.rows.len(), 1);
        assert_eq!(csv_out.rows[0].id, "a");

        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn chart_raw_points_and_aggregation() {
        let root = scratch("chart");
        write(&root.join("data/weight.csv"),
            "id,date,weight\na,2024-01-03,79.4\nb,2024-01-01,82.5\nc,2024-01-02,81.0\n");

        // Raw line series — points come back sorted by x (date).
        let line = run_chart(&root, "source: data/weight.csv\ntype: chart\nchartType: line\nx: date\ny: weight\n").unwrap();
        assert_eq!(line.chart_type, "line");
        assert_eq!(line.points.len(), 3);
        assert_eq!(line.points[0].x, "2024-01-01");
        assert_eq!(line.points[0].y, 82.5);
        assert_eq!(line.points[2].x, "2024-01-03");

        // Aggregated bar — sum weight grouped by date (one row each here).
        let bar = run_chart(&root, "source: data/weight.csv\ntype: chart\nchartType: bar\nx: date\ny: weight\nagg: sum\n").unwrap();
        assert_eq!(bar.points.len(), 3);

        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn set_cell_writes_back_to_both_sources() {
        let root = scratch("write");

        // Collection: edit frontmatter, typed + sorted on write.
        write(&root.join("collections/books/dune.md"),
            "---\ntitle: Dune\nrating: 3\nstatus: reading\n---\nBody.");
        set_cell(&root, "collections/books", "dune", "rating", "5", "number").unwrap();
        let table = read_collection(&root, "books").unwrap();
        assert_eq!(table.rows[0].cells.get("rating").unwrap().as_num(), Some(5.0));
        // Body preserved, frontmatter still parses.
        let raw = std::fs::read_to_string(root.join("collections/books/dune.md")).unwrap();
        assert!(raw.contains("Body."));
        assert!(raw.contains("rating: 5"));

        // Editing id / $body is refused.
        assert!(set_cell(&root, "collections/books", "dune", "id", "x", "text").is_err());
        assert!(set_cell(&root, "collections/books", "dune", "$body", "x", "text").is_err());

        // CSV: edit a cell, column order + id sort preserved.
        write(&root.join("data/weight.csv"), "id,date,weight\nb,2024-01-02,81\na,2024-01-01,82\n");
        set_cell(&root, "data/weight.csv", "a", "weight", "80.5", "number").unwrap();
        let csv = std::fs::read_to_string(root.join("data/weight.csv")).unwrap();
        // Header unchanged; rows now id-sorted (a before b); a's weight updated.
        assert_eq!(csv.lines().next().unwrap(), "id,date,weight");
        assert_eq!(csv.lines().nth(1).unwrap(), "a,2024-01-01,80.5");
        assert_eq!(csv.lines().nth(2).unwrap(), "b,2024-01-02,81");

        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn add_row_appends_to_both_sources() {
        let root = scratch("addrow");

        // Collection: creates a note with seeded fields.
        write(&root.join("collections/books/dune.md"), "---\ntitle: Dune\nstatus: reading\n---\n");
        let mut fields = BTreeMap::new();
        fields.insert("title".to_string(), "Untitled".to_string());
        fields.insert("created".to_string(), "2026-05-31".to_string());
        fields.insert("status".to_string(), "to-read".to_string()); // board group seed
        add_row(&root, "collections/books", "new-book", &fields).unwrap();
        let table = read_collection(&root, "books").unwrap();
        assert_eq!(table.rows.len(), 2);
        let added = table.rows.iter().find(|r| r.id == "new-book").unwrap();
        assert_eq!(added.cells.get("status").unwrap().as_text(), "to-read");
        // Duplicate id rejected.
        assert!(add_row(&root, "collections/books", "new-book", &fields).is_err());

        // CSV: appends a record into the right columns, id-sorted.
        write(&root.join("data/weight.csv"), "id,date,weight\na,2024-01-01,82\n");
        let mut cf = BTreeMap::new();
        cf.insert("date".to_string(), "2024-01-02".to_string());
        cf.insert("weight".to_string(), "81".to_string());
        add_row(&root, "data/weight.csv", "b", &cf).unwrap();
        let csv = std::fs::read_to_string(root.join("data/weight.csv")).unwrap();
        assert_eq!(csv.lines().nth(2).unwrap(), "b,2024-01-02,81");

        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn delete_csv_row_removes_the_line() {
        let root = scratch("delcsv");
        write(&root.join("data/weight.csv"), "id,date,weight\na,2024-01-01,82\nb,2024-01-02,81\n");
        delete_csv_row(&root, "data/weight.csv", "a").unwrap();
        let csv = std::fs::read_to_string(root.join("data/weight.csv")).unwrap();
        assert_eq!(csv.lines().count(), 2); // header + 1 row
        assert_eq!(csv.lines().nth(1).unwrap(), "b,2024-01-02,81");
        assert!(delete_csv_row(&root, "data/weight.csv", "nope").is_err());
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn structured_spec_round_trips_and_flags_complex_filters() {
        // Flat filter: parsed into clauses, rebuilt identically.
        let spec = "source: collections/books\ntype: table\nfilter: status == 'reading' and rating > 3\nsort: [rating desc, title]\ncolumns: [title, author, rating]\n";
        let s = parse_view_spec(spec).unwrap();
        assert!(!s.filter_complex);
        assert_eq!(s.filters.len(), 2);
        assert_eq!(s.filter_join, "and");
        assert_eq!(s.filters[0].field, "status");
        assert_eq!(s.filters[0].op, "==");
        assert_eq!(s.filters[0].value, "reading");
        assert_eq!(s.filters[1].op, ">");
        assert_eq!(s.sort.len(), 2);
        assert!(s.sort[0].desc && !s.sort[1].desc);

        let yaml = serialize_view_spec(&s);
        assert!(yaml.contains("filter: status == 'reading' and rating > 3"));
        assert!(yaml.contains("sort: [rating desc, title]"));
        assert!(yaml.contains("columns: [title, author, rating]"));
        // And it parses back to the same shape.
        let again = parse_view_spec(&yaml).unwrap();
        assert_eq!(again.filters.len(), 2);
        assert_eq!(again.filter_join, "and");

        // Mixed connectors can't be flattened → preserved verbatim.
        let mixed = "source: collections/books\nfilter: a == '1' and b == '2' or c == '3'\n";
        let m = parse_view_spec(mixed).unwrap();
        assert!(m.filter_complex);
        assert_eq!(m.filter_raw.as_deref(), Some("a == '1' and b == '2' or c == '3'"));
        assert!(serialize_view_spec(&m).contains("filter: a == '1' and b == '2' or c == '3'"));
    }

    #[test]
    fn rollup_aggregates_across_a_relation() {
        let root = scratch("rollup");
        // Tasks with hours.
        write(&root.join("collections/tasks/a.md"), "---\ntitle: Task A\nhours: 3\n---\n");
        write(&root.join("collections/tasks/b.md"), "---\ntitle: Task B\nhours: 5\n---\n");
        write(&root.join("collections/tasks/c.md"), "---\ntitle: Task C\nhours: 2\n---\n");
        // A project linking two tasks by title.
        write(&root.join("collections/projects/p.md"),
            "---\ntitle: Launch\ntasks: [Task A, Task B]\n---\n");

        let schema = crate::schema::TypeSchema {
            properties: vec![
                crate::schema::PropertyDef {
                    name: "tasks".into(),
                    ty: crate::schema::PropType::Relation,
                    collection: Some("tasks".into()),
                    ..Default::default()
                },
                crate::schema::PropertyDef {
                    name: "total_hours".into(),
                    ty: crate::schema::PropType::Rollup,
                    relation: Some("tasks".into()),
                    property: Some("hours".into()),
                    function: Some("sum".into()),
                    ..Default::default()
                },
                crate::schema::PropertyDef {
                    name: "task_count".into(),
                    ty: crate::schema::PropType::Rollup,
                    relation: Some("tasks".into()),
                    function: Some("count".into()),
                    ..Default::default()
                },
            ],
        };

        let mut table = read_collection(&root, "projects").unwrap();
        apply_rollups(&root, &mut table, &schema);
        let row = &table.rows[0];
        assert_eq!(row.cells.get("total_hours").unwrap().as_num(), Some(8.0)); // 3 + 5
        assert_eq!(row.cells.get("task_count").unwrap().as_num(), Some(2.0));

        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn list_membership_and_and_or() {
        let root = scratch("tags");
        write(&root.join("collections/notes/a.md"),
            "---\ntitle: A\ntags: [rust, db]\nrating: 5\n---\n");
        write(&root.join("collections/notes/b.md"),
            "---\ntitle: B\ntags: [js]\nrating: 2\n---\n");
        let table = read_collection(&root, "notes").unwrap();

        let q = Query {
            filter: Some(parse_filter("tags contains 'rust' or rating <= 2").unwrap()),
            ..Default::default()
        };
        let out = q.apply(&table);
        assert_eq!(out.rows.len(), 2); // A (has rust) + B (rating 2)

        std::fs::remove_dir_all(&root).ok();
    }
}
