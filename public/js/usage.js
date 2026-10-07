// Usage per AI drives size: the more you send to an AI, the bigger it gets.
// AIs are ranked by count, ties broken by ORDER. Rank 1 gets a 2x2 tile,
// ranks 2-3 get 2x1, the rest 1x1. An AI with no sends never grows, so a
// fresh board (all zeros) renders even.
import { ORDER } from "./ais.js";

export const USAGE_KEY = "switchboard-usage";

// [columns, rows] each tier covers on the grid.
export const TIER_SPAN = { lg: [2, 2], md: [2, 1], sm: [1, 1] };

export function emptyUsage() {
  return Object.fromEntries(ORDER.map((id) => [id, 0]));
}

// Accepts whatever was stored (possibly garbage) and returns a clean count per AI.
export function parseUsage(raw) {
  const usage = emptyUsage();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return usage;
  }
  if (data && typeof data === "object") {
    for (const id of ORDER) {
      const n = Number(data[id]);
      if (Number.isFinite(n) && n > 0) usage[id] = Math.floor(n);
    }
  }
  return usage;
}

// Most-used first; ties keep the default ORDER.
export function rankAIs(usage) {
  return [...ORDER].sort((a, b) => (usage[b] ?? 0) - (usage[a] ?? 0));
}

// Tiers for counts sorted most-used first: by position, but only for AIs
// you've actually used. Sizes never grow down the list, so the grid packs
// with any leftover cells in its last row (see layoutBoard).
export function tiersFor(sortedCounts) {
  return sortedCounts.map((count, i) => {
    if (!count) return "sm";
    if (i === 0) return "lg";
    return i <= 2 ? "md" : "sm";
  });
}

// Ranked tiles with their tier. `rank` is 1-based among used AIs (0 = unused),
// for themes that size things themselves. `spare` is how many empty cells the
// last grid row has: the board shows them as spare sockets rather than
// stretching the least-used tiles to fill the row.
export function layoutBoard(usage, cols) {
  const ranked = rankAIs(usage);
  const tiers = tiersFor(ranked.map((id) => usage[id] ?? 0));
  const items = ranked.map((id, i) => {
    const count = usage[id] ?? 0;
    return { id, rank: count ? i + 1 : 0, count, tier: tiers[i] };
  });
  const cells = items.reduce((sum, { tier }) => {
    const [w, h] = TIER_SPAN[tier];
    return sum + Math.min(w, cols) * h;
  }, 0);
  return { items, spare: (cols - (cells % cols)) % cols };
}
