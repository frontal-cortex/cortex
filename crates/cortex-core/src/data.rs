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
    pub(crate) fn as_num(&self) -> Option<f64> {
        match self {
            CellValue::Num(n) => Some(*n),
            CellValue::Text(t) | CellValue::Date(t) => t.parse::<f64>().ok(),
            CellValue::Bool(b) => Some(if *b { 1.0 } else { 0.0 }),
            _ => None,
        }
    }

    pub(crate) fn as_text(&self) -> String {
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
pub(crate) fn infer_columns(rows: &[Row]) -> Vec<Column> {
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

pub(crate) fn infer_cell(raw: &str) -> CellValue {
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
    DoesNotContain,
    StartsWith,
    EndsWith,
    /// `field is_empty` — no value.
    IsEmpty,
    /// `field is_not_empty` — no value.
    IsNotEmpty,
    /// `field within 7d` — a date between today and today+7 (`-7d`: the past
    /// week; units d, w, m, y). Resolved at evaluation time.
    Within,
}

impl Op {
    /// The spelling a filter string uses (and the toolbar's `op` field).
    pub fn as_str(&self) -> &'static str {
        match self {
            Op::Eq => "==",
            Op::Ne => "!=",
            Op::Gt => ">",
            Op::Ge => ">=",
            Op::Lt => "<",
            Op::Le => "<=",
            Op::Contains => "contains",
            Op::DoesNotContain => "does_not_contain",
            Op::StartsWith => "starts_with",
            Op::EndsWith => "ends_with",
            Op::IsEmpty => "is_empty",
            Op::IsNotEmpty => "is_not_empty",
            Op::Within => "within",
        }
    }

    fn parse(tok: &str) -> Option<Op> {
        Some(match tok.to_lowercase().as_str() {
            "==" | "=" => Op::Eq,
            "!=" => Op::Ne,
            ">" => Op::Gt,
            ">=" => Op::Ge,
            "<" => Op::Lt,
            "<=" => Op::Le,
            "contains" => Op::Contains,
            "does_not_contain" => Op::DoesNotContain,
            "starts_with" => Op::StartsWith,
            "ends_with" => Op::EndsWith,
            "is_empty" => Op::IsEmpty,
            "is_not_empty" => Op::IsNotEmpty,
            "within" => Op::Within,
            _ => return None,
        })
    }

    fn takes_value(&self) -> bool {
        !matches!(self, Op::IsEmpty | Op::IsNotEmpty)
    }
}

#[derive(Debug, Clone)]
pub enum Condition {
    Cmp { field: String, op: Op, value: String },
    /// `field in [a, b, c]` — equal to any of the values.
    In { field: String, values: Vec<String> },
    Not(Box<Condition>),
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
    /// Select/status properties sort by their option order, not alphabetically:
    /// `priority: [p1, p2, p3]` puts p1 first whatever the words are.
    pub option_order: BTreeMap<String, Vec<String>>,
}

/// The option order of every select/status property in a schema — what
/// `Query::option_order` wants. Empty without a schema.
pub fn option_order(schema: Option<&crate::schema::TypeSchema>) -> BTreeMap<String, Vec<String>> {
    let mut out = BTreeMap::new();
    if let Some(s) = schema {
        for p in &s.properties {
            if !p.options.is_empty() {
                out.insert(p.name.clone(), p.options.iter().map(|o| o.name.clone()).collect());
            }
        }
    }
    out
}

/// The schema a `collections/<name>` source resolves to; None for CSV or when none is saved.
pub fn schema_for_source(root: &Path, source: &str) -> Option<crate::schema::TypeSchema> {
    let name = source.strip_prefix("collections/")?.trim_end_matches('/');
    crate::schema::load(root, name).ok().flatten()
}

impl Condition {
    fn eval(&self, row: &Row) -> bool {
        match self {
            Condition::And(a, b) => a.eval(row) && b.eval(row),
            Condition::Or(a, b) => a.eval(row) || b.eval(row),
            Condition::Not(c) => !c.eval(row),
            Condition::Cmp { field, op, value } => {
                let cell = row.cells.get(field).cloned().unwrap_or(CellValue::Null);
                eval_cmp(&cell, *op, value)
            }
            Condition::In { field, values } => {
                let cell = row.cells.get(field).cloned().unwrap_or(CellValue::Null);
                values.iter().any(|v| eval_cmp(&cell, Op::Eq, v))
            }
        }
    }
}

fn eval_cmp(cell: &CellValue, op: Op, literal: &str) -> bool {
    // The negations and the emptiness tests are defined in terms of their
    // positives so every value kind agrees on them.
    match op {
        Op::DoesNotContain => return !eval_cmp(cell, Op::Contains, literal),
        Op::IsNotEmpty => return !eval_cmp(cell, Op::IsEmpty, literal),
        Op::Within => {
            let Some((lo, hi)) = within_bounds(literal, crate::placeholders::today()) else { return false };
            return eval_cmp(cell, Op::Ge, &lo) && eval_cmp(cell, Op::Le, &hi);
        }
        _ => {}
    }
    // An empty cell equals '' and nothing else: it is neither before nor after
    // a date, neither above nor below a number — `due <= @today` must not
    // sweep in undated rows.
    let empty = matches!(cell, CellValue::Null)
        || matches!(cell, CellValue::Text(t) if t.is_empty())
        || matches!(cell, CellValue::List(items) if items.is_empty());
    if op == Op::IsEmpty {
        return empty;
    }
    if empty {
        return match op { Op::Eq => literal.is_empty(), Op::Ne => !literal.is_empty(), _ => false };
    }
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
            Op::StartsWith => cell.as_text().starts_with(literal),
            Op::EndsWith => cell.as_text().ends_with(literal),
            _ => false,
        };
    }
    if let CellValue::List(items) = cell {
        return match op {
            Op::Contains | Op::Eq => items.iter().any(|i| i == literal),
            Op::Ne => !items.iter().any(|i| i == literal),
            Op::StartsWith => items.iter().any(|i| i.starts_with(literal)),
            Op::EndsWith => items.iter().any(|i| i.ends_with(literal)),
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
        Op::StartsWith => a.starts_with(literal),
        Op::EndsWith => a.ends_with(literal),
        _ => false,
    }
}

/// The inclusive ISO date range `within` spans: `7d` / `7` is today through
/// today+7, `-7d` today-7 through today; `w` weeks, `m` calendar months, `y`
/// years. `None` for anything else.
pub fn within_bounds(spec: &str, base: chrono::NaiveDate) -> Option<(String, String)> {
    let spec = spec.trim().to_lowercase();
    let (num, unit) = match spec.chars().last() {
        Some(u) if u.is_ascii_alphabetic() => (&spec[..spec.len() - 1], u),
        _ => (spec.as_str(), 'd'),
    };
    let n: i64 = num.parse().ok()?;
    let other = match unit {
        'd' => base.checked_add_signed(chrono::Duration::days(n))?,
        'w' => base.checked_add_signed(chrono::Duration::days(7 * n))?,
        'm' => shift_months(base, n)?,
        'y' => shift_months(base, 12 * n)?,
        _ => return None,
    };
    let iso = |d: chrono::NaiveDate| d.format("%Y-%m-%d").to_string();
    Some(if other < base { (iso(other), iso(base)) } else { (iso(base), iso(other)) })
}

fn shift_months(d: chrono::NaiveDate, by: i64) -> Option<chrono::NaiveDate> {
    let months = chrono::Months::new(by.unsigned_abs() as u32);
    if by < 0 { d.checked_sub_months(months) } else { d.checked_add_months(months) }
}

impl Query {
    pub fn apply(&self, table: &Table) -> Table {
        let mut rows: Vec<Row> = table.rows.iter()
            .filter(|r| self.filter.as_ref().map(|c| c.eval(r)).unwrap_or(true))
            .cloned()
            .collect();

        // Multi-key stable sort (apply keys in reverse so the first key wins).
        // Empty cells go last in either direction — an undated task belongs at
        // the bottom of Upcoming, not the top — and select values follow their
        // option order when the schema declares one.
        for key in self.sort.iter().rev() {
            let order = self.option_order.get(&key.field);
            rows.sort_by(|a, b| {
                let av = a.cells.get(&key.field).cloned().unwrap_or(CellValue::Null);
                let bv = b.cells.get(&key.field).cloned().unwrap_or(CellValue::Null);
                let empty = |v: &CellValue| matches!(v, CellValue::Null) || v.as_text().is_empty();
                match (empty(&av), empty(&bv)) {
                    (true, true) => return std::cmp::Ordering::Equal,
                    (true, false) => return std::cmp::Ordering::Greater,
                    (false, true) => return std::cmp::Ordering::Less,
                    _ => {}
                }
                let ord = if let Some(opts) = order {
                    let rank = |v: &CellValue| opts.iter().position(|o| *o == v.as_text()).unwrap_or(opts.len());
                    rank(&av).cmp(&rank(&bv))
                } else {
                    match (av.as_num(), bv.as_num()) {
                        (Some(x), Some(y)) => x.partial_cmp(&y).unwrap_or(std::cmp::Ordering::Equal),
                        _ => av.as_text().cmp(&bv.as_text()),
                    }
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

// ── Filter parser ─────────────────────────────────────────────────────────────
//
//   expr    := and ("or" and)*             `and` binds tighter than `or`
//   and     := unary ("and" unary)*
//   unary   := "not" unary | "(" expr ")" | clause
//   clause  := field OP value
//            | field is_empty | field is_not_empty
//            | field in "[" value ("," value)* "]"
//            | field within 7d
//
// Values are quoted strings or bare words; `@today`, `@monday-1`, … resolve
// to ISO dates when the condition is built (`@me` is substituted earlier by
// the caller). The same tokens feed the toolbar's structured form, which
// keeps `@today` literal.

pub fn parse_filter(input: &str) -> Result<Condition> {
    let tokens = tokenize(input);
    let mut pos = 0;
    let cond = parse_or(&tokens, &mut pos)?;
    if pos != tokens.len() {
        return Err(AppError::Other(format!("Unexpected token in filter: {:?}", tokens.get(pos).map(display_token))));
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
            '(' | ')' | '[' | ']' | ',' => {
                if !cur.is_empty() { out.push(std::mem::take(&mut cur)); }
                out.push(c.to_string());
            }
            _ => cur.push(c),
        }
    }
    if !cur.is_empty() { out.push(cur); }
    out
}

fn is_literal(tok: &str) -> bool { tok.starts_with('\u{1}') }
fn unquote(tok: &str) -> String { tok.strip_prefix('\u{1}').unwrap_or(tok).to_string() }
fn display_token(tok: &String) -> String { if is_literal(tok) { format!("'{}'", unquote(tok)) } else { tok.clone() } }
fn is_word(tok: &str, word: &str) -> bool { !is_literal(tok) && tok.eq_ignore_ascii_case(word) }

fn parse_or(tokens: &[String], pos: &mut usize) -> Result<Condition> {
    let mut left = parse_and(tokens, pos)?;
    while tokens.get(*pos).map(|t| is_word(t, "or")).unwrap_or(false) {
        *pos += 1;
        let right = parse_and(tokens, pos)?;
        left = Condition::Or(Box::new(left), Box::new(right));
    }
    Ok(left)
}

fn parse_and(tokens: &[String], pos: &mut usize) -> Result<Condition> {
    let mut left = parse_unary(tokens, pos)?;
    while tokens.get(*pos).map(|t| is_word(t, "and")).unwrap_or(false) {
        *pos += 1;
        let right = parse_unary(tokens, pos)?;
        left = Condition::And(Box::new(left), Box::new(right));
    }
    Ok(left)
}

fn parse_unary(tokens: &[String], pos: &mut usize) -> Result<Condition> {
    match tokens.get(*pos) {
        Some(t) if is_word(t, "not") => {
            *pos += 1;
            Ok(Condition::Not(Box::new(parse_unary(tokens, pos)?)))
        }
        Some(t) if t == "(" => {
            *pos += 1;
            let inner = parse_or(tokens, pos)?;
            match tokens.get(*pos) {
                Some(t) if t == ")" => { *pos += 1; Ok(inner) }
                other => Err(AppError::Other(format!("Expected ')' in filter, found {:?}", other.map(display_token)))),
            }
        }
        _ => {
            let c = parse_clause(tokens, pos)?;
            let resolve = |v: &String| match v.strip_prefix('@').and_then(|w| crate::placeholders::resolve(w, crate::placeholders::today())) {
                Some(d) => d,
                None => v.clone(),
            };
            Ok(match c.op {
                None => Condition::In { field: c.field, values: c.values.iter().map(resolve).collect() },
                Some(op) => Condition::Cmp { field: c.field, op, value: c.values.first().map(resolve).unwrap_or_default() },
            })
        }
    }
}

/// One `field op value` clause as written: `op` is `None` for `in`, whose
/// values are the bracketed list; `is_empty` / `is_not_empty` carry none.
struct Clause {
    field: String,
    op: Option<Op>,
    values: Vec<String>,
}

fn parse_clause(tokens: &[String], pos: &mut usize) -> Result<Clause> {
    let field = tokens.get(*pos).ok_or_else(|| AppError::Other("Expected field".into()))?;
    if is_literal(field) || matches!(field.as_str(), "(" | ")" | "[" | "]" | ",") {
        return Err(AppError::Other(format!("Expected field in filter, found {}", display_token(field))));
    }
    let field = field.clone();
    let op_tok = tokens.get(*pos + 1).ok_or_else(|| AppError::Other("Expected operator".into()))?;
    *pos += 2;
    if is_word(op_tok, "in") {
        if tokens.get(*pos).map(|t| t != "[").unwrap_or(true) {
            return Err(AppError::Other("Expected '[' after in".into()));
        }
        *pos += 1;
        let mut values = Vec::new();
        loop {
            match tokens.get(*pos) {
                Some(t) if t == "]" => { *pos += 1; break; }
                Some(t) if t == "," => { *pos += 1; }
                Some(t) if t == "(" || t == ")" || t == "[" => return Err(AppError::Other(format!("Unexpected {t} in list"))),
                Some(t) => { values.push(unquote(t)); *pos += 1; }
                None => return Err(AppError::Other("Expected ']' to close the list".into())),
            }
        }
        return Ok(Clause { field, op: None, values });
    }
    let op = Op::parse(op_tok).ok_or_else(|| AppError::Other(format!("Unknown operator: {}", display_token(op_tok))))?;
    if !op.takes_value() {
        return Ok(Clause { field, op: Some(op), values: vec![] });
    }
    let val_tok = tokens.get(*pos).ok_or_else(|| AppError::Other("Expected value".into()))?;
    if !is_literal(val_tok) && matches!(val_tok.as_str(), "(" | ")" | "[" | "]" | ",") {
        return Err(AppError::Other(format!("Expected value in filter, found {val_tok}")));
    }
    *pos += 1;
    Ok(Clause { field, op: Some(op), values: vec![unquote(val_tok)] })
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
    /// Table views: a per-column summary row, `summary: {amount: sum, done:
    /// percent_checked}`. Functions: count, sum, avg, min, max,
    /// percent_checked, empty, not_empty. Computed here over the rows the view
    /// shows, never written anywhere.
    #[serde(default)]
    pub summary: BTreeMap<String, String>,
    /// Every other key: the options a view type reads — charts `x`, `y`,
    /// `agg`, `chartType`, `bucket`, `series`; trackers `log`, `done`,
    /// `range` and their field mappings. One map, so a new view type or
    /// option needs no new field here, in the structured form, or in the
    /// app's parsers: they all carry unknown keys through.
    #[serde(flatten, default)]
    pub options: BTreeMap<String, serde_yaml::Value>,
}

impl ViewSpec {
    /// A scalar option as text, `None` when absent or blank.
    pub fn option(&self, key: &str) -> Option<String> {
        let v = self.options.get(key)?;
        let s = match v {
            serde_yaml::Value::String(s) => s.clone(),
            serde_yaml::Value::Number(n) => n.to_string(),
            serde_yaml::Value::Bool(b) => b.to_string(),
            _ => return None,
        };
        let s = s.trim().to_string();
        if s.is_empty() { None } else { Some(s) }
    }
}

pub(crate) fn parse_sort(entry: &str) -> Sort {
    let mut it = entry.split_whitespace();
    let field = it.next().unwrap_or("").to_string();
    let desc = it.next().map(|d| d.eq_ignore_ascii_case("desc")).unwrap_or(false);
    Sort { field, desc }
}

/// Resolve a spec `source:` string to a concrete in-memory table.
pub(crate) fn resolve_source(root: &Path, source: &str) -> Result<Table> {
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

// ── Resolved view: the display-ready table every surface returns ──────────────

#[derive(Debug, Clone, serde::Serialize)]
pub struct ResolvedColumn {
    pub key: String,
    pub ty: String,
    /// Typed-property schema for this column (select options + colours), when
    /// the source's schema declares one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub schema: Option<crate::schema::PropertyDef>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ResolvedRow {
    pub id: String,
    pub cells: BTreeMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedTable {
    pub name: String,
    pub columns: Vec<ResolvedColumn>,
    /// Every field the source offers before column projection — for the
    /// toolbar's hidden-column, sort and filter pickers.
    pub all_columns: Vec<String>,
    pub rows: Vec<ResolvedRow>,
    /// The spec's `summary:` functions evaluated over `rows` — field → value.
    /// Absent when the spec asks for none.
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    pub summary: BTreeMap<String, serde_json::Value>,
}

/// Column type label for a schema-only property (one with no row values yet).
fn prop_ty(ty: crate::schema::PropType) -> &'static str {
    use crate::schema::PropType;
    match ty {
        PropType::Number => "number",
        PropType::Date => "date",
        PropType::Checkbox => "bool",
        PropType::MultiSelect | PropType::Relation => "list",
        _ => "text",
    }
}

/// Run a view and dress it for display: `@me` resolved, the schema attached
/// per column (person options from the roster, relation options from the
/// linked collection), rollups computed, schema-only properties surfaced as
/// empty columns, `$body` hidden. The app's table, the CLI and MCP all go
/// through here, so they cannot drift.
pub fn resolve_view(root: &Path, spec_yaml: &str) -> Result<ResolvedTable> {
    let spec_text = crate::members::resolve_me(spec_yaml, root);
    let spec: ViewSpec = serde_yaml::from_str(&spec_text)?;
    let all_columns = source_columns(root, &spec.source).ok().unwrap_or_default();
    let members = crate::members::load(root);
    let schema = crate::schema::schema_key(&format!("{}/_.md", spec.source.trim_end_matches('/')), None)
        .and_then(|key| crate::schema::load(root, &key).ok().flatten())
        .map(|mut s| {
            crate::members::fill_person_options(&mut s, &members);
            fill_relation_options(root, &mut s);
            s
        });
    // Computed columns first, then the query — so a view may filter or sort
    // on a rollup or a formula (`progress < 100`, `sort: [days_left]`).
    let mut table = resolve_source(root, &spec.source)?;
    if let Some(s) = &schema {
        apply_rollups(root, &mut table, s);
        apply_formulas(&mut table, s);
    }
    let query = Query {
        filter: match &spec.filter { Some(f) if !f.trim().is_empty() => Some(parse_filter(f)?), _ => None },
        sort: spec.sort.clone().unwrap_or_default().iter().map(|s| parse_sort(s)).collect(),
        columns: spec.columns.clone(),
        limit: spec.limit,
        option_order: option_order(schema.as_ref()),
    };
    let table = query.apply(&table);
    let summary = summarize_table(&table, &spec.summary).into_iter().map(|(k, v)| (k, v.to_json())).collect();
    let all_columns = if all_columns.is_empty() { table.columns.iter().map(|c| c.key.clone()).collect() } else {
        // Computed properties are fields too, for the toolbar's pickers.
        let mut all = all_columns;
        if let Some(s) = &schema { for p in &s.properties { if !all.contains(&p.name) { all.push(p.name.clone()); } } }
        all
    };
    let mut columns: Vec<ResolvedColumn> = table.columns.into_iter()
        .filter(|c| c.key != "$body")
        .map(|c| ResolvedColumn { schema: schema.as_ref().and_then(|s| s.property(&c.key)).cloned(), key: c.key, ty: c.ty.as_str().to_string() })
        .collect();
    if spec.columns.as_ref().map_or(true, |c| c.is_empty()) {
        if let Some(s) = &schema {
            for p in &s.properties {
                if p.name != "$body" && !columns.iter().any(|c| c.key == p.name) {
                    columns.push(ResolvedColumn { key: p.name.clone(), ty: prop_ty(p.ty).to_string(), schema: Some(p.clone()) });
                }
            }
        }
    }
    Ok(ResolvedTable {
        name: table.name,
        all_columns,
        columns,
        rows: table.rows.into_iter().map(|r| ResolvedRow { id: r.id, cells: r.cells.into_iter().map(|(k, v)| (k, v.to_json())).collect() }).collect(),
        summary,
    })
}

/// The functions a view's `summary:` (and a schema's rollup) may name.
pub const SUMMARY_FUNCTIONS: &[&str] = &["count", "sum", "avg", "min", "max", "percent_checked", "empty", "not_empty"];

/// One summary value over a set of rows: the same arithmetic a rollup uses, so
/// a table's footer, `cortex view --summary` and MCP `run_view` agree. An
/// unknown function yields `Null` rather than an error, like a rollup.
pub fn summarize(rows: &[Row], field: &str, func: &str) -> CellValue {
    let refs: Vec<&Row> = rows.iter().collect();
    rollup_value(&refs, field, func.trim())
}

/// Evaluate a spec's `summary:` map over a table's rows, field → value.
pub fn summarize_table(table: &Table, summary: &BTreeMap<String, String>) -> BTreeMap<String, CellValue> {
    summary.iter()
        .filter(|(_, func)| !func.trim().is_empty())
        .map(|(field, func)| (field.clone(), summarize(&table.rows, field, func)))
        .collect()
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
    let schema = schema_for_source(root, &spec.source);

    let query = Query {
        filter: match spec.filter {
            Some(f) if !f.trim().is_empty() => Some(parse_filter(&f)?),
            _ => None,
        },
        sort: spec.sort.unwrap_or_default().iter().map(|s| parse_sort(s)).collect(),
        columns: spec.columns,
        limit: spec.limit,
        option_order: option_order(schema.as_ref()),
    };

    Ok(query.apply(&table))
}

// ── Structured spec ⇄ YAML (the GUI filter/sort/group builder talks to this) ──
//
// The YAML spec stays the on-disk source of truth. The toolbar edits this
// structured form and serializes it straight back, so a view authored in the
// UI is byte-identical to one hand-written, and a hand-written one round-trips
// without surprises. The structured form is a list of clauses under one
// connector, where a clause may instead be one parenthesised group of plain
// clauses with its own connector — `a and (b or c)`. Anything else (mixed
// `and`/`or` without parentheses, nested groups, `not`) is flagged
// `filter_complex` and kept verbatim — the UI then defers to raw editing
// rather than mangling it.

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct FilterClause {
    pub field: String,
    /// One of `Op::as_str` or `in`; `value` is the list joined by `, ` for
    /// `in` and empty for `is_empty` / `is_not_empty`.
    pub op: String,
    pub value: String,
    /// A parenthesised group: its own clauses and connector; `field`, `op`
    /// and `value` are then unused.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub clauses: Vec<FilterClause>,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub join: String,
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
    /// Table summary row, field → function (see `ViewSpec::summary`).
    #[serde(default)]
    pub summary: BTreeMap<String, String>,
    /// View-type options (`x`, `chartType`, `log`, `range`, …) exactly as
    /// written; the toolbar edits none of them and carries them all through.
    #[serde(flatten, default)]
    pub options: BTreeMap<String, String>,
}

/// Flatten a filter string into clauses joined by a single connector, where a
/// clause may be one parenthesised group of plain clauses. `None` when it
/// mixes `and`/`or` at one level, nests groups, uses `not`, or isn't a clean
/// `field op value …` chain.
pub(crate) fn flatten_filter(filter: &str) -> Option<(Vec<FilterClause>, String)> {
    let tokens = tokenize(filter);
    if tokens.is_empty() {
        return Some((vec![], "and".into()));
    }
    let mut pos = 0;
    let (clauses, join) = flatten_chain(&tokens, &mut pos, true)?;
    if pos != tokens.len() {
        return None;
    }
    Some((clauses, join))
}

/// `item (conn item)*` with one connector; items are clauses, or — at the top
/// level only — parenthesised chains of clauses.
fn flatten_chain(tokens: &[String], pos: &mut usize, top: bool) -> Option<(Vec<FilterClause>, String)> {
    let mut clauses = Vec::new();
    let mut join: Option<String> = None;
    loop {
        let tok = tokens.get(*pos)?;
        if tok == "(" {
            if !top { return None; }
            *pos += 1;
            let (inner, inner_join) = flatten_chain(tokens, pos, false)?;
            if tokens.get(*pos)? != ")" { return None; }
            *pos += 1;
            clauses.push(FilterClause { clauses: inner, join: inner_join, ..Default::default() });
        } else {
            if is_word(tok, "not") { return None; }
            let c = parse_clause(tokens, pos).ok()?;
            clauses.push(FilterClause {
                field: c.field,
                op: c.op.map(|o| o.as_str().to_string()).unwrap_or_else(|| "in".into()),
                value: c.values.join(", "),
                ..Default::default()
            });
        }
        match tokens.get(*pos) {
            None => break,
            Some(t) if t == ")" => break,
            Some(conn) => {
                let conn = conn.to_lowercase();
                if is_literal(conn.as_str()) || (conn != "and" && conn != "or") {
                    return None;
                }
                match &join {
                    Some(j) if *j != conn => return None, // mixed → complex
                    _ => join = Some(conn),
                }
                *pos += 1;
            }
        }
    }
    Some((clauses, join.unwrap_or_else(|| "and".into())))
}

/// String values get quoted; bare numbers/bools and relative dates don't —
/// matching the spec style the engine already parses (`status == 'reading'`,
/// `rating > 3`, `due <= @today`, `due within 7d`).
pub(crate) fn build_filter(clauses: &[FilterClause], join: &str) -> String {
    let literal = |v: &str| {
        let v = v.trim();
        let bare = v.parse::<f64>().is_ok()
            || matches!(v.to_ascii_lowercase().as_str(), "true" | "false")
            || v.starts_with('@')
            || is_within_spec(v);
        if bare { v.to_string() } else { format!("'{}'", v.replace('\'', "")) }
    };
    let render = |c: &FilterClause| {
        if !c.clauses.is_empty() {
            let join = if c.join.is_empty() { "and" } else { &c.join };
            return format!("({})", build_filter(&c.clauses, join));
        }
        match c.op.as_str() {
            "in" => format!("{} in [{}]", c.field, c.value.split(',').map(literal).collect::<Vec<_>>().join(", ")),
            "is_empty" | "is_not_empty" => format!("{} {}", c.field, c.op),
            _ => format!("{} {} {}", c.field, c.op, literal(&c.value)),
        }
    };
    clauses.iter().map(render).collect::<Vec<_>>().join(&format!(" {join} "))
}

fn is_within_spec(v: &str) -> bool {
    within_bounds(v, chrono::NaiveDate::from_ymd_opt(2000, 1, 3).unwrap()).is_some()
}

/// Parse a YAML view spec into its structured (UI-editable) form.
pub fn parse_view_spec(spec_yaml: &str) -> Result<StructuredSpec> {
    let vs: ViewSpec = serde_yaml::from_str(spec_yaml)?;
    let options: BTreeMap<String, String> = vs.options.keys().filter_map(|k| vs.option(k).map(|v| (k.clone(), v))).collect();
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
        summary: vs.summary,
        options,
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
    // Flow style keeps the summary on one line, like `sort` and `columns`.
    let summary: Vec<String> = s.summary.iter()
        .filter(|(_, f)| !f.trim().is_empty())
        .map(|(k, f)| format!("{k}: {}", f.trim()))
        .collect();
    if !summary.is_empty() {
        out.push_str(&format!("summary: {{{}}}\n", summary.join(", ")));
    }
    // Options in a fixed order: the well-known ones first, the rest alphabetically.
    let known = ["x", "y", "agg", "chartType", "bucket", "series", "log", "done", "range"];
    let mut keys: Vec<&String> = s.options.keys().collect();
    keys.sort_by_key(|k| (known.iter().position(|w| w == k).unwrap_or(known.len()), k.as_str()));
    for k in keys {
        if let Some(v) = s.options.get(k).map(|v| v.trim()).filter(|v| !v.is_empty()) {
            out.push_str(&format!("{k}: {v}\n"));
        }
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
    Ok(set_cell_effects(root, source, row_id, field, value, ty)?.into_iter().next())
}

/// `set_cell`, returning every file it touched: the row, and — when a date
/// property is auto-stamped or the row repeats — the same row again or the
/// next occurrence. Callers re-index all of them.
pub fn set_cell_effects(root: &Path, source: &str, row_id: &str, field: &str, value: &str, ty: &str) -> Result<Vec<std::path::PathBuf>> {
    if field == "id" || field == "$body" {
        return Err(AppError::Other(format!("Field '{field}' is not editable")));
    }
    if row_id.contains('/') || row_id.contains("..") {
        return Err(AppError::Other("Invalid row id".into()));
    }

    if let Some(name) = source.strip_prefix("collections/") {
        let name = name.trim_end_matches('/');
        let dir = root.join("collections").join(name);
        let path = dir.join(format!("{row_id}.md"));
        let content = std::fs::read_to_string(&path)
            .map_err(|_| AppError::Other(format!("Row not found: {row_id}")))?;
        let mut note = crate::note::parse_note(row_id, &content)?;
        note.frontmatter.insert(field.to_string(), coerce(value, ty));
        let schema = crate::schema::load(root, name).ok().flatten();
        let mut written = vec![path.clone()];
        stamp_auto_dates(&mut note, schema.as_ref());
        let finished = is_finishing_edit(&note, field, schema.as_ref());
        if finished {
            if let Some(extra) = recur(&dir, row_id, &mut note, schema.as_ref(), field)? { written.push(extra); }
        }
        std::fs::write(&path, crate::note::serialize_note(&note)?)?;
        Ok(written)
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
        Ok(vec![])
    } else {
        Err(AppError::Other(format!("Unknown source '{source}'")))
    }
}

/// What follows any edit to a collection row, however it was made — the
/// app's cell editor, `cortex set`, an MCP `set_properties`: auto-stamped
/// dates, and the next occurrence of a repeating row. `changed` names the
/// frontmatter keys the edit touched. Returns every file written.
pub fn apply_row_effects(root: &Path, rel_path: &str, changed: &[String]) -> Result<Vec<std::path::PathBuf>> {
    let rel = rel_path.trim_start_matches("./");
    let Some(rest) = rel.strip_prefix("collections/") else { return Ok(vec![]) };
    let Some((name, file)) = rest.split_once('/') else { return Ok(vec![]) };
    let row_id = file.trim_end_matches(".md");
    if row_id.starts_with('_') || row_id.contains('/') { return Ok(vec![]); }
    let dir = root.join("collections").join(name);
    let path = dir.join(format!("{row_id}.md"));
    let content = std::fs::read_to_string(&path)?;
    let mut note = crate::note::parse_note(row_id, &content)?;
    let schema = crate::schema::load(root, name).ok().flatten();
    let before = note.frontmatter.clone();
    stamp_auto_dates(&mut note, schema.as_ref());
    let mut written = Vec::new();
    if let Some(trigger) = changed.iter().find(|f| is_finishing_edit(&note, f, schema.as_ref())) {
        if let Some(extra) = recur(&dir, row_id, &mut note, schema.as_ref(), trigger)? { written.push(extra); }
    }
    if note.frontmatter != before {
        std::fs::write(&path, crate::note::serialize_note(&note)?)?;
        written.insert(0, path);
    }
    Ok(written)
}

/// A note's frontmatter as a row, for evaluating filters against it.
fn note_as_row(note: &crate::note::Note) -> Row {
    Row { id: note.path.trim_end_matches(".md").rsplit('/').next().unwrap_or("").to_string(), cells: note.frontmatter.iter().map(|(k, v)| (k.clone(), json_to_cell(v))).collect() }
}

/// Date properties with `auto: <condition>` get today's date when the
/// condition holds and they are empty — `completed` when status becomes done.
fn stamp_auto_dates(note: &mut crate::note::Note, schema: Option<&crate::schema::TypeSchema>) {
    let Some(s) = schema else { return };
    let today = crate::placeholders::today().format("%Y-%m-%d").to_string();
    for p in &s.properties {
        if p.ty != crate::schema::PropType::Date { continue; }
        let Some(cond) = p.auto.as_deref().filter(|c| !c.trim().is_empty()) else { continue };
        let Ok(c) = parse_filter(cond) else { continue };
        let holds = c.eval(&note_as_row(note));
        let empty = note.frontmatter.get(&p.name).map(|v| v.is_null() || v.as_str().map(|s| s.is_empty()).unwrap_or(false)).unwrap_or(true);
        if holds && empty {
            note.frontmatter.insert(p.name.clone(), serde_json::Value::String(today.clone()));
        }
    }
}

/// Did this edit finish the row? A checkbox now true, or a status/select set
/// to its schema's last option or to a word that means done.
fn is_finishing_edit(note: &crate::note::Note, field: &str, schema: Option<&crate::schema::TypeSchema>) -> bool {
    match note.frontmatter.get(field) {
        Some(serde_json::Value::Bool(b)) => *b && (crate::recurrence::is_done_word(field) || field == "done"),
        Some(serde_json::Value::String(v)) => {
            let last = schema.and_then(|s| s.property(field)).filter(|p| matches!(p.ty, crate::schema::PropType::Status | crate::schema::PropType::Select))
                .and_then(|p| p.options.last().map(|o| o.name.clone()));
            last.as_deref() == Some(v.as_str()) || crate::recurrence::is_done_word(v)
        }
        _ => false,
    }
}

/// A finished row that `repeat`s: advance every date by the interval and
/// either write the next occurrence as a new row (default) or move this row
/// forward (`repeat_mode: advance`). The trigger and auto-stamped dates are
/// reset on the occurrence that continues. Returns the new row's path.
fn recur(dir: &Path, row_id: &str, note: &mut crate::note::Note, schema: Option<&crate::schema::TypeSchema>, trigger: &str) -> Result<Option<std::path::PathBuf>> {
    let Some(rule) = note.frontmatter.get("repeat").and_then(|v| v.as_str()) else { return Ok(None) };
    let Some(interval) = crate::recurrence::parse(rule) else { return Ok(None) };
    let advance_in_place = note.frontmatter.get("repeat_mode").and_then(|v| v.as_str()) == Some("advance");
    let auto_dates: Vec<String> = schema.map(|s| s.properties.iter().filter(|p| p.auto.is_some()).map(|p| p.name.clone()).collect()).unwrap_or_default();

    let mut next = note.frontmatter.clone();
    let mut primary: Option<String> = None;
    for (k, v) in note.frontmatter.iter() {
        if k == "created" || auto_dates.contains(k) { continue; }
        if let Some(s) = v.as_str() {
            if looks_like_date(s) {
                let shifted = crate::recurrence::shift_text(s, interval);
                // The date that names the next occurrence: due/date/next_due/scheduled when present, else the first date seen.
                let preferred = ["due", "date", "next_due", "scheduled"].contains(&k.as_str());
                if primary.is_none() || preferred { primary = Some(shifted.clone()); }
                next.insert(k.clone(), serde_json::Value::String(shifted));
            }
        }
    }
    // Reset the trigger only — the field whose edit finished the row: a
    // checkbox → false, a status → its first option (or `todo`). Every other
    // select keeps its value; an `area: admin` must not become `area: work`
    // because admin happens to be last in its list.
    match note.frontmatter.get(trigger) {
        Some(serde_json::Value::Bool(true)) => { next.insert(trigger.to_string(), serde_json::Value::Bool(false)); }
        Some(serde_json::Value::String(_)) => {
            let first = schema.and_then(|sc| sc.property(trigger)).and_then(|p| p.options.first().map(|o| o.name.clone())).unwrap_or_else(|| "todo".into());
            next.insert(trigger.to_string(), serde_json::Value::String(first));
        }
        _ => {}
    }
    for k in &auto_dates { next.remove(k); }

    if advance_in_place {
        note.frontmatter = next;
        return Ok(None);
    }
    let today = crate::placeholders::today().format("%Y-%m-%d").to_string();
    next.insert("created".into(), serde_json::Value::String(today));
    let stem = regex_strip_date(row_id);
    let mut id = format!("{stem}-{}", primary.as_deref().unwrap_or("next"));
    let mut n = 2;
    while dir.join(format!("{id}.md")).exists() { id = format!("{stem}-{}-{n}", primary.as_deref().unwrap_or("next")); n += 1; }
    let path = dir.join(format!("{id}.md"));
    let new_note = crate::note::Note { path: format!("{id}.md"), frontmatter: next, body: note.body.clone() };
    std::fs::write(&path, crate::note::serialize_note(&new_note)?)?;
    Ok(Some(path))
}

/// `pay-rent-2026-09-01` → `pay-rent`; `row-abc` → `row-abc`.
fn regex_strip_date(id: &str) -> String {
    let b = id.as_bytes();
    if b.len() > 11 && b[b.len() - 11] == b'-' && looks_like_date(&id[b.len() - 10..]) { id[..b.len() - 11].to_string() }
    else if looks_like_date(id) { "row".to_string() }
    else { id.to_string() }
}

/// Seeds arrive as strings from the UI. Keep booleans, numbers and lists typed
/// so a new row's frontmatter matches its schema (`done: false`, `done: []`,
/// not `done: "false"`); dates, select values and free text stay strings.
pub(crate) fn typed_seed(v: &str) -> serde_json::Value {
    let t = v.trim();
    if t.is_empty() || looks_like_date(t) {
        return serde_json::Value::String(v.to_string());
    }
    match serde_yaml::from_str::<serde_json::Value>(t) {
        Ok(serde_json::Value::Bool(b)) => serde_json::Value::Bool(b),
        Ok(serde_json::Value::Number(n)) => serde_json::Value::Number(n),
        Ok(serde_json::Value::Array(a)) if a.iter().all(|x| x.is_string()) => serde_json::Value::Array(a),
        _ => serde_json::Value::String(v.to_string()),
    }
}

/// Expand `{{date}}`, `{{time}}`, `{{title}}` and `{{uuid}}` — the same
/// placeholders note templates use — in a row template's text.
pub fn expand_placeholders(text: &str, vars: &BTreeMap<&str, String>) -> String {
    let mut out = text.to_string();
    for (k, v) in vars {
        out = out.replace(&format!("{{{{{k}}}}}"), v);
    }
    out
}

/// The placeholder values for a new row: `date` is its `created` (the log day
/// for a tracker, today otherwise), `title` its title.
pub(crate) fn row_vars(fields: &BTreeMap<String, String>) -> BTreeMap<&'static str, String> {
    let now = chrono::Local::now();
    let date = fields.get("created").cloned().filter(|d| !d.is_empty()).unwrap_or_else(|| now.format("%Y-%m-%d").to_string());
    let title = fields.get("title").cloned().filter(|t| !t.is_empty()).unwrap_or_else(|| date.clone());
    // No uuid crate in core: a time-and-salt hash in the 8-4-4-4-12 shape is unique enough for a note id.
    let digest = {
        use sha2::Digest;
        let mut h = sha2::Sha256::new();
        h.update(now.timestamp_nanos_opt().unwrap_or_default().to_le_bytes());
        h.update(title.as_bytes());
        hex::encode(h.finalize())
    };
    let uuid = format!("{}-{}-{}-{}-{}", &digest[0..8], &digest[8..12], &digest[12..16], &digest[16..20], &digest[20..32]);
    BTreeMap::from([("date", date), ("time", now.format("%H:%M").to_string()), ("title", title), ("uuid", uuid)])
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
                fm.insert(k.clone(), typed_seed(v));
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

/// Duplicate a row: the same frontmatter and body under a new id, `created`
/// set to the given day (today, from the caller) and the title marked "copy"
/// so the two stay distinguishable — relations resolve by title. CSV rows are
/// copied as a record with the new id. Returns the new note path for
/// collections (to re-index) or `None` for CSV.
pub fn duplicate_row(root: &Path, source: &str, row_id: &str, new_id: &str, created: &str) -> Result<Option<std::path::PathBuf>> {
    for id in [row_id, new_id] {
        if id.is_empty() || id.contains('/') || id.contains("..") {
            return Err(AppError::Other("Invalid row id".into()));
        }
    }
    if let Some(name) = source.strip_prefix("collections/") {
        let name = name.trim_end_matches('/');
        let dir = root.join("collections").join(name);
        let content = std::fs::read_to_string(dir.join(format!("{row_id}.md")))
            .map_err(|_| AppError::Other(format!("Row not found: {row_id}")))?;
        let path = dir.join(format!("{new_id}.md"));
        if path.exists() {
            return Err(AppError::Other(format!("Row already exists: {new_id}")));
        }
        let mut note = crate::note::parse_note(&format!("collections/{name}/{new_id}.md"), &content)?;
        if let Some(t) = note.frontmatter.get("title").and_then(|v| v.as_str()).map(String::from) {
            note.frontmatter.insert("title".into(), serde_json::Value::String(format!("{t} copy")));
        }
        note.frontmatter.insert("created".into(), serde_json::Value::String(created.to_string()));
        std::fs::write(&path, crate::note::serialize_note(&note)?)?;
        Ok(Some(path))
    } else if let Some(rest) = source.strip_prefix("data/") {
        let path = root.join("data").join(format!("{}.csv", rest.trim_end_matches(".csv")));
        let (header, mut records) = read_csv_raw(&path)?;
        let id_idx = header.iter().position(|h| h == "id")
            .ok_or_else(|| AppError::Other("CSV has no id column to duplicate by".into()))?;
        if records.iter().any(|r| r.get(id_idx).map(String::as_str) == Some(new_id)) {
            return Err(AppError::Other(format!("Row already exists: {new_id}")));
        }
        let mut rec = records.iter().find(|r| r.get(id_idx).map(String::as_str) == Some(row_id))
            .cloned()
            .ok_or_else(|| AppError::Other(format!("Row not found: {row_id}")))?;
        rec[id_idx] = new_id.to_string();
        records.push(rec);
        write_csv_raw(&path, &header, records, Some(id_idx))?;
        Ok(None)
    } else {
        Err(AppError::Other(format!("Unknown source '{source}'")))
    }
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
    let vars = row_vars(fields);
    let base = chrono::NaiveDate::parse_from_str(&vars["date"], "%Y-%m-%d").unwrap_or_else(|_| crate::placeholders::today());
    let content = crate::placeholders::expand(&expand_placeholders(&content, &vars), base);
    let tpl = crate::note::parse_note(&format!("_template-{template}.md"), &content)?;

    let path = dir.join(format!("{id}.md"));
    if path.exists() {
        return Err(AppError::Other(format!("Row already exists: {id}")));
    }

    let mut fm = tpl.frontmatter.clone();
    // A template that names its own title (e.g. `title: "{{date}}"` in a log)
    // keeps it; otherwise the row is Untitled until the user renames it.
    let tpl_title = fm.get("title").and_then(|v| v.as_str()).filter(|t| !t.is_empty() && !t.contains("{{")).map(String::from);
    fm.insert("title".into(), serde_json::Value::String(
        fields.get("title").cloned().filter(|t| t != "Untitled" || tpl_title.is_none()).or(tpl_title).unwrap_or_else(|| "Untitled".into())));
    if let Some(c) = fields.get("created") {
        fm.insert("created".into(), serde_json::Value::String(c.clone()));
    }
    for (k, v) in fields {
        if !matches!(k.as_str(), "title" | "created") {
            fm.insert(k.clone(), typed_seed(v));
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

/// The row template a collection uses by default: `_template-<collection>.md`
/// (what a pack installs), else the only template there is, else none.
pub fn default_row_template(root: &Path, source: &str) -> Option<String> {
    let (name, _) = collection_dir(root, source).ok()?;
    let all = list_row_templates(root, source).ok()?;
    if all.iter().any(|t| *t == name) { return Some(name); }
    if all.len() == 1 { return all.into_iter().next(); }
    None
}

/// The path of row `id`, creating it first when it does not exist — from the
/// collection's default row template if there is one, else a blank row. This is
/// how a tracker's log day comes into being on the first tick, and how
/// `cortex set collections/habit-log/2026-09-08 done+=Exercise` works on a day
/// that has no file yet.
pub fn ensure_row(root: &Path, source: &str, id: &str, fields: &BTreeMap<String, String>) -> Result<std::path::PathBuf> {
    let (_, dir) = collection_dir(root, source)?;
    let path = dir.join(format!("{id}.md"));
    if path.exists() { return Ok(path); }
    let written = match default_row_template(root, source) {
        Some(t) => add_row_from_template(root, source, id, &t, fields)?,
        None => add_row(root, source, id, fields)?,
    };
    Ok(written.unwrap_or(path))
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

/// An empty cell: missing, null, blank text, or an empty list.
fn cell_is_empty(v: Option<&CellValue>) -> bool {
    match v {
        None | Some(CellValue::Null) => true,
        Some(CellValue::Text(t)) | Some(CellValue::Date(t)) => t.trim().is_empty(),
        Some(CellValue::List(items)) => items.is_empty(),
        _ => false,
    }
}

fn cell_is_checked(v: Option<&CellValue>) -> bool {
    match v {
        Some(CellValue::Bool(b)) => *b,
        Some(CellValue::Text(t)) => t.eq_ignore_ascii_case("true"),
        _ => false,
    }
}

fn rollup_value(rows: &[&Row], prop: &str, func: &str) -> CellValue {
    match func {
        "count" => CellValue::Num(rows.len() as f64),
        "empty" => CellValue::Num(rows.iter().filter(|r| cell_is_empty(r.cells.get(prop))).count() as f64),
        "not_empty" => CellValue::Num(rows.iter().filter(|r| !cell_is_empty(r.cells.get(prop))).count() as f64),
        // Share of rows ticked, 0–100 like a rollup `percent`; unset counts as unticked.
        "percent_checked" => {
            if rows.is_empty() { return CellValue::Null; }
            let checked = rows.iter().filter(|r| cell_is_checked(r.cells.get(prop))).count();
            CellValue::Num((100.0 * checked as f64 / rows.len() as f64).round())
        }
        "values" => CellValue::List(
            rows.iter().filter_map(|r| r.cells.get(prop).map(CellValue::as_text)).filter(|s| !s.is_empty()).collect(),
        ),
        "sum" | "avg" | "min" | "max" => {
            let nums: Vec<f64> = rows.iter().filter_map(|r| r.cells.get(prop).and_then(CellValue::as_num)).collect();
            if nums.is_empty() {
                // Dates and other text still have a min and a max (ISO dates sort as text).
                if matches!(func, "min" | "max") {
                    let mut texts: Vec<String> = rows.iter().filter_map(|r| r.cells.get(prop).map(CellValue::as_text)).filter(|s| !s.is_empty()).collect();
                    texts.sort();
                    return match if func == "min" { texts.first() } else { texts.last() } {
                        Some(t) => if looks_like_date(t) { CellValue::Date(t.clone()) } else { CellValue::Text(t.clone()) },
                        None => CellValue::Null,
                    };
                }
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
    use crate::schema::PropType;
    // Reverse side first: rows of `from` whose `relation` names this row.
    for p in &schema.properties {
        let (Some(from), Some(rel_name)) = (p.from.clone(), p.relation.clone()) else { continue };
        if !matches!(p.ty, PropType::Rollup | PropType::Relation) { continue; }
        let Ok(children) = read_collection(root, &from) else { continue };
        let filter = p.where_.as_deref().filter(|w| !w.trim().is_empty()).and_then(|w| parse_filter(w).ok());
        let func = p.function.clone().unwrap_or_else(|| "count".into());
        let target_prop = p.property.clone().unwrap_or_default();
        for row in &mut table.rows {
            let title = row.cells.get("title").map(CellValue::as_text).unwrap_or_default();
            let mine: Vec<&Row> = children.rows.iter().filter(|c| match c.cells.get(&rel_name) {
                Some(CellValue::List(items)) => items.iter().any(|i| *i == title || *i == row.id),
                Some(other) => { let t = other.as_text(); t == title || t == row.id }
                None => false,
            }).collect();
            let value = if p.ty == PropType::Relation {
                CellValue::List(mine.iter().filter_map(|c| c.cells.get("title").map(CellValue::as_text)).filter(|s| !s.is_empty()).collect())
            } else if func == "percent" {
                let matching = mine.iter().filter(|c| filter.as_ref().map(|f| f.eval(c)).unwrap_or(true)).count();
                if mine.is_empty() { CellValue::Null } else { CellValue::Num((100.0 * matching as f64 / mine.len() as f64).round()) }
            } else {
                let kept: Vec<&Row> = mine.into_iter().filter(|c| filter.as_ref().map(|f| f.eval(c)).unwrap_or(true)).collect();
                rollup_value(&kept, &target_prop, &func)
            };
            row.cells.insert(p.name.clone(), value);
        }
    }
    for p in &schema.properties {
        if p.ty != PropType::Rollup || p.from.is_some() {
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

/// Compute every formula property from the row's own cells — after rollups,
/// so a formula may use a rollup. A formula that does not parse yields nothing
/// rather than failing the view; `cortex packs lint` reports it.
pub fn apply_formulas(table: &mut Table, schema: &crate::schema::TypeSchema) {
    let today = crate::placeholders::today();
    let formulas: Vec<(String, crate::formula::Formula)> = schema.properties.iter()
        .filter(|p| p.ty == crate::schema::PropType::Formula)
        .filter_map(|p| p.expr.as_deref().and_then(|e| crate::formula::Formula::parse(e).ok()).map(|f| (p.name.clone(), f)))
        .collect();
    if formulas.is_empty() { return; }
    for row in &mut table.rows {
        for (name, f) in &formulas {
            let v = f.eval(&row.cells, today).to_cell();
            row.cells.insert(name.clone(), v);
        }
    }
    // A computed column that no row had before now needs a type.
    for (name, _) in &formulas {
        if !table.columns.iter().any(|c| &c.key == name) {
            let ty = table.rows.iter().find_map(|r| r.cells.get(name)).map(col_type).unwrap_or(ColumnType::Text);
            table.columns.push(Column { key: name.clone(), ty });
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
pub struct ChartSeries {
    pub name: String,
    pub points: Vec<ChartPoint>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChartResult {
    pub chart_type: String,
    pub x_label: String,
    pub y_label: String,
    pub points: Vec<ChartPoint>,
    /// Per-value series when the spec sets `series:`; empty otherwise (then
    /// `points` is the one series; with series, `points` is their sum per x).
    #[serde(default)]
    pub series: Vec<ChartSeries>,
}

#[derive(Default)]
struct Acc {
    vals: Vec<f64>,
    rows: usize,
}

/// Fold an ISO date into its `day | week | month | year` bucket: the week is
/// its Monday, so buckets stay sortable dates. Non-dates pass through.
pub(crate) fn bucket_key(value: &str, bucket: &str) -> String {
    let Ok(d) = chrono::NaiveDate::parse_from_str(&value[..value.len().min(10)], "%Y-%m-%d") else { return value.to_string() };
    match bucket {
        "week" => {
            use chrono::Datelike;
            (d - chrono::Duration::days(d.weekday().num_days_from_monday() as i64)).format("%Y-%m-%d").to_string()
        }
        "month" => d.format("%Y-%m").to_string(),
        "year" => d.format("%Y").to_string(),
        _ => d.format("%Y-%m-%d").to_string(),
    }
}

fn aggregate(table: &Table, x: &str, y: &str, agg: &str, bucket: Option<&str>) -> Result<Vec<ChartPoint>> {
    // BTreeMap keeps groups sorted by x (correct for dates/text; numeric x is
    // lexical — acceptable for Slice 2, revisit with typed x buckets later).
    let mut groups: BTreeMap<String, Acc> = BTreeMap::new();
    for row in &table.rows {
        let raw = row.cells.get(x).map(|c| c.as_text()).unwrap_or_default();
        let xv = match bucket { Some(b) => bucket_key(&raw, b), None => raw };
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

/// Parse a `cortex-chart` spec, resolve + filter its source, and produce
/// `{x, y}` points (aggregated if `agg` is set; bucketed by `bucket`; one
/// series per distinct `series` value when that is set).
pub fn run_chart(root: &Path, spec_yaml: &str) -> Result<ChartResult> {
    let spec: ViewSpec = serde_yaml::from_str(spec_yaml)?;
    let table = resolve_source(root, &spec.source)?;

    let x = spec.option("x").ok_or_else(|| AppError::Other("Chart requires an `x` field".into()))?;
    let y = spec.option("y").ok_or_else(|| AppError::Other("Chart requires a `y` field".into()))?;
    let chart_type = spec.option("chartType").unwrap_or_else(|| "line".into());
    let agg = spec.option("agg");
    let bucket_opt = spec.option("bucket").filter(|b| b != "none");
    let bucket = bucket_opt.as_deref();
    let series_field = spec.option("series");

    // Apply filter (and any sort) first.
    let schema = schema_for_source(root, &spec.source);
    let orders = option_order(schema.as_ref());
    let query = Query {
        filter: match &spec.filter {
            Some(f) if !f.trim().is_empty() => Some(parse_filter(f)?),
            _ => None,
        },
        sort: spec.sort.clone().unwrap_or_default().iter().map(|s| parse_sort(s)).collect(),
        columns: None,
        limit: None,
        option_order: orders.clone(),
    };
    let filtered = query.apply(&table);
    let x_order = orders.get(&x).cloned();

    let series_of = |t: &Table| -> Result<Vec<ChartPoint>> {
        let mut points = match &agg {
            Some(agg) => aggregate(t, &x, &y, agg, bucket)?,
            _ => t.rows.iter().filter_map(|r| {
                let yv = r.cells.get(&y).and_then(|c| c.as_num())?;
                let raw = r.cells.get(&x).map(|c| c.as_text()).unwrap_or_default();
                Some(ChartPoint { x: match bucket { Some(b) => bucket_key(&raw, b), None => raw }, y: yv })
            }).collect(),
        };
        // Order points along x: a select's option order when it has one, else
        // numeric when possible, else lexical.
        points.sort_by(|a, b| match &x_order {
            Some(opts) => {
                let rank = |v: &str| opts.iter().position(|o| o == v).unwrap_or(opts.len());
                rank(&a.x).cmp(&rank(&b.x)).then_with(|| a.x.cmp(&b.x))
            }
            None => match (a.x.parse::<f64>(), b.x.parse::<f64>()) {
                (Ok(p), Ok(q)) => p.partial_cmp(&q).unwrap_or(std::cmp::Ordering::Equal),
                _ => a.x.cmp(&b.x),
            },
        });
        Ok(points)
    };

    let series: Vec<ChartSeries> = match series_field.as_deref() {
        None => vec![],
        Some(field) => {
            let mut by: BTreeMap<String, Vec<Row>> = BTreeMap::new();
            for r in &filtered.rows {
                // A list-valued series field (e.g. a tracker log's `done`) puts the row in every value's series.
                let keys: Vec<String> = match r.cells.get(field) {
                    Some(CellValue::List(items)) => items.clone(),
                    Some(c) => vec![c.as_text()],
                    None => vec![String::new()],
                };
                for k in keys { by.entry(k).or_default().push(r.clone()); }
            }
            let mut out = Vec::new();
            for (name, rows) in by {
                let t = Table { name: filtered.name.clone(), columns: filtered.columns.clone(), rows };
                out.push(ChartSeries { name, points: series_of(&t)? });
            }
            out
        }
    };
    let points = if series.is_empty() { series_of(&filtered)? } else { series.iter().flat_map(|s| s.points.iter().cloned()).fold(BTreeMap::<String, f64>::new(), |mut m, p| { *m.entry(p.x).or_default() += p.y; m }).into_iter().map(|(x, y)| ChartPoint { x, y }).collect() };

    Ok(ChartResult { chart_type, x_label: x, y_label: y, points, series })
}

// ── Tests: the contract — one Query type, two sources ──────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn gap_root(name: &str) -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!("cortex-engine-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join(".cortex/schemas")).unwrap();
        root
    }
    fn put(root: &Path, rel: &str, text: &str) {
        let p = root.join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, text).unwrap();
    }
    fn iso(d: chrono::NaiveDate) -> String { d.format("%Y-%m-%d").to_string() }

    #[test]
    fn relative_dates_in_filters() {
        let root = gap_root("reldates");
        let t = crate::placeholders::today();
        put(&root, "collections/tasks/a.md", &format!("---\ntitle: A\ndue: {}\n---\n", iso(t - chrono::Duration::days(1))));
        put(&root, "collections/tasks/b.md", &format!("---\ntitle: B\ndue: {}\n---\n", iso(t)));
        put(&root, "collections/tasks/c.md", &format!("---\ntitle: C\ndue: {}\n---\n", iso(t + chrono::Duration::days(10))));
        put(&root, "collections/tasks/d.md", "---\ntitle: D\n---\n");
        let names = |spec: &str| -> Vec<String> { run_view(&root, spec).unwrap().rows.iter().map(|r| r.cells["title"].as_text()).collect() };
        assert_eq!(names("source: collections/tasks\nfilter: due <= @today\nsort: [due]\n"), vec!["A", "B"]);
        assert_eq!(names("source: collections/tasks\nfilter: due > @today and due <= @today+14\n"), vec!["C"]);
        assert_eq!(names("source: collections/tasks\nfilter: due < @today\n"), vec!["A"]);
        // Empties sort last in either direction.
        assert_eq!(names("source: collections/tasks\nsort: [due]\n"), vec!["A", "B", "C", "D"]);
        assert_eq!(names("source: collections/tasks\nsort: [due desc]\n"), vec!["C", "B", "A", "D"]);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn selects_sort_by_option_order() {
        let root = gap_root("optorder");
        put(&root, ".cortex/schemas/tasks.yaml", "properties:\n  - name: priority\n    type: select\n    options:\n      - name: high\n      - name: medium\n      - name: low\n");
        put(&root, "collections/tasks/a.md", "---\ntitle: A\npriority: low\n---\n");
        put(&root, "collections/tasks/b.md", "---\ntitle: B\npriority: high\n---\n");
        put(&root, "collections/tasks/c.md", "---\ntitle: C\npriority: medium\n---\n");
        let t = run_view(&root, "source: collections/tasks\nsort: [priority]\n").unwrap();
        let names: Vec<String> = t.rows.iter().map(|r| r.cells["title"].as_text()).collect();
        assert_eq!(names, vec!["B", "C", "A"]);
        // A chart over the select follows the same order.
        let c = run_chart(&root, "source: collections/tasks\ntype: chart\nx: priority\ny: title\nagg: count\n").unwrap();
        assert_eq!(c.points.iter().map(|p| p.x.as_str()).collect::<Vec<_>>(), vec!["high", "medium", "low"]);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn reverse_rollups_relations_and_formulas() {
        let root = gap_root("reverse");
        put(&root, ".cortex/schemas/projects.yaml", "properties:\n  - name: milestones\n    type: relation\n    from: milestones\n    relation: project\n  - name: done_count\n    type: rollup\n    from: milestones\n    relation: project\n    function: count\n    where: done == true\n  - name: progress\n    type: rollup\n    from: milestones\n    relation: project\n    function: percent\n    where: done == true\n  - name: latest\n    type: rollup\n    from: milestones\n    relation: project\n    property: due\n    function: max\n  - name: budget\n    type: number\n  - name: spent\n    type: number\n  - name: remaining\n    type: formula\n    expr: budget - spent\n  - name: label\n    type: formula\n    expr: concat(progress, '% · ', remaining, ' left')\n");
        put(&root, "collections/projects/site.md", "---\ntitle: Site\nbudget: 1000\nspent: 250\n---\n");
        put(&root, "collections/projects/idle.md", "---\ntitle: Idle\n---\n");
        put(&root, "collections/milestones/m1.md", "---\ntitle: Brief\nproject: [Site]\ndone: true\ndue: 2026-09-01\n---\n");
        put(&root, "collections/milestones/m2.md", "---\ntitle: Design\nproject: [Site]\ndone: false\ndue: 2026-10-01\n---\n");
        put(&root, "collections/milestones/m3.md", "---\ntitle: Launch\nproject: Site\ndone: true\ndue: 2026-11-01\n---\n");
        let t = resolve_view(&root, "source: collections/projects\n").unwrap();
        let site = t.rows.iter().find(|r| r.id == "site").unwrap();
        assert_eq!(site.cells["milestones"], serde_json::json!(["Brief", "Design", "Launch"]));
        assert_eq!(site.cells["done_count"], serde_json::json!(2.0));
        assert_eq!(site.cells["progress"], serde_json::json!(67.0));
        assert_eq!(site.cells["latest"], serde_json::json!("2026-11-01"));
        assert_eq!(site.cells["remaining"], serde_json::json!(750.0));
        assert_eq!(site.cells["label"], serde_json::json!("67% · 750 left"));
        let idle = t.rows.iter().find(|r| r.id == "idle").unwrap();
        assert_eq!(idle.cells["done_count"], serde_json::json!(0.0));
        assert!(idle.cells["progress"].is_null());
        assert!(idle.cells["remaining"].is_null());
        assert!(t.columns.iter().any(|c| c.key == "remaining"), "formula columns exist even when no row stored them");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn auto_stamped_dates_and_recurrence() {
        let root = gap_root("recur");
        put(&root, ".cortex/schemas/tasks.yaml", "properties:\n  - name: status\n    type: status\n    options:\n      - name: todo\n      - name: doing\n      - name: done\n  - name: area\n    type: select\n    options:\n      - name: work\n      - name: admin\n  - name: due\n    type: date\n  - name: completed\n    type: date\n    auto: status == done\n");
        // A weekly task: finishing it stamps `completed` and creates next week's row.
        put(&root, "collections/tasks/water-plants-2026-09-07.md", "---\ntitle: Water plants\nstatus: todo\narea: admin\ndue: 2026-09-07\nrepeat: weekly\ncreated: 2026-09-01\n---\nRemember the balcony.\n");
        let written = set_cell_effects(&root, "collections/tasks", "water-plants-2026-09-07", "status", "done", "text").unwrap();
        assert_eq!(written.len(), 2, "{written:?}");
        let done = std::fs::read_to_string(root.join("collections/tasks/water-plants-2026-09-07.md")).unwrap();
        assert!(done.contains("status: done"), "{done}");
        assert!(done.contains(&format!("completed: {}", iso(crate::placeholders::today()))) || done.contains(&format!("completed: '{}'", iso(crate::placeholders::today()))), "{done}");
        let next = std::fs::read_to_string(root.join("collections/tasks/water-plants-2026-09-14.md")).unwrap();
        assert!(next.contains("due: 2026-09-14") && next.contains("status: todo") && !next.contains("completed") && next.contains("balcony"), "{next}");
        assert!(next.contains("area: admin"), "only the trigger is reset, other selects keep their value: {next}");
        // A bill that advances in place: paid → unpaid, next_due one month on, same file.
        put(&root, ".cortex/schemas/bills.yaml", "properties:\n  - name: paid\n    type: checkbox\n  - name: next_due\n    type: date\n");
        put(&root, "collections/bills/rent.md", "---\ntitle: Rent\npaid: false\nnext_due: 2026-09-30\nrepeat: monthly\nrepeat_mode: advance\n---\n");
        let written = set_cell_effects(&root, "collections/bills", "rent", "paid", "true", "bool").unwrap();
        assert_eq!(written.len(), 1);
        let rent = std::fs::read_to_string(root.join("collections/bills/rent.md")).unwrap();
        assert!(rent.contains("next_due: 2026-10-30") && rent.contains("paid: false"), "{rent}");
        // No repeat: nothing extra happens.
        put(&root, "collections/tasks/once.md", "---\ntitle: Once\nstatus: todo\n---\n");
        assert_eq!(set_cell_effects(&root, "collections/tasks", "once", "status", "done", "text").unwrap().len(), 1);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn views_filter_and_sort_on_computed_columns() {
        let root = gap_root("computed");
        put(&root, ".cortex/schemas/goals.yaml", "properties:\n  - name: target\n    type: number\n  - name: current\n    type: number\n  - name: pct\n    type: formula\n    expr: round(current / target * 100)\n");
        put(&root, "collections/goals/a.md", "---\ntitle: A\ntarget: 10\ncurrent: 10\n---\n");
        put(&root, "collections/goals/b.md", "---\ntitle: B\ntarget: 10\ncurrent: 3\n---\n");
        put(&root, "collections/goals/c.md", "---\ntitle: C\ntarget: 10\ncurrent: 7\n---\n");
        let t = resolve_view(&root, "source: collections/goals\nfilter: pct < 100\nsort: [pct desc]\n").unwrap();
        let names: Vec<&str> = t.rows.iter().map(|r| r.cells["title"].as_str().unwrap()).collect();
        assert_eq!(names, vec!["C", "B"]);
        assert!(t.all_columns.contains(&"pct".to_string()));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn row_effects_apply_to_direct_frontmatter_writes() {
        let root = gap_root("effects");
        put(&root, ".cortex/schemas/tasks.yaml", "properties:\n  - name: status\n    type: status\n    options:\n      - name: todo\n      - name: done\n  - name: completed\n    type: date\n    auto: status == done\n");
        put(&root, "collections/tasks/gym-2026-09-08.md", "---\ntitle: Gym\nstatus: done\ndue: 2026-09-08\nrepeat: every 2 days\n---\n");
        let written = apply_row_effects(&root, "collections/tasks/gym-2026-09-08.md", &["status".into()]).unwrap();
        assert_eq!(written.len(), 2, "{written:?}");
        assert!(root.join("collections/tasks/gym-2026-09-10.md").exists());
        assert!(std::fs::read_to_string(root.join("collections/tasks/gym-2026-09-08.md")).unwrap().contains("completed:"));
        // Not a collection row: nothing happens.
        put(&root, "notes/a.md", "---\ntitle: A\n---\n");
        assert!(apply_row_effects(&root, "notes/a.md", &["status".into()]).unwrap().is_empty());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn row_templates_expand_date_words() {
        let root = gap_root("datewords");
        put(&root, "collections/weeks/_template-weeks.md", "---\ntitle: \"Week of {{monday}}\"\nweek: \"{{monday}}\"\nreview: \"{{date+5}}\"\n---\n");
        let mut fields = BTreeMap::new();
        fields.insert("title".to_string(), "Untitled".to_string());
        fields.insert("created".to_string(), "2026-09-09".to_string()); // a Wednesday
        let path = add_row_from_template(&root, "collections/weeks", "w37", "weeks", &fields).unwrap().unwrap();
        let text = std::fs::read_to_string(path).unwrap();
        assert!(text.contains("week: 2026-09-07") || text.contains("week: '2026-09-07'"), "{text}");
        assert!(text.contains("review: 2026-09-14") || text.contains("review: '2026-09-14'"), "{text}");
        assert!(text.contains("title: Week of 2026-09-07"), "{text}");
        let _ = std::fs::remove_dir_all(&root);
    }

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
            option_order: Default::default(),
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
            option_order: Default::default(),
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
    fn duplicate_row_copies_fields_and_body_under_a_new_id() {
        let root = scratch("duprow");
        write(&root.join("collections/books/dune.md"),
            "---\ntitle: Dune\ncreated: 2020-01-01\nrating: 5\ntags: [sf, classic]\n---\nA body.\n");
        let path = duplicate_row(&root, "collections/books", "dune", "dune-2", "2026-09-09").unwrap().unwrap();
        assert!(path.ends_with("collections/books/dune-2.md"));
        let raw = std::fs::read_to_string(&path).unwrap();
        assert!(raw.contains("title: Dune copy"), "{raw}");
        assert!(raw.contains("created: 2026-09-09"), "{raw}");
        assert!(raw.contains("rating: 5"), "{raw}");
        assert!(raw.contains("A body."), "{raw}");
        // Keys stay sorted on write.
        let created = raw.find("created:").unwrap();
        let rating = raw.find("rating:").unwrap();
        let tags = raw.find("tags:").unwrap();
        assert!(created < rating && rating < tags, "{raw}");
        // The original is untouched; ids are unique; missing rows are errors.
        assert!(std::fs::read_to_string(root.join("collections/books/dune.md")).unwrap().contains("title: Dune\n"));
        assert!(duplicate_row(&root, "collections/books", "dune", "dune-2", "2026-09-09").is_err());
        assert!(duplicate_row(&root, "collections/books", "nope", "x", "2026-09-09").is_err());
        assert!(duplicate_row(&root, "collections/books", "dune", "../x", "2026-09-09").is_err());

        // CSV: the record is copied under the new id, id-sorted.
        write(&root.join("data/weight.csv"), "id,date,weight\na,2024-01-01,82\n");
        assert!(duplicate_row(&root, "data/weight.csv", "a", "b", "2026-09-09").unwrap().is_none());
        let csv = std::fs::read_to_string(root.join("data/weight.csv")).unwrap();
        assert_eq!(csv.lines().nth(2).unwrap(), "b,2024-01-01,82");
        assert!(duplicate_row(&root, "data/weight.csv", "zzz", "c", "2026-09-09").is_err());

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

    fn row(cells: &[(&str, CellValue)]) -> Row {
        Row { id: "r".into(), cells: cells.iter().map(|(k, v)| (k.to_string(), v.clone())).collect() }
    }
    fn text(s: &str) -> CellValue { CellValue::Text(s.into()) }
    fn matches(filter: &str, r: &Row) -> bool { parse_filter(filter).unwrap().eval(r) }

    #[test]
    fn filter_precedence_parentheses_and_not() {
        let r = row(&[("a", text("1")), ("b", text("2")), ("c", text("3"))]);
        // `and` binds tighter than `or`: a or (b and c).
        assert!(matches("a == '1' or b == 'x' and c == 'x'", &r));
        assert!(!matches("a == 'x' or b == '2' and c == 'x'", &r));
        assert!(matches("a == 'x' or b == '2' and c == '3'", &r));
        // Parentheses regroup.
        assert!(!matches("(a == '1' or b == 'x') and c == 'x'", &r));
        assert!(matches("(a == 'x' or b == '2') and c == '3'", &r));
        assert!(matches("((a == '1'))", &r));
        // `not` is a prefix, and applies to a group.
        assert!(matches("not a == 'x'", &r));
        assert!(!matches("not a == '1'", &r));
        assert!(matches("not (a == 'x' or b == 'x') and c == '3'", &r));
        assert!(matches("a == '1' and not b == 'x'", &r));
        // A plain chain still reads as before.
        assert!(matches("a == '1' and b == '2' and c == '3'", &r));
        // Errors, not panics.
        assert!(parse_filter("(a == '1'").is_err());
        assert!(parse_filter("a == '1')").is_err());
        assert!(parse_filter("a ==").is_err());
        assert!(parse_filter("a like 'x'").is_err());
        assert!(parse_filter("a in 'x'").is_err());
        assert!(parse_filter("a in [x").is_err());
    }

    #[test]
    fn filter_new_operators() {
        let r = row(&[
            ("title", text("Piranesi")),
            ("tags", CellValue::List(vec!["rust".into(), "notes".into()])),
            ("none", CellValue::List(vec![])),
            ("blank", text("")),
            ("n", CellValue::Num(3.0)),
        ]);
        assert!(matches("title starts_with 'Pir'", &r));
        assert!(!matches("title starts_with 'pir'", &r));
        assert!(matches("title ends_with 'esi'", &r));
        assert!(matches("tags starts_with 'ru'", &r));
        assert!(matches("title does_not_contain 'x'", &r));
        assert!(!matches("title does_not_contain 'ran'", &r));
        assert!(!matches("tags does_not_contain 'rust'", &r));
        assert!(matches("missing does_not_contain 'rust'", &r));
        assert!(matches("blank is_empty", &r));
        assert!(matches("missing is_empty", &r));
        assert!(matches("none is_empty", &r));
        assert!(!matches("title is_empty", &r));
        assert!(matches("title is_not_empty", &r));
        assert!(!matches("blank is_not_empty", &r));
        assert!(matches("title in ['Piranesi', 'Other']", &r));
        assert!(matches("title in [\"Other\", \"Piranesi\"]", &r));
        assert!(!matches("title in ['Other']", &r));
        assert!(matches("tags in ['notes', 'x']", &r));
        assert!(matches("n in [1, 2, 3]", &r));
        assert!(!matches("n in [1, 2]", &r));
        assert!(!matches("blank in ['x']", &r));
        assert!(matches("n starts_with '3'", &r));
    }

    #[test]
    fn filter_within_dates() {
        let base = chrono::NaiveDate::from_ymd_opt(2026, 9, 9).unwrap();
        assert_eq!(within_bounds("7d", base).unwrap(), ("2026-09-09".to_string(), "2026-09-16".to_string()));
        assert_eq!(within_bounds("7", base).unwrap(), ("2026-09-09".to_string(), "2026-09-16".to_string()));
        assert_eq!(within_bounds("-7d", base).unwrap(), ("2026-09-02".to_string(), "2026-09-09".to_string()));
        assert_eq!(within_bounds("2w", base).unwrap(), ("2026-09-09".to_string(), "2026-09-23".to_string()));
        assert_eq!(within_bounds("1m", base).unwrap(), ("2026-09-09".to_string(), "2026-10-09".to_string()));
        assert_eq!(within_bounds("-1y", base).unwrap(), ("2025-09-09".to_string(), "2026-09-09".to_string()));
        assert!(within_bounds("soon", base).is_none());
        assert!(within_bounds("7x", base).is_none());

        let t = crate::placeholders::today();
        let r = row(&[("due", CellValue::Date(iso(t + chrono::Duration::days(3)))), ("past", CellValue::Date(iso(t - chrono::Duration::days(3))))]);
        assert!(matches("due within 7d", &r));
        assert!(matches("due within '7d'", &r));
        assert!(!matches("due within 2d", &r));
        assert!(!matches("due within -7d", &r));
        assert!(matches("past within -7d", &r));
        assert!(!matches("past within 7d", &r));
        assert!(!matches("missing within 7d", &r));
        assert!(!matches("due within 'soon'", &r));
    }

    #[test]
    fn structured_spec_round_trips_new_operators_and_a_group() {
        let spec = "source: collections/tasks\nfilter: status in ['todo', 'doing'] and due within 7d and owner is_not_empty and title starts_with 'A'\n";
        let s = parse_view_spec(spec).unwrap();
        assert!(!s.filter_complex);
        assert_eq!(s.filters.iter().map(|f| f.op.as_str()).collect::<Vec<_>>(), vec!["in", "within", "is_not_empty", "starts_with"]);
        assert_eq!(s.filters[0].value, "todo, doing");
        assert_eq!(s.filters[1].value, "7d");
        assert_eq!(s.filters[2].value, "");
        assert_eq!(serialize_view_spec(&s), spec);

        // One parenthesised group round-trips; its position is kept.
        let spec = "source: collections/tasks\nfilter: (status == 'todo' or status == 'doing') and due <= @today\n";
        let s = parse_view_spec(spec).unwrap();
        assert!(!s.filter_complex);
        assert_eq!(s.filter_join, "and");
        assert_eq!(s.filters.len(), 2);
        assert_eq!(s.filters[0].join, "or");
        assert_eq!(s.filters[0].clauses.len(), 2);
        assert_eq!(s.filters[0].clauses[1].value, "doing");
        assert_eq!(s.filters[1].value, "@today");
        assert_eq!(serialize_view_spec(&s), spec);
        let spec = "source: collections/tasks\nfilter: due <= @today and (status == 'todo' or status == 'doing')\n";
        assert_eq!(serialize_view_spec(&parse_view_spec(spec).unwrap()), spec);
        // The JSON the toolbar sees carries the group.
        let json = serde_json::to_value(&s).unwrap();
        assert_eq!(json["filters"][0]["join"], "or");
        assert!(json["filters"][1].get("clauses").is_none());

        // Nested groups, `not`, and mixed connectors inside a group stay raw.
        for raw in ["not a == '1'", "(a == '1' and (b == '2' or c == '3'))", "(a == '1' or b == '2' and c == '3')", "a == '1' or b == '2' and c == '3'"] {
            let s = parse_view_spec(&format!("source: collections/x\nfilter: {raw}\n")).unwrap();
            assert!(s.filter_complex, "{raw}");
            assert_eq!(s.filter_raw.as_deref(), Some(raw));
        }
    }

    #[test]
    fn marketplace_filters_still_parse() {
        // Regression guard for the packs: CORTEX_FILTERS_FILE holds one filter per line.
        let Ok(path) = std::env::var("CORTEX_FILTERS_FILE") else { return };
        let mut bad = Vec::new();
        for line in std::fs::read_to_string(path).unwrap().lines() {
            if line.trim().is_empty() { continue; }
            if let Err(e) = parse_filter(line) { bad.push(format!("{line}: {e}")); }
        }
        assert!(bad.is_empty(), "{}", bad.join("\n"));
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
    fn summary_row_is_computed_over_the_visible_rows() {
        let root = scratch("summary");
        write(&root.join("collections/expenses/a.md"), "---\ntitle: Rent\namount: 1200\ndone: true\ncategory: home\n---\n");
        write(&root.join("collections/expenses/b.md"), "---\ntitle: Food\namount: 300\ndone: false\ncategory: home\n---\n");
        write(&root.join("collections/expenses/c.md"), "---\ntitle: Gym\namount: 40\ndone: true\n---\n");
        write(&root.join("collections/expenses/d.md"), "---\ntitle: Pending\ndone: false\ncategory: ''\n---\n");

        let spec = "source: collections/expenses\ntype: table\nsummary: {amount: sum, done: percent_checked, category: empty, title: count, unknown: median}\n";
        let t = resolve_view(&root, spec).unwrap();
        let get = |k: &str| t.summary.get(k).cloned().unwrap_or(serde_json::Value::Null);
        assert_eq!(get("amount"), serde_json::json!(1540.0));
        assert_eq!(get("done"), serde_json::json!(50.0)); // 2 of 4
        assert_eq!(get("category"), serde_json::json!(2.0)); // c has none, d has ''
        assert_eq!(get("title"), serde_json::json!(4.0));
        assert_eq!(get("unknown"), serde_json::Value::Null);
        // Nothing was written to any row.
        assert!(!std::fs::read_to_string(root.join("collections/expenses/a.md")).unwrap().contains("summary"));

        // The filter runs first: the summary covers only the rows shown.
        let filtered = "source: collections/expenses\nfilter: category == 'home'\nsummary: {amount: avg, amount_max: max, done: not_empty}\n";
        let t = resolve_view(&root, filtered).unwrap();
        assert_eq!(t.rows.len(), 2);
        assert_eq!(t.summary.get("amount"), Some(&serde_json::json!(750.0)));
        assert_eq!(t.summary.get("done"), Some(&serde_json::json!(2.0)));
        assert_eq!(t.summary.get("amount_max"), Some(&serde_json::Value::Null)); // no such field

        // No summary asked for → none in the output.
        let plain = resolve_view(&root, "source: collections/expenses\n").unwrap();
        assert!(plain.summary.is_empty());
        assert!(!serde_json::to_string(&plain).unwrap().contains("\"summary\""));

        // Min/max of a date column and an empty table.
        let empty = Table { name: "x".into(), columns: vec![], rows: vec![] };
        let mut m = BTreeMap::new();
        m.insert("amount".to_string(), "sum".to_string());
        m.insert("done".to_string(), "percent_checked".to_string());
        let out = summarize_table(&empty, &m);
        assert_eq!(out.get("amount"), Some(&CellValue::Null));
        assert_eq!(out.get("done"), Some(&CellValue::Null));

        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn summary_survives_the_structured_round_trip() {
        let spec = "source: collections/expenses\ntype: table\nsummary:\n  amount: sum\n  done: percent_checked\nlimit: 10\n";
        let s = parse_view_spec(spec).unwrap();
        assert_eq!(s.summary.get("amount").map(String::as_str), Some("sum"));
        assert_eq!(s.limit, Some(10));
        assert!(!s.options.contains_key("summary"));
        let yaml = serialize_view_spec(&s);
        assert!(yaml.contains("summary: {amount: sum, done: percent_checked}\n"), "{yaml}");
        let again = parse_view_spec(&yaml).unwrap();
        assert_eq!(again.summary, s.summary);
        // The engine reads the flow form back as the same map.
        let vs: ViewSpec = serde_yaml::from_str(&yaml).unwrap();
        assert_eq!(vs.summary, s.summary);
    }

    #[test]
    fn calendar_mode_and_end_survive_the_structured_round_trip() {
        // The app remembers the calendar's mode and span field in the spec;
        // both are plain options the engine carries through untouched.
        let spec = "source: collections/trips\ntype: calendar\ndate: start\nend: end\nmode: week\n";
        let s = parse_view_spec(spec).unwrap();
        assert_eq!(s.kind.as_deref(), Some("calendar"));
        assert_eq!(s.date.as_deref(), Some("start"));
        assert_eq!(s.options.get("mode").map(String::as_str), Some("week"));
        assert_eq!(s.options.get("end").map(String::as_str), Some("end"));
        let yaml = serialize_view_spec(&s);
        assert!(yaml.contains("mode: week\n"), "{yaml}");
        assert!(yaml.contains("end: end\n"), "{yaml}");
        let again = parse_view_spec(&yaml).unwrap();
        assert_eq!(again.options, s.options);
    }

    #[test]
    fn a_list_view_resolves_like_a_table() {
        // `type: list` is presentation only: the engine returns the same rows,
        // filtered and sorted, that the table would — from the CLI and MCP too.
        let root = gap_root("list");
        put(&root, "collections/books/a.md", "---\ntitle: A\nstatus: reading\n---\n");
        put(&root, "collections/books/b.md", "---\ntitle: B\nstatus: done\n---\n");
        let spec = "source: collections/books\ntype: list\nfilter: status == 'reading'\ncolumns: [title, status]\n";
        let t = resolve_view(&root, spec).unwrap();
        assert_eq!(t.rows.len(), 1);
        assert_eq!(t.rows[0].cells["title"], serde_json::json!("A"));
        assert_eq!(t.columns.iter().map(|c| c.key.as_str()).collect::<Vec<_>>(), vec!["title", "status"]);
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
