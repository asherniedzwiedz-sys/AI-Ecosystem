// Tile themes. A theme only changes how a tile looks; routing, the lamp race,
// sounds, sending, usage and sizing all live in app.js and work with any theme.
//
// Contract for renderTile(ai, rank, count) -> the tile's inner HTML:
// - include exactly one `.badge` element (the app writes "Pick"/"Alt" into it);
// - style state from classes the app puts on the tile: `lit` (lamp race),
//   `picked`, `alt`, `hop` (landing celebration), `flash` (Send to all),
//   plus `data-size` = sm | md | lg for the usage tier;
// - `--c` on the tile is the AI's color (`colors` overrides it per theme).
// Optional: mount(ctx) -> Promise<{ unmount, afterLanding?, sendsAfterLanding? }>
// for themes that draw outside the tiles (the 3D world).
import { ORDER, mascotSrc } from "./ais.js";

export const THEME_KEY = "switchboard-theme";

// The 3D world's exact roster. `ui` is the accent for its labels and buttons
// (Grok's near-black body can't be a button color, so it uses its cyan).
export const WORLD_PALETTE = {
  muse: { body: "#F6EBD2", ui: "#F6EBD2" },
  claude: { body: "#D97757", ui: "#D97757" },
  grok: { body: "#0A0A0F", accent: "#22D3EE", ui: "#22D3EE" },
  chatgpt: { body: "#10A37F", ui: "#10A37F" },
  deepseek: { body: "#0B3D91", accent: "#BFEFFF", ui: "#0B3D91" },
  copilot: { body: "#E03131", accent: "#FFD27A", ui: "#E03131" },
  gemini: { body: "#A11ECA", accent: "#F760B9", ui: "#A11ECA" },
  perplexity: { body: "#F5B301", ui: "#F5B301" },
};
export const DEFAULT_THEME = "creatures";

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (value) => String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);

const lineNo = (id) => `LINE ${String(ORDER.indexOf(id) + 1).padStart(2, "0")}`;

export const THEMES = {
  creatures: {
    id: "creatures",
    name: "Creatures",
    renderTile(ai) {
      // Stagger the idle bob so the board doesn't float in lockstep.
      const delay = -(ORDER.indexOf(ai.id) * 0.7).toFixed(1);
      return `
        <span class="mascot" style="--delay:${delay}s" data-initial="${esc(ai.name[0])}">
          <img src="${esc(mascotSrc(ai.id))}" alt="" decoding="async" draggable="false" />
        </span>
        <span class="creature-name">${esc(ai.name)}</span>
        <span class="creature-tag">${esc(ai.creature)} · ${esc(ai.tagline)}</span>
        ${ai.prefill ? "" : '<span class="fill-chip creature-chip">paste</span>'}
        <span class="badge">Pick</span>`;
    },
  },
  classic: {
    id: "classic",
    name: "Classic",
    renderTile(ai) {
      return `
        <div class="tile-top"><span class="lamp"></span><span class="line-no">${lineNo(ai.id)}</span></div>
        <div class="tile-name">${esc(ai.name)}</div>
        <div class="tile-tag">${esc(ai.tagline)}</div>
        <div class="tile-foot">
          <span class="maker">${esc(ai.maker)}</span>
          <span class="fill-chip${ai.prefill ? " auto" : ""}">${ai.prefill ? "auto-fill" : "paste"}</span>
        </div>
        <span class="badge">Pick</span>`;
    },
  },
  world: {
    id: "world",
    name: "World",
    colors: Object.fromEntries(Object.entries(WORLD_PALETTE).map(([id, p]) => [id, p.ui])),
    // The tiles become name tags floating over each creature.
    renderTile(ai) {
      return `
        <span class="world-dot"></span>
        <span class="world-name">${esc(ai.name)}</span>
        <span class="badge">Pick</span>`;
    },
    // Three.js only loads when this theme is picked.
    async mount(ctx) {
      const { mountWorld } = await import("./world.js");
      return mountWorld({ ...ctx, palette: WORLD_PALETTE });
    },
  },
};

export function getTheme(id) {
  return THEMES[id] ?? THEMES[DEFAULT_THEME];
}
