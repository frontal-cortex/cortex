---
title: "Tour: Writing"
type: note
tags: [tour]
created: {{today}}
---

Everything on this page is plain Markdown in `notes/tour/writing.md`. Edit
anything; the file changes as you type and git keeps the history.

## The slash menu

Type `/` on an empty line. Headings, lists, quotes, a table, an image, a
callout, an equation, a collection view — pick with the arrow keys and
`Enter`. Press `Tab` to nest a block under the one above.

> [!note] Callouts
> A callout is a quote that starts with `[!type]`. Try `[!tip]`, `[!warning]`,
> `[!question]`. In the file it stays a blockquote, so it reads fine anywhere.

## Code and maths

Code blocks are highlighted by language:

```rust
fn main() {
    println!("files are the truth");
}
```

Equations render with KaTeX — a block between `$$` lines, or inline like
$e^{i\pi} + 1 = 0$:

$$
\int_0^1 x^2 \, dx = \frac{1}{3}
$$

## Checklists

- [x] A ticked item is `- [x]` in the file
- [ ] An open one is `- [ ]`
- [ ] Tick this one — the strike-through follows the checkbox

## Images and files

Paste a screenshot or drop an image onto the page: it is saved under
`assets/` and the note refers to it by path. A PDF or any other file dropped
in becomes a file block. Nothing is embedded in the Markdown; the folder is
the whole vault.

## Bookmarks

A paragraph that is only a link becomes a card:

[Cortex on GitHub](https://github.com/frontal-cortex/cortex)

## Finding your way on a long page

`Ctrl+F` finds in the note. `Ctrl+Shift+O` opens the outline — the headings
of this page — and `Ctrl+Shift+M` hides everything but the page.

Next: [[Tour: Linking]].
