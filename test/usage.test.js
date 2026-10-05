import { test } from "node:test";
import assert from "node:assert/strict";
import { ORDER } from "../public/js/ais.js";
import {
  TIER_SPAN,
  emptyUsage,
  layoutBoard,
  parseUsage,
  rankAIs,
  seedRegulars,
  seedSurprise,
  tiersFor,
} from "../public/js/usage.js";

const usageOf = (counts) => ({ ...emptyUsage(), ...counts });

// Simulates CSS grid dense packing to prove the layout leaves no holes.
function packedGrid(layout, cols) {
  const rows = [];
  const free = (r, c) => !rows[r]?.[c];
  const fill = (r, c, id) => {
    rows[r] ??= [];
    rows[r][c] = id;
  };
  for (const item of layout) {
    const [tw, h] = TIER_SPAN[item.tier];
    const w = item.colSpan || Math.min(tw, cols);
    let placed = false;
    for (let r = 0; !placed; r += 1) {
      for (let c = 0; c + w <= cols && !placed; c += 1) {
        let fits = true;
        for (let dr = 0; dr < h; dr += 1) for (let dc = 0; dc < w; dc += 1) fits &&= free(r + dr, c + dc);
        if (fits) {
          for (let dr = 0; dr < h; dr += 1) for (let dc = 0; dc < w; dc += 1) fill(r + dr, c + dc, item.id);
          placed = true;
        }
      }
    }
  }
  return rows;
}

test("tiers: rank 1 is 2x2, ranks 2-3 are 2x1, the rest 1x1; unused stays 1x1", () => {
  assert.deepEqual(tiersFor([9, 5, 3, 2, 1, 0, 0, 0]), ["lg", "md", "md", "sm", "sm", "sm", "sm", "sm"]);
  assert.deepEqual(tiersFor([1, 0, 0, 0, 0, 0, 0, 0]), ["lg", "sm", "sm", "sm", "sm", "sm", "sm", "sm"]);
  assert.deepEqual(tiersFor([0, 0, 0, 0, 0, 0, 0, 0]), Array(8).fill("sm"));
});

test("tiers: ties never promote", () => {
  // Send to all on an even board: everyone at 1, nobody gets crowned.
  assert.deepEqual(tiersFor(Array(8).fill(1)), Array(8).fill("sm"));
  // Two tied at the top share the wide tier instead of one getting 2x2.
  assert.deepEqual(tiersFor([2, 2, 1, 0, 0, 0, 0, 0]).slice(0, 4), ["md", "md", "md", "sm"]);
  // A three-way tie for second keeps all three at 1x1.
  assert.deepEqual(tiersFor([3, 1, 1, 1, 0, 0, 0, 0]).slice(0, 4), ["lg", "sm", "sm", "sm"]);
});

test("rankAIs sorts by usage and keeps the default order for ties", () => {
  assert.deepEqual(rankAIs(emptyUsage()), ORDER);
  const ranked = rankAIs(usageOf({ grok: 4, claude: 2, muse: 2 }));
  assert.deepEqual(ranked.slice(0, 3), ["grok", "claude", "muse"]);
});

test("parseUsage survives junk and keeps only known AIs", () => {
  assert.deepEqual(parseUsage("not json"), emptyUsage());
  assert.deepEqual(parseUsage(null), emptyUsage());
  assert.deepEqual(parseUsage('{"claude": 3.7, "lechat": 9, "grok": -2, "muse": "4"}'), usageOf({ claude: 3, muse: 4 }));
});

const scenarios = {
  "fresh board": emptyUsage(),
  "one favorite": usageOf({ gemini: 1 }),
  "two used": usageOf({ claude: 5, grok: 2 }),
  "three used": usageOf({ claude: 5, grok: 2, deepseek: 1 }),
  "everything used": Object.fromEntries(ORDER.map((id, i) => [id, 10 - i])),
  "tied at the top": usageOf({ claude: 2, grok: 2, muse: 1 }),
  "all tied": Object.fromEntries(ORDER.map((id) => [id, 1])),
};

for (const [name, usage] of Object.entries(scenarios)) {
  for (const cols of [4, 2]) {
    test(`layoutBoard leaves no holes: ${name}, ${cols} columns`, () => {
      const layout = layoutBoard(usage, cols);
      assert.equal(layout.length, ORDER.length);
      const grid = packedGrid(layout, cols);
      for (const row of grid) {
        for (let c = 0; c < cols; c += 1) assert.ok(row[c], `hole in ${JSON.stringify(grid)}`);
      }
    });
  }
}

test("layoutBoard puts the most-used AI first as the big tile", () => {
  const layout = layoutBoard(usageOf({ perplexity: 7, claude: 3, muse: 1 }), 4);
  assert.deepEqual(
    layout.slice(0, 4).map(({ id, tier }) => [id, tier]),
    [
      ["perplexity", "lg"],
      ["claude", "md"],
      ["muse", "md"],
      ["chatgpt", "sm"],
    ],
  );
});

test("seedRegulars ranks picks in tap order", () => {
  const usage = seedRegulars(["deepseek", "claude", "grok"]);
  assert.deepEqual(rankAIs(usage).slice(0, 3), ["deepseek", "claude", "grok"]);
  assert.equal(usage.chatgpt, 0);
});

test("seedSurprise gives exactly three AIs a head start", () => {
  let n = 0;
  const fakeRandom = () => ((n = (n * 7 + 3) % 11), n / 11);
  const usage = seedSurprise(fakeRandom);
  assert.deepEqual(
    Object.values(usage)
      .filter(Boolean)
      .sort(),
    [1, 2, 3],
  );
});
