import { useEffect, useLayoutEffect, useState } from "react";
import { BREAKPOINTS, ViewportSize, viewportQuery, breakpointProperties } from "../lib/breakpoints";

export interface Viewport {
  size: ViewportSize;
  /** Below `BREAKPOINTS.phone`: drawer sidebar, bottom-sheet terminal, thumb-sized targets. */
  isPhone: boolean;
  /** Below `BREAKPOINTS.compact` (phones included): the narrowed in-flow layout. */
  isCompact: boolean;
}

/** The current viewport size, from the breakpoints in lib/breakpoints.ts.
 *
 * Re-renders only when the size changes, not on every pixel of a resize. */
export function useViewport(): Viewport {
  const [size, setSize] = useState<ViewportSize>(resolveSize);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const update = () => setSize(resolveSize());
    const lists = (["phone", "compact"] as const).map((s) => window.matchMedia(viewportQuery(s)));
    lists.forEach((mq) => mq.addEventListener("change", update));
    return () => lists.forEach((mq) => mq.removeEventListener("change", update));
  }, []);

  return { size, isPhone: size === "phone", isCompact: size !== "wide" };
}

/** Stamps the viewport on <html> for CSS: `data-viewport="phone|compact|wide"`
 *  and the `--bp-*` custom properties. Call once, from the root component. */
export function useViewportAttribute(): Viewport {
  const viewport = useViewport();
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.viewport = viewport.size;
    for (const [k, v] of Object.entries(breakpointProperties(BREAKPOINTS))) root.style.setProperty(k, v);
  }, [viewport.size]);
  return viewport;
}

function resolveSize(): ViewportSize {
  if (typeof window === "undefined" || !window.matchMedia) return "wide";
  if (window.matchMedia(viewportQuery("phone")).matches) return "phone";
  if (window.matchMedia(viewportQuery("compact")).matches) return "compact";
  return "wide";
}
