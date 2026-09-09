use rusqlite::{params, params_from_iter, Connection};
use std::path::Path;

use crate::error::Result;
use crate::note::NoteEntry;
use crate::search::{self, Field, SearchHit};

pub struct Db {
    conn: Connection,
}

impl std::fmt::Debug for Db {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Db").finish_non_exhaustive()
    }
}

impl Db {
    pub fn open(vault_path: &Path) -> Result<Self> {
        let db_path = vault_path.join(".brain").join("index.db");
        std::fs::create_dir_all(db_path.parent().unwrap())?;
        let conn = Connection::open(db_path)?;
        let db = Self { conn };
        db.migrate()?;
        Ok(db)
    }

    #[cfg(test)]
    pub(crate) fn open_in_memory() -> Result<Self> {
        let db = Self { conn: Connection::open_in_memory()? };
        db.migrate()?;
        Ok(db)
    }

    fn migrate(&self) -> Result<()> {
        self.conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS notes (
                path        TEXT PRIMARY KEY,
                title       TEXT NOT NULL DEFAULT '',
                note_type   TEXT,
                tags        TEXT NOT NULL DEFAULT '[]',
                modified    INTEGER NOT NULL DEFAULT 0,
                indexed_at  INTEGER NOT NULL DEFAULT 0
            );

            -- Plain FTS5 (no content='') so DELETE works normally
            CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts
                USING fts5(path UNINDEXED, title, body);

            -- [[wiki link]] graph: source note → raw link target text
            CREATE TABLE IF NOT EXISTS links (
                source  TEXT NOT NULL,
                target  TEXT NOT NULL,
                PRIMARY KEY (source, target)
            );
            ",
        )?;
        Ok(())
    }

    pub fn upsert_note(&self, entry: &NoteEntry, body: &str) -> Result<()> {
        let tags = serde_json::to_string(&entry.tags).unwrap_or_default();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);

        self.conn.execute(
            "INSERT INTO notes (path, title, note_type, tags, modified, indexed_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(path) DO UPDATE SET
               title=excluded.title,
               note_type=excluded.note_type,
               tags=excluded.tags,
               modified=excluded.modified,
               indexed_at=excluded.indexed_at",
            params![entry.path, entry.title, entry.note_type, tags, entry.modified, now],
        )?;

        // FTS5 doesn't support ON CONFLICT — delete + insert
        self.conn
            .execute("DELETE FROM notes_fts WHERE path = ?1", params![entry.path])?;
        self.conn.execute(
            "INSERT INTO notes_fts(path, title, body) VALUES (?1, ?2, ?3)",
            params![entry.path, entry.title, body],
        )?;

        Ok(())
    }

    pub fn upsert_links(&self, source: &str, targets: &[String]) -> Result<()> {
        self.conn
            .execute("DELETE FROM links WHERE source = ?1", params![source])?;
        for target in targets {
            self.conn.execute(
                "INSERT OR IGNORE INTO links (source, target) VALUES (?1, ?2)",
                params![source, target],
            )?;
        }
        Ok(())
    }

    /// Return all notes that contain a [[link]] pointing at this note,
    /// matched by title or path stem.
    pub fn get_backlinks(&self, path: &str) -> Result<Vec<NoteEntry>> {
        let stem = path
            .split('/')
            .next_back()
            .unwrap_or(path)
            .trim_end_matches(".md");

        let title: Option<String> = self
            .conn
            .query_row(
                "SELECT title FROM notes WHERE path = ?1",
                params![path],
                |row| row.get(0),
            )
            .ok();
        let title = title.unwrap_or_else(|| stem.to_string());

        let mut stmt = self.conn.prepare(
            "SELECT DISTINCT n.path, n.title, n.note_type, n.tags, n.modified
             FROM links l
             JOIN notes n ON n.path = l.source
             WHERE (l.target = ?1 OR l.target = ?2)
               AND l.source != ?3
             ORDER BY n.modified DESC",
        )?;
        collect_entries(&mut stmt, params![title, stem, path])
    }

    pub fn remove_note(&self, path: &str) -> Result<()> {
        self.conn.execute("DELETE FROM notes WHERE path = ?1", params![path])?;
        self.conn.execute("DELETE FROM notes_fts WHERE path = ?1", params![path])?;
        self.conn.execute("DELETE FROM links WHERE source = ?1", params![path])?;
        Ok(())
    }

    /// Remove all notes whose paths start with `prefix` (e.g. "notes/work/").
    pub fn remove_notes_by_prefix(&self, prefix: &str) -> Result<()> {
        let pattern = format!("{prefix}%");
        self.conn.execute("DELETE FROM notes WHERE path LIKE ?1", params![pattern])?;
        self.conn.execute("DELETE FROM notes_fts WHERE path LIKE ?1", params![pattern])?;
        self.conn.execute("DELETE FROM links WHERE source LIKE ?1", params![pattern])?;
        Ok(())
    }

    /// Update index paths after a note is moved/renamed.
    pub fn rename_note(&self, old_path: &str, new_path: &str) -> Result<()> {
        self.conn.execute(
            "UPDATE notes SET path = ?1 WHERE path = ?2",
            params![new_path, old_path],
        )?;
        self.conn.execute(
            "UPDATE links SET source = ?1 WHERE source = ?2",
            params![new_path, old_path],
        )?;
        // FTS5 row must be re-inserted with the new path
        self.conn.execute("DELETE FROM notes_fts WHERE path = ?1", params![old_path])?;
        Ok(())
    }

    pub fn get_all_links(&self) -> Result<Vec<(String, String)>> {
        let mut stmt = self.conn.prepare("SELECT source, target FROM links")?;
        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    pub fn list_notes(&self) -> Result<Vec<NoteEntry>> {
        let mut stmt = self.conn.prepare(
            "SELECT path, title, note_type, tags, modified
             FROM notes
             ORDER BY modified DESC",
        )?;
        collect_entries(&mut stmt, [])
    }

    /// Full-text search with the operators in [`crate::search`]: prefix
    /// words, `"phrases"`, `-excluded`, `OR`, and `tag:` / `type:` / `path:`
    /// filters. Title matches rank above body matches; each hit carries a
    /// body snippet with the match highlighted. An empty query lists
    /// everything, newest first.
    pub fn search(&self, raw_query: &str) -> Result<Vec<SearchHit>> {
        let query = search::parse(raw_query);
        if query.is_empty() {
            return Ok(self.list_notes()?.into_iter().map(|entry| SearchHit { entry, snippet: String::new() }).collect());
        }

        let mut params: Vec<String> = Vec::new();
        let mut clauses: Vec<String> = Vec::new();

        // Positive terms drive FTS; exclusions ride inside the same MATCH as
        // `NOT`. With no positive terms there is nothing to MATCH, so the
        // exclusions become an anti-join and the list is ordered by date.
        let (from, order, snippet) = match query.match_expr() {
            Some(expr) => {
                params.push(expr);
                clauses.push("notes_fts MATCH ?1".to_string());
                (
                    "notes_fts f JOIN notes n ON n.path = f.path",
                    "bm25(notes_fts, 0.0, 5.0, 1.0)",
                    "snippet(notes_fts, 2, '<mark>', '</mark>', '…', 12)",
                )
            }
            None => {
                if let Some(neg) = &query.excludes {
                    params.push(neg.clone());
                    clauses.push("n.path NOT IN (SELECT path FROM notes_fts WHERE notes_fts MATCH ?1)".to_string());
                }
                ("notes n", "n.modified DESC", "''")
            }
        };

        for f in &query.filters {
            params.push(f.value.clone());
            let i = params.len();
            let test = match f.field {
                Field::Tag => format!(
                    "EXISTS (SELECT 1 FROM json_each(n.tags) \
                     WHERE lower(json_each.value) = lower(?{i}) \
                        OR lower(json_each.value) LIKE lower(?{i}) || '/%')"
                ),
                Field::Type => format!("lower(coalesce(n.note_type, '')) = lower(?{i})"),
                Field::Path => format!("instr(lower(n.path), lower(?{i})) > 0"),
            };
            clauses.push(if f.negated { format!("NOT ({test})") } else { test });
        }

        let sql = format!(
            "SELECT n.path, n.title, n.note_type, n.tags, n.modified, {snippet}
             FROM {from}
             WHERE {}
             ORDER BY {order}",
            clauses.join(" AND "),
        );
        let mut stmt = self.conn.prepare(&sql)?;
        let hits = stmt
            .query_map(params_from_iter(params.iter()), |row| {
                let snippet: String = row.get(5)?;
                Ok(SearchHit { entry: entry_from_row(row)?, snippet: one_line(&snippet) })
            })?
            .filter_map(|r| r.ok())
            .collect();
        Ok(hits)
    }
}

/// Collapse a snippet onto one line so it sits under a result row.
fn one_line(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn entry_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<NoteEntry> {
    let tags_str: String = row.get(3)?;
    let tags: Vec<String> = serde_json::from_str(&tags_str).unwrap_or_default();
    Ok(NoteEntry {
        path: row.get(0)?,
        title: row.get(1)?,
        note_type: row.get(2)?,
        tags,
        modified: row.get(4)?,
        icon: None,
        parent: None,
    })
}

fn collect_entries<P: rusqlite::Params>(
    stmt: &mut rusqlite::Statement<'_>,
    params: P,
) -> Result<Vec<NoteEntry>> {
    let entries = stmt
        .query_map(params, entry_from_row)?
        .filter_map(|r| r.ok())
        .collect();
    Ok(entries)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn note(path: &str, title: &str, note_type: Option<&str>, tags: &[&str]) -> NoteEntry {
        NoteEntry {
            path: path.to_string(),
            title: title.to_string(),
            note_type: note_type.map(str::to_string),
            tags: tags.iter().map(|t| t.to_string()).collect(),
            modified: 0,
            icon: None,
            parent: None,
        }
    }

    /// Four notes that between them exercise every operator.
    fn vault() -> Db {
        let db = Db::open_in_memory().unwrap();
        let rows = [
            (note("notes/rust.md", "Rust notes", Some("note"), &["lang", "work/backend"]),
             "Ownership and borrowing. The borrow checker is strict but fair."),
            (note("notes/journal/2026-01-01.md", "New year", Some("journal"), &["personal"]),
             "Resolved to learn Rust properly this year. Draft plan follows."),
            (note("notes/work/standup.md", "Standup", Some("meeting"), &["work"]),
             "Discussed the borrow checker bug and the deploy schedule."),
            (note("notes/cats.md", "Cats", None, &[]),
             "The cat sat on the mat. Cats are strict about naps."),
        ];
        for (entry, body) in rows {
            db.upsert_note(&entry, body).unwrap();
        }
        db
    }

    fn paths(hits: &[SearchHit]) -> Vec<String> {
        hits.iter().map(|h| h.entry.path.clone()).collect()
    }

    #[test]
    fn prefix_words_match_title_and_body_and_title_ranks_first() {
        let hits = vault().search("rust").unwrap();
        assert_eq!(paths(&hits), vec!["notes/rust.md", "notes/journal/2026-01-01.md"]);
        assert_eq!(vault().search("borrow").unwrap().len(), 2, "prefix of 'borrowing' and 'borrow'");
    }

    #[test]
    fn snippet_highlights_the_match_on_one_line() {
        let hits = vault().search("checker").unwrap();
        let rust = hits.iter().find(|h| h.entry.path == "notes/rust.md").unwrap();
        assert!(rust.snippet.contains("borrow <mark>checker</mark> is strict"), "{}", rust.snippet);
        assert!(!rust.snippet.contains('\n'));
    }

    #[test]
    fn quoted_phrase_needs_the_words_in_order() {
        let db = vault();
        assert_eq!(paths(&db.search("\"borrow checker\"").unwrap()).len(), 2);
        assert!(db.search("\"checker borrow\"").unwrap().is_empty());
        assert!(db.search("\"the cat\"").unwrap().len() == 1, "phrases are exact, not prefix");
    }

    #[test]
    fn minus_excludes_a_word() {
        let db = vault();
        assert_eq!(paths(&db.search("rust -draft").unwrap()), vec!["notes/rust.md"]);
        // Exclusion alone: everything that does not match, newest first.
        let rest = db.search("-strict").unwrap();
        assert_eq!(rest.len(), 2);
        assert!(rest.iter().all(|h| h.entry.path != "notes/rust.md" && h.entry.path != "notes/cats.md"));
        assert!(rest.iter().all(|h| h.snippet.is_empty()));
    }

    #[test]
    fn or_widens_the_match() {
        let hits = vault().search("cats OR deploy").unwrap();
        let mut got = paths(&hits);
        got.sort();
        assert_eq!(got, vec!["notes/cats.md", "notes/work/standup.md"]);
    }

    #[test]
    fn tag_filter_is_exact_case_insensitive_and_nested() {
        let db = vault();
        let mut work = paths(&db.search("tag:Work").unwrap());
        work.sort();
        assert_eq!(work, vec!["notes/rust.md", "notes/work/standup.md"], "work and work/backend");
        assert_eq!(paths(&db.search("tag:lang").unwrap()), vec!["notes/rust.md"]);
        assert!(db.search("tag:lan").unwrap().is_empty(), "no prefix matching on tags");
        assert_eq!(paths(&db.search("strict -tag:lang").unwrap()), vec!["notes/cats.md"]);
    }

    #[test]
    fn type_and_path_filters_combine_with_words() {
        let db = vault();
        assert_eq!(paths(&db.search("type:meeting").unwrap()), vec!["notes/work/standup.md"]);
        assert_eq!(paths(&db.search("borrow type:meeting").unwrap()), vec!["notes/work/standup.md"]);
        assert_eq!(paths(&db.search("path:journal").unwrap()), vec!["notes/journal/2026-01-01.md"]);
        assert_eq!(paths(&db.search("strict path:notes/ -path:cats").unwrap()), vec!["notes/rust.md"]);
        assert!(db.search("type:nope").unwrap().is_empty());
    }

    #[test]
    fn punctuation_and_empty_queries_never_error() {
        let db = vault();
        // `c*` and `(rust*` both hit the Rust note; the point is no FTS5 parse error.
        assert_eq!(paths(&db.search("c++ (rust OR NOT \"").unwrap()), vec!["notes/rust.md"]);
        assert_eq!(db.search("").unwrap().len(), 4);
        assert_eq!(db.search("*** -").unwrap().len(), 4, "nothing usable typed → everything");
    }
}
