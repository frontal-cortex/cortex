import { save } from "@tauri-apps/plugin-dialog";
import { commands } from "./commands";
import { isDesktop } from "./transport";

/** Prompt for a destination and write the export there — or, served to a
 *  browser that has no path on the serving machine to write to, download it.
 *  `target` is a note path (note-html) or a `collections/<name>` source
 *  (collection-csv / -html). */
export async function exportToFile(
  kind: "note-html" | "collection-csv" | "collection-html",
  target: string,
  suggestedName: string,
): Promise<void> {
  if (!isDesktop()) {
    const text = await commands.exportText(kind, target);
    const type = kind === "collection-csv" ? "text/csv" : "text/html";
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement("a");
    a.href = url;
    a.download = suggestedName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return;
  }
  const dest = await save({ defaultPath: suggestedName });
  if (typeof dest === "string" && dest) {
    await commands.exportToFile(kind, target, dest);
  }
}
