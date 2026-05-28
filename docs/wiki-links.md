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

## Resolution

When you click a `[[link]]`, the app resolves it in order:

1. Exact title match (`title:` frontmatter field)
2. Path stem match (filename without extension, spaces normalized)

If no match is found, the click is a no-op (future: offer to create).

## Autocomplete

Typing `[[` in the editor opens a dropdown showing matching notes.
Keep typing to filter. Navigate with `↑↓`, confirm with `Enter` or `Tab`.

The selected title is inserted as `[[Note Title]]` (closing `]]` always
added automatically).

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
  a regex crate dependency, called by the indexer on every write.
