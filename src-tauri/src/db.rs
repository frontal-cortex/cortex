use rusqlite::{Connection, params};
use std::path::Path;
use crate::error::Result;
use crate::note::NoteEntry;

pub struct Db {
    conn: Connection,
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
        self.conn.execute_batch("
            CREATE TABLE IF NOT EXISTS notes (
                path        TEXT PRIMARY KEY,
                title       TEXT NOT NULL DEFAULT '',
                note_type   TEXT,
                tags        TEXT NOT NULL DEFAULT '[]',
                modified    INTEGER NOT NULL DEFAULT 0,
                indexed_at  INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS links (
                source TEXT NOT NULL,
                target TEXT NOT NULL,
                PRIMARY KEY (source, target)
            );

            CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts
                USING fts5(path UNINDEXED, title, body, content='');
        ")?;
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
               title=excluded.title, note_type=excluded.note_type,
               tags=excluded.tags, modified=excluded.modified,
               indexed_at=excluded.indexed_at",
            params![entry.path, entry.title, entry.note_type, tags, entry.modified, now],
        )?;

        self.conn.execute(
            "INSERT INTO notes_fts(path, title, body) VALUES (?1, ?2, ?3)
             ON CONFLICT DO UPDATE SET title=excluded.title, body=excluded.body",
            params![entry.path, entry.title, body],
        )?;

        Ok(())
    }

    pub fn list_notes(&self) -> Result<Vec<NoteEntry>> {
        let mut stmt = self.conn.prepare(
            "SELECT path, title, note_type, tags, modified FROM notes ORDER BY modified DESC"
        )?;

        let entries = stmt.query_map([], |row| {
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

    pub fn search(&self, query: &str) -> Result<Vec<NoteEntry>> {
        let mut stmt = self.conn.prepare(
            "SELECT n.path, n.title, n.note_type, n.tags, n.modified
             FROM notes_fts f
             JOIN notes n ON n.path = f.path
             WHERE notes_fts MATCH ?1
             ORDER BY rank"
        )?;

        let entries = stmt.query_map(params![query], |row| {
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
}
