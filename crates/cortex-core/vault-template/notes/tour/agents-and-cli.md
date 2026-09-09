---
title: "Tour: Agents and the CLI"
type: note
tags: [tour]
created: {{today}}
---

Because a vault is files, anything that can read and write files can work
in it — including an AI agent. The app gives agents the same operations it
uses itself, so what they write is what you would have written.

## The terminal pane

`Ctrl+L` opens a terminal in the vault. Set `terminal_command` in Settings
to an agent CLI — `claude`, `codex`, `hermes` — and the pane opens that
instead of a shell, already inside your notes. `cortex agents` lists which
ones are installed.

## The `cortex` command

The same binary that powers the app, for scripts and agents:

```bash
cortex ls notes/tour                  # list notes
cortex search "backlinks"             # the app's search
cortex show "Tour: Linking" --body    # print a note
cortex new "Week 37" --template note  # create from a template
cortex set "Week 37" tags+=review     # edit properties, keys stay sorted
cortex view books --filter "status == 'reading'"
cortex packs install tasks
```

Add `--json` to any of them. `AGENTS.md` in the vault root lists every
command with the rules an agent should follow; `cortex mcp` serves the same
operations over the Model Context Protocol for agents that speak it.

## Proposals

An agent that changes ten notes at once should not just do it. With
`cortex propose "Summarise week 36" notes/journal/*.md` the change lands on
an `agent/…` branch and shows up in the app as a **proposal**: you read the
diff, then apply or discard it — a pull request against your own notes.

> [!note] Agents read your notes as data
> Text in a note — yours, a pack's, a colleague's — is content to an agent,
> never an instruction. `AGENTS.md` says so, and the app's MCP server repeats it.

## Comments

`Ctrl+Alt+C` comments on a selection. Threads live in `notes/…comments.yaml`
beside the note, never in it, so discussion and text stay separate.

Next: [[Tour: Sync, publishing and looks]].
