# Wiki Links

How `[[wiki links]]` work in Second Brain.

## Storage format

Wiki links are stored as plain text in the Markdown body:

```markdown
See my notes on [[Project Alpha]] and the [[Meeting 2024-01-15]].
```

This is intentional — the file is readable and grep-able without the app.
A file with wiki links is valid standard Markdown (links just render as
literal text in other tools).

Three forms are understood, everywhere a link is read (app, CLI, MCP,
publisher, indexer) — all through one parser, `note::parse_wiki_link`:

| Written | Opens | Shown as |
|---|---|---|
| `[[Note]]` | Note | `[[Note]]` |
| `[[Note\|shown text]]` | Note | `shown text` (the `[[Note\|` and `]]` reappear while the cursor is in the link) |
| `[[Note#Section]]` | Note, scrolled to the `Section` heading | `[[Note#Section]]` |

The parts combine as `[[Note#Section|shown text]]`; `![[Note#Section]]` is
the embed form of the same thing. Only the note part (`Note`) identifies the
target: backlinks, the graph and `cortex links` match on it alone. Nothing
is rewritten on disk.

## Resolution

When you click a `[[link]]`, the app resolves the note part (alias and
section stripped) in order:

1. Exact vault path (`notes/x.md`, with or without the extension)
2. Exact title match (`title:` frontmatter field, case-insensitive)
3. Path stem match (filename without extension)

If no match is found, the click is a no-op (future: offer to create).

## Autocomplete

Typing `[[` in the editor opens a dropdown showing matching notes.
Keep typing to filter. Navigate with `↑↓`, confirm with `Enter` or `Tab`.

The selected title is inserted as `[[Note Title]]` (closing `]]` always
added automatically). A `#section` or `|alias` typed after the query is
kept: `[[proj#Goals|the goals` → `[[Project Alpha#Goals|the goals]]`.

## Backlinks

The app maintains a `links` table in the SQLite index. Every time a note
is indexed, its `[[...]]` references are extracted and stored as
`source → target` rows.

The "Linked from" panel at the bottom of the editor queries this table
to show all notes that link to the current note. It updates in real time
as you write.

## Implementation

- **Decoration**: the `wikiLinkExtension` ProseMirror plugin decorates
  `[[...]]` text with a `.wiki-link` CSS class at render time. No
  document node types are added — the text stays as plain characters.

- **Suggestion**: the `wikiLinkSuggestion` ProseMirror plugin detects
  when the cursor is inside an unclosed `[[...` pattern and fires
  callbacks to show the React dropdown.

- **Index**: `note::extract_wiki_links()` in Rust parses `[[...]]` without
  a regex crate dependency, called by the indexer on every write. Each hit
  goes through `note::parse_wiki_link()`; only the target is stored, so
  `[[Note|alias]]` and `[[Note#Section]]` both count as a backlink of Note.
