//! Search query translation.
//!
//! The words a user types into the search box become an FTS5 `MATCH`
//! expression plus filters on the `notes` columns, so the app, the CLI and
//! the MCP tool all understand the same operators:
//!
//! | You type          | Means                                                    |
//! |-------------------|----------------------------------------------------------|
//! | `word`            | prefix match (`word*`) in the title or body              |
//! | `"exact phrase"`  | the words in that order                                  |
//! | `-word`           | exclude notes matching `word` (also `-"a phrase"`)       |
//! | `a OR b`          | either; words next to each other are implicitly AND      |
//! | `tag:x`           | notes carrying tag `x` (or nested under `x/`)            |
//! | `type:x`          | notes whose frontmatter `type` is `x`                    |
//! | `path:x`          | notes whose path contains `x`                            |
//! | `-tag:x` …        | any filter can be negated                                |
//!
//! Every term is emitted as a quoted FTS5 string, so punctuation the user
//! types (`c++`, `foo-bar`, `a:b`) can never break the query.

use serde::{Deserialize, Serialize};

use crate::note::NoteEntry;

/// A search result: the note plus a body excerpt around the first match.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchHit {
    #[serde(flatten)]
    pub entry: NoteEntry,
    /// One line of the body around the match, the matched words wrapped in
    /// `<mark>…</mark>`. Empty when the query had no words (filters only) or
    /// nothing in the body matched.
    pub snippet: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Field {
    Tag,
    Type,
    Path,
}

impl Field {
    fn parse(key: &str) -> Option<Self> {
        match key.to_ascii_lowercase().as_str() {
            "tag" | "tags" => Some(Self::Tag),
            "type" => Some(Self::Type),
            "path" | "file" => Some(Self::Path),
            _ => None,
        }
    }
}

/// A `field:value` clause, matched against the `notes` table rather than FTS.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Filter {
    pub field: Field,
    pub value: String,
    pub negated: bool,
}

/// A parsed query, ready for [`crate::db::Db::search`].
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Query {
    /// FTS5 expression for the terms a note must match, if any.
    pub matches: Option<String>,
    /// FTS5 expression (terms joined with `OR`) a note must *not* match, if any.
    pub excludes: Option<String>,
    pub filters: Vec<Filter>,
}

impl Query {
    /// True when nothing was typed (or nothing survived translation).
    pub fn is_empty(&self) -> bool {
        self.matches.is_none() && self.excludes.is_none() && self.filters.is_empty()
    }

    /// The `MATCH` expression when there are positive terms: `(a b OR c) NOT (x OR y)`.
    pub fn match_expr(&self) -> Option<String> {
        let pos = self.matches.as_ref()?;
        Some(match &self.excludes {
            Some(neg) => format!("({pos}) NOT ({neg})"),
            None => pos.clone(),
        })
    }
}

/// One whitespace-delimited unit of the raw query, quotes resolved.
#[derive(Debug, PartialEq, Eq)]
enum Token {
    Or,
    Term { text: String, phrase: bool, negated: bool },
    Filter(Filter),
}

fn tokenize(raw: &str) -> Vec<Token> {
    let mut out = Vec::new();
    let mut chars = raw.chars().peekable();
    loop {
        while chars.peek().is_some_and(|c| c.is_whitespace()) {
            chars.next();
        }
        let Some(&first) = chars.peek() else { break };

        let negated = first == '-';
        if negated {
            chars.next();
        }

        // Read one word. A `"` opens a quoted run that may contain spaces;
        // `field:"two words"` keeps the field prefix and quotes the value.
        let mut text = String::new();
        let mut unquoted_prefix = String::new();
        let mut opened_quote = false;
        let mut quoted_at_start = false;
        while let Some(&c) = chars.peek() {
            if c == '"' {
                chars.next();
                if !opened_quote {
                    opened_quote = true;
                    quoted_at_start = text.is_empty();
                    unquoted_prefix = text.clone();
                }
                while let Some(q) = chars.next() {
                    if q == '"' {
                        break;
                    }
                    text.push(q);
                }
                continue;
            }
            if c.is_whitespace() {
                break;
            }
            chars.next();
            text.push(c);
        }
        if !opened_quote {
            unquoted_prefix = text.clone();
        }

        if !negated && !opened_quote && text == "OR" {
            out.push(Token::Or);
            continue;
        }

        // `tag:x` — only when the `tag:` part was typed outside quotes, so
        // `"tag:x"` still searches for that literal phrase.
        if !quoted_at_start {
            if let Some((key, _)) = unquoted_prefix.split_once(':') {
                if let Some(field) = Field::parse(key) {
                    let value = text[key.len() + 1..].trim().trim_start_matches('#').to_string();
                    if !value.is_empty() {
                        out.push(Token::Filter(Filter { field, value, negated }));
                    }
                    continue;
                }
            }
        }

        if text.chars().any(char::is_alphanumeric) {
            out.push(Token::Term { text, phrase: quoted_at_start, negated });
        }
    }
    out
}

/// A term as an FTS5 string: quoted (so any character is safe), and with a
/// trailing `*` for prefix matching unless it was typed as a phrase.
fn fts_term(text: &str, phrase: bool) -> String {
    let escaped = text.replace('"', "\"\"");
    if phrase {
        format!("\"{escaped}\"")
    } else {
        format!("\"{escaped}\"*")
    }
}

/// Translate a raw search string into a [`Query`].
pub fn parse(raw: &str) -> Query {
    let mut positive: Vec<String> = Vec::new();
    let mut negative: Vec<String> = Vec::new();
    let mut filters = Vec::new();

    for token in tokenize(raw) {
        match token {
            Token::Or => {
                // OR only makes sense between two terms; drop it at the start
                // or when it follows another OR.
                if positive.last().is_some_and(|p| p != "OR") {
                    positive.push("OR".to_string());
                }
            }
            Token::Term { text, phrase, negated: true } => negative.push(fts_term(&text, phrase)),
            Token::Term { text, phrase, negated: false } => positive.push(fts_term(&text, phrase)),
            Token::Filter(f) => filters.push(f),
        }
    }
    if positive.last().is_some_and(|p| p == "OR") {
        positive.pop();
    }

    Query {
        matches: (!positive.is_empty()).then(|| positive.join(" ")),
        excludes: (!negative.is_empty()).then(|| negative.join(" OR ")),
        filters,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn filter(field: Field, value: &str, negated: bool) -> Filter {
        Filter { field, value: value.to_string(), negated }
    }

    #[test]
    fn words_become_quoted_prefix_terms() {
        let q = parse("my no");
        assert_eq!(q.matches.as_deref(), Some("\"my\"* \"no\"*"));
        assert_eq!(q.excludes, None);
        assert!(q.filters.is_empty());
    }

    #[test]
    fn punctuation_is_kept_inside_the_quotes() {
        assert_eq!(parse("c++ foo-bar").matches.as_deref(), Some("\"c++\"* \"foo-bar\"*"));
        assert_eq!(parse("x:y").matches.as_deref(), Some("\"x:y\"*"), "unknown field is a plain word");
    }

    #[test]
    fn quoted_text_is_a_phrase_without_prefix() {
        assert_eq!(parse("\"exact phrase\" more").matches.as_deref(), Some("\"exact phrase\" \"more\"*"));
        assert_eq!(parse("\"unterminated").matches.as_deref(), Some("\"unterminated\""));
    }

    #[test]
    fn minus_excludes() {
        let q = parse("rust -draft -\"work in progress\"");
        assert_eq!(q.matches.as_deref(), Some("\"rust\"*"));
        assert_eq!(q.excludes.as_deref(), Some("\"draft\"* OR \"work in progress\""));
        assert_eq!(q.match_expr().as_deref(), Some("(\"rust\"*) NOT (\"draft\"* OR \"work in progress\")"));
    }

    #[test]
    fn exclusion_alone_has_no_match_expr() {
        let q = parse("-draft");
        assert_eq!(q.matches, None);
        assert_eq!(q.excludes.as_deref(), Some("\"draft\"*"));
        assert_eq!(q.match_expr(), None);
        assert!(!q.is_empty());
    }

    #[test]
    fn or_passes_through_and_is_tidied() {
        assert_eq!(parse("cat OR dog").matches.as_deref(), Some("\"cat\"* OR \"dog\"*"));
        assert_eq!(parse("OR cat OR OR dog OR").matches.as_deref(), Some("\"cat\"* OR \"dog\"*"));
        assert_eq!(parse("or").matches.as_deref(), Some("\"or\"*"), "lowercase or is a word");
        assert_eq!(parse("\"OR\"").matches.as_deref(), Some("\"OR\""), "quoted OR is a phrase");
        assert_eq!(parse("OR"), Query::default());
    }

    #[test]
    fn field_filters() {
        let q = parse("tag:work type:meeting path:notes/2026 hello");
        assert_eq!(q.matches.as_deref(), Some("\"hello\"*"));
        assert_eq!(q.filters, vec![
            filter(Field::Tag, "work", false),
            filter(Field::Type, "meeting", false),
            filter(Field::Path, "notes/2026", false),
        ]);
    }

    #[test]
    fn filters_accept_quotes_hashes_and_negation() {
        let q = parse("tag:#work -type:\"meeting notes\" TAG:x tag:");
        assert_eq!(q.matches, None);
        assert_eq!(q.filters, vec![
            filter(Field::Tag, "work", false),
            filter(Field::Type, "meeting notes", true),
            filter(Field::Tag, "x", false),
        ]);
        assert!(parse("tag:").is_empty(), "a filter without a value is nothing");
    }

    #[test]
    fn quoted_field_syntax_is_a_phrase() {
        let q = parse("\"tag:work\"");
        assert_eq!(q.matches.as_deref(), Some("\"tag:work\""));
        assert!(q.filters.is_empty());
    }

    #[test]
    fn empty_and_junk_queries_are_empty() {
        assert!(parse("").is_empty());
        assert!(parse("   ").is_empty());
        assert!(parse("- \"\" *** OR").is_empty());
    }

    #[test]
    fn a_stray_quote_is_consumed() {
        assert_eq!(parse("say\"hi").matches.as_deref(), Some("\"sayhi\"*"));
    }
}
