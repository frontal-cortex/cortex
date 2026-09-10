// ── Button block ─────────────────────────────────────────────────────────────
// One action a person presses: add a row with preset values, open a page or
// view, tick a habit, set a property on this row, open a link. On disk it is
// a `cortex-button` fence (src/lib/buttons.ts has the form and the dispatch);
// the custom block exists only in memory, translated at the load/save
// boundary like cortex-view fences. Consecutive buttons sit in one row.

import { createContext, useContext, useEffect, useState } from "react";
import { createReactBlockSpec, DefaultReactSuggestionItem } from "@blocknote/react";
import { insertOrUpdateBlockForSlashMenu } from "@blocknote/core/extensions";
import { commands } from "../../lib/commands";
import { openExternal } from "../../lib/links";
import {
  BUTTON_ACTIONS, ButtonAction, ButtonDeps, ButtonSpec, describeButton, parseButtonSpec, runButton, serializeButtonSpec,
} from "../../lib/buttons";
import { PlusIcon, OpenIcon, TrackerIcon, LinkIcon, CheckSquareIcon, MoreIcon } from "./icons";
import styles from "./ButtonBlock.module.css";

export const BUTTON_LANGUAGE = "cortex-button";

/** The open note's path, so a `set` button knows which row it is on. */
export const NotePathContext = createContext<string>("");

/** What a button touches in the app — one place, shared with the palette. */
export function appButtonDeps(): ButtonDeps {
  return {
    addRow: (s, id, f) => commands.addRow(s, id, f),
    addRowFromTemplate: (s, id, t, f) => commands.addRowFromTemplate(s, id, t, f),
    setCell: (s, id, k, v) => commands.setCell(s, id, k, v, "text"),
    listTrackers: () => commands.listTrackers(),
    trackerToggle: (l, d, dn, date, item) => commands.trackerToggle(l, d, dn, date, item, true).then(() => {}),
    resolveNote: (t) => commands.resolveNote(t).then((n) => n?.path ?? null),
    openNote: (path, view) => {
      window.dispatchEvent(new CustomEvent("cortex:open-note", { detail: { path } }));
      if (view) setTimeout(() => window.dispatchEvent(new CustomEvent("cortex:select-view", { detail: { path, name: view } })), 150);
    },
    openExternal,
  };
}

/** Press a button from anywhere (block, palette). Errors are shown, not swallowed. */
export async function pressButton(spec: ButtonSpec, notePath: string): Promise<void> {
  try {
    await runButton(spec, notePath, appButtonDeps());
  } catch (e) {
    window.alert(e instanceof Error ? e.message : String(e));
  }
}

function ActionIcon({ action }: { action: ButtonAction }) {
  switch (action) {
    case "add-row": return <PlusIcon size={13} />;
    case "open": return <OpenIcon size={13} />;
    case "log": return <TrackerIcon size={13} />;
    case "url": return <LinkIcon size={13} />;
    default: return <CheckSquareIcon size={13} />;
  }
}

function Button({ block, editor }: { block: any; editor: any }) {
  const notePath = useContext(NotePathContext);
  const { spec, unknownKeys } = parseButtonSpec(String(block.props.spec ?? ""));
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(!spec.label);
  const known = BUTTON_ACTIONS.includes(spec.action);

  const press = async () => {
    if (busy || !known) return;
    setBusy(true);
    try { await pressButton(spec, notePath); } finally { setBusy(false); }
  };

  return (
    <div className={styles.wrap} contentEditable={false}>
      <button
        type="button"
        className={`${styles.pill} ${!known ? styles.pillBroken : ""}`}
        onClick={press}
        disabled={busy}
        title={known ? describeButton(spec) : `Unknown action "${spec.action}"`}
      >
        <ActionIcon action={spec.action} />
        <span>{busy ? "…" : spec.label || "Button"}</span>
      </button>
      <button type="button" className={styles.edit} title="Edit button" aria-label="Edit button" onClick={() => setEditing((e) => !e)}>
        <MoreIcon size={12} />
      </button>
      {editing && (
        <ButtonEditor
          spec={spec}
          unknownKeys={unknownKeys}
          onSave={(next) => { editor.updateBlock(block, { props: { spec: serializeButtonSpec(next) } }); setEditing(false); }}
          onCancel={() => setEditing(false)}
        />
      )}
    </div>
  );
}

const ACTION_LABEL: Record<ButtonAction, string> = {
  "add-row": "Add a row", open: "Open a page or view", log: "Tick a habit today", set: "Set properties on this row", url: "Open a link",
};

function ButtonEditor({ spec, unknownKeys, onSave, onCancel }: {
  spec: ButtonSpec; unknownKeys: string[]; onSave: (s: ButtonSpec) => void; onCancel: () => void;
}) {
  const [draft, setDraft] = useState<ButtonSpec>({ ...spec, action: BUTTON_ACTIONS.includes(spec.action) ? spec.action : "add-row" });
  const [valuesText, setValuesText] = useState(Object.entries(spec.values ?? {}).map(([k, v]) => `${k}: ${v}`).join("\n"));
  const [collections, setCollections] = useState<string[]>([]);
  useEffect(() => { commands.listCollections().then(setCollections).catch(() => {}); }, []);

  const save = () => {
    const values: Record<string, string> = {};
    for (const line of valuesText.split("\n")) {
      const m = line.match(/^\s*([^:]+):\s*(.*)$/);
      if (m) values[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
    }
    onSave({ ...draft, label: draft.label.trim() || "Button", values: Object.keys(values).length ? values : undefined });
  };
  const set = <K extends keyof ButtonSpec>(k: K, v: ButtonSpec[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const needsCollection = draft.action === "add-row" || draft.action === "log" || (draft.action === "open" && !draft.target);

  return (
    <div className={styles.editor} role="group" aria-label="Button settings"
      onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); onCancel(); } if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); } }}>
      <label className={styles.field}><span>Label</span>
        <input autoFocus value={draft.label} onChange={(e) => set("label", e.target.value)} placeholder="New expense" />
      </label>
      <label className={styles.field}><span>Does</span>
        <select value={draft.action} onChange={(e) => set("action", e.target.value as ButtonAction)}>
          {BUTTON_ACTIONS.map((a) => <option key={a} value={a}>{ACTION_LABEL[a]}</option>)}
        </select>
      </label>
      {needsCollection && (
        <label className={styles.field}><span>Collection</span>
          <input list="cortex-button-collections" value={draft.collection ?? ""} onChange={(e) => set("collection", e.target.value.replace(/^collections\//, ""))} placeholder="budget" />
          <datalist id="cortex-button-collections">{collections.map((c) => <option key={c} value={c} />)}</datalist>
        </label>
      )}
      {draft.action === "open" && (
        <>
          <label className={styles.field}><span>Or a note</span>
            <input value={draft.target ?? ""} onChange={(e) => set("target", e.target.value)} placeholder="a title or notes/path.md" />
          </label>
          <label className={styles.field}><span>View</span>
            <input value={draft.view ?? ""} onChange={(e) => set("view", e.target.value)} placeholder="tab name (optional)" />
          </label>
        </>
      )}
      {draft.action === "log" && (
        <label className={styles.field}><span>Item</span>
          <input value={draft.item ?? ""} onChange={(e) => set("item", e.target.value)} placeholder="the habit's title" />
        </label>
      )}
      {draft.action === "url" && (
        <label className={styles.field}><span>URL</span>
          <input value={draft.url ?? ""} onChange={(e) => set("url", e.target.value)} placeholder="https://…" />
        </label>
      )}
      {(draft.action === "add-row" || draft.action === "set") && (
        <label className={styles.field}><span>Values</span>
          <textarea rows={3} value={valuesText} onChange={(e) => setValuesText(e.target.value)} placeholder={"kind: expense\ndate: {{today}}"} spellCheck={false} />
        </label>
      )}
      {draft.action === "add-row" && (
        <>
          <label className={styles.field}><span>Template</span>
            <input value={draft.template ?? ""} onChange={(e) => set("template", e.target.value)} placeholder="row template name (optional)" />
          </label>
          <label className={styles.check}>
            <input type="checkbox" checked={!!draft.open} onChange={(e) => set("open", e.target.checked)} /> Open the new row
          </label>
        </>
      )}
      {unknownKeys.length > 0 && <div className={styles.hint}>Ignored keys in the fence: {unknownKeys.join(", ")}</div>}
      <div className={styles.actions}>
        <button type="button" className={styles.save} onClick={save}>Save</button>
        <button type="button" className={styles.cancel} onClick={onCancel}>Cancel</button>
        <span className={styles.hint}>Ctrl+Enter saves · Esc cancels</span>
      </div>
    </div>
  );
}

export const cortexButtonSpec = createReactBlockSpec(
  {
    type: "cortexButton",
    propSchema: { spec: { default: "" } },
    content: "none",
  },
  {
    render: (props) => <Button block={props.block} editor={props.editor} />,
  },
)();

export function buttonSlashItem(editor: any): DefaultReactSuggestionItem {
  return {
    title: "Button",
    subtext: "One click: add a row, open a page, tick a habit, set a property, open a link",
    aliases: ["button", "action", "quick add", "new row button"],
    group: "Cortex",
    onItemClick: () =>
      insertOrUpdateBlockForSlashMenu(editor, {
        type: "cortexButton",
        props: { spec: serializeButtonSpec({ label: "", action: "add-row" }) },
      } as never),
  };
}

// ── Boundary translation ──────────────────────────────────────────────────────

function inlineText(content: unknown): string {
  return Array.isArray(content) ? content.map((c: any) => (typeof c?.text === "string" ? c.text : "")).join("") : "";
}

/** Markdown → blocks: a ```cortex-button fence is a live button. */
export function inflateButtons(blocks: any[]): any[] {
  return blocks.map((b) => {
    if (b?.type === "codeBlock" && b?.props?.language === BUTTON_LANGUAGE) {
      return { type: "cortexButton", props: { spec: inlineText(b.content) } };
    }
    if (Array.isArray(b?.children) && b.children.length) return { ...b, children: inflateButtons(b.children) };
    return b;
  });
}

/** Blocks → markdown: a button is its fence again; children are hoisted after it. */
export function flattenButtons(blocks: any[]): any[] {
  return blocks.flatMap((b) => {
    if (b?.type === "cortexButton") {
      const fence = { type: "codeBlock", props: { language: BUTTON_LANGUAGE }, content: [{ type: "text", text: String(b.props?.spec ?? "").replace(/\n$/, ""), styles: {} }] };
      return [fence, ...flattenButtons(Array.isArray(b.children) ? b.children : [])];
    }
    if (Array.isArray(b?.children) && b.children.length) return [{ ...b, children: flattenButtons(b.children) }];
    return [b];
  });
}
