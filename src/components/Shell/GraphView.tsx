import { useEffect, useRef, useState, useCallback } from "react";
import {
  forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide,
  SimulationNodeDatum, SimulationLinkDatum,
} from "d3-force";
import { NoteEntry, commands } from "../../lib/commands";
import { clamp, distance, midpoint, pinchFactor, wheelZoomFactor, Point } from "../../lib/gestures";
import { CloseIcon } from "./icons";
import styles from "./GraphView.module.css";

interface GNode extends SimulationNodeDatum {
  id: string;
  title: string;
  icon: string | null;
  x: number;
  y: number;
}

interface GLink {
  source: string;
  target: string;
}

interface ResolvedLink {
  sx: number; sy: number;
  tx: number; ty: number;
}

interface Props {
  notes: NoteEntry[];
  onNavigate: (path: string) => void;
  onClose: () => void;
}

export function GraphView({ notes, onNavigate, onClose }: Props) {
  const [nodes, setNodes] = useState<GNode[]>([]);
  const [links, setLinks] = useState<ResolvedLink[]>([]);
  const [loading, setLoading] = useState(true);

  // Pan/zoom state. Pointer events carry mouse, pen and touch down one path:
  // one pointer pans, two pinch (scale about the fingers' midpoint); the
  // wheel zooms. `touch-action: none` on the svg keeps the browser from
  // scrolling or zooming the page with the same fingers.
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const latest = useRef(transform);
  latest.current = transform;
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<{ x: number; y: number; tx: number; ty: number; dist: number; scale: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    commands.getAllLinks().then((rawLinks) => {
      const titleToPath = new Map<string, string>();
      const stemToPath = new Map<string, string>();
      for (const n of notes) {
        titleToPath.set(n.title.toLowerCase(), n.path);
        const stem = n.path.split("/").pop()?.replace(/\.md$/, "") ?? "";
        stemToPath.set(stem.toLowerCase(), n.path);
      }

      const gnodes: GNode[] = notes.map((n) => ({
        id: n.path,
        title: n.title || n.path.split("/").pop()?.replace(/\.md$/, "") || "",
        icon: n.icon,
        x: (Math.random() - 0.5) * 400,
        y: (Math.random() - 0.5) * 400,
      }));

      const nodeById = new Map(gnodes.map((n) => [n.id, n]));

      const glinks: GLink[] = [];
      for (const [src, tgt] of rawLinks) {
        const tgtPath =
          titleToPath.get(tgt.toLowerCase()) ??
          stemToPath.get(tgt.toLowerCase());
        if (tgtPath && nodeById.has(src) && nodeById.has(tgtPath) && src !== tgtPath) {
          glinks.push({ source: src, target: tgtPath });
        }
      }

      const sim = forceSimulation<GNode>(gnodes)
        .force("link", forceLink<GNode, SimulationLinkDatum<GNode>>(glinks as any)
          .id((d: GNode) => d.id).distance(90).strength(0.6))
        .force("charge", forceManyBody<GNode>().strength(-180))
        .force("center", forceCenter(0, 0))
        .force("collide", forceCollide<GNode>(38))
        .stop();

      for (let i = 0; i < 300; i++) sim.tick();

      const resolved: ResolvedLink[] = (glinks as any[]).map((l) => ({
        sx: l.source.x ?? 0, sy: l.source.y ?? 0,
        tx: l.target.x ?? 0, ty: l.target.y ?? 0,
      }));

      setNodes([...gnodes]);
      setLinks(resolved);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [notes]);

  // The wheel listener is attached by hand: React registers `wheel` as
  // passive, so an `onWheel` prop could not stop the page from scrolling.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = wheelZoomFactor(e.deltaY);
      setTransform((t) => ({ ...t, scale: clamp(t.scale * factor, 0.2, 4) }));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [loading]);

  /** Where the current pointers stand: one pans from it, two pinch from it. */
  const anchor = (t: { x: number; y: number; scale: number }) => {
    const pts = [...pointers.current.values()];
    const c = pts.length >= 2 ? midpoint(pts[0], pts[1]) : pts[0];
    gesture.current = { x: c.x, y: c.y, tx: t.x, ty: t.y, dist: pts.length >= 2 ? distance(pts[0], pts[1]) : 0, scale: t.scale };
  };

  const onPointerDown = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    if ((e.target as Element).closest("[data-node]")) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    anchor(latest.current);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (!g) return;
    const pts = [...pointers.current.values()];
    const c = pts.length >= 2 ? midpoint(pts[0], pts[1]) : pts[0];
    const scale = pts.length >= 2 ? clamp(g.scale * pinchFactor(g.dist, distance(pts[0], pts[1])), 0.2, 4) : g.scale;
    setTransform({ x: g.tx + (c.x - g.x), y: g.ty + (c.y - g.y), scale });
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    if (!pointers.current.delete(e.pointerId)) return;
    if (pointers.current.size === 0) { gesture.current = null; return; }
    // A finger lifted mid-pinch: carry on panning from where the rest stand.
    anchor(latest.current);
  }, []);

  return (
    <div className={styles.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={styles.modal}>
        <div className={styles.toolbar}>
          <span className={styles.toolbarTitle}>Note Graph</span>
          <span className={styles.toolbarHint}>{nodes.length} notes · {links.length} links</span>
          <button className={styles.closeBtn} onClick={onClose} title="Close"><CloseIcon size={15} /></button>
        </div>

        {loading ? (
          <div className={styles.loading}>Building graph…</div>
        ) : (
          <svg
            ref={svgRef}
            className={styles.svg}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            <g transform={`translate(${transform.x + (svgRef.current?.clientWidth ?? 800) / 2},${transform.y + (svgRef.current?.clientHeight ?? 600) / 2}) scale(${transform.scale})`}>
              {links.map((l, i) => (
                <line key={i} x1={l.sx} y1={l.sy} x2={l.tx} y2={l.ty} className={styles.edge} />
              ))}
              {nodes.map((n) => (
                <g key={n.id} data-node className={styles.nodeGroup}
                  transform={`translate(${n.x ?? 0},${n.y ?? 0})`}
                  onClick={() => { onNavigate(n.id); onClose(); }} role="button">
                  <circle r={18} className={styles.nodeCircle} />
                  {n.icon ? (
                    <text textAnchor="middle" dominantBaseline="central" fontSize={14}>{n.icon}</text>
                  ) : (
                    <circle r={4} className={styles.nodeDot} />
                  )}
                  <text y={28} textAnchor="middle" className={styles.nodeLabel}>
                    {n.title.length > 18 ? n.title.slice(0, 16) + "…" : n.title}
                  </text>
                </g>
              ))}
            </g>
          </svg>
        )}
      </div>
    </div>
  );
}
