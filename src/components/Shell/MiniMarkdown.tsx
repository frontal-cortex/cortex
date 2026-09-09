// A small Markdown → React renderer for previews: note embeds and the
// marketplace's template previews. Headings, bullet and numbered lists,
// checkboxes, quotes, paragraphs; inline bold, code, [[wiki links]] and
// `{{placeholders}}`. Deliberately small — a preview, not the editor; anything
// it does not understand renders as the text it is.

import { createElement, Fragment } from "react";
import { parseWikiLink, wikiLinkLabel } from "../../lib/wikiLink";
import styles from "./MiniMarkdown.module.css";

/** Ask the shell to navigate to a wiki target (reuses Shell's resolver). */
function navigateTo(target: string) {
  window.dispatchEvent(new CustomEvent("cortex:navigate", { detail: { target } }));
}

/** Inline Markdown: `[[wiki]]`, `**bold**`, `` `code` `` and `{{placeholder}}`, the rest as text. */
export function renderInline(text: string, keyBase: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /(\[\[[^\]]+\]\]|\*\*[^*]+\*\*|`[^`]+`|\{\{[^}]+\}\})/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(<Fragment key={`${keyBase}-t${i}`}>{text.slice(last, m.index)}</Fragment>);
    const tok = m[0];
    if (tok.startsWith("[[")) {
      const target = tok.slice(2, -2).trim();
      out.push(
        <span key={`${keyBase}-w${i}`} className={styles.wikiLink} onClick={() => navigateTo(target)}>
          {wikiLinkLabel(parseWikiLink(target))}
        </span>,
      );
    } else if (tok.startsWith("**")) {
      out.push(<strong key={`${keyBase}-b${i}`}>{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith("{{")) {
      // A template placeholder: shown as the thing it becomes, not as braces.
      out.push(<span key={`${keyBase}-v${i}`} className={styles.placeholder} title={`Filled in when a note is made from the template: ${tok}`}>{tok.slice(2, -2).trim()}</span>);
    } else {
      out.push(<code key={`${keyBase}-c${i}`} className={styles.code}>{tok.slice(1, -1)}</code>);
    }
    last = m.index + tok.length;
    i++;
  }
  if (last < text.length) out.push(<Fragment key={`${keyBase}-t${i}`}>{text.slice(last)}</Fragment>);
  return out;
}

type Item = { text: string; check: null | boolean };

export function MiniMarkdown({ body }: { body: string }) {
  const lines = body.split("\n");
  const out: React.ReactNode[] = [];
  let para: string[] = [];
  let list: Item[] = [];
  let ordered = false;
  let key = 0;

  const flushPara = () => {
    if (para.length) {
      out.push(<p key={`p${key++}`}>{renderInline(para.join(" "), `p${key}`)}</p>);
      para = [];
    }
  };
  const flushList = () => {
    if (list.length) {
      const items = list.map((li, j) => (
        <li key={j} className={li.check === null ? undefined : styles.task}>
          {li.check !== null && <span className={`${styles.checkbox} ${li.check ? styles.checked : ""}`} aria-hidden />}
          {renderInline(li.text, `u${key}-${j}`)}
        </li>
      ));
      out.push(ordered
        ? <ol key={`o${key++}`} className={styles.list}>{items}</ol>
        : <ul key={`u${key++}`} className={styles.list}>{items}</ul>);
      list = [];
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    const number = line.match(/^\s*\d+[.)]\s+(.*)$/);
    const quote = line.match(/^>\s?(.*)$/);
    if (heading) {
      flushPara(); flushList();
      const lvl = Math.min(heading[1].length, 6);
      const tag = `h${Math.min(lvl + 2, 6)}`;
      out.push(createElement(tag, { key: `h${key++}`, className: styles.heading }, renderInline(heading[2], `h${key}`)));
    } else if (bullet || number) {
      flushPara();
      const isOrdered = !!number && !bullet;
      if (list.length && ordered !== isOrdered) flushList();
      ordered = isOrdered;
      const text = (bullet ?? number)![1];
      const check = text.match(/^\[([ xX])\]\s*(.*)$/);
      list.push(check ? { text: check[2], check: check[1] !== " " } : { text, check: null });
    } else if (quote) {
      flushPara(); flushList();
      out.push(<blockquote key={`q${key++}`} className={styles.quote}>{renderInline(quote[1], `q${key}`)}</blockquote>);
    } else if (line.trim() === "") {
      flushPara(); flushList();
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara(); flushList();
  return <>{out}</>;
}
