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
  window.addEventListener("load", () => { navigator.serviceWorker.register("/sw.js").catch(() => {}); });
}
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <ErrorBoundary label="the app">
    <App />
  </ErrorBoundary>,
);
