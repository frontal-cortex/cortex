// A page of views draws the ones on screen first. Until a view comes within a
// screen of the viewport it is an empty box of about its height: no query, no
// rows, no layout for the browser to do. A dashboard of a dozen views opens
// with the four you can see, and the rest arrive as you scroll toward them.
// Once shown, a view stays mounted.

import { ReactNode, useEffect, useRef, useState } from "react";

export function Deferred({ children, minHeight }: { children: ReactNode; minHeight: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(() => typeof IntersectionObserver === "undefined");
  useEffect(() => {
    if (shown) return;
    const el = ref.current;
    if (!el) return;
    // A screen's height of margin: a view is ready by the time it scrolls in.
    const io = new IntersectionObserver(
      (entries) => { if (entries.some((e) => e.isIntersecting)) { setShown(true); io.disconnect(); } },
      { rootMargin: "100% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [shown]);
  if (shown) return <>{children}</>;
  return <div ref={ref} style={{ minHeight }} aria-busy="true" />;
}
