// ── Terminal pane: xterm.js in front of a Rust pty ───────────────────────────
//
// The shell lives in Rust (src-tauri/src/terminal.rs); this component is the
// screen and keyboard. It is built to be hidden and shown without losing the
// session: the parent toggles `visible` (typically via the `hidden`
// attribute), and we refit the grid when it comes back rather than tearing
// anything down. The session only ends when the component unmounts.
//
// Colours come from the app's design tokens so the terminal matches whatever
// theme or desktop palette is active, and follow it live.

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import "@xterm/xterm/css/xterm.css";
import { commands, TerminalData, TerminalExit } from "../../lib/commands";
import styles from "./TerminalPane.module.css";

export interface TerminalPaneProps {
  /** Directory the shell starts in. Defaults (in Rust) to the open vault. */
  cwd?: string;
  /** Whether the pane is currently shown. Flipping to true refits the grid. */
  visible: boolean;
}

/** Imperative surface for the parent: focus the terminal (e.g. on a
 *  keyboard shortcut that opens the pane). */
export interface TerminalPaneHandle {
  focus: () => void;
}

const FONT_SIZE = 13;
const EXIT_NOTICE = "\r\n\x1b[2m[shell exited — press Enter to restart]\x1b[0m\r\n";

export const TerminalPane = forwardRef<TerminalPaneHandle, TerminalPaneProps>(
  function TerminalPane({ cwd, visible }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const termRef = useRef<Terminal | null>(null);
    const fitRef = useRef<FitAddon | null>(null);
    // Latest cwd for respawns, without re-running the mount effect.
    const cwdRef = useRef(cwd);
    cwdRef.current = cwd;

    useImperativeHandle(ref, () => ({ focus: () => termRef.current?.focus() }), []);

    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;

      const term = new Terminal({
        cursorBlink: true,
        fontFamily: readMonoFont(),
        fontSize: FONT_SIZE,
        theme: buildTheme(),
        scrollback: 5000,
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      termRef.current = term;
      fitRef.current = fit;

      // Session state lives in closures, not React state: nothing here
      // renders, and a re-render per output chunk would be wasteful.
      let disposed = false;
      let opened = false;
      let sessionId: number | null = null;
      let spawning = false;
      let exited = false;
      // Output that arrives between calling spawn and learning our id. The
      // shell prints its prompt within milliseconds, faster than the invoke
      // round-trip, so this window is real.
      let pending: TerminalData[] = [];
      const unlisteners: UnlistenFn[] = [];

      const writeChunk = (chunk: TerminalData) => {
        term.write(decodeBase64(chunk.data));
      };

      const spawn = async () => {
        if (spawning || disposed) return;
        spawning = true;
        exited = false;
        pending = [];
        try {
          const id = await commands.terminalSpawn(cwdRef.current, term.cols, term.rows);
          if (disposed) {
            void commands.terminalKill(id);
            return;
          }
          sessionId = id;
          for (const chunk of pending) if (chunk.id === id) writeChunk(chunk);
          pending = [];
          // The grid may have been fitted while the spawn was in flight.
          void commands.terminalResize(id, term.cols, term.rows);
        } catch (e) {
          term.write(`\r\n\x1b[31m${String(e)}\x1b[0m\r\n`);
          exited = true;
        } finally {
          spawning = false;
        }
      };

      // Opening xterm inside a display:none box measures a zero-width cell
      // and renders garbage until something re-measures, so we wait for the
      // container to have a size before opening and spawning. Keeping the
      // Terminal object itself is cheap and lets `focus()` work early.
      const openIfSized = () => {
        if (opened || disposed) return;
        const { width, height } = container.getBoundingClientRect();
        if (width === 0 || height === 0) return;
        opened = true;
        term.open(container);
        fit.fit();
        void spawn();
      };

      const disposables = [
        term.onData((data) => {
          if (exited) {
            // Any key restarts the shell; the key itself is not forwarded.
            void spawn();
            return;
          }
          if (sessionId !== null) {
            commands.terminalWrite(sessionId, data).catch(() => {
              // The shell died before its exit event could be matched to
              // our id (a crash within the spawn round-trip). Same recovery.
              sessionId = null;
              exited = true;
              term.write(EXIT_NOTICE);
            });
          }
        }),
        // xterm only fires this when the grid actually changed, so the fit
        // addon can run freely and the pty is told just the net result.
        term.onResize(({ cols, rows }) => {
          if (sessionId !== null) void commands.terminalResize(sessionId, cols, rows);
        }),
      ];

      const setup = async () => {
        const offData = await listen<TerminalData>("terminal://data", ({ payload }) => {
          if (sessionId === null) {
            if (spawning && pending.length < 256) pending.push(payload);
            return;
          }
          if (payload.id === sessionId) writeChunk(payload);
        });
        const offExit = await listen<TerminalExit>("terminal://exit", ({ payload }) => {
          if (payload.id !== sessionId) return;
          sessionId = null;
          exited = true;
          term.write(EXIT_NOTICE);
        });
        if (disposed) {
          offData();
          offExit();
          return;
        }
        unlisteners.push(offData, offExit);
        openIfSized();
      };
      void setup();

      const resizeObserver = new ResizeObserver(() => {
        if (!opened) {
          // Listeners must be live before the shell starts, or its first
          // output is lost; `setup` opens once they are.
          if (unlisteners.length > 0) openIfSized();
          return;
        }
        fit.fit();
      });
      resizeObserver.observe(container);

      // Follow the theme: an explicit light/dark switch, a desktop palette
      // being applied or removed (its colours are inline `--palette-*`
      // properties, hence `style`), or the OS flipping while on "system".
      const retheme = () => {
        term.options.theme = buildTheme();
        term.options.fontFamily = readMonoFont();
      };
      const themeObserver = new MutationObserver(retheme);
      themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["data-theme", "data-palette", "style"],
      });
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      mq.addEventListener("change", retheme);

      return () => {
        disposed = true;
        resizeObserver.disconnect();
        themeObserver.disconnect();
        mq.removeEventListener("change", retheme);
        for (const off of unlisteners) off();
        for (const d of disposables) d.dispose();
        if (sessionId !== null) void commands.terminalKill(sessionId);
        term.dispose();
        termRef.current = null;
        fitRef.current = null;
      };
    }, []);

    // The pane was display:none while hidden, so its size (and possibly the
    // window's) changed without us seeing it. Refit once it has been laid out.
    useEffect(() => {
      if (!visible) return;
      const frame = requestAnimationFrame(() => fitRef.current?.fit());
      return () => cancelAnimationFrame(frame);
    }, [visible]);

    return <div ref={containerRef} className={styles.root} />;
  },
);

// ── Helpers ──────────────────────────────────────────────────────────────────

function decodeBase64(data: string): Uint8Array {
  const bin = atob(data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function readMonoFont(): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue("--font-mono").trim();
  return v || "monospace";
}

/** Sensible ANSI colours for when no desktop palette is active. Picked to
 *  read on both the light and dark token backgrounds. */
const ANSI_DEFAULTS = {
  black: "#3b3a37",
  red: "#d1453b",
  green: "#3d8f4a",
  yellow: "#b8860b",
  blue: "#2383e2",
  magenta: "#a24bb3",
  cyan: "#1f9aa5",
  white: "#c9c7c2",
};

/** Build an xterm theme from the app's tokens. Tokens may be `color-mix()`
 *  expressions or `var()` chains, which xterm cannot parse, so each is
 *  resolved to a plain hex colour first. */
function buildTheme(): ITheme {
  const root = getComputedStyle(document.documentElement);
  const token = (name: string) => root.getPropertyValue(name).trim() || undefined;
  const resolve = (name: string, fallback: string) => toHex(token(name)) ?? fallback;
  const palette = (name: string) => toHex(token(`--palette-${name}`));

  const background = resolve("--bg-panel", "#ffffff");
  const foreground = resolve("--text-primary", "#191918");
  const accent = resolve("--accent", ANSI_DEFAULTS.blue);
  const dim = resolve("--text-secondary", ANSI_DEFAULTS.black);

  // Bright variants fall back to the normal colour — that is what most
  // terminal palettes (and Omarchy's) do anyway.
  const ansi = (name: keyof typeof ANSI_DEFAULTS) => palette(name) ?? ANSI_DEFAULTS[name];
  const bright = (name: keyof typeof ANSI_DEFAULTS) => palette(`bright-${name}`) ?? ansi(name);

  return {
    background,
    foreground: palette("foreground") ?? foreground,
    cursor: accent,
    cursorAccent: background,
    selectionBackground: `${accent}55`,
    black: palette("background") ?? dim,
    red: ansi("red"),
    green: ansi("green"),
    yellow: ansi("yellow"),
    blue: ansi("blue"),
    magenta: ansi("magenta"),
    cyan: ansi("cyan"),
    white: palette("light-foreground") ?? ansi("white"),
    brightBlack: palette("muted") ?? palette("dark-foreground") ?? dim,
    brightRed: bright("red"),
    brightGreen: bright("green"),
    brightYellow: bright("yellow"),
    brightBlue: bright("blue"),
    brightMagenta: bright("magenta"),
    brightCyan: bright("cyan"),
    brightWhite: palette("bright-foreground") ?? palette("foreground") ?? foreground,
  };
}

let probeCtx: CanvasRenderingContext2D | null | undefined;

/** Normalise any CSS colour the browser understands (hex, rgb(), color-mix(),
 *  color(srgb …)) to `#rrggbb` by painting a pixel and reading it back. The
 *  canvas shares the CSS colour parser, so anything the stylesheet accepted
 *  is accepted here. Returns undefined for empty or unparseable input. */
function toHex(css: string | undefined): string | undefined {
  if (!css) return undefined;
  if (/^#[0-9a-f]{6}$/i.test(css)) return css.toLowerCase();
  if (probeCtx === undefined) {
    probeCtx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  }
  const ctx = probeCtx;
  if (!ctx) return undefined;
  ctx.canvas.width = 1;
  ctx.canvas.height = 1;
  ctx.fillStyle = "#000000";
  ctx.fillStyle = css;
  // An unparseable colour leaves fillStyle untouched — treat that as "none"
  // unless the caller genuinely asked for black.
  if (ctx.fillStyle === "#000000" && !/^(#000(000)?|black|rgba?\(0,\s*0,\s*0)/i.test(css)) {
    return undefined;
  }
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}
