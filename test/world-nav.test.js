import { test } from "node:test";
import assert from "node:assert/strict";
import { createNav } from "../public/js/world-nav.js";

const pillar = { type: "circle", x: 0, z: 0, r: 1.5 };
const wall = { type: "box", x: 0, z: 2.5, hx: 3, hz: 0.3, yaw: 0 };

test("clearance: distance to the nearest obstacle or the platform edge", () => {
  const nav = createNav({ radius: 6, obstacles: [pillar] });
  assert.ok(Math.abs(nav.exactClearance(3, 0) - 1.5) < 1e-9);
  assert.ok(Math.abs(nav.exactClearance(5.5, 0) - 0.5) < 1e-9); // edge is closer
  assert.ok(nav.exactClearance(0.5, 0) < 0); // inside the pillar
  // A rotated box: a quarter turn swaps its half extents.
  const turned = createNav({ radius: 6, obstacles: [{ ...wall, x: 0, z: 0, yaw: Math.PI / 2 }] });
  assert.ok(Math.abs(turned.exactClearance(1, 0) - 0.7) < 1e-9);
  assert.ok(Math.abs(turned.exactClearance(0, 4) - 1) < 1e-9);
});

test("path: walks around an obstacle and every leg keeps its distance", () => {
  const nav = createNav({ radius: 6, obstacles: [pillar] });
  const from = { x: -4, z: 0 };
  const to = { x: 4, z: 0.2 };
  const r = 0.5;
  const legs = nav.path(from, to, r);
  assert.ok(legs && legs.length >= 2, "goes around, not through");
  assert.deepEqual(legs.at(-1), to);
  let prev = from;
  for (const p of legs) {
    assert.ok(nav.clearLine(prev, p, r), `leg ${JSON.stringify(prev)} -> ${JSON.stringify(p)} clips the pillar`);
    prev = p;
  }
});

test("path: a creature too big for the gap gets no path", () => {
  // Two walls leave a 1-unit gap at the middle of a corridor.
  const obstacles = [
    { type: "box", x: -3.5, z: 0, hx: 3, hz: 0.3, yaw: 0 },
    { type: "box", x: 3.5, z: 0, hx: 3, hz: 0.3, yaw: 0 },
  ];
  const nav = createNav({ radius: 6.5, obstacles });
  // The walls reach past the platform edge, so the gap is the only way across.
  assert.ok(nav.path({ x: 0, z: -3 }, { x: 0, z: 3 }, 0.4));
  assert.equal(nav.path({ x: 0, z: -3 }, { x: 0, z: 3 }, 0.6), null);
});

test("randomPoint lands in open floor that accept() likes", () => {
  const nav = createNav({ radius: 6, obstacles: [pillar] });
  let seed = 1;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < 20; k += 1) {
    const p = nav.randomPoint(0.5, (q) => q.x > 0, random);
    assert.ok(p && p.x > 0 && nav.clearance(p.x, p.z) >= 0.5);
  }
});

test("region: a pocket you can't walk out of isn't part of it", () => {
  // A wall across the platform with no gap: the far side is cut off.
  const nav = createNav({ radius: 6, obstacles: [{ type: "box", x: 0, z: 0, hx: 7, hz: 0.3, yaw: 0 }] });
  const near = nav.region({ x: 0, z: -3 }, 0.5);
  assert.equal(near(1, -3), true);
  assert.equal(near(1, 3), false);
});
