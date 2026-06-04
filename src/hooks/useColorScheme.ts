import { useEffect, useState } from "react";

/** The app's resolved color scheme ("light" | "dark").
 *
 * Tracks the explicit `data-theme` attribute set on <html> from Settings, and
 * falls back to the OS preference when the theme is "system" (attribute absent).
 * Components that embed third-party widgets which theme themselves off the OS
 * (e.g. BlockNote's `theme="auto"`) need this so they match the forced theme
 * instead of the OS — otherwise dark-mode text renders on a light background. */
export function useColorScheme(): "light" | "dark" {
  const [scheme, setScheme] = useState<"light" | "dark">(resolveScheme);

  useEffect(() => {
    const update = () => setScheme(resolveScheme());
    // React to Settings toggling the data-theme attribute…
    const obs = new MutationObserver(update);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    // …and to OS changes while the theme is "system".
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", update);
    return () => { obs.disconnect(); mq.removeEventListener("change", update); };
  }, []);

  return scheme;
}

function resolveScheme(): "light" | "dark" {
  const explicit = document.documentElement.dataset.theme;
  if (explicit === "light" || explicit === "dark") return explicit;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
