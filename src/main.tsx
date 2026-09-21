import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { installLinkGuard } from "./lib/links";
import { isDesktop } from "./lib/transport";
import "./index.css";

// NOTE: intentionally not wrapped in <React.StrictMode>. BlockNote's editor does
// not support StrictMode's mount→unmount→remount cycle — it leaves the editor in
// a torn-down state where block IDs no longer resolve ("Block with ID … not
// found"), which broke checkbox toggles (and other block interactions) from
// persisting. This is a known BlockNote limitation.
installLinkGuard();
// Served to a browser rather than inside the desktop app: the service worker
// lets the app open from the home screen and show its shell when offline.
// It never caches vault data (see vite.config.ts).
if (import.meta.env.PROD && !isDesktop() && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").then((reg) => {
      // A phone keeps a page alive for days: added to the home screen, the app
      // is resumed rather than loaded, and the running bundle can be several
      // versions behind the server while every reported bug is already fixed.
      // Ask on every return to the app whether there is a newer one.
      const check = () => { if (document.visibilityState === "visible") reg.update().catch(() => {}); };
      document.addEventListener("visibilitychange", check);
      window.setInterval(check, 30 * 60 * 1000);
    }).catch(() => {});
    // The new worker claims the page as soon as it installs; the tab is still
    // running the old bundle until it reloads. Reload when nothing is being
    // typed — never under someone's hands mid-sentence.
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      const el = document.activeElement as HTMLElement | null;
      const typing = !!el && (el.isContentEditable || ["INPUT", "TEXTAREA"].includes(el.tagName));
      if (!typing) window.location.reload();
    });
  });
}
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <ErrorBoundary label="the app">
    <App />
  </ErrorBoundary>,
);

