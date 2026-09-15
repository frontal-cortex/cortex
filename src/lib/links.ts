import { open } from "@tauri-apps/plugin-shell";
import { isDesktop } from "./transport";

const SCHEMES = new Set(["http:", "https:", "mailto:"]);

/** Open a URL outside the app — only web pages and mail. Anything else (file:,
 *  custom schemes an installer registered, javascript:) is refused: a note or a
 *  pack README must not be able to launch programs by being clicked. */
export async function openExternal(raw: string): Promise<boolean> {
  let url: URL;
  try { url = new URL(raw); } catch { return false; }
  if (!SCHEMES.has(url.protocol)) return false;
  try {
    // Served to a browser, a new tab is the outside.
    if (isDesktop()) await open(url.href);
    else window.open(url.href, "_blank", "noopener,noreferrer");
    return true;
  } catch { return false; }
}

/** Every anchor click in the app: internal links (wiki links, same-document
 *  anchors) proceed; anything with a scheme goes through `openExternal`. The
 *  webview itself never navigates (the Rust side refuses that too). */
export function installLinkGuard(): void {
  document.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button !== 0) return;
    const a = (e.target as Element | null)?.closest?.("a[href]");
    if (!a) return;
    if (a.hasAttribute("download")) return; // a download the app itself started (lib/export.ts)
    const href = a.getAttribute("href") ?? "";
    if (!/^[a-z][a-z0-9+.-]*:/i.test(href)) return; // relative or #anchor: the app's own
    e.preventDefault();
    void openExternal(href);
  }, true);
}
