import { useEffect, useRef } from "react";
import styles from "./VaultPicker.module.css";

interface Props {
  onOpen: () => void;
  error: string | null;
}

export function VaultPicker({ onOpen, error }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // --- build a brain-like point cloud (folded, flattened sphere with a midline fissure) ---
    const COUNT = 1500;
    const pts = new Float32Array(COUNT * 3);
    const accent = new Uint8Array(COUNT);
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < COUNT; i++) {
      const t = i / (COUNT - 1);
      const incl = Math.acos(1 - 2 * t);
      const az = i * golden;
      const ux = Math.sin(incl) * Math.cos(az);
      const uy = Math.sin(incl) * Math.sin(az);
      const uz = Math.cos(incl);
      const fold =
        0.05 * Math.sin(6 * ux * Math.PI) * Math.sin(5 * uy * Math.PI) +
        0.04 * Math.cos(7 * uz * Math.PI) * Math.sin(4 * ux * Math.PI);
      const groove = 1 - 0.18 * Math.exp(-(ux * ux) / 0.012); // longitudinal fissure at x≈0
      const rr = (1 + fold) * groove;
      pts[i * 3] = ux * 1.3 * rr; // wider left-right
      pts[i * 3 + 1] = uy * 0.76 * rr; // shorter top-bottom
      pts[i * 3 + 2] = uz * 1.05 * rr;
      accent[i] = Math.random() > 0.88 ? 1 : 0;
    }

    // --- nearest-neighbour edges (the neural mesh), computed once on the static cloud ---
    const edges: number[] = [];
    const adj: number[][] = Array.from({ length: COUNT }, () => []);
    for (let i = 0; i < COUNT; i++) {
      let b0 = -1, b1 = -1, d0 = Infinity, d1 = Infinity;
      const ax = pts[i * 3], ay = pts[i * 3 + 1], az = pts[i * 3 + 2];
      for (let j = 0; j < COUNT; j++) {
        if (j === i) continue;
        const dx = pts[j * 3] - ax, dy = pts[j * 3 + 1] - ay, dz = pts[j * 3 + 2] - az;
        const d = dx * dx + dy * dy + dz * dz;
        if (d < d0) { d1 = d0; b1 = b0; d0 = d; b0 = j; }
        else if (d < d1) { d1 = d; b1 = j; }
      }
      for (const j of [b0, b1]) {
        if (j > i) {
          const k = edges.length;
          edges.push(i, j);
          adj[i].push(k);
          adj[j].push(k);
        }
      }
    }
    const edgeCount = edges.length / 2;

    // --- travelling synapse pulses ---
    interface Pulse { from: number; to: number; t: number; speed: number; }
    const pulses: Pulse[] = [];
    if (!reduceMotion) {
      for (let i = 0; i < 5; i++) {
        const k = Math.floor(Math.random() * edgeCount) * 2;
        pulses.push({ from: edges[k], to: edges[k + 1], t: Math.random(), speed: 0.004 + Math.random() * 0.006 });
      }
    }

    // synapse firings: a node flashes bright with an expanding ripple, then fades
    const flashes: { node: number; life: number }[] = [];

    const sx = new Float32Array(COUNT);
    const sy = new Float32Array(COUNT);
    const depth = new Float32Array(COUNT);

    let mx = -9999, my = -9999, mouseOn = false;

    let W = 0, H = 0, cx = 0, cy = 0, radius = 0;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = rect.width; H = rect.height;
      canvas.width = Math.floor(W * dpr);
      canvas.height = Math.floor(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cx = W / 2;
      cy = H / 2;
      radius = Math.min(W, H) * 0.36;
      if (reduceMotion) frame();
    };

    let angle = reduceMotion ? 0.6 : 0;
    const tilt = -0.32;
    const focal = 4;

    function frame() {
      angle += reduceMotion ? 0 : 0.0016;
      const cos = Math.cos(angle), sin = Math.sin(angle);
      const ct = Math.cos(tilt), st = Math.sin(tilt);

      ctx.clearRect(0, 0, W, H);
      ctx.globalCompositeOperation = "lighter";

      for (let i = 0; i < COUNT; i++) {
        const x = pts[i * 3], y = pts[i * 3 + 1], z = pts[i * 3 + 2];
        const X = x * cos + z * sin;
        const Z = -x * sin + z * cos;
        const Y2 = y * ct - Z * st;
        const Z2 = y * st + Z * ct;
        const persp = focal / (focal + Z2);
        sx[i] = cx + X * radius * persp;
        sy[i] = cy + Y2 * radius * persp;
        let d = (Z2 + 1.25) / 2.5;
        depth[i] = d < 0 ? 0 : d > 1 ? 1 : d;
      }

      // nudge dots away from the cursor
      if (mouseOn) {
        const R = 130, R2 = R * R;
        for (let i = 0; i < COUNT; i++) {
          const dx = sx[i] - mx, dy = sy[i] - my;
          const d2 = dx * dx + dy * dy;
          if (d2 < R2 && d2 > 0.5) {
            const dist = Math.sqrt(d2);
            const f = 1 - dist / R;
            const push = f * f * 24;
            sx[i] += (dx / dist) * push;
            sy[i] += (dy / dist) * push;
          }
        }
      }

      // edges, bucketed by depth so we only set strokeStyle a handful of times
      const BUCKETS = 5;
      const paths: Path2D[] = [];
      for (let b = 0; b < BUCKETS; b++) paths.push(new Path2D());
      for (let k = 0; k < edges.length; k += 2) {
        const a = edges[k], c = edges[k + 1];
        const d = (depth[a] + depth[c]) * 0.5;
        if (d < 0.18) continue;
        const b = d >= 1 ? BUCKETS - 1 : Math.floor(d * BUCKETS);
        paths[b].moveTo(sx[a], sy[a]);
        paths[b].lineTo(sx[c], sy[c]);
      }
      ctx.lineWidth = 1;
      for (let b = 0; b < BUCKETS; b++) {
        const d = (b + 0.5) / BUCKETS;
        ctx.strokeStyle = `rgba(102,156,240,${(0.016 + d * 0.06).toFixed(3)})`;
        ctx.stroke(paths[b]);
      }

      // particles
      for (let i = 0; i < COUNT; i++) {
        const d = depth[i];
        if (d < 0.04) continue;
        const size = 0.7 + d * 2.2;
        const a = 0.16 + d * 0.82;
        let r: number, g: number, bl: number;
        if (accent[i]) { r = 150; g = 120; bl = 240; }
        else { r = 70 + d * 120; g = 110 + d * 120; bl = 180 + d * 70; }
        ctx.fillStyle = `rgba(${r | 0},${g | 0},${bl | 0},${a.toFixed(2)})`;
        ctx.fillRect(sx[i] - size * 0.5, sy[i] - size * 0.5, size, size);
      }

      // synapse pulses flowing along connected edges
      for (const p of pulses) {
        p.t += p.speed;
        if (p.t >= 1) {
          const node = p.to;
          if (flashes.length < 3 && Math.random() < 0.12) flashes.push({ node, life: 0 });
          const opts = adj[node];
          const k = opts[(Math.random() * opts.length) | 0];
          const other = edges[k] === node ? edges[k + 1] : edges[k];
          p.from = node;
          p.to = other;
          p.t = 0;
          p.speed = 0.004 + Math.random() * 0.006;
        }
        const f = p.from, to = p.to, t = p.t;
        const px = sx[f] + (sx[to] - sx[f]) * t;
        const py = sy[f] + (sy[to] - sy[f]) * t;
        const d = depth[f] + (depth[to] - depth[f]) * t;
        const rad = (1.4 + d * 2.2) * 4;
        const grad = ctx.createRadialGradient(px, py, 0, px, py, rad);
        grad.addColorStop(0, `rgba(190,225,255,${(0.85 * d).toFixed(2)})`);
        grad.addColorStop(1, "rgba(120,170,255,0)");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(px, py, rad, 0, Math.PI * 2);
        ctx.fill();
      }

      // spontaneous synapse firings, biased toward the front of the cloud
      if (flashes.length < 3 && Math.random() < 0.012) {
        let n = (Math.random() * COUNT) | 0;
        for (let s = 0; s < 3; s++) {
          const c = (Math.random() * COUNT) | 0;
          if (depth[c] > depth[n]) n = c;
        }
        flashes.push({ node: n, life: 0 });
      }
      for (let fi = flashes.length - 1; fi >= 0; fi--) {
        const fl = flashes[fi];
        fl.life += 0.022;
        if (fl.life >= 1) { flashes.splice(fi, 1); continue; }
        const n = fl.node;
        const d = depth[n];
        const fade = 1 - fl.life;
        const px = sx[n], py = sy[n];
        const coreR = 10 + d * 16;
        const g = ctx.createRadialGradient(px, py, 0, px, py, coreR);
        g.addColorStop(0, `rgba(214,236,255,${(0.85 * fade * d).toFixed(2)})`);
        g.addColorStop(1, "rgba(140,190,255,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(px, py, coreR, 0, Math.PI * 2);
        ctx.fill();
        const ringR = (5 + fl.life * 30) * (0.55 + d * 0.45);
        ctx.strokeStyle = `rgba(176,214,255,${(0.45 * fade * d).toFixed(2)})`;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(px, py, ringR, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const onMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mx = e.clientX - rect.left;
      my = e.clientY - rect.top;
      mouseOn = mx >= 0 && my >= 0 && mx <= rect.width && my <= rect.height;
    };
    const onLeave = () => { mouseOn = false; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseout", onLeave);

    let raf = 0;
    if (!reduceMotion) {
      const loop = () => { frame(); raf = requestAnimationFrame(loop); };
      raf = requestAnimationFrame(loop);
    }

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseout", onLeave);
    };
  }, []);

  return (
    <div className={styles.root}>
      <div className={styles.blob} data-blob="1" />
      <div className={styles.blob} data-blob="2" />
      <canvas ref={canvasRef} className={styles.canvas} />
      <div className={styles.scrim} />
      <div className={styles.content}>
        <div className={styles.wordmark}>
          <BrainIcon />
          <span>Cortex</span>
        </div>
        <h1 className={styles.title}>Your second brain, in plain text.</h1>
        <p className={styles.subtitle}>
          A local-first knowledge base backed by a plain git repo.
        </p>
        <button className={styles.button} onClick={onOpen}>
          Open vault
        </button>
        {error && <p className={styles.error}>{error}</p>}
        <p className={styles.hint}>
          Any folder works — Cortex initializes git automatically.
        </p>
      </div>
    </div>
  );
}

function BrainIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.46 2.5 2.5 0 0 1-1.98-3 2.5 2.5 0 0 1-1.32-4.24 3 3 0 0 1 .34-5.58 2.5 2.5 0 0 1 1.96-3.12A2.5 2.5 0 0 1 9.5 2Z"/>
      <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.46 2.5 2.5 0 0 0 1.98-3 2.5 2.5 0 0 0 1.32-4.24 3 3 0 0 0-.34-5.58 2.5 2.5 0 0 0-1.96-3.12A2.5 2.5 0 0 0 14.5 2Z"/>
    </svg>
  );
}
