---
title: "Tour: Sync, publishing and looks"
type: note
tags: [tour]
created: {{today}}
---

## Git, without thinking about it

Every save is committed a little later (`auto_commit`), so the sidebar's
history is a list of what you changed and when. Click a commit to see the
diff; open a note's history to read an old version or restore it. Deleted
notes go to `.trash/` first.

Add a remote and the sync button pushes and pulls:

```bash
git remote add origin git@github.com:you/my-vault.git
git push -u origin main
```

Conflicts are shown as conflicts, in the app, with both sides. Two people
can also edit one note live if you run the optional relay (`collab_url`).

## Publishing

Nothing leaves this machine unless you publish. `publish: true` in a note's
frontmatter marks it eligible; **Publish site…** in the command palette, or
`cortex publish --out DIR`, builds a folder of HTML from the marked notes.
Links to notes you did not publish become plain text. `--gh-pages` pushes
the folder to GitHub Pages.

## Looks

`Ctrl+,` opens Settings — a page, backed by `.cortex/settings.yaml`, which
you can also edit by hand or with `cortex settings set`.

- **Theme** follows the system, or a palette file: on Omarchy, point
  `theme_file` at `~/.local/state/omarchy/current/theme/colors.toml` and the
  app changes colour when your desktop does. `accent` picks the action colour.
- **Type**: `prose_font` and `prose_slant` set the page face and tilt.
- **Keys**: every shortcut is rebindable under `keybindings`. `Ctrl+/` lists
  them.

## Where to go from here

The [[Tour: Collections|books collection]] is small on purpose. Install a
pack, or make a collection of your own from the sidebar's **+**. Then
delete the `tour/` folder — you know the way round now.

Back to [[Welcome]].
