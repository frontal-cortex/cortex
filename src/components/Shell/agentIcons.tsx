// Marks for the agent CLIs the terminal pane can open into — the products'
// own icons, so the picker reads like an app launcher. Raster ones are the
// vendors' favicons at 64px; Copilot is a monochrome mark in currentColor.
// An agent we have no mark for gets a monogram so the list stays aligned.
//
// Sources (brand marks used to identify the product, not endorsements):
// claude.ai, openai.com, gemini.google.com, opencode.ai, aider.chat,
// github.com/block/goose, ampcode.com, nousresearch.com, openclaw.ai, pi.dev,
// Simple Icons (GitHub Copilot, CC0).

import claude from "../../assets/agents/claude.png";
import codex from "../../assets/agents/codex.png";
import gemini from "../../assets/agents/gemini.png";
import opencode from "../../assets/agents/opencode.png";
import aider from "../../assets/agents/aider.png";
import goose from "../../assets/agents/goose.png";
import amp from "../../assets/agents/amp.png";
import hermes from "../../assets/agents/hermes.png";
import openclaw from "../../assets/agents/openclaw.svg";
import pi from "../../assets/agents/pi.svg";
import copilot from "../../assets/agents/copilot.svg";

const MARKS: Record<string, string> = {
  claude, codex, gemini, opencode, aider, goose, amp, hermes, openclaw, pi,
};

/** The mark for an agent id (see cortex_core::agents::KNOWN), 16px square. */
export function AgentIcon({ id, label, size = 16 }: { id: string; label: string; size?: number }) {
  if (id === "copilot") {
    // Monochrome SVG via <img> would lose currentColor; mask it instead.
    return (
      <span
        role="img"
        aria-label={label}
        style={{
          display: "inline-block", width: size, height: size, backgroundColor: "currentColor",
          WebkitMaskImage: `url(${copilot})`, maskImage: `url(${copilot})`,
          WebkitMaskSize: "contain", maskSize: "contain", WebkitMaskRepeat: "no-repeat", maskRepeat: "no-repeat",
        }}
      />
    );
  }
  const src = MARKS[id];
  if (src) {
    return <img src={src} alt="" width={size} height={size} style={{ borderRadius: 3, display: "block" }} />;
  }
  return (
    <span
      role="img"
      aria-label={label}
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        width: size, height: size, borderRadius: 3,
        background: "var(--bg-active)", color: "var(--text-secondary)",
        fontSize: Math.round(size * 0.6), fontWeight: 600, lineHeight: 1,
      }}
    >
      {label.charAt(0).toUpperCase()}
    </span>
  );
}
