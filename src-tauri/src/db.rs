use rusqlite::{params, Connection};
use std::path::Path;

use crate::error::Result;
use crate::note::NoteEntry;

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

    pub fn list_notes(&self) -> Result<Vec<NoteEntry>> {
        let mut stmt = self.conn.prepare(
            "SELECT path, title, note_type, tags, modified
             FROM notes
             ORDER BY modified DESC",
        )?;
        collect_entries(&mut stmt, [])
    }

    pub fn search(&self, raw_query: &str) -> Result<Vec<NoteEntry>> {
        let query = fts_query(raw_query);
        if query.is_empty() {
            return self.list_notes();
        }
        let mut stmt = self.conn.prepare(
            "SELECT n.path, n.title, n.note_type, n.tags, n.modified
             FROM notes_fts f
             JOIN notes n ON n.path = f.path
             WHERE notes_fts MATCH ?1
             ORDER BY rank",
        )?;
        collect_entries(&mut stmt, [query.as_str()])
    }
}

fn collect_entries<P: rusqlite::Params>(
    stmt: &mut rusqlite::Statement<'_>,
    params: P,
) -> Result<Vec<NoteEntry>> {
    let entries = stmt
        .query_map(params, |row| {
            let tags_str: String = row.get(3)?;
            let tags: Vec<String> = serde_json::from_str(&tags_str).unwrap_or_default();
            Ok(NoteEntry {
                path: row.get(0)?,
                title: row.get(1)?,
                note_type: row.get(2)?,
                tags,
                modified: row.get(4)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();
    Ok(entries)
}

/// Converts a raw search string into a safe FTS5 MATCH expression
/// with prefix matching on each word: "my no" → "my* no*"
fn fts_query(raw: &str) -> String {
    raw.split_whitespace()
        .map(|w| {
            // Strip FTS5 special characters to avoid parse errors
            let safe: String = w.chars().filter(|c| c.is_alphanumeric() || *c == '-').collect();
            if safe.is_empty() {
                String::new()
            } else {
                format!("{safe}*")
            }
        })
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}
