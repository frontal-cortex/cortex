// Code blocks: a curated language picker and lazily loaded syntax
// highlighting. On disk a code block is still an ordinary ```lang fence —
// only the fence language is stored, and only if the user chose one. Colours
// come from the `--code-*` custom properties in styles/tokens.css: shiki's
// CSS-variables theme writes `color: var(--code-token-keyword)` and friends
// into the token spans, so a highlighted block follows light/dark and the
// desktop palette live, without re-tokenising.
//
// Nothing shiki-related is in the main bundle. The highlighter core, the
// regex engine and each grammar are separate chunks fetched the first time a
// code block of that language is rendered.

import { createCodeBlockSpec, type CodeBlockOptions } from "@blocknote/core";

type GrammarModule = typeof import("@shikijs/langs/json");

type Language = {
  /** Picker label. */
  name: string;
  /** Fence names that map to this grammar. Every alias must be one shiki
   *  itself knows for the grammar (the highlighter is handed the raw fence
   *  language), so they are taken from the grammar's own alias list. */
  aliases?: string[];
  /** Grammar chunk; absent for plain text. */
  load?: () => Promise<GrammarModule>;
};

/** Keyed by shiki grammar id, which is what the picker writes into the fence.
 *  Order is the picker's order: plain text first, then roughly by how often
 *  the language shows up in notes. */
export const LANGUAGES: Record<string, Language> = {
  text: { name: "Plain text", aliases: ["plaintext", "txt"] },
  javascript: { name: "JavaScript", aliases: ["js", "mjs", "cjs"], load: () => import("@shikijs/langs/javascript") },
  typescript: { name: "TypeScript", aliases: ["ts", "mts", "cts"], load: () => import("@shikijs/langs/typescript") },
  jsx: { name: "JSX", load: () => import("@shikijs/langs/jsx") },
  tsx: { name: "TSX", load: () => import("@shikijs/langs/tsx") },
  html: { name: "HTML", load: () => import("@shikijs/langs/html") },
  css: { name: "CSS", load: () => import("@shikijs/langs/css") },
  json: { name: "JSON", load: () => import("@shikijs/langs/json") },
  yaml: { name: "YAML", aliases: ["yml"], load: () => import("@shikijs/langs/yaml") },
  toml: { name: "TOML", load: () => import("@shikijs/langs/toml") },
  markdown: { name: "Markdown", aliases: ["md"], load: () => import("@shikijs/langs/markdown") },
  xml: { name: "XML", load: () => import("@shikijs/langs/xml") },
  shellscript: { name: "Shell", aliases: ["bash", "sh", "shell", "zsh"], load: () => import("@shikijs/langs/shellscript") },
  python: { name: "Python", aliases: ["py"], load: () => import("@shikijs/langs/python") },
  rust: { name: "Rust", aliases: ["rs"], load: () => import("@shikijs/langs/rust") },
  go: { name: "Go", load: () => import("@shikijs/langs/go") },
  c: { name: "C", load: () => import("@shikijs/langs/c") },
  cpp: { name: "C++", aliases: ["c++"], load: () => import("@shikijs/langs/cpp") },
  csharp: { name: "C#", aliases: ["cs", "c#"], load: () => import("@shikijs/langs/csharp") },
  java: { name: "Java", load: () => import("@shikijs/langs/java") },
  kotlin: { name: "Kotlin", aliases: ["kt", "kts"], load: () => import("@shikijs/langs/kotlin") },
  swift: { name: "Swift", load: () => import("@shikijs/langs/swift") },
  ruby: { name: "Ruby", aliases: ["rb"], load: () => import("@shikijs/langs/ruby") },
  php: { name: "PHP", load: () => import("@shikijs/langs/php") },
  lua: { name: "Lua", load: () => import("@shikijs/langs/lua") },
  sql: { name: "SQL", load: () => import("@shikijs/langs/sql") },
  haskell: { name: "Haskell", aliases: ["hs"], load: () => import("@shikijs/langs/haskell") },
  elixir: { name: "Elixir", load: () => import("@shikijs/langs/elixir") },
  zig: { name: "Zig", load: () => import("@shikijs/langs/zig") },
  nix: { name: "Nix", load: () => import("@shikijs/langs/nix") },
  docker: { name: "Dockerfile", aliases: ["dockerfile"], load: () => import("@shikijs/langs/docker") },
  make: { name: "Makefile", aliases: ["makefile"], load: () => import("@shikijs/langs/make") },
  ini: { name: "INI", aliases: ["properties"], load: () => import("@shikijs/langs/ini") },
  diff: { name: "Diff", load: () => import("@shikijs/langs/diff") },
};

/** The grammar id for a fence language (`js` → `javascript`), or undefined
 *  when the language is not in the curated list. */
export function languageId(fence: string): string | undefined {
  const key = fence.toLowerCase();
  return Object.keys(LANGUAGES).find((id) => id === key || LANGUAGES[id].aliases?.includes(key));
}

async function createHighlighter() {
  const [{ createBundledHighlighter, createCssVariablesTheme }, { createJavaScriptRegexEngine }] =
    await Promise.all([import("@shikijs/core"), import("@shikijs/engine-javascript")]);
  const grammars: Record<string, () => Promise<GrammarModule>> = {};
  for (const [id, lang] of Object.entries(LANGUAGES)) if (lang.load) grammars[id] = lang.load;
  const create = createBundledHighlighter({
    langs: grammars,
    // Token colours resolve to the --code-* properties in tokens.css.
    themes: { cortex: createCssVariablesTheme({ name: "cortex", variablePrefix: "--code-", fontStyle: true }) },
    // The pure-JS engine keeps WebAssembly out of the bundle; `forgiving`
    // skips the odd Oniguruma-only pattern instead of failing the grammar.
    engine: () => createJavaScriptRegexEngine({ forgiving: true }),
  });
  // Grammars load on demand: BlockNote calls loadLanguage() the first time a
  // block with that language is highlighted.
  return create({ themes: ["cortex"], langs: [] });
}

const options: CodeBlockOptions = {
  // An empty default keeps a plain fence plain (``` rather than ```text).
  defaultLanguage: "",
  supportedLanguages: Object.fromEntries(
    Object.entries(LANGUAGES).map(([id, { name, aliases }]) => [id, { name, aliases }]),
  ),
  createHighlighter,
};

const base = createCodeBlockSpec(options);

/** BlockNote's code block, with the picker made to agree with the fence: a
 *  known alias selects its grammar (```js shows "JavaScript"), an empty
 *  language shows "Plain text", and a language outside the list is kept as
 *  an extra option rather than showing a blank picker — the fence is never
 *  rewritten unless the user picks something else. */
export const codeBlockSpec = {
  ...base,
  implementation: {
    ...base.implementation,
    render(this: unknown, block: { props: { language: string } }, editor: unknown) {
      const out = (base.implementation.render as Function).call(this, block, editor);
      const select: HTMLSelectElement | null = out.dom.querySelector("select");
      if (select) {
        const fence = block.props.language;
        const id = fence ? languageId(fence) : "text";
        if (id) {
          select.value = id;
        } else {
          const option = document.createElement("option");
          option.value = fence;
          option.text = fence;
          select.appendChild(option);
          select.value = fence;
        }
      }
      return out;
    },
  },
} as typeof base;
