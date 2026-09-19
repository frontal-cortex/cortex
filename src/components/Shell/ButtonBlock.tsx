// ── Button block ─────────────────────────────────────────────────────────────
// One action a person presses: add a row with preset values, open a page or
// view, tick a habit, set a property on this row, open a link. On disk it is
// a `cortex-button` fence (src/lib/buttons.ts has the form and the dispatch);
// the custom block exists only in memory, translated at the load/save
// boundary like cortex-view fences. Consecutive buttons sit in one row.

import { createContext, useContext, useEffect, useState } from "react";
import { createReactBlockSpec, DefaultReactSuggestionItem } from "@blocknote/react";
import { insertOrUpdateBlockForSlashMenu } from "@blocknote/core/extensions";
import { commands, PropertyDef } from "../../lib/commands";
import { parseViews } from "../../lib/database";
import { openExternal } from "../../lib/links";
import {
  BUTTON_ACTIONS, ButtonAction, ButtonDeps, ButtonSpec, describeButton, parseButtonSpec, runButton, serializeButtonSpec,
} from "../../lib/buttons";
import { PlusIcon, OpenIcon, TrackerIcon, LinkIcon, CheckSquareIcon, MoreIcon, CloseIcon } from "./icons";
import { Dropdown } from "./Dropdown";
import { useCollections, useRowTitles, useSourceFields } from "./useSourceFields";
import styles from "./ButtonBlock.module.css";

export const BUTTON_LANGUAGE = "cortex-button";

/** The open note's path, so a `set` button knows which row it is on. */
export const NotePathContext = createContext<string>("");

/** The open note's title: what `@this` means to a view on it, and so what a
 *  row added to that view carries. */
export const NoteTitleContext = createContext<string>("");

/** What a button touches in the app — one place, shared with the palette. */
export function appButtonDeps(): ButtonDeps {
  return {
    addRow: (s, id, f) => commands.addRow(s, id, f),
    addRowFromTemplate: (s, id, t, f) => commands.addRowFromTemplate(s, id, t, f),
    listRowTemplates: (s) => commands.listRowTemplates(s),
    setCell: (s, id, k, v) => commands.setCell(s, id, k, v, "text"),
    listTrackers: () => commands.listTrackers(),
    trackerToggle: (l, d, dn, date, item) => commands.trackerToggle(l, d, dn, date, item, true).then(() => {}),
    resolveNote: (t) => commands.resolveNote(t).then((n) => n?.path ?? null),
    openNote: (path, view) => {
      window.dispatchEvent(new CustomEvent("cortex:open-note", { detail: { path } }));
      if (view) setTimeout(() => window.dispatchEvent(new CustomEvent("cortex:select-view", { detail: { path, name: view } })), 150);
    },
    openExternal,
    titleOf: (path) => commands.readNote(path).then((n) => String(n.frontmatter["title"] ?? "")).catch(() => ""),
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

/** A date a button writes: the day it is pressed, relative to it, or fixed. */
const DATE_CHOICES = [
  { value: "{{today}}", label: "When pressed" },
  { value: "{{today+1}}", label: "The next day" },
  { value: "{{today+7}}", label: "A week later" },
  { value: "{{monday}}", label: "That week's Monday" },
  { value: "__date", label: "A specific date…", separator: true },
];

/** Computed properties are never written by a button. */
const COMPUTED = new Set(["rollup", "formula", "created_time", "edited_time", "created_by", "edited_by"]);

function ValueInput({ prop, value, onChange }: { prop?: PropertyDef; value: string; onChange: (v: string) => void }) {
  const titles = useRowTitles(prop?.type === "relation" ? prop.collection : undefined);
  const [specific, setSpecific] = useState(false);
  switch (prop?.type) {
    case "date": {
      if (specific || /^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return (
          <span className={styles.valueLine}>
            <input type="date" value={value} onChange={(e) => onChange(e.target.value)} />
            <button type="button" className={styles.iconBtn} title="Relative to the press" onClick={() => { setSpecific(false); onChange("{{today}}"); }}>↺</button>
          </span>
        );
      }
      return <Dropdown fullWidth value={value} placeholder="Pick a day" options={DATE_CHOICES}
        onChange={(v) => { if (v === "__date") { setSpecific(true); onChange(""); } else onChange(v); }} />;
    }
    case "select":
    case "status":
      if (prop.options?.length) return <Dropdown fullWidth value={value} placeholder="Pick an option" options={prop.options.map((o) => ({ value: o.name, label: o.name }))} onChange={onChange} />;
      break;
    case "checkbox":
      return <Dropdown fullWidth value={value} placeholder="Pick" options={[{ value: "true", label: "Checked" }, { value: "false", label: "Unchecked" }]} onChange={onChange} />;
    case "relation":
      if (titles.length) return <Dropdown fullWidth value={value} placeholder={`Pick from ${prop.collection}`} options={[...(value && !titles.includes(value) ? [value] : []), ...titles].map((t) => ({ value: t, label: t }))} onChange={onChange} />;
      break;
  }
  return <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={prop?.type === "number" ? "0" : "value"} inputMode={prop?.type === "number" ? "decimal" : undefined} spellCheck={false} />;
}

/** The values a button writes, one row per property: the property from the
 *  collection's schema, the value shaped by its type. */
function ValuesEditor({ collection, values, onChange }: {
  collection: string | undefined; values: [string, string][]; onChange: (v: [string, string][]) => void;
}) {
  const { names, props } = useSourceFields(collection ? `collections/${collection}` : undefined);
  const writable = names.filter((n) => n !== "title" && !COMPUTED.has(props[n]?.type ?? ""));
  const unused = writable.filter((n) => !values.some(([k]) => k === n));
  const set = (i: number, row: [string, string]) => onChange(values.map((r, j) => (j === i ? row : r)));
  return (
    <div className={styles.values}>
      {values.length === 0 && <span className={styles.hint}>Nothing set — the row starts from its template.</span>}
      {values.map(([k, v], i) => (
        <div key={i} className={styles.valueRow}>
          {writable.length ? (
            <Dropdown fullWidth value={k} placeholder="Property"
              options={[...(k && !writable.includes(k) ? [k] : []), ...writable].map((n) => ({ value: n, label: n, disabled: n !== k && values.some(([x]) => x === n) }))}
              onChange={(n) => set(i, [n, props[n]?.type === "date" ? "{{today}}" : ""])} />
          ) : (
            <input value={k} placeholder="property" onChange={(e) => set(i, [e.target.value, v])} spellCheck={false} />
          )}
          <ValueInput prop={props[k]} value={v} onChange={(nv) => set(i, [k, nv])} />
          <button type="button" className={styles.iconBtn} title="Remove" onClick={() => onChange(values.filter((_, j) => j !== i))}>
            <CloseIcon size={12} />
          </button>
        </div>
      ))}
      <button type="button" className={styles.addValue} disabled={writable.length > 0 && unused.length === 0}
        onClick={() => { const n = unused[0] ?? ""; onChange([...values, [n, props[n]?.type === "date" ? "{{today}}" : ""]]); }}>
        <PlusIcon size={12} /> Set a property
      </button>
    </div>
  );
}

function ButtonEditor({ spec, unknownKeys, onSave, onCancel }: {
  spec: ButtonSpec; unknownKeys: string[]; onSave: (s: ButtonSpec) => void; onCancel: () => void;
}) {
  const notePath = useContext(NotePathContext);
  const [draft, setDraft] = useState<ButtonSpec>({ ...spec, action: BUTTON_ACTIONS.includes(spec.action) ? spec.action : "add-row" });
  const [values, setValues] = useState<[string, string][]>(Object.entries(spec.values ?? {}));
  const collections = useCollections();
  const [templates, setTemplates] = useState<string[]>([]);
  const [views, setViews] = useState<string[]>([]);
  const set = <K extends keyof ButtonSpec>(k: K, v: ButtonSpec[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const needsCollection = draft.action === "add-row" || draft.action === "log" || (draft.action === "open" && !draft.target);
  // A `set` button writes to the row it sits on: its collection is the note's.
  const valuesCollection = draft.action === "set" ? notePath.match(/^collections\/([^/]+)\//)?.[1] : draft.collection;
  const habits = useRowTitles(draft.action === "log" ? draft.collection : undefined);

  useEffect(() => {
    if (!draft.collection) { setTemplates([]); setViews([]); return; }
    let live = true;
    commands.listRowTemplates(`collections/${draft.collection}`).then((t) => { if (live) setTemplates(t); }).catch(() => { if (live) setTemplates([]); });
    commands.readNote(`collections/${draft.collection}/_index.md`)
      .then((n) => { if (live) setViews(parseViews(n.frontmatter).map((v) => v.name)); })
      .catch(() => { if (live) setViews([]); });
    return () => { live = false; };
  }, [draft.collection]);

  const save = () => {
    const kept = values.filter(([k]) => k.trim());
    onSave({ ...draft, label: draft.label.trim() || "Button", values: kept.length ? Object.fromEntries(kept.map(([k, v]) => [k.trim(), v])) : undefined });
  };
  const listed = (list: string[], current: string | undefined) => [...(current && !list.includes(current) ? [current] : []), ...list];

  return (
    <div className={styles.editor} role="group" aria-label="Button settings"
      onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); onCancel(); } if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); } }}>
      <label className={styles.field}><span>Label</span>
        <input autoFocus value={draft.label} onChange={(e) => set("label", e.target.value)} placeholder="New expense" />
      </label>
      <div className={styles.field}><span>Does</span>
        <Dropdown fullWidth value={draft.action} options={BUTTON_ACTIONS.map((a) => ({ value: a, label: ACTION_LABEL[a] }))} onChange={(a) => set("action", a as ButtonAction)} />
      </div>
      {needsCollection && (
        <div className={styles.field}><span>{draft.action === "open" ? "Collection" : "In"}</span>
          <Dropdown fullWidth value={draft.collection ?? ""} placeholder="Pick a collection"
            options={listed(collections, draft.collection).map((c) => ({ value: c, label: c }))}
            onChange={(c) => setDraft((d) => ({ ...d, collection: c, template: undefined, view: undefined, item: undefined }))} />
        </div>
      )}
      {draft.action === "open" && (
        <>
          <label className={styles.field}><span>Or a note</span>
            <input value={draft.target ?? ""} onChange={(e) => set("target", e.target.value)} placeholder="a title or notes/path.md" />
          </label>
          {!draft.target && (
            <div className={styles.field}><span>View</span>
              <Dropdown fullWidth value={draft.view ?? ""} placeholder="Its first view"
                options={[{ value: "", label: "Its first view" }, ...listed(views, draft.view).map((v) => ({ value: v, label: v }))]}
                onChange={(v) => set("view", v || undefined)} />
            </div>
          )}
        </>
      )}
      {draft.action === "log" && (
        <div className={styles.field}><span>Item</span>
          {habits.length
            ? <Dropdown fullWidth value={draft.item ?? ""} placeholder="Pick one" options={listed(habits, draft.item).map((h) => ({ value: h, label: h }))} onChange={(h) => set("item", h)} />
            : <input value={draft.item ?? ""} onChange={(e) => set("item", e.target.value)} placeholder="the habit's title" />}
        </div>
      )}
      {draft.action === "url" && (
        <label className={styles.field}><span>URL</span>
          <input value={draft.url ?? ""} onChange={(e) => set("url", e.target.value)} placeholder="https://…" />
        </label>
      )}
      {(draft.action === "add-row" || draft.action === "set") && (
        <div className={styles.field}><span>{draft.action === "set" ? "Sets" : "With"}</span>
          <ValuesEditor collection={valuesCollection} values={values} onChange={setValues} />
        </div>
      )}
      {draft.action === "add-row" && (
        <>
          {templates.length > 0 && (
            <div className={styles.field}><span>Template</span>
              <Dropdown fullWidth value={draft.template ?? ""} placeholder="The default"
                options={[{ value: "", label: "The default" }, ...listed(templates, draft.template).map((t) => ({ value: t, label: t }))]}
                onChange={(t) => set("template", t || undefined)} />
            </div>
          )}
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
