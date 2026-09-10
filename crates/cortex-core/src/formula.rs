//! Formulas — a small expression language over one row's properties,
//! evaluated on read and never written (principle 2 of the roadmap).
//!
//! ```yaml
//! - name: remaining
//!   type: formula
//!   expr: monthly_limit - spent
//! - name: days_left
//!   type: formula
//!   expr: days_until(deadline)
//! - name: label
//!   type: formula
//!   expr: if(done, "done", concat(round(progress), "%"))
//! ```
//!
//! Values: numbers, text, booleans, dates (ISO text), lists, null. Operators:
//! `+ - * / %`, `== != < <= > >=`, `and or not`, parentheses. Functions:
//! `days_until(d)`, `days_since(d)`, `days_between(a, b)`, `today()`,
//! `year(d)`, `month(d)`, `quarter(d)`, `week(d)` (ISO week),
//! `date_add(d, n, unit)` with unit `day | week | month | quarter | year`
//! (negative n goes back; month arithmetic clamps to the month's last day),
//! `format_date(d, pattern)` with tokens `YYYY YY MMMM MMM MM M DD D Do W Q`
//! (anything else is copied through — `format_date(due, "MMM Do")` → "Sep 9th"),
//! `format_number(x, unit?, decimals?)` — thousands separators, `decimals`
//! places (default 2); a symbol unit is a prefix (`"$"` → `$1,234.50`), a
//! word unit a suffix (`"kg"` → `1,234.50 kg`), `round(x, n?)`, `abs`, `min`,
//! `max`, `if(c, a, b)`, `coalesce(a, b, …)`, `len(x)`, `contains(list_or_text,
//! v)`, `concat(…)`, `lower`, `upper`, `empty(x)`. Property names are bare
//! identifiers; a missing property is null; anything with null in arithmetic
//! is null. A formatted result is text.

use std::collections::BTreeMap;

use chrono::NaiveDate;

use crate::data::CellValue;

#[derive(Debug, Clone, PartialEq)]
pub enum Value {
    Null,
    Num(f64),
    Text(String),
    Bool(bool),
    List(Vec<String>),
}

impl Value {
    fn from_cell(c: &CellValue) -> Value {
        match c {
            CellValue::Null => Value::Null,
            CellValue::Num(n) => Value::Num(*n),
            CellValue::Text(t) | CellValue::Date(t) => Value::Text(t.clone()),
            CellValue::Bool(b) => Value::Bool(*b),
            CellValue::List(l) => Value::List(l.clone()),
            // A range enters a formula as its start day (`days_until(trip)`).
            CellValue::Range(start, _) => Value::Text(start.clone()),
        }
    }
    pub fn to_cell(&self) -> CellValue {
        match self {
            Value::Null => CellValue::Null,
            Value::Num(n) => CellValue::Num(*n),
            Value::Text(t) => if looks_like_date(t) { CellValue::Date(t.clone()) } else { CellValue::Text(t.clone()) },
            Value::Bool(b) => CellValue::Bool(*b),
            Value::List(l) => CellValue::List(l.clone()),
        }
    }
    fn num(&self) -> Option<f64> {
        match self {
            Value::Num(n) => Some(*n),
            Value::Bool(b) => Some(if *b { 1.0 } else { 0.0 }),
            Value::Text(t) => t.trim().parse().ok(),
            _ => None,
        }
    }
    fn truthy(&self) -> bool {
        match self {
            Value::Null => false,
            Value::Num(n) => *n != 0.0,
            Value::Text(t) => !t.is_empty(),
            Value::Bool(b) => *b,
            Value::List(l) => !l.is_empty(),
        }
    }
    fn text(&self) -> String {
        match self {
            Value::Null => String::new(),
            Value::Num(n) => if n.fract() == 0.0 { format!("{}", *n as i64) } else { n.to_string() },
            Value::Text(t) => t.clone(),
            Value::Bool(b) => b.to_string(),
            Value::List(l) => l.join(", "),
        }
    }
    fn date(&self) -> Option<NaiveDate> {
        match self {
            Value::Text(t) => NaiveDate::parse_from_str(&t[..t.len().min(10)], "%Y-%m-%d").ok(),
            _ => None,
        }
    }
}

fn looks_like_date(s: &str) -> bool {
    s.len() == 10 && NaiveDate::parse_from_str(s, "%Y-%m-%d").is_ok()
}

// ── Tokens ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq)]
enum Tok { Num(f64), Str(String), Ident(String), Op(String), LParen, RParen, Comma }

fn tokenize(src: &str) -> Result<Vec<Tok>, String> {
    let mut out = Vec::new();
    let chars: Vec<char> = src.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c.is_whitespace() { i += 1; continue; }
        if c.is_ascii_digit() || (c == '.' && i + 1 < chars.len() && chars[i + 1].is_ascii_digit()) {
            let start = i;
            while i < chars.len() && (chars[i].is_ascii_digit() || chars[i] == '.') { i += 1; }
            let s: String = chars[start..i].iter().collect();
            out.push(Tok::Num(s.parse().map_err(|_| format!("bad number {s}"))?));
            continue;
        }
        if c == '\'' || c == '"' {
            let mut s = String::new();
            i += 1;
            while i < chars.len() && chars[i] != c { s.push(chars[i]); i += 1; }
            if i >= chars.len() { return Err("unterminated string".into()); }
            i += 1;
            out.push(Tok::Str(s));
            continue;
        }
        if c.is_alphabetic() || c == '_' {
            let start = i;
            while i < chars.len() && (chars[i].is_alphanumeric() || chars[i] == '_') { i += 1; }
            let s: String = chars[start..i].iter().collect();
            match s.as_str() {
                "and" | "or" | "not" => out.push(Tok::Op(s)),
                _ => out.push(Tok::Ident(s)),
            }
            continue;
        }
        match c {
            '(' => { out.push(Tok::LParen); i += 1; }
            ')' => { out.push(Tok::RParen); i += 1; }
            ',' => { out.push(Tok::Comma); i += 1; }
            '+' | '-' | '*' | '/' | '%' => { out.push(Tok::Op(c.to_string())); i += 1; }
            '=' | '!' | '<' | '>' => {
                let mut op = c.to_string();
                if i + 1 < chars.len() && chars[i + 1] == '=' { op.push('='); i += 1; }
                if op == "=" { op = "==".into(); }
                out.push(Tok::Op(op));
                i += 1;
            }
            other => return Err(format!("unexpected character {other:?}")),
        }
    }
    Ok(out)
}

// ── Parser (precedence climbing) → AST ───────────────────────────────────────

#[derive(Debug, Clone)]
enum Expr {
    Lit(Value),
    Prop(String),
    Unary(String, Box<Expr>),
    Bin(String, Box<Expr>, Box<Expr>),
    Call(String, Vec<Expr>),
}

struct Parser { toks: Vec<Tok>, pos: usize }

impl Parser {
    fn peek(&self) -> Option<&Tok> { self.toks.get(self.pos) }
    fn next(&mut self) -> Option<Tok> { let t = self.toks.get(self.pos).cloned(); self.pos += 1; t }
    fn eat_op(&mut self, ops: &[&str]) -> Option<String> {
        if let Some(Tok::Op(o)) = self.peek() { if ops.contains(&o.as_str()) { let o = o.clone(); self.pos += 1; return Some(o); } }
        None
    }
    fn expr(&mut self) -> Result<Expr, String> { self.or() }
    fn or(&mut self) -> Result<Expr, String> {
        let mut l = self.and()?;
        while self.eat_op(&["or"]).is_some() { let r = self.and()?; l = Expr::Bin("or".into(), Box::new(l), Box::new(r)); }
        Ok(l)
    }
    fn and(&mut self) -> Result<Expr, String> {
        let mut l = self.not()?;
        while self.eat_op(&["and"]).is_some() { let r = self.not()?; l = Expr::Bin("and".into(), Box::new(l), Box::new(r)); }
        Ok(l)
    }
    fn not(&mut self) -> Result<Expr, String> {
        if self.eat_op(&["not"]).is_some() { let e = self.not()?; return Ok(Expr::Unary("not".into(), Box::new(e))); }
        self.cmp()
    }
    fn cmp(&mut self) -> Result<Expr, String> {
        let l = self.add()?;
        if let Some(op) = self.eat_op(&["==", "!=", "<", "<=", ">", ">="]) { let r = self.add()?; return Ok(Expr::Bin(op, Box::new(l), Box::new(r))); }
        Ok(l)
    }
    fn add(&mut self) -> Result<Expr, String> {
        let mut l = self.mul()?;
        while let Some(op) = self.eat_op(&["+", "-"]) { let r = self.mul()?; l = Expr::Bin(op, Box::new(l), Box::new(r)); }
        Ok(l)
    }
    fn mul(&mut self) -> Result<Expr, String> {
        let mut l = self.unary()?;
        while let Some(op) = self.eat_op(&["*", "/", "%"]) { let r = self.unary()?; l = Expr::Bin(op, Box::new(l), Box::new(r)); }
        Ok(l)
    }
    fn unary(&mut self) -> Result<Expr, String> {
        if self.eat_op(&["-"]).is_some() { let e = self.unary()?; return Ok(Expr::Unary("-".into(), Box::new(e))); }
        self.primary()
    }
    fn primary(&mut self) -> Result<Expr, String> {
        match self.next() {
            Some(Tok::Num(n)) => Ok(Expr::Lit(Value::Num(n))),
            Some(Tok::Str(s)) => Ok(Expr::Lit(Value::Text(s))),
            Some(Tok::LParen) => { let e = self.expr()?; match self.next() { Some(Tok::RParen) => Ok(e), _ => Err("expected )".into()) } }
            Some(Tok::Ident(name)) => {
                if self.peek() == Some(&Tok::LParen) {
                    self.pos += 1;
                    let mut args = Vec::new();
                    if self.peek() != Some(&Tok::RParen) {
                        loop {
                            args.push(self.expr()?);
                            match self.next() { Some(Tok::Comma) => continue, Some(Tok::RParen) => break, _ => return Err(format!("bad arguments to {name}")) }
                        }
                    } else { self.pos += 1; }
                    return Ok(Expr::Call(name, args));
                }
                match name.as_str() {
                    "true" => Ok(Expr::Lit(Value::Bool(true))),
                    "false" => Ok(Expr::Lit(Value::Bool(false))),
                    "null" | "empty" => Ok(Expr::Lit(Value::Null)),
                    _ => Ok(Expr::Prop(name)),
                }
            }
            other => Err(format!("unexpected {other:?}")),
        }
    }
}

/// A parsed, reusable formula.
#[derive(Debug, Clone)]
pub struct Formula { ast: Expr }

impl Formula {
    pub fn parse(src: &str) -> Result<Formula, String> {
        let toks = tokenize(src)?;
        if toks.is_empty() { return Err("empty formula".into()); }
        let mut p = Parser { toks, pos: 0 };
        let ast = p.expr()?;
        if p.pos != p.toks.len() { return Err(format!("unexpected {:?} after the expression", p.toks[p.pos])); }
        Ok(Formula { ast })
    }

    pub fn eval(&self, cells: &BTreeMap<String, CellValue>, today: NaiveDate) -> Value {
        eval(&self.ast, cells, today)
    }
}

fn eval(e: &Expr, cells: &BTreeMap<String, CellValue>, today: NaiveDate) -> Value {
    match e {
        Expr::Lit(v) => v.clone(),
        Expr::Prop(name) => cells.get(name).map(Value::from_cell).unwrap_or(Value::Null),
        Expr::Unary(op, x) => {
            let v = eval(x, cells, today);
            match op.as_str() {
                "not" => Value::Bool(!v.truthy()),
                _ => v.num().map(|n| Value::Num(-n)).unwrap_or(Value::Null),
            }
        }
        Expr::Bin(op, a, b) => {
            let (l, r) = (eval(a, cells, today), eval(b, cells, today));
            match op.as_str() {
                "and" => Value::Bool(l.truthy() && r.truthy()),
                "or" => Value::Bool(l.truthy() || r.truthy()),
                "+" => match (&l, &r) {
                    (Value::Text(_), _) | (_, Value::Text(_)) if l.num().is_none() || r.num().is_none() => Value::Text(format!("{}{}", l.text(), r.text())),
                    _ => arith(&l, &r, |x, y| x + y),
                },
                "-" => match (l.date(), r.date()) {
                    (Some(x), Some(y)) => Value::Num((x - y).num_days() as f64),
                    _ => arith(&l, &r, |x, y| x - y),
                },
                "*" => arith(&l, &r, |x, y| x * y),
                "/" => match (l.num(), r.num()) { (Some(x), Some(y)) if y != 0.0 => Value::Num(x / y), _ => Value::Null },
                "%" => match (l.num(), r.num()) { (Some(x), Some(y)) if y != 0.0 => Value::Num(x % y), _ => Value::Null },
                "==" => Value::Bool(same(&l, &r)),
                "!=" => Value::Bool(!same(&l, &r)),
                "<" | "<=" | ">" | ">=" => {
                    let ord = match (l.num(), r.num()) {
                        (Some(x), Some(y)) => x.partial_cmp(&y),
                        _ => Some(l.text().cmp(&r.text())),
                    };
                    match ord {
                        None => Value::Null,
                        Some(o) => Value::Bool(match op.as_str() {
                            "<" => o.is_lt(), "<=" => o.is_le(), ">" => o.is_gt(), _ => o.is_ge(),
                        }),
                    }
                }
                _ => Value::Null,
            }
        }
        Expr::Call(name, args) => {
            let a: Vec<Value> = args.iter().map(|x| eval(x, cells, today)).collect();
            let n = |i: usize| a.get(i).and_then(Value::num);
            match name.as_str() {
                "today" => Value::Text(today.format("%Y-%m-%d").to_string()),
                "days_until" => a.first().and_then(Value::date).map(|d| Value::Num((d - today).num_days() as f64)).unwrap_or(Value::Null),
                "days_since" => a.first().and_then(Value::date).map(|d| Value::Num((today - d).num_days() as f64)).unwrap_or(Value::Null),
                "days_between" => match (a.first().and_then(Value::date), a.get(1).and_then(Value::date)) { (Some(x), Some(y)) => Value::Num((y - x).num_days() as f64), _ => Value::Null },
                "year" => a.first().and_then(Value::date).map(|d| Value::Num(chrono::Datelike::year(&d) as f64)).unwrap_or(Value::Null),
                "month" => a.first().and_then(Value::date).map(|d| Value::Num(chrono::Datelike::month(&d) as f64)).unwrap_or(Value::Null),
                "quarter" => a.first().and_then(Value::date).map(|d| Value::Num(((chrono::Datelike::month(&d) - 1) / 3 + 1) as f64)).unwrap_or(Value::Null),
                "week" => a.first().and_then(Value::date).map(|d| Value::Num(chrono::Datelike::iso_week(&d).week() as f64)).unwrap_or(Value::Null),
                "date_add" => match (a.first().and_then(Value::date), n(1), a.get(2).map(Value::text)) {
                    (Some(d), Some(k), Some(unit)) => date_add(d, k.round() as i64, &unit).map(|r| Value::Text(r.format("%Y-%m-%d").to_string())).unwrap_or(Value::Null),
                    _ => Value::Null,
                },
                "format_date" => match (a.first().and_then(Value::date), a.get(1).map(Value::text)) {
                    (Some(d), Some(p)) => Value::Text(format_date(d, &p)),
                    _ => Value::Null,
                },
                "format_number" => match n(0) {
                    Some(x) => Value::Text(format_number(x, a.get(1).map(Value::text).as_deref(), n(2).map(|p| p.max(0.0) as usize))),
                    None => Value::Null,
                },
                "round" => match (n(0), n(1)) { (Some(x), Some(p)) => { let f = 10f64.powi(p as i32); Value::Num((x * f).round() / f) } (Some(x), None) => Value::Num(x.round()), _ => Value::Null },
                "abs" => n(0).map(|x| Value::Num(x.abs())).unwrap_or(Value::Null),
                "min" => a.iter().filter_map(Value::num).reduce(f64::min).map(Value::Num).unwrap_or(Value::Null),
                "max" => a.iter().filter_map(Value::num).reduce(f64::max).map(Value::Num).unwrap_or(Value::Null),
                "if" => if a.first().map(Value::truthy).unwrap_or(false) { a.get(1).cloned().unwrap_or(Value::Null) } else { a.get(2).cloned().unwrap_or(Value::Null) },
                "coalesce" => a.iter().find(|v| !matches!(v, Value::Null) && !(matches!(v, Value::Text(t) if t.is_empty()))).cloned().unwrap_or(Value::Null),
                "len" => match a.first() { Some(Value::List(l)) => Value::Num(l.len() as f64), Some(v) => Value::Num(v.text().chars().count() as f64), None => Value::Null },
                "contains" => match (a.first(), a.get(1)) {
                    (Some(Value::List(l)), Some(v)) => Value::Bool(l.iter().any(|x| *x == v.text())),
                    (Some(x), Some(v)) => Value::Bool(x.text().contains(&v.text())),
                    _ => Value::Null,
                },
                "concat" => Value::Text(a.iter().map(Value::text).collect()),
                "lower" => Value::Text(a.first().map(Value::text).unwrap_or_default().to_lowercase()),
                "upper" => Value::Text(a.first().map(Value::text).unwrap_or_default().to_uppercase()),
                "empty" => Value::Bool(!a.first().map(Value::truthy).unwrap_or(false)),
                _ => Value::Null,
            }
        }
    }
}

/// `d` moved by `n` units. Months and years land on the same day of month,
/// clamped to the target month's last day (Jan 31 + 1 month = Feb 28/29).
fn date_add(d: NaiveDate, n: i64, unit: &str) -> Option<NaiveDate> {
    use chrono::{Duration, Months};
    let u = unit.trim().to_lowercase();
    let u = u.trim_end_matches('s');
    match u {
        "day" => d.checked_add_signed(Duration::days(n)),
        "week" => d.checked_add_signed(Duration::weeks(n)),
        "month" | "quarter" | "year" => {
            let months = n * match u { "month" => 1, "quarter" => 3, _ => 12 };
            if months >= 0 { d.checked_add_months(Months::new(months as u32)) } else { d.checked_sub_months(Months::new((-months) as u32)) }
        }
        _ => None,
    }
}

/// `pattern` with the date tokens filled in; every other character is kept.
fn format_date(d: NaiveDate, pattern: &str) -> String {
    use chrono::Datelike;
    const MONTHS: [&str; 12] = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    let day = d.day();
    let ordinal = match day { 11 | 12 | 13 => "th", _ => match day % 10 { 1 => "st", 2 => "nd", 3 => "rd", _ => "th" } };
    // Longest tokens first so `MMMM` is not read as two `MM`s.
    let tokens: [(&str, String); 11] = [
        ("YYYY", format!("{}", d.year())),
        ("MMMM", MONTHS[(d.month() - 1) as usize].to_string()),
        ("MMM", MONTHS[(d.month() - 1) as usize][..3].to_string()),
        ("YY", format!("{:02}", d.year() % 100)),
        ("MM", format!("{:02}", d.month())),
        ("DD", format!("{:02}", day)),
        ("Do", format!("{day}{ordinal}")),
        ("M", format!("{}", d.month())),
        ("D", format!("{day}")),
        ("W", format!("{}", d.iso_week().week())),
        ("Q", format!("{}", (d.month() - 1) / 3 + 1)),
    ];
    let mut out = String::new();
    let mut rest = pattern;
    'outer: while !rest.is_empty() {
        for (tok, val) in &tokens {
            if let Some(after) = rest.strip_prefix(tok) { out.push_str(val); rest = after; continue 'outer; }
        }
        let ch = rest.chars().next().unwrap();
        out.push(ch);
        rest = &rest[ch.len_utf8()..];
    }
    out
}

/// `x` with thousands separators and `decimals` places (default 2). A unit
/// made of letters is a suffix with a space (`12.50 kg`); anything else — a
/// currency symbol — is a prefix (`$12.50`, `-$12.50`).
fn format_number(x: f64, unit: Option<&str>, decimals: Option<usize>) -> String {
    let decimals = decimals.unwrap_or(2);
    let neg = x < 0.0;
    // Half away from zero, as people expect of money; `{:.n}` alone rounds half to even.
    let factor = 10f64.powi(decimals as i32);
    let fixed = format!("{:.*}", decimals, (x.abs() * factor).round() / factor);
    let (int, frac) = fixed.split_once('.').map(|(i, f)| (i.to_string(), Some(f.to_string()))).unwrap_or((fixed.clone(), None));
    let mut grouped = String::new();
    for (i, ch) in int.chars().enumerate() {
        if i > 0 && (int.len() - i) % 3 == 0 { grouped.push(','); }
        grouped.push(ch);
    }
    let mut body = grouped;
    if let Some(f) = frac { body.push('.'); body.push_str(&f); }
    let unit = unit.map(str::trim).filter(|u| !u.is_empty());
    let sign = if neg { "-" } else { "" };
    match unit {
        Some(u) if u.chars().all(char::is_alphabetic) => format!("{sign}{body} {u}"),
        Some(u) => format!("{sign}{u}{body}"),
        None => format!("{sign}{body}"),
    }
}

fn arith(l: &Value, r: &Value, f: impl Fn(f64, f64) -> f64) -> Value {
    match (l.num(), r.num()) { (Some(x), Some(y)) => Value::Num(f(x, y)), _ => Value::Null }
}

fn same(l: &Value, r: &Value) -> bool {
    match (l.num(), r.num()) {
        (Some(x), Some(y)) if !matches!((l, r), (Value::Text(_), Value::Text(_))) => x == y,
        _ => l.text() == r.text(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cells(pairs: &[(&str, CellValue)]) -> BTreeMap<String, CellValue> {
        pairs.iter().map(|(k, v)| (k.to_string(), v.clone())).collect()
    }
    fn t() -> NaiveDate { NaiveDate::from_ymd_opt(2026, 9, 9).unwrap() }

    #[test]
    fn arithmetic_dates_and_text() {
        let c = cells(&[("limit", CellValue::Num(400.0)), ("spent", CellValue::Num(123.5)), ("deadline", CellValue::Date("2026-09-30".into())), ("start", CellValue::Date("2026-09-01".into())), ("done", CellValue::Bool(false)), ("tags", CellValue::List(vec!["a".into(), "b".into()]))]);
        let ev = |s: &str| Formula::parse(s).unwrap().eval(&c, t());
        assert_eq!(ev("limit - spent"), Value::Num(276.5));
        assert_eq!(ev("round(spent / limit * 100)"), Value::Num(31.0));
        assert_eq!(ev("days_until(deadline)"), Value::Num(21.0));
        assert_eq!(ev("deadline - start"), Value::Num(29.0));
        assert_eq!(ev("if(done, 'done', concat(round(spent), ' spent'))"), Value::Text("124 spent".into()));
        assert_eq!(ev("not done and spent > 100"), Value::Bool(true));
        assert_eq!(ev("len(tags)"), Value::Num(2.0));
        assert_eq!(ev("contains(tags, 'b')"), Value::Bool(true));
        assert_eq!(ev("missing + 1"), Value::Null);
        assert_eq!(ev("coalesce(missing, spent)"), Value::Num(123.5));
        assert_eq!(ev("today()"), Value::Text("2026-09-09".into()));
        assert_eq!(ev("year(deadline)"), Value::Num(2026.0));
        assert_eq!(ev("(limit - spent) / limit >= 0.5"), Value::Bool(true));
        assert!(Formula::parse("1 +").is_err());
        assert!(Formula::parse("foo(").is_err());
    }

    #[test]
    fn date_functions_add_format_quarter_week() {
        let c = cells(&[("due", CellValue::Date("2026-01-31".into())), ("start", CellValue::Date("2026-09-09".into())), ("amount", CellValue::Num(1234.5)), ("neg", CellValue::Num(-7.0)), ("kg", CellValue::Num(12.0))]);
        let ev = |s: &str| Formula::parse(s).unwrap().eval(&c, t());
        // Month arithmetic clamps to the last day; negative offsets go back.
        assert_eq!(ev("date_add(due, 1, 'month')"), Value::Text("2026-02-28".into()));
        assert_eq!(ev("date_add(due, 1, 'months')"), Value::Text("2026-02-28".into()));
        assert_eq!(ev("date_add(due, -1, 'day')"), Value::Text("2026-01-30".into()));
        assert_eq!(ev("date_add(start, 2, 'week')"), Value::Text("2026-09-23".into()));
        assert_eq!(ev("date_add(start, -1, 'quarter')"), Value::Text("2026-06-09".into()));
        assert_eq!(ev("date_add(due, 1, 'year')"), Value::Text("2027-01-31".into()));
        assert_eq!(ev("date_add(due, 1, 'fortnight')"), Value::Null);
        assert_eq!(ev("date_add(missing, 1, 'day')"), Value::Null);
        // The result is a date again: it feeds the other date functions.
        assert_eq!(ev("days_between(start, date_add(start, 10, 'day'))"), Value::Num(10.0));
        // Formatting tokens, longest first; other characters copied through.
        assert_eq!(ev("format_date(start, 'YYYY-MM')"), Value::Text("2026-09".into()));
        assert_eq!(ev("format_date(start, 'MMM Do, YYYY')"), Value::Text("Sep 9th, 2026".into()));
        assert_eq!(ev("format_date(due, 'MMMM D (Q) W YY')"), Value::Text("January 31 (1) 5 26".into()));
        assert_eq!(ev("format_date(start, 'Do')"), Value::Text("9th".into()));
        assert_eq!(ev("format_date(missing, 'YYYY')"), Value::Null);
        assert_eq!(ev("quarter(start)"), Value::Num(3.0));
        assert_eq!(ev("quarter(due)"), Value::Num(1.0));
        assert_eq!(ev("week(start)"), Value::Num(37.0));
        // Numbers: separators, decimals, symbol prefix, word suffix, sign.
        assert_eq!(ev("format_number(amount)"), Value::Text("1,234.50".into()));
        assert_eq!(ev("format_number(amount, '$')"), Value::Text("$1,234.50".into()));
        assert_eq!(ev("format_number(amount, '€', 0)"), Value::Text("€1,235".into()));
        assert_eq!(ev("format_number(kg, 'kg', 1)"), Value::Text("12.0 kg".into()));
        assert_eq!(ev("format_number(neg, '$')"), Value::Text("-$7.00".into()));
        assert_eq!(ev("format_number(1234567.891, '', 3)"), Value::Text("1,234,567.891".into()));
        assert_eq!(ev("concat('Balance: ', format_number(amount, '$'))"), Value::Text("Balance: $1,234.50".into()));
        assert_eq!(ev("format_number(missing)"), Value::Null);
        // Ordinal suffixes around the teens.
        let one = cells(&[("d", CellValue::Date("2026-03-01".into())), ("e", CellValue::Date("2026-03-12".into())), ("f", CellValue::Date("2026-03-22".into())), ("g", CellValue::Date("2026-03-23".into()))]);
        let ev1 = |s: &str| Formula::parse(s).unwrap().eval(&one, t());
        assert_eq!(ev1("format_date(d, 'Do')"), Value::Text("1st".into()));
        assert_eq!(ev1("format_date(e, 'Do')"), Value::Text("12th".into()));
        assert_eq!(ev1("format_date(f, 'Do')"), Value::Text("22nd".into()));
        assert_eq!(ev1("format_date(g, 'Do')"), Value::Text("23rd".into()));
    }
}
