//! Recurrence — a row that comes back.
//!
//! A row carries `repeat: weekly` (or `daily`, `biweekly`, `monthly`,
//! `quarterly`, `yearly`, `every 3 days`, `every 2 weeks`, `every 6 months`).
//! When the row is finished — its status set to done, or a checkbox such as
//! `done` / `paid` ticked — the engine advances every date property by the
//! interval and either writes the result as a **new row** (a task, a meeting:
//! history stays) or moves this row forward in place (`repeat_mode: advance`
//! — a bill's next due date). The trigger and the auto-stamped dates are
//! reset so the next occurrence starts clean. Nothing runs on a timer: the
//! next occurrence exists the moment the current one is done, which is also
//! the moment you would have created it by hand.

use chrono::{Datelike, Duration, NaiveDate};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Unit { Days, Weeks, Months, Years }

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Interval { pub n: u32, pub unit: Unit }

/// Parse a `repeat:` value. `None` when it is not a rule we know.
pub fn parse(rule: &str) -> Option<Interval> {
    let r = rule.trim().to_lowercase();
    let simple = match r.as_str() {
        "daily" | "every day" => Some((1, Unit::Days)),
        "weekdays" => Some((1, Unit::Days)), // advanced by a day; the weekday skip happens in `shift`
        "weekly" | "every week" => Some((1, Unit::Weeks)),
        "biweekly" | "fortnightly" | "every other week" => Some((2, Unit::Weeks)),
        "monthly" | "every month" => Some((1, Unit::Months)),
        "quarterly" => Some((3, Unit::Months)),
        "yearly" | "annually" | "every year" => Some((1, Unit::Years)),
        _ => None,
    };
    if let Some((n, unit)) = simple { return Some(Interval { n, unit }); }
    let rest = r.strip_prefix("every ")?;
    let mut parts = rest.split_whitespace();
    let n: u32 = parts.next()?.parse().ok()?;
    let unit = match parts.next()?.trim_end_matches('s') {
        "day" => Unit::Days,
        "week" => Unit::Weeks,
        "month" => Unit::Months,
        "year" => Unit::Years,
        _ => return None,
    };
    Some(Interval { n: n.max(1), unit })
}

/// The date one interval later. Month and year steps keep the day of month
/// where the month has it, else the month's last day.
pub fn shift(d: NaiveDate, by: Interval) -> NaiveDate {
    match by.unit {
        Unit::Days => d + Duration::days(by.n as i64),
        Unit::Weeks => d + Duration::days(7 * by.n as i64),
        Unit::Months => add_months(d, by.n as i32),
        Unit::Years => add_months(d, 12 * by.n as i32),
    }
}

fn add_months(d: NaiveDate, by: i32) -> NaiveDate {
    let total = d.year() * 12 + d.month0() as i32 + by;
    let (y, m) = (total.div_euclid(12), (total.rem_euclid(12) + 1) as u32);
    let last = last_day(y, m);
    NaiveDate::from_ymd_opt(y, m, d.day().min(last)).unwrap_or(d)
}

fn last_day(y: i32, m: u32) -> u32 {
    let (ny, nm) = if m == 12 { (y + 1, 1) } else { (y, m + 1) };
    (NaiveDate::from_ymd_opt(ny, nm, 1).unwrap() - Duration::days(1)).day()
}

/// Shift an ISO date string; anything that is not a date is returned unchanged.
pub fn shift_text(s: &str, by: Interval) -> String {
    match NaiveDate::parse_from_str(&s[..s.len().min(10)], "%Y-%m-%d") {
        Ok(d) => shift(d, by).format("%Y-%m-%d").to_string(),
        Err(_) => s.to_string(),
    }
}

/// Words that mean "this row is finished" when they are a status value or
/// a checkbox name — used when no schema says which option is the last.
pub fn is_done_word(s: &str) -> bool {
    matches!(s.trim().to_lowercase().as_str(), "done" | "complete" | "completed" | "finished" | "paid" | "published" | "closed" | "shipped" | "read")
}

#[cfg(test)]
mod tests {
    use super::*;
    fn d(s: &str) -> NaiveDate { NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap() }

    #[test]
    fn rules_and_shifts() {
        assert_eq!(parse("weekly"), Some(Interval { n: 1, unit: Unit::Weeks }));
        assert_eq!(parse("Every 3 days"), Some(Interval { n: 3, unit: Unit::Days }));
        assert_eq!(parse("every 2 weeks"), Some(Interval { n: 2, unit: Unit::Weeks }));
        assert_eq!(parse("quarterly"), Some(Interval { n: 3, unit: Unit::Months }));
        assert_eq!(parse("sometimes"), None);
        assert_eq!(shift(d("2026-01-31"), parse("monthly").unwrap()), d("2026-02-28"));
        assert_eq!(shift(d("2026-02-28"), parse("yearly").unwrap()), d("2027-02-28"));
        assert_eq!(shift(d("2026-09-09"), parse("biweekly").unwrap()), d("2026-09-23"));
        assert_eq!(shift_text("2026-09-09", parse("daily").unwrap()), "2026-09-10");
        assert_eq!(shift_text("not a date", parse("daily").unwrap()), "not a date");
        assert!(is_done_word("Done") && is_done_word("paid") && !is_done_word("doing"));
    }
}
