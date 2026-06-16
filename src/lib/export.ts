import { save } from "@tauri-apps/plugin-dialog";
import { commands } from "./commands";

/** Prompt for a destination and write the export there. `target` is a note path
 *  (note-html) or a `collections/<name>` source (collection-csv / -html). */
export async function exportToFile(
  kind: "note-html" | "collection-csv" | "collection-html",
  target: string,
  suggestedName: string,
): Promise<void> {
  const dest = await save({ defaultPath: suggestedName });
  if (typeof dest === "string" && dest) {
    await commands.exportToFile(kind, target, dest);
  }
}
