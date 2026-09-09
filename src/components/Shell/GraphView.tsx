import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide,
  Simulation, SimulationNodeDatum, SimulationLinkDatum, ForceLink,
} from "d3-force";
import { NoteEntry, commands } from "../../lib/commands";
import {
  buildGraph, buildLegend, colorOf, nodeRadius, clampDepth, MIN_DEPTH, MAX_DEPTH,
  GraphNode, GraphMode, ColorBy,
} from "../../lib/graph";
import { shortcutFor } from "../../lib/keymap";
import { CloseIcon } from "./icons";
import styles from "./GraphView.module.css";

// The graph is a lens over the links table: `lib/graph.ts` decides what to
// show (mode, depth, filter, orphans, colours) and this component only lays it
// out. Positions live in the simulation, never in a note. The simulation runs
// live — d3 cools it down and stops once it settles; a drag, a changed node
// set or the play button warm it up again.

interface SimNode extends GraphNode, SimulationNodeDatum {}
type SimLink = SimulationLinkDatum<SimNode>;

interface Props {
  notes: NoteEntry[];
  /** The open note — the centre of the local graph (null: nothing open). */
  currentPath: string | null;
  /** Open straight into this mode; otherwise the mode from last time. */
  initialMode?: GraphMode;
  onNavigate: (path: string) => void;
  onClose: () => void;
}

/** Settings survive closing and reopening the graph within a session; they
 *  are view state, so they are not written anywhere. */
const remembered = { mode: "global" as GraphMode, depth: 1, filter: "", colorBy: "none" as ColorBy, showOrphans: true };

const LEGEND_MAX = 12;
const DRAG_THRESHOLD = 4;

export function GraphView({ notes, currentPath, initialMode, onNavigate, onClose }: Props) {
  const [rawLinks, setRawLinks] = useState<Array<[string, string]> | null>(null);
  const [failed, setFailed] = useState(false);

  const [mode, setMode] = useState<GraphMode>(initialMode ?? remembered.mode);
  const [depth, setDepth] = useState(remembered.depth);
  const [filter, setFilter] = useState(remembered.filter);
  const [colorBy, setColorBy] = useState<ColorBy>(remembered.colorBy);
  const [showOrphans, setShowOrphans] = useState(remembered.showOrphans);
  useEffect(() => { Object.assign(remembered, { mode, depth, filter, colorBy, showOrphans }); }, [mode, depth, filter, colorBy, showOrphans]);

  // Local mode needs a centre; without an open note the toggle is disabled.
  const localMode = mode === "local" && currentPath !== null;

  useEffect(() => {
    commands.getAllLinks().then(setRawLinks).catch(() => setFailed(true));
  }, [notes]);

  const model = useMemo(
    () => buildGraph(notes, rawLinks ?? [], { mode: localMode ? "local" : "global", centre: currentPath, depth, filter, showOrphans }),
    [notes, rawLinks, localMode, currentPath, depth, filter, showOrphans],
  );
  const legend = useMemo(() => buildLegend(model.nodes, colorBy), [model.nodes, colorBy]);
  const centre = localMode ? currentPath : null;

  // An in-progress pan of the canvas or drag of one node, by pointer id.
  const panRef = useRef<{ pointerId: number; x: number; y: number; tx: number; ty: number } | null>(null);
  const dragRef = useRef<{ pointerId: number; id: string; x: number; y: number; moved: boolean } | null>(null);

  // ── Simulation ──────────────────────────────────────────────────────────────
  const simRef = useRef<Simulation<SimNode, SimLink> | null>(null);
  const nodesRef = useRef<SimNode[]>([]);
  const linksRef = useRef<SimLink[]>([]);
  const signatureRef = useRef("");
  const [, setTick] = useState(0);
  const [running, setRunning] = useState(false);

  const sim = useCallback((): Simulation<SimNode, SimLink> => {
    if (!simRef.current) {
      simRef.current = forceSimulation<SimNode>([])
        .force("link", forceLink<SimNode, SimLink>([]).id((d) => d.id).distance(90).strength(0.6))
        .force("charge", forceManyBody<SimNode>().strength(-200))
        .force("center", forceCenter(0, 0))
        .force("collide", forceCollide<SimNode>((d) => nodeRadius(d.degree) + 8))
        .on("tick", () => setTick((t) => t + 1))
        .on("end", () => setRunning(false))
        .stop();
    }
    return simRef.current;
  }, []);
  useEffect(() => () => { simRef.current?.stop(); }, []);

  const heat = useCallback((alpha: number) => { sim().alpha(alpha).restart(); setRunning(true); }, [sim]);

  // Reconcile the simulation with the model: nodes that stay keep their
  // positions, new ones start near the centre, and the pinned centre sits at
  // the origin. Only a changed node/edge set warms the simulation back up.
  useEffect(() => {
    if (!rawLinks) return;
    const signature = `${centre ?? ""}|${model.nodes.map((n) => n.id).join("\n")}|${model.links.map((l) => `${l.source}>${l.target}`).join("\n")}`;
    if (signature === signatureRef.current) return;
    signatureRef.current = signature;

    const prev = new Map(nodesRef.current.map((n) => [n.id, n]));
    const spread = Math.min(400, 60 + model.nodes.length * 4);
    nodesRef.current = model.nodes.map((n) => {
      const kept = prev.get(n.id);
      const node: SimNode = kept ? Object.assign(kept, n) : { ...n, x: (Math.random() - 0.5) * spread, y: (Math.random() - 0.5) * spread };
      if (n.id === centre) { node.fx = 0; node.fy = 0; }
      else if (dragRef.current?.id !== n.id) { node.fx = null; node.fy = null; }
      return node;
    });
    linksRef.current = model.links.map((l) => ({ source: l.source, target: l.target }));
    const s = sim();
    s.nodes(nodesRef.current);
    (s.force("link") as ForceLink<SimNode, SimLink>).links(linksRef.current);
    heat(prev.size ? 0.6 : 1);
  }, [model, centre, rawLinks, sim, heat]);

  const togglePlay = useCallback(() => {
    if (running) { sim().stop(); setRunning(false); } else heat(0.5);
  }, [running, sim, heat]);

  // ── Pan / zoom / drag (pointer events, so touch and mouse share one path) ──
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const transformRef = useRef(transform);
  transformRef.current = transform;
  const svgRef = useRef<SVGSVGElement>(null);

  /** Pointer position in graph coordinates (before pan and zoom). */
  const toGraph = useCallback((clientX: number, clientY: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    const t = transformRef.current;
    if (!rect) return { x: 0, y: 0 };
    return {
      x: (clientX - rect.left - rect.width / 2 - t.x) / t.scale,
      y: (clientY - rect.top - rect.height / 2 - t.y) / t.scale,
    };
  }, []);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    // Native listener: React's wheel handler is passive, so it could not
    // stop the page behind the modal from scrolling.
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      const px = e.clientX - rect.left - rect.width / 2;
      const py = e.clientY - rect.top - rect.height / 2;
      setTransform((t) => {
        const scale = Math.max(0.2, Math.min(4, t.scale * (e.deltaY < 0 ? 1.1 : 0.9)));
        const k = scale / t.scale;
        return { scale, x: px - (px - t.x) * k, y: py - (py - t.y) * k };
      });
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [rawLinks]);

  const onSvgPointerDown = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    if ((e.target as Element).closest("[data-node]")) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    panRef.current = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, tx: transformRef.current.x, ty: transformRef.current.y };
  }, []);

  const onSvgPointerMove = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    const pan = panRef.current;
    if (pan && pan.pointerId === e.pointerId) {
      setTransform((t) => ({ ...t, x: pan.tx + (e.clientX - pan.x), y: pan.ty + (e.clientY - pan.y) }));
      return;
    }
    const drag = dragRef.current;
    if (drag && drag.pointerId === e.pointerId) {
      if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > DRAG_THRESHOLD) {
        drag.moved = true;
        sim().alphaTarget(0.3).restart();
        setRunning(true);
      }
      if (!drag.moved) return;
      const node = nodesRef.current.find((n) => n.id === drag.id);
      if (node) { const p = toGraph(e.clientX, e.clientY); node.fx = p.x; node.fy = p.y; }
    }
  }, [sim, toGraph]);

  const onSvgPointerUp = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    if (panRef.current?.pointerId === e.pointerId) panRef.current = null;
    const drag = dragRef.current;
    if (drag && drag.pointerId === e.pointerId) {
      dragRef.current = null;
      const node = nodesRef.current.find((n) => n.id === drag.id);
      if (drag.moved) {
        sim().alphaTarget(0);
        if (node && node.id !== centre) { node.fx = null; node.fy = null; }
      } else if (node) {
        onNavigate(node.id);
        onClose();
      }
    }
  }, [sim, centre, onNavigate, onClose]);

  const onNodePointerDown = useCallback((e: React.PointerEvent<SVGGElement>, id: string) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    e.stopPropagation();
    svgRef.current?.setPointerCapture(e.pointerId);
    dragRef.current = { pointerId: e.pointerId, id, x: e.clientX, y: e.clientY, moved: false };
    const node = nodesRef.current.find((n) => n.id === id);
    if (node) { node.fx = node.x; node.fy = node.y; }
  }, []);

  // ── Render ──────────────────────────────────────────────────────────────────
  const nodes = nodesRef.current;
  const links = linksRef.current;
  const width = svgRef.current?.clientWidth ?? 900;
  const height = svgRef.current?.clientHeight ?? 600;
  const hint = rawLinks
    ? `${model.nodes.length} of ${notes.length} notes · ${model.links.length} link${model.links.length === 1 ? "" : "s"}`
      + (model.hiddenOrphans ? ` · ${model.hiddenOrphans} orphan${model.hiddenOrphans === 1 ? "" : "s"} hidden` : "")
    : "";

  return (
    <div className={styles.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={styles.modal} role="dialog" aria-label="Note graph">
        <div className={styles.toolbar}>
          <span className={styles.toolbarTitle}>{localMode ? "Local graph" : "Note graph"}</span>
          <span className={styles.toolbarHint}>{hint}</span>
          <button className={styles.closeBtn} onClick={onClose} title="Close (Esc)"><CloseIcon size={15} /></button>
        </div>

        <div className={styles.controls}>
          <div className={styles.segment} role="radiogroup" aria-label="Scope">
            <button className={`${styles.segBtn} ${!localMode ? styles.segBtnActive : ""}`} role="radio" aria-checked={!localMode}
              onClick={() => setMode("global")} title={`Every note (${shortcutFor("graph")})`}>Global</button>
            <button className={`${styles.segBtn} ${localMode ? styles.segBtnActive : ""}`} role="radio" aria-checked={localMode}
              disabled={currentPath === null} onClick={() => setMode("local")}
              title={currentPath === null ? "Open a note to see its local graph" : `The open note and its neighbours (${shortcutFor("local-graph")})`}>Local</button>
          </div>
          {localMode && (
            <div className={styles.segment} role="radiogroup" aria-label="Depth">
              {Array.from({ length: MAX_DEPTH - MIN_DEPTH + 1 }, (_, i) => MIN_DEPTH + i).map((d) => (
                <button key={d} className={`${styles.segBtn} ${clampDepth(depth) === d ? styles.segBtnActive : ""}`} role="radio"
                  aria-checked={clampDepth(depth) === d} onClick={() => setDepth(d)} title={`${d} hop${d === 1 ? "" : "s"} from the open note`}>{d}</button>
              ))}
            </div>
          )}
          <input
            className={styles.filter}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter: title, tag:x, path:x, -tag:y"
            aria-label="Filter notes"
            autoFocus
            spellCheck={false}
          />
          <label className={styles.control}>
            Colour
            <select className={styles.select} value={colorBy} onChange={(e) => setColorBy(e.target.value as ColorBy)} aria-label="Colour nodes by">
              <option value="none">none</option>
              <option value="tag">tag</option>
              <option value="folder">folder</option>
            </select>
          </label>
          <label className={styles.control} title="Show notes with no links in this graph">
            <input type="checkbox" checked={showOrphans} onChange={(e) => setShowOrphans(e.target.checked)} />
            Orphans
          </label>
          <button className={styles.playBtn} onClick={togglePlay} title={running ? "Pause the layout" : "Resume the layout"} aria-pressed={running}>
            {running ? "Pause" : "Resume"}
          </button>
        </div>

        {failed ? (
          <div className={styles.loading}>Could not read the links index.</div>
        ) : !rawLinks ? (
          <div className={styles.loading}>Building graph…</div>
        ) : (
          <div className={styles.canvas}>
            <svg
              ref={svgRef}
              className={styles.svg}
              onPointerDown={onSvgPointerDown}
              onPointerMove={onSvgPointerMove}
              onPointerUp={onSvgPointerUp}
              onPointerCancel={onSvgPointerUp}
            >
              <g transform={`translate(${transform.x + width / 2},${transform.y + height / 2}) scale(${transform.scale})`}>
                {links.map((l, i) => {
                  const s = l.source as SimNode, t = l.target as SimNode;
                  if (typeof s !== "object" || typeof t !== "object") return null;
                  return <line key={i} x1={s.x ?? 0} y1={s.y ?? 0} x2={t.x ?? 0} y2={t.y ?? 0} className={styles.edge} />;
                })}
                {nodes.map((n) => {
                  const r = nodeRadius(n.degree);
                  const color = colorBy === "none" ? null : colorOf(n, colorBy, legend);
                  const isCentre = n.id === centre;
                  const dim = n.distance !== undefined && n.distance > 1 ? 1 - (n.distance - 1) * 0.2 : 1;
                  return (
                    <g key={n.id} data-node className={`${styles.nodeGroup} ${isCentre ? styles.nodeCentre : ""}`}
                      transform={`translate(${n.x ?? 0},${n.y ?? 0})`} opacity={dim}
                      onPointerDown={(e) => onNodePointerDown(e, n.id)} role="button" tabIndex={-1}
                      aria-label={n.title}>
                      <title>{n.title}{n.degree ? ` · ${n.degree} link${n.degree === 1 ? "" : "s"}` : ""}</title>
                      <circle r={r} className={styles.nodeCircle}
                        style={color ? { fill: `var(--tag-${color}-bg)`, stroke: `var(--tag-${color}-fg)` } : undefined} />
                      {n.icon ? (
                        <text textAnchor="middle" dominantBaseline="central" fontSize={Math.max(10, r)}>{n.icon}</text>
                      ) : (
                        <circle r={Math.max(2, r / 4)} className={styles.nodeDot}
                          style={color ? { fill: `var(--tag-${color}-fg)` } : undefined} />
                      )}
                      <text y={r + 12} textAnchor="middle" className={styles.nodeLabel}>
                        {n.title.length > 18 ? n.title.slice(0, 16) + "…" : n.title}
                      </text>
                    </g>
                  );
                })}
              </g>
            </svg>
            {model.nodes.length === 0 && (
              <div className={styles.empty}>
                {filter.trim() ? "No notes match this filter." : localMode ? "This note has no links yet." : "No notes to show."}
              </div>
            )}
            {legend.length > 0 && (
              <div className={styles.legend} aria-label={`Colour by ${colorBy}`}>
                {legend.slice(0, LEGEND_MAX).map((e) => (
                  <span key={e.key} className={styles.legendItem} title={`${e.count} note${e.count === 1 ? "" : "s"}`}>
                    <span className={styles.swatch} style={{ background: `var(--tag-${e.color}-bg)`, borderColor: `var(--tag-${e.color}-fg)` }} />
                    {colorBy === "tag" ? `#${e.key}` : e.key}
                    <span className={styles.legendCount}>{e.count}</span>
                  </span>
                ))}
                {legend.length > LEGEND_MAX && <span className={styles.legendMore}>+{legend.length - LEGEND_MAX} more</span>}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
