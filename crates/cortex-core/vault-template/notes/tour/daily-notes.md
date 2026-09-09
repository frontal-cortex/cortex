---
title: "Tour: Daily notes"
type: note
tags: [tour]
created: {{today}}
---

## Today

`Ctrl+Shift+T` opens today's note, creating it from `templates/daily.md` the
first time. It lands in `notes/journal/` with the date as its title, so a
month of days is a folder you can scroll.

Open it now and write one line about what you are doing. Come back
tomorrow and the button gives you a fresh page.

## Templates

`templates/` holds note templates. `Ctrl+N` asks which one; `note.md` is the
plain one, `meeting.md` a shape for a meeting. A template is a note with
placeholders:

    {{date}}    today, YYYY-MM-DD        {{time}}    HH:MM
    {{title}}   the title you typed      {{uuid}}    a unique id

Quote them in frontmatter — `title: "{{date}}"` — so the file stays valid
YAML before the placeholder is filled.

> [!tip] Any note is a template
> Copy a note you keep re-creating into `templates/`, replace the parts that
> change with placeholders, done. Templates are ordinary files; agents and
> scripts can write them too.

## Make Today a row instead

If you keep a journal as a collection — one row per day, with mood and
energy as properties — point `journal_template` in `.cortex/settings.yaml`
at it (`collections/journal`) and Today creates that day's row. The Daily
Note pack in the marketplace sets this up.

Next: [[Tour: Collections]].
