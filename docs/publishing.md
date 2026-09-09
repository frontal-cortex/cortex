# Publishing

Put some of your notes on the internet, as a plain static site, without ever
publishing by accident.

## The two rules

1. **Private by default.** A note is eligible for the site only when its
   frontmatter says `publish: true` or it carries the `public` tag. Nothing
   else is ever included — not templates, not `VAULT.md`, not the trash.
2. **Publishing is an act.** Marking a note changes nothing on the internet.
   The site is built only when you run **Publish site…** in the app or
   `cortex publish` in a terminal. It never happens on save, on sync, or on a
   timer. Agents can see what is marked (`list_published` over MCP) and can set
   the flag if you ask, but cannot build or push a site.

## Marking a note

- In the app: open the note, command palette → **Make this note public**
  (run it again to make it private). A green **Public** chip appears in the
  line under the title.
- By hand: add `publish: true` to the frontmatter, or `public` to `tags`.
- From a terminal: `cortex set <note> publish=true`.

`cortex publish` with no target lists what is currently marked.

## Building the site

```bash
cortex publish                    # list what would be published
cortex publish --out ./site       # build into a folder
cortex publish --gh-pages         # build and push the gh-pages branch of origin
cortex publish --github-action    # write a manual-trigger workflow (see below)
```

In the app: command palette → **Publish site…** shows the notes that will go,
lets you pick a folder or GitHub Pages, and reports where the site went.

The output is one page per note at `<path without .md>/`, an `index.html`
listing every published note (newest first, with a small search box), a
`style.css`, a `search.json`, and the images the pages reference. It is
self-contained: open `index.html` from disk, or copy the folder to any static
host.

**Safety of `--out`.** A build refuses a non-empty folder it did not write
before (there is a `.cortex-site.json` manifest in every folder it wrote),
unless you pass `--force`. Even then it only ever deletes files listed in its
own manifest, so a typo cannot wipe a directory.

## What the pages contain

- The note's title, its `created` date, and its tags (except `public`).
- The body, rendered from Markdown: headings (with anchors), lists, tables,
  task lists, code, images, callouts (`> [!tip] …`). Math (`$…$`,
  `$$…$$`) is shown as its LaTeX source in a monospace span — the site ships
  no KaTeX — so nothing is mangled and the equation is still readable.
- **Wiki links** to other published notes become links, including
  `[[Note#Section]]` anchors and `[[Note|alias]]` labels. A link to a note
  that is *not* published becomes plain text — the site never reveals what
  stayed private. Embeds (`![[Note]]`) become links, never inlined bodies.
- **Images** referenced by vault-relative path (`assets/…`) are copied along.
  Only the files that published pages reference are copied.

Not included, by design: comments, presence, editing, properties other than
`created` and `tags`. The site is for reading.

## Site settings

Two keys in `.cortex/settings.yaml` (Settings → Publishing in the app):

| Key | Meaning |
|---|---|
| `site_title` | Header and tab title. Empty = the vault folder's name. |
| `site_home` | A published note shown above the list on the front page, e.g. `notes/about.md`. |

## Hosting it yourself

- **Any static host.** Publish to a folder and upload it: Netlify Drop,
  Cloudflare Pages, S3, a `public_html` — anything that serves files.
- **GitHub Pages, from the app or CLI.** `cortex publish --gh-pages` builds
  the site and force-pushes it as an orphan `gh-pages` branch on `origin`.
  Only the site is on that branch, never the vault's history. Enable it once:
  repo Settings → Pages → Source: *Deploy from a branch* → `gh-pages`.
  Re-run to update.
- **GitHub Pages, from a workflow.** `cortex publish --github-action` writes
  `.github/workflows/publish.yml`. It runs when you press **Run workflow** in
  the Actions tab, builds with `cortex publish`, and deploys with Pages
  (Settings → Pages → Source: *GitHub Actions*). The `push:` trigger is in the
  file, commented out: enabling it means every sync republishes whatever is
  flagged at that moment, which is a choice to make on purpose.

## A hosted service

Planned, not built: a `cortex.site` you push to that builds and serves the
site for you. It would consume exactly this output. See `docs/ROADMAP.md`.
