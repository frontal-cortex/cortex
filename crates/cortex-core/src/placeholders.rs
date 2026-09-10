//! Date placeholders and relative dates — one vocabulary for templates,
//! seeds and filters.
//!
//! Placeholders (in `{{…}}`): `today`, `today+7`, `today-1`, `monday`,
//! `monday-1` (the Monday of last week), `sunday`, `month` (`YYYY-MM`),
//! `year`, `week` (`YYYY-Www`). Row templates also get `date` (the row's own
//! day) with the same offsets. Filters use the same words after `@`:
//! `due <= @today`, `date >= @today-7`, `week == @monday`.
//!
//! Everything resolves against one base day so a seed installed on a Sunday
//! and a filter run on a Monday agree about what "this week" means.

use chrono::{Datelike, Duration, NaiveDate, Weekday};

/// Resolve one placeholder name (without braces or `@`) against `base`.
/// `None` when the name is not a date word.
pub fn resolve(name: &str, base: NaiveDate) -> Option<String> {
    let name = name.trim();
    let (word, offset) = split_offset(name)?;
    let d = match word {
        "today" | "date" | "now" => base + Duration::days(offset),
        "tomorrow" => base + Duration::days(1 + offset),
        "yesterday" => base - Duration::days(1 - offset),
        "monday" => monday(base) + Duration::days(7 * offset),
        "sunday" => monday(base) + Duration::days(6 + 7 * offset),
        "month" => return Some(shift_month(base, offset as i32).format("%Y-%m").to_string()),
        "year" => return Some(format!("{}", base.year() + offset as i32)),
        // The quarter's first day, so `date >= @quarter and date < @quarter+1` reads naturally.
        "quarter" => {
            let q0 = shift_month(NaiveDate::from_ymd_opt(base.year(), base.month0() / 3 * 3 + 1, 1).unwrap(), 3 * offset as i32);
            return Some(q0.format("%Y-%m-%d").to_string());
        }
        "week" => {
            let m = monday(base) + Duration::days(7 * offset);
            let iso = m.iso_week();
            return Some(format!("{}-W{:02}", iso.year(), iso.week()));
        }
        _ => return None,
    };
    Some(d.format("%Y-%m-%d").to_string())
}

/// Is `name` a date placeholder this module resolves?
pub fn is_date_word(name: &str) -> bool {
    resolve(name, NaiveDate::from_ymd_opt(2000, 1, 3).unwrap()).is_some()
}

/// Expand every `{{word±n}}` date placeholder in `text` against `base`.
/// Other placeholders (`{{title}}`, `{{uuid}}`, unknown words) are left alone.
pub fn expand(text: &str, base: NaiveDate) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = rest.find("{{") {
        out.push_str(&rest[..start]);
        let after = &rest[start + 2..];
        match after.find("}}") {
            None => { out.push_str(&rest[start..]); return out; }
            Some(end) => {
                let name = &after[..end];
                match resolve(name, base) {
                    Some(v) => out.push_str(&v),
                    None => { out.push_str("{{"); out.push_str(name); out.push_str("}}"); }
                }
                rest = &after[end + 2..];
            }
        }
    }
    out.push_str(rest);
    out
}

/// Replace `@today`, `@today-7`, `@monday`, … in a filter string with ISO dates.
/// `@me` and unknown words are untouched (the caller resolves those).
pub fn resolve_in_filter(filter: &str, base: NaiveDate) -> String {
    let mut out = String::with_capacity(filter.len());
    let bytes = filter.as_bytes();
    let mut i = 0;
    while i < filter.len() {
        if bytes[i] == b'@' {
            let start = i + 1;
            let mut j = start;
            while j < filter.len() && (bytes[j].is_ascii_alphanumeric() || bytes[j] == b'+' || bytes[j] == b'-' || bytes[j] == b'_') { j += 1; }
            let word = &filter[start..j];
            match resolve(word, base) {
                Some(v) => { out.push_str(&v); i = j; continue; }
                None => { out.push('@'); i += 1; continue; }
            }
        }
        let ch = filter[i..].chars().next().unwrap();
        out.push(ch);
        i += ch.len_utf8();
    }
    out
}

fn split_offset(name: &str) -> Option<(&str, i64)> {
    let idx = name.find(['+', '-']);
    match idx {
        None => Some((name, 0)),
        Some(i) => {
            let (w, off) = name.split_at(i);
            let n: i64 = off.parse().ok()?;
            Some((w, n))
        }
    }
}

fn monday(d: NaiveDate) -> NaiveDate {
    d - Duration::days(d.weekday().num_days_from_monday() as i64)
}

fn shift_month(d: NaiveDate, by: i32) -> NaiveDate {
    let total = d.year() * 12 + d.month0() as i32 + by;
    NaiveDate::from_ymd_opt(total.div_euclid(12), (total.rem_euclid(12) + 1) as u32, 1).unwrap_or(d)
}

pub fn today() -> NaiveDate {
    chrono::Local::now().date_naive()
}

#[allow(dead_code)]
fn _weekday_unused(_: Weekday) {}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(s: &str) -> NaiveDate { NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap() }

    #[test]
    fn words_and_offsets() {
        let base = d("2026-09-09"); // a Wednesday
        assert_eq!(resolve("today", base).unwrap(), "2026-09-09");
        assert_eq!(resolve("today+7", base).unwrap(), "2026-09-16");
        assert_eq!(resolve("today-30", base).unwrap(), "2026-08-10");
        assert_eq!(resolve("monday", base).unwrap(), "2026-09-07");
        assert_eq!(resolve("monday-1", base).unwrap(), "2026-08-31");
        assert_eq!(resolve("sunday", base).unwrap(), "2026-09-13");
        assert_eq!(resolve("month", base).unwrap(), "2026-09");
        assert_eq!(resolve("month-1", base).unwrap(), "2026-08");
        assert_eq!(resolve("month+4", base).unwrap(), "2027-01");
        assert_eq!(resolve("year", base).unwrap(), "2026");
        assert_eq!(resolve("week", base).unwrap(), "2026-W37");
        assert_eq!(resolve("tomorrow", base).unwrap(), "2026-09-10");
        assert!(resolve("title", base).is_none());
        assert!(resolve("today+x", base).is_none());
    }

    #[test]
    fn expands_text_and_leaves_the_rest() {
        let base = d("2026-09-09");
        assert_eq!(expand("created: \"{{today}}\"\ndue: \"{{today+7}}\"\nt: \"{{title}}\"", base), "created: \"2026-09-09\"\ndue: \"2026-09-16\"\nt: \"{{title}}\"");
        assert_eq!(expand("{{monday}} to {{sunday}} ({{week}})", base), "2026-09-07 to 2026-09-13 (2026-W37)");
        assert_eq!(expand("unterminated {{today", base), "unterminated {{today");
    }

    #[test]
    fn filters() {
        let base = d("2026-09-09");
        assert_eq!(resolve_in_filter("due <= @today and owner == @me", base), "due <= 2026-09-09 and owner == @me");
        assert_eq!(resolve_in_filter("date >= @today-7 and date < @monday+1", base), "date >= 2026-09-02 and date < 2026-09-14");
        assert_eq!(resolve_in_filter("a == 'x@y'", base), "a == 'x@y'");
    }

    #[test]
    fn quarter_word() {
        let base = d("2026-09-09");
        assert_eq!(resolve("quarter", base).unwrap(), "2026-07-01");
        assert_eq!(resolve("quarter+1", base).unwrap(), "2026-10-01");
        assert_eq!(resolve("quarter-1", base).unwrap(), "2026-04-01");
        assert_eq!(resolve("quarter-3", base).unwrap(), "2025-10-01");
        assert_eq!(resolve("quarter", d("2026-01-15")).unwrap(), "2026-01-01");
        assert!(is_date_word("quarter"));
    }
}
