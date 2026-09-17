// What the visual editors offer to pick from: the collections in the vault,
// and a source's properties with their types — so a field is chosen from a
// list, not typed, and a filter's value input can be a date, a select's
// options or a yes/no.

import { useEffect, useState } from "react";
import { commands, PropertyDef } from "../../lib/commands";

export interface SourceFields {
  /** Every field a row of the source has, `title` first. */
  names: string[];
  /** The schema of each property that has one. */
  props: Record<string, PropertyDef>;
}

const EMPTY: SourceFields = { names: [], props: {} };
const cache = new Map<string, Promise<SourceFields>>();

function load(source: string): Promise<SourceFields> {
  const name = source.match(/^collections\/([^/]+)\/?$/)?.[1] ?? (/^[\w-]+$/.test(source) ? source : null);
  const p: Promise<SourceFields> = name
    ? commands.getSchema(name).then((schema) => {
        const props: Record<string, PropertyDef> = {};
        for (const d of schema?.properties ?? []) props[d.name] = d;
        const names = ["title", ...Object.keys(props).filter((n) => n !== "title")];
        return { names, props };
      })
    // A CSV has no schema: its header row is the field list.
    : commands.runView(`source: ${source}\nlimit: 1\n`).then((t) => ({ names: t.allColumns.filter((c) => c !== "$body"), props: {} }));
  const safe = p.catch(() => EMPTY);
  cache.set(source, safe);
  // Schemas change (a property added from a table header): forget after a moment.
  setTimeout(() => { if (cache.get(source) === safe) cache.delete(source); }, 5000);
  return safe;
}

export function useSourceFields(source: string | undefined): SourceFields {
  const [fields, setFields] = useState<SourceFields>(EMPTY);
  useEffect(() => {
    if (!source) { setFields(EMPTY); return; }
    let live = true;
    (cache.get(source) ?? load(source)).then((f) => { if (live) setFields(f); });
    return () => { live = false; };
  }, [source]);
  return fields;
}

/** The titles of a collection's rows — what a relation value, a habit to
 *  tick or a filter on a relation is picked from. */
export function useRowTitles(collection: string | undefined): string[] {
  const [titles, setTitles] = useState<string[]>([]);
  useEffect(() => {
    if (!collection) { setTitles([]); return; }
    let live = true;
    commands.runView(`source: collections/${collection}\ncolumns: [title]\nsort: [title]\n`)
      .then((t) => { if (live) setTitles([...new Set(t.rows.map((r) => String(r.cells.title ?? "")).filter(Boolean))]); })
      .catch(() => { if (live) setTitles([]); });
    return () => { live = false; };
  }, [collection]);
  return titles;
}

let collectionsCache: Promise<string[]> | null = null;

export function useCollections(): string[] {
  const [list, setList] = useState<string[]>([]);
  useEffect(() => {
    let live = true;
    if (!collectionsCache) {
      collectionsCache = commands.listCollections().catch(() => []);
      setTimeout(() => { collectionsCache = null; }, 5000);
    }
    collectionsCache.then((l) => { if (live) setList(l); });
    return () => { live = false; };
  }, []);
  return list;
}

/** Is this property a date to the filter — worth offering "This month"? */
export function isDateProp(field: string, d: PropertyDef | undefined): boolean {
  const t = d?.type;
  return t === "date" || t === "date_range" || t === "created_time" || t === "edited_time" || (!d && (field === "created" || field === "date"));
}
