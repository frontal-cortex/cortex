// The address of a note. Served to a browser, the app had one URL for the whole
// vault: nothing could be bookmarked, put on a home screen, sent to anyone, or
// reloaded without losing your place. A note now lives at `/n/<its path>`, each
// segment percent-encoded, and the server hands any `/n/…` request the app
// (crates/cortex-app/src/server.rs), which then opens that note.

const PREFIX = "/n/";

/** `notes/ideas/Second Brain.md` → `/n/notes/ideas/Second%20Brain.md` */
export function noteUrl(path: string): string {
  const segments = path.split("/").filter(Boolean).map(encodeURIComponent);
  return segments.length ? PREFIX + segments.join("/") : "/";
}

/** The note an address names, or null when it names none. Takes a full URL or a
 *  bare pathname. A segment that could climb out of the vault is refused here
 *  as well as in the backend: an address is user input like any other. */
export function notePathFromUrl(url: string): string | null {
  let pathname = url;
  if (/^https?:\/\//i.test(url)) {
    try { pathname = new URL(url).pathname; } catch { return null; }
  }
  pathname = pathname.split("?")[0].split("#")[0];
  if (!pathname.startsWith(PREFIX)) return null;
  const rest = pathname.slice(PREFIX.length);
  if (!rest) return null;
  let segments: string[];
  try {
    segments = rest.split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    return null; // a half-written percent escape, pasted by hand
  }
  if (!segments.length) return null;
  if (segments.some((s) => s === "." || s === ".." || s.includes("\0"))) return null;
  return segments.join("/");
}
