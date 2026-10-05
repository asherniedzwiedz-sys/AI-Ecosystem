// Usage per AI drives tile size: the more you send to an AI, the bigger its tile.
// Rank 1 gets a 2x2 tile, ranks 2-3 get 2x1, the rest 1x1. Unused AIs stay 1x1,
// and ties never promote: a tile only moves up a tier when it's strictly ahead
// of the first tile below that tier (so "Send to all" on an even board keeps
// it even instead of crowning whoever is first in ORDER).
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

// Tiers for counts sorted most-used first. Never puts a smaller tier before a
// bigger one, which keeps the grid packing hole-free (see layoutBoard).
export function tiersFor(sortedCounts) {
  const at = (i) => sortedCounts[i] ?? 0;
  return sortedCounts.map((count, i) => {
    if (!count) return "sm";
    if (i === 0 && count > at(1)) return "lg";
    if (i <= 2 && count > at(3)) return "md";
    return "sm";
  });
}

// Ranked tiles with their tier, plus an extra column span for the trailing
// 1x1 tiles so the last grid row never has holes. Big tiles come first and the
// grid packs densely, so any leftover cells are always in the last row.
export function layoutBoard(usage, cols) {
  const ranked = rankAIs(usage);
  const tiers = tiersFor(ranked.map((id) => usage[id] ?? 0));
  const items = ranked.map((id, i) => ({ id, rank: i + 1, count: usage[id] ?? 0, tier: tiers[i], colSpan: 0 }));
  const cells = items.reduce((sum, { tier }) => {
    const [w, h] = TIER_SPAN[tier];
    return sum + Math.min(w, cols) * h;
  }, 0);
  const leftover = cells % cols;
  if (leftover) {
    const lastRow = items.slice(-leftover);
    const base = Math.floor(cols / leftover);
    lastRow.forEach((item, i) => {
      item.colSpan = base + (i < cols % leftover ? 1 : 0);
    });
  }
  return items;
}

// Setup: the AIs you tap, in order, get a head start (favorite first).
export function seedRegulars(picked) {
  const usage = emptyUsage();
  picked.forEach((id, i) => {
    if (id in usage) usage[id] = picked.length - i;
  });
  return usage;
}

// Setup: a random top three.
export function seedSurprise(random = Math.random) {
  const shuffled = [...ORDER];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return seedRegulars(shuffled.slice(0, 3));
}
