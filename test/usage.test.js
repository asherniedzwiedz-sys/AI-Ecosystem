import { test } from "node:test";
import assert from "node:assert/strict";
import { ORDER } from "../public/js/ais.js";
import {
  TIER_SPAN,
  emptyUsage,
  layoutBoard,
  parseUsage,
  rankAIs,
  tiersFor,
} from "../public/js/usage.js";

const usageOf = (counts) => ({ ...emptyUsage(), ...counts });

// Simulates CSS grid dense packing (tiles, then the spare sockets) to prove
// the board leaves no holes.
function packedGrid({ items, spare }, cols) {
  const layout = [...items, ...Array.from({ length: spare }, (_, i) => ({ id: `spare${i}`, tier: "sm" }))];
  const rows = [];
  const free = (r, c) => !rows[r]?.[c];
  const fill = (r, c, id) => {
    rows[r] ??= [];
    rows[r][c] = id;
  };
  for (const item of layout) {
    const [tw, h] = TIER_SPAN[item.tier];
    const w = Math.min(tw, cols);
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

test("tiers: ties go by position (ORDER), but unused AIs never grow", () => {
  assert.deepEqual(tiersFor(Array(8).fill(1)), ["lg", "md", "md", "sm", "sm", "sm", "sm", "sm"]);
  assert.deepEqual(tiersFor([2, 2, 0, 0, 0, 0, 0, 0]).slice(0, 3), ["lg", "md", "sm"]);
});

test("layoutBoard: Send to all on a fresh board crowns the first AI in ORDER", () => {
  const { items } = layoutBoard(Object.fromEntries(ORDER.map((id) => [id, 1])), 4);
  assert.deepEqual(
    items.slice(0, 4).map(({ id, tier, rank }) => [id, tier, rank]),
    [
      [ORDER[0], "lg", 1],
      [ORDER[1], "md", 2],
      [ORDER[2], "md", 3],
      [ORDER[3], "sm", 4],
    ],
  );
});

test("layoutBoard: all zeros render even, with no ranks", () => {
  const { items, spare } = layoutBoard(emptyUsage(), 4);
  assert.ok(items.every(({ tier, rank }) => tier === "sm" && rank === 0));
  assert.equal(spare, 0);
});

test("layoutBoard: the least-used AI is never bigger than a more-used one", () => {
  const { items, spare } = layoutBoard(usageOf({ deepseek: 9, grok: 5, muse: 3, claude: 1 }), 4);
  assert.equal(spare, 3); // 4 + 2 + 2 + 5 cells: the last row has 3 spare sockets
  assert.ok(items.every((item) => !("colSpan" in item)));
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
      assert.equal(layout.items.length, ORDER.length);
      const grid = packedGrid(layout, cols);
      for (const row of grid) {
        for (let c = 0; c < cols; c += 1) assert.ok(row[c], `hole in ${JSON.stringify(grid)}`);
      }
    });
  }
}

test("layoutBoard puts the most-used AI first as the big tile", () => {
  const { items } = layoutBoard(usageOf({ perplexity: 7, claude: 3, muse: 1 }), 4);
  assert.deepEqual(
    items.slice(0, 4).map(({ id, tier }) => [id, tier]),
    [
      ["perplexity", "lg"],
      ["claude", "md"],
      ["muse", "md"],
      ["chatgpt", "sm"],
    ],
  );
});
