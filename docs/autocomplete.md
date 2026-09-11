# Inline autocomplete (ghost text)

A grey continuation of the sentence you are typing, shown after the caret and
accepted with Tab. Off by default, powered by a model you bring, and never
part of the note until you accept it.

This is a plan, not built code. It follows `docs/MOBILE.md` in shape: the
constraints first, then the design, then the work in the order it should land.

## What it must not break

The project's tenets (`ARCHITECTURE.md`) decide most of the design before any
code is written:

- **Bring your own everything — no required cloud services.** The feature is
  off until the user turns it on and supplies a key. A vault with it off makes
  no network calls, and nothing about the app changes.
- **Files are truth.** A suggestion lives in the editor's decoration layer. It
  reaches the document only when accepted, through the normal save path, so
  nothing derived is ever written to a note and an unaccepted suggestion can
  never be committed by accident.
- **`.cortex/settings.yaml` is committed.** The preference belongs there. The
  API key must never go near it (`docs/MOBILE.md` Phase 2 states the same
  constraint for the git token).
- **Typing must never wait on the network.** Every failure — no key, offline,
  rate limit, timeout, a slow model — degrades to no suggestion at all, with
  no dialog and no blocked keystroke.

## Why not run the user's agent CLI

The obvious first idea is to reuse what the vault already has: the agent CLI
the terminal pane launches (`terminal_command`, `cortex_core::agents`). It
would need no key, since the CLI is already signed in.

Measured on this machine, with the smallest possible prompt:

| Path | Latency |
|---|---|
| `claude -p --model haiku "<one short sentence>"` | 4.9 s, 5.9 s |

Ghost text needs a suggestion inside roughly half a second of the user pausing.
A per-suggestion process spawn that loads an agent's system prompt, skills and
MCP servers is two orders of magnitude off, and the cost per call is far higher
than the completion needs. The agent CLI stays what it is — the door for
open-ended work in the terminal pane — and autocomplete gets a direct request.

## Shape

```
 editor (React/ProseMirror)          Rust (cortex-core)              network
 ─────────────────────────           ──────────────────              ───────
 caret pauses ≥ delay
   → build a bounded context
   → invoke assist_complete ──────→  provider::complete()
                                       build request  ──────────────→ POST /v1/messages
                                       parse + trim   ←────────────── one text block
   ← suggestion (or nothing) ──────  ─┘
   render as a widget decoration
   Tab → one insert transaction → the normal debounced save
```

Four pieces:

1. **`crates/cortex-core/src/assist.rs`** — a `Provider` trait with one method,
   `complete(&self, ctx: &Context) -> Result<String>`, plus the Anthropic
   implementation. Prompt building and response trimming are pure functions
   with unit tests; the HTTP call uses `ureq`, already a dependency, configured
   the way `preview.rs` configures it (global timeout, size cap, no redirects
   it does not need).
2. **`src-tauri/src/commands/assist.rs`** — one `#[tauri::command(async)]`,
   the same shape as `fetch_link_preview`, which is the app's only async
   command today. It carries a request id so a stale reply can be dropped.
3. **`src/lib/ghostText.ts`** — the decision logic as pure functions: should a
   suggestion be requested here, what context to send, how to trim what comes
   back. Node-tested, the convention the repo already uses for editor logic.
4. **`src/components/Shell/ghostTextExtension.ts`** — the ProseMirror plugin:
   one widget decoration at the caret, the key handling, and the accept
   transaction.

### Why the request goes through Rust

Not a choice. The production CSP in `src-tauri/tauri.conf.json` allows
`connect-src 'self' ipc: http://ipc.localhost`, so the webview cannot reach any
external origin; every network call in the app already goes through `ureq` in
Rust. That is also where the key should live — out of the webview entirely.

## What leaves the machine

The contract has to be small enough to state in the settings UI in one line,
because a local-first note app that quietly uploads notes is a broken promise.

Sent, and only when the feature is on and the caret is in a text block:

- The note's **title**.
- Up to **N characters before the caret** (default 1200) and up to **200 after**,
  taken from the rendered text of the current block and the ones before it.
- Nothing else: no frontmatter, no other notes, no file paths, no vault name,
  no git identity, no collection rows.

Never sent: a note whose frontmatter says `ai: false`, any note under a folder
the user excludes, and anything at all while the setting is off. Frontmatter is
excluded wholesale rather than filtered, because properties are exactly where
people put things like `salary` or `dob`.

A small indicator in the status line shows when a request is in flight, so the
feature is never invisible while it is running.

## Credentials

`.cortex/settings.yaml` is committed to the user's git repository, so the key
cannot go there. There is no keychain in the app yet — `docs/MOBILE.md` Phase 2
plans one for the git token, and this feature should land on the same mechanism
when it exists. Until then, resolve in order:

1. `CORTEX_ANTHROPIC_KEY`, else `ANTHROPIC_API_KEY`, from the environment.
   The precedent is `CORTEX_GIT_TOKEN` in `remote.rs`, introduced for exactly
   this reason.
2. A file in the app config directory (`app_config_dir`, beside
   `recent_vaults.json`), written with `0600`, holding the key for all vaults
   on this machine. The Settings UI writes this one.

The settings page shows which source was found and never displays the key
itself. `cortex settings` never prints it, because it never holds it.

## Settings

Five keys, added the way every key is added (struct, default, `Default` impl,
`describe()` row in the same order, `set_field` arm, the TS mirror in
`src/lib/commands.ts`, a row in `SettingsView.tsx`, and the manual table in
`docs/agent-integration.md`). A new **Assist** section in the settings page
sits under Notes.

| Key | Type | Default | Meaning |
|---|---|---|---|
| `assist` | bool | `false` | Suggest a continuation as you type. Off sends nothing, ever. |
| `assist_model` | string | `claude-haiku-4-5` | The model asked for a continuation. |
| `assist_delay_ms` | number | `400` | How long the caret rests before a suggestion is requested. |
| `assist_context_chars` | number | `1200` | How much of the note before the caret is sent. |
| `assist_exclude` | string | `""` | Comma-separated folders never sent (for example `journal, private`). |

`assist` is a toggle, `assist_model` a picker with a Custom… escape hatch (the
`prose_font` pattern), the two numbers are `NumberField`s, and `assist_exclude`
is a plain text row. All five are shapes the settings page already has.

The key deliberately reads `assist`, not `ai`: the same plumbing is what a
"rewrite this paragraph" or "suggest a title" command would use later, and the
setting should not have to be renamed then.

## The request

Haiku 4.5 is the right model here and its constraints are specific:

```jsonc
POST https://api.anthropic.com/v1/messages
{
  "model": "claude-haiku-4-5",
  "max_tokens": 48,
  "temperature": 0.2,
  "stop_sequences": ["\n\n"],
  "system": "<fixed, ~120 tokens>",
  "messages": [{ "role": "user", "content": "<title + window + marker>" }]
}
```

- **No `thinking`.** Omitting it means no thinking on Haiku 4.5, which is what
  a continuation wants. It is also the only current model that would still take
  `budget_tokens`; we do not want it.
- **No `output_config.effort`.** Effort errors on Haiku 4.5.
- **`temperature` is allowed** on Haiku 4.5 (it is rejected on the 4.6+ models),
  and a low value keeps continuations predictable.
- **`max_tokens: 48`** with `stop_sequences: ["\n\n"]` caps a suggestion at
  about a sentence and bounds the latency.
- **Prompt caching will not fire.** Haiku 4.5's minimum cacheable prefix is
  4096 tokens; a system prompt plus a 1200-character window is far below it, so
  a cache breakpoint would silently do nothing. Only a long note would qualify,
  and only if the breakpoint sits after the stable head of the context. Not
  worth doing in the first version; revisit if the context window grows.

Trimming the reply matters as much as the request: strip a leading space the
caret already has, drop a completion that merely repeats what is on screen, cut
at the first newline, and refuse anything that starts with a quote or "Sure".

## What it costs

At Haiku 4.5 rates ($1 per million input tokens, $5 per million output):

| | Tokens | Cost |
|---|---:|---:|
| One suggestion, 1200-character window | ~450 in, ~30 out | ~$0.0006 |
| An hour of steady writing, ~250 suggestions | | ~$0.15 |

The debounce is the spend dial, which is why it is a setting rather than a
constant. A suggestion is requested only after the caret rests, never on every
keystroke, and an in-flight request is abandoned the moment the user types
again.

## Latency budget

Unmeasured here — this machine has no API key, so the first task is a spike
that measures a real Haiku round trip from Rust before anything is built on the
assumption. The target is a suggestion on screen within 500 ms of the caret
resting; if the measured round trip cannot fit that, the feature should be
reconsidered rather than shipped slow. Streaming the response is the fallback
lever: the first few words can be shown while the rest arrives.

## In the editor

**When a suggestion is requested.** The caret has rested for `assist_delay_ms`,
the selection is empty, the caret sits at the end of a paragraph or heading
whose text is non-empty, no suggestion menu (`/`, `[[`, `@`, `#`) is open, no
composition (IME) is in progress, and the block is not a code block, a table, a
math block, or any of the custom view blocks.

**How it renders.** A ProseMirror widget decoration holding a `<span>` that is
`contenteditable="false"`, `user-select: none`, `pointer-events: none`, at
around 45% opacity in the current theme's foreground colour. A decoration is
not document content, so it cannot be selected, copied, saved, or seen by the
save pipeline. `wikiLinkExtension.ts` is the precedent for a decoration plugin
in this codebase.

**Where the plugin goes.** `Editor.tsx` builds the editor once and passes the
app's own ProseMirror extensions through `_tiptapOptions.extensions` — wiki
links, the wiki-link suggestion menu, image paste and drop, find-in-note,
comment anchors, the math input rule. Ghost text is the seventh entry in that
array. BlockNote appends these after its own extensions, and a `handleKeyDown`
prop from this array already beats BlockNote's Tab today: that is how the `[[`
menu accepts with Tab.

**Tab has four existing owners**, and the plugin must yield to every one of
them:

| Owner | When |
|---|---|
| The `[[` / `@` / `#` suggestion menu | Whenever it is open, it already takes Tab to accept the highlighted item |
| A code block | Tab inserts two spaces |
| A table | Tab moves to the next cell |
| BlockNote | Otherwise, Tab nests the block and Shift-Tab unnests it |

The rule that keeps all four intact: consume Tab **only** when a suggestion is
actually on screen, and never request one in the first place inside a code
block or a table or while a menu is open. BlockNote's own Tab handler already
declines while a suggestion menu has open state, which is the same courtesy in
the other direction.

**Escape needs equal care.** BlockNote's `OverrideEscape` blurs the editor
unless one of its menus is showing, and the Shell's capture-phase handler
deliberately lets Escape through. So the plugin must consume Escape while a
suggestion is visible, or dismissing one would drop the user out of the editor.

Other keys, all only while a suggestion is showing: arrows and clicks dismiss
it, Ctrl+→ accepts one word, and a printable key that matches the suggestion's
next character advances it instead of discarding it.

**Reading the text before the caret** is a solved problem in this codebase.
`wikiLinkSuggestion.ts` already derives it from `$cursor.parent.textContent`
and `$cursor.parentOffset`, and `findInNote.ts` has the reference
implementation for mapping a character offset back to a ProseMirror position
across mixed inline content. Neither needs reinventing.

**A widget decoration is new here.** Every decoration in the app today is
`Decoration.inline` over text that already exists; ghost text is the first
`Decoration.widget`. Its class belongs with the others in
`Editor.module.css`, beside `.cortex-find-match` and `.cortex-comment-anchor`.

**Reaching the plugin from settings.** The editor takes almost no settings as
props; visual settings arrive as CSS custom properties, and a prop is added
only when the editor has to be rebuilt. The extension array is built once, so
the plugin should read a mutable ref instead, exactly as the wiki-link
extension takes `(t) => navigateRef.current(t)`. Toggling `assist` then takes
effect immediately with no remount.

**The hydration guard.** `Editor.tsx` holds a `hydrating` ref so that loading a
note does not look like an edit and trigger a save. No suggestion may be
requested while it is set, and the accept transaction must never run during
hydration.

**Accepting** inserts the text in one transaction, which reaches `onChange`,
which is the note's normal debounced save. Nothing new is needed there, and
undo puts the note back to the pre-acceptance state in one step.

## Cancellation

There is no cancellation pattern in the codebase today; the closest analogue is
`terminal_kill`. For this, a monotonic request id per editor session is enough:
the frontend ignores any reply whose id is not the latest, and the Rust side
gets a short global timeout so an abandoned request cannot outlive its usefulness.
`ureq` is blocking, and an async Tauri command already runs off the UI thread,
so no new runtime is involved.

## Testing

- **Rust**: prompt construction and response trimming as pure functions with
  unit tests. The HTTP call itself is behind the `Provider` trait, so a fake
  provider covers the command without a network.
- **TypeScript**: `src/lib/ghostText.ts` gets a `node --test` file — trigger
  decisions, context windowing, trimming, and the "does this suggestion repeat
  what is already typed" rule. `npm run test:lib` already globs both `src/lib`
  and `src/components`. Follow `typingFocus.ts`, which states the split this
  feature needs: pure decisions over timestamps in `src/lib`, timers and DOM in
  the hook that owns them.
- **By hand**: the one thing tests cannot cover is that Tab still nests a block
  when no suggestion is showing. That belongs in the PR description as a manual
  check.

## The work, in order

Each of these is one session and lands on its own.

1. **Spike: measure the round trip.** A throwaway Rust binary that posts a
   realistic autocomplete request to Haiku 4.5 and prints the latency spread
   over 20 calls, cold and warm, with the real context size. Deliverable: a
   short findings note in this file's "Latency budget" section, and a go or
   no-go. Nothing else is built until this passes.
2. **The provider and the command.** `assist.rs` with the trait, the Anthropic
   implementation, prompt building and trimming with tests; the async Tauri
   command; credential resolution with the precedence above. No UI yet;
   exercised from a unit test and `cortex assist "<text>"` behind a hidden
   flag, so the shape can be judged before the editor work starts.
3. **The settings.** The five keys end to end, the Assist section in the
   settings page, the key file in the app config directory, and the "where the
   key was found" row. Feature still does nothing in the editor.
4. **The ghost text.** The plugin, the decoration, the trigger rules, Tab and
   the other keys, the in-flight indicator. This is the riskiest piece and it
   should land last, when everything under it is already proven.
5. **The privacy fence.** `ai: false` in frontmatter, `assist_exclude`, and a
   documented list of exactly what is sent, in `docs/autocomplete.md` and in
   the settings hint.

Backlog rows for these, in the format `docs/parity/proposed-backlog.md` uses,
follow at the end of this document.

## Not in this feature

- **A chat panel, or any question-answering over the vault.** Different shape,
  different cost, different UI. The agent doors already cover it.
- **Retrieval across notes.** The context is the note you are typing in.
  Vault-wide retrieval needs embeddings, which `ARCHITECTURE.md` lists as a
  future consideration with a local model.
- **Multi-paragraph generation.** A stop sequence at the first blank line is a
  deliberate ceiling; anything longer is a writing command, not autocomplete.
- **A local provider**, for now. The `Provider` trait exists so that an
  OpenAI-compatible endpoint on localhost (Ollama, llama.cpp) can be a second
  implementation with no other change, and that is the natural next step for a
  vault that wants this feature with no cloud service at all. It is not in the
  first version only because the trait has to exist first.

---

## Backlog rows

Paste into `collections/backlog/` in the vault, or run
`cortex new "<title>" --dir collections/backlog`. Priorities continue after the
rows in `docs/parity/proposed-backlog.md`.

```markdown
---
created: 2026-09-11
effort: S
priority: 40
status: planned
tags: [assist]
title: Assist — spike: measure a Haiku round trip from Rust
type: note
---

Findings first, no feature code. Write a throwaway Rust binary (or a
`#[ignore]` test) in a scratch branch that posts a realistic inline-completion
request to the Messages API with `claude-haiku-4-5`: a ~120-token system
prompt, a ~450-token context window, `max_tokens: 48`, `temperature: 0.2`,
`stop_sequences: ["\n\n"]`, no `thinking` and no `output_config.effort` (effort
errors on Haiku 4.5). Use `ureq`, which `cortex-core` already depends on,
configured like `preview.rs` does it. Read the key from `ANTHROPIC_API_KEY`;
the machine has none today, so the person running this supplies one.

Report the latency spread over 20 calls (cold and warm), the token counts the
response reports, and the cost per call. Then answer one question in
`docs/autocomplete.md` under "Latency budget": can a suggestion be on screen
within 500 ms of the caret resting? If not, say what would have to change —
streaming the first words, a smaller window, a different model — or recommend
dropping the feature. Measured numbers only; no estimates.
```

```markdown
---
created: 2026-09-11
effort: M
priority: 41
status: planned
tags: [assist]
title: Assist — the provider, the command and the credential path
type: note
---

`crates/cortex-core/src/assist.rs`: a `Provider` trait with one method,
`complete(&self, ctx: &Context) -> Result<String>`, and an Anthropic
implementation over `ureq` configured like `preview.rs` (global timeout, size
cap). Prompt building and reply trimming are pure functions with unit tests:
strip a leading space the caret already has, cut at the first newline, drop a
reply that repeats what is already on screen, drop one that opens with a quote
or a preamble like "Sure".

Credentials never touch `.cortex/settings.yaml`, which is committed. Resolve
`CORTEX_ANTHROPIC_KEY`, then `ANTHROPIC_API_KEY`, then a `0600` file in the app
config directory beside `recent_vaults.json` (`app_config_dir`); the
`CORTEX_GIT_TOKEN` handling in `remote.rs` is the precedent, and
`docs/MOBILE.md` Phase 2 is where this should move when a keychain exists.

Expose one `#[tauri::command(async)]`, the shape `fetch_link_preview` already
uses, carrying a request id so a stale reply can be dropped. Add a hidden
`cortex assist "<text>"` so the prompt and the trimming can be judged before
any editor work starts. No UI, no settings, no editor changes in this row.
```

```markdown
---
created: 2026-09-11
effort: M
priority: 42
status: planned
tags: [assist]
title: Assist — settings, and the key the vault never sees
type: note
---

Five keys end to end, each in the five places `settings.rs` requires (struct,
default fn, `Default` impl, the `describe()` row in the same order, the
`set_field` arm), plus the TS mirror in `src/lib/commands.ts`, a row in
`SettingsView.tsx`, and the hand-maintained table in
`docs/agent-integration.md`. `describe_matches_struct` fails on drift.

  assist (bool, false) · assist_model (string, claude-haiku-4-5) ·
  assist_delay_ms (number, 400) · assist_context_chars (number, 1200) ·
  assist_exclude (string, "")

A new Assist section in the settings page, under Notes: a toggle, a model
picker with a Custom… escape hatch (the `prose_font` pattern), two
`NumberField`s, and a text row. Add a read-only row naming where the key was
found — environment, app config file, or nowhere — and never render the key
itself. A button writes the key to the app config file.

The section's hint states in one sentence exactly what leaves the machine: the
note title, the characters around the caret, nothing else. Feature still does
nothing in the editor after this row.
```

```markdown
---
created: 2026-09-11
effort: L
priority: 43
status: planned
tags: [assist, editor]
title: Assist — ghost text in the editor
type: note
---

The riskiest row; everything under it should already be merged. A new
ProseMirror extension added to `_tiptapOptions.extensions` in `Editor.tsx`,
beside the wiki-link and find-in-note extensions, plus `src/lib/ghostText.ts`
for the pure decisions (when to request, what window to send, how to trim)
with a `node --test` file.

Render the suggestion as a `Decoration.widget` at the caret — the first widget
decoration in the app; every existing one is `Decoration.inline`. The span is
`contenteditable="false"`, not selectable, not clickable, at about 45% opacity,
styled in `Editor.module.css` beside `.cortex-find-match`.

Request only when: the feature is on, the caret rests for `assist_delay_ms`,
the selection is empty, the caret is at the end of a non-empty paragraph or
heading, `hydrating` is clear, no IME composition is in progress, and the block
is not a code block, table, math block or custom view block.

Consume Tab only while a suggestion is on screen, so nesting, code-block
indentation, table navigation and the `[[` menu all keep it. Consume Escape
the same way, or dismissing a suggestion would blur the editor through
BlockNote's `OverrideEscape`. Arrows and clicks dismiss; Ctrl+→ accepts a word;
a printable key matching the next character advances the suggestion. Accepting
inserts in one transaction, which the existing debounced save picks up, and
undo reverses in one step.

Cancellation is a monotonic request id: ignore any reply that is not the
latest. Read settings through a mutable ref, the way the wiki-link extension
reads `navigateRef`, so toggling `assist` needs no remount. Show an in-flight
indicator in the status line. Manual check for the PR: Tab still nests a block
when no suggestion is showing.
```

```markdown
---
created: 2026-09-11
effort: S
priority: 44
status: planned
tags: [assist, privacy]
title: Assist — the privacy fence
type: note
---

Make the promise enforceable rather than documented. A note whose frontmatter
carries `ai: false` is never sent. A folder listed in `assist_exclude` is never
sent. Frontmatter is excluded wholesale from every context window, because
properties are where people keep things like a salary or a date of birth.

Add the decisions as pure functions in `src/lib/ghostText.ts` with tests, so
"this note is excluded" is provable rather than a code-reading exercise. State
the full contract in `docs/autocomplete.md` and in one line in the settings
hint, and confirm by test that with `assist: false` no request is built at all.
```
