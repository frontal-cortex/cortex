import { createHash } from "node:crypto";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const host = process.env.TAURI_DEV_HOST;

// The served app's service worker, written at build time with this build's
// file names. It caches the app shell only — vault data under /api is never
// cached — so an installed app opens instantly and, offline, shows its own
// "can't reach" screen instead of the browser's.
function cortexServiceWorker(): Plugin {
  return {
    name: "cortex-service-worker",
    apply: "build",
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle).filter((f) => !f.endsWith(".map")).sort();
      const shell = [
        "/", "/index.html", "/manifest.webmanifest",
        "/icons/icon-192.png", "/icons/icon-512.png", "/icons/icon-maskable-512.png", "/icons/apple-touch-icon.png",
        ...files.filter((f) => f !== "index.html").map((f) => `/${f}`),
      ];
      const version = createHash("sha256").update(files.join("|")).digest("hex").slice(0, 12);
      const source = `const CACHE = "cortex-shell-${version}";
const SHELL = ${JSON.stringify(shell)};
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("cortex-shell-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  if (e.request.mode === "navigate") {
    e.respondWith(fetch(e.request).catch(() => caches.match("/index.html")));
    return;
  }
  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request)));
});
`;
      this.emitFile({ type: "asset", fileName: "sw.js", source });
    },
  };
}

export default defineConfig({
  plugins: [react(), cortexServiceWorker()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? { protocol: "ws", host, port: 1421 }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**", "**/crates/**", "**/target/**"],
    },
  },
});
