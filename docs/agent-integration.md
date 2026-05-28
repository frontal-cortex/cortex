# Agent Integration

How AI agents interact with a Second Brain vault.

## Protocol

Agents interact through standard git. No app-specific API is required.

```
1. Agent clones or fetches the vault repo
2. Agent creates a branch:  agent/<description>
3. Agent reads/writes .md files on that branch
4. Agent commits and pushes the branch
5. App detects agent/* branches → shows as "Agent proposals"
6. User reviews the diff, then Applies (merge) or Discards (delete branch)
```

The agent only needs: git access + knowledge that notes are Markdown files
with YAML frontmatter. It does not need to know the app exists.

## Branch naming

All agent branches must start with `agent/`. The text after the slash
becomes the proposal description shown in the UI.

```
agent/summarise-meeting-notes
agent/create-project-plan
agent/weekly-review
```

## What agents can do

| Action | How |
|--------|-----|
| Read notes | `git clone` or `git fetch`, read `.md` files |
| Create notes | Write a new `.md` file with frontmatter |
| Edit notes | Modify existing `.md` files |
| Delete notes | `git rm` a file |
| Create folders | `mkdir` (git tracks via `.gitkeep` or first file) |
| Link notes | Write `[[Note Title]]` in the body |

## Frontmatter conventions

Agents should follow the same frontmatter conventions as the app:

```yaml
---
created: 2024-01-15   # ISO date
tags: [tag1, tag2]    # list
title: Note Title     # display name
type: note            # note type
---
```

Keys must be **alphabetically sorted** so the app produces identical output
and diffs stay clean. Any extra fields are preserved.

## Review UX

When an `agent/*` branch exists, the sidebar shows it under "Agent proposals":

- **Apply** — fast-forward merges the branch into main, deletes the branch
- **Discard** — deletes the branch without merging

If the merge produces conflicts, the app surfaces them as standard git
conflict markers in the affected notes. The user resolves them in the editor.

## Example: Claude Code agent

```bash
#!/bin/bash
# Example: agent that summarises today's meeting notes

VAULT_PATH="$1"
TODAY=$(date +%Y-%m-%d)
BRANCH="agent/summarise-$TODAY"

cd "$VAULT_PATH"
git checkout -b "$BRANCH"

# ... agent reads notes, writes summary ...
echo "---
title: Summary $TODAY
type: note
tags: [summary]
created: $TODAY
---

$(cat notes/journal/$TODAY.md | your-llm-summariser)
" > "notes/summaries/$TODAY.md"

git add .
git commit -m "Add meeting summary for $TODAY"
git push origin "$BRANCH"
```

The app will detect `agent/summarise-YYYY-MM-DD` and show it for review.

## Planned: `.brain/agents.json`

Per-vault agent configuration (not yet implemented):

```json
{
  "agents": [
    {
      "name": "Daily summariser",
      "trigger": "manual",
      "command": "./scripts/summarise.sh",
      "permissions": ["read", "create"]
    }
  ]
}
```
