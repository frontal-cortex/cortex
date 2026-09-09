---
title: "Tour: Templates and packs"
type: note
tags: [tour]
created: {{today}}
---

## The marketplace

`Ctrl+Shift+B`, or **Templates** at the bottom of the sidebar. A pack is a
ready-made collection or note template — tasks, projects, a reading list, a
habit tracker, a budget, recipes and meal plans, meeting notes, a weekly
review — each a folder of Markdown and YAML. No code, ever.

Install one and look at what arrived: `collections/<name>/`,
`.cortex/schemas/<name>.yaml`, sometimes `templates/<name>.md`. Every page
and row a pack writes carries `pack: <id>` in its frontmatter, so you can
always see what came from where. Installing never overwrites a file you have
edited, and removing a pack removes only what it added.

> [!tip] From a terminal
> `cortex packs list`, `cortex packs install tasks`, `cortex packs remove tasks`.
> An agent can do the same over MCP when you ask it for "a place to track X".

## Trust

The official index is reviewed; a **Verified** badge means a maintainer
used the pack in a real vault. You can add your own index in Settings — a
team registry — and packs from it are marked as third-party. A pack is
data: the worst it can do is be unhelpful, and the app tells you when its
text reads like instructions aimed at an agent rather than at you.

## Make one

Any collection or template you like can become a pack:

    cortex packs new my-pack --from collections/books
    cortex packs lint my-pack

Fill in the manifest, add a screenshot, open a pull request on the
marketplace repository. The contributing guide there is short.

## Start a whole vault from a template

`cortex init ~/new-vault --template you/your-template` copies any repository
or folder as the starting point — this vault came from one. Keep a vault of
the notes, folders and collections you always want, and every new vault
begins there.

Next: [[Tour: Agents and the CLI]].
