// Walking room for the World theme's creatures: a grid over the platform that
// knows how far each spot is from the nearest obstacle (the "clearance"), and
// finds paths a creature of a given radius fits through. Plain math on {x, z}
// floor points, no Three.js, so it's cheap and testable.
//
// Obstacles: { type: "circle", x, z, r } or { type: "box", x, z, hx, hz, yaw }
// (a box rotated like a Three.js object's rotation.y). The walkable area is a
// disc of radius `radius` around the origin.

const SQRT2 = Math.SQRT2;

function obstacleDistance(o, x, z) {
  const dx = x - o.x;
  const dz = z - o.z;
  if (o.type === "circle") return Math.hypot(dx, dz) - o.r;
  const c = Math.cos(o.yaw);
  const s = Math.sin(o.yaw);
  const qx = Math.abs(c * dx - s * dz) - o.hx;
  const qz = Math.abs(s * dx + c * dz) - o.hz;
  return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0);
}

export function createNav({ radius, obstacles, cell = 0.2 }) {
  const n = Math.ceil((2 * radius) / cell) + 1;
  const origin = -((n - 1) * cell) / 2;
  const clear = new Float32Array(n * n);

  const exactClearance = (x, z) => {
    let d = radius - Math.hypot(x, z);
    for (const o of obstacles) d = Math.min(d, obstacleDistance(o, x, z));
    return d;
  };
  for (let iz = 0; iz < n; iz += 1) {
    for (let ix = 0; ix < n; ix += 1) clear[iz * n + ix] = exactClearance(origin + ix * cell, origin + iz * cell);
  }

  const toCell = (v) => Math.min(n - 1, Math.max(0, Math.round((v - origin) / cell)));
  const xOf = (i) => origin + (i % n) * cell;
  const zOf = (i) => origin + Math.floor(i / n) * cell;

  // Bilinear, so motion that leans on it is smooth.
  function clearance(x, z) {
    const fx = Math.min(n - 1.001, Math.max(0, (x - origin) / cell));
    const fz = Math.min(n - 1.001, Math.max(0, (z - origin) / cell));
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    const tx = fx - ix;
    const tz = fz - iz;
    const at = (a, b) => clear[(iz + b) * n + ix + a];
    const top = at(0, 0) * (1 - tx) + at(1, 0) * tx;
    const bottom = at(0, 1) * (1 - tx) + at(1, 1) * tx;
    // Outside the grid, keep falling off with distance so callers push back in.
    return top * (1 - tz) + bottom * tz - Math.max(0, Math.hypot(x, z) - radius - cell);
  }

  // Unit vector toward more room (or zero on a flat spot).
  function gradient(x, z) {
    const e = cell * 0.5;
    const gx = clearance(x + e, z) - clearance(x - e, z);
    const gz = clearance(x, z + e) - clearance(x, z - e);
    const len = Math.hypot(gx, gz);
    return len > 1e-6 ? { x: gx / len, z: gz / len } : { x: 0, z: 0 };
  }

  function clearLine(a, b, r) {
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / (cell * 0.5)));
    for (let k = 1; k <= steps; k += 1) {
      const t = k / steps;
      if (clearance(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t) < r - 0.02) return false;
    }
    return true;
  }

  // The passable cell nearest to a point, searching outward a few rings.
  function nearestOpen(p, r) {
    const cx = toCell(p.x);
    const cz = toCell(p.z);
    for (let ring = 0; ring <= 6; ring += 1) {
      let best = -1;
      let bestD = Infinity;
      for (let dz = -ring; dz <= ring; dz += 1) {
        for (let dx = -ring; dx <= ring; dx += 1) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
          const ix = cx + dx;
          const iz = cz + dz;
          if (ix < 0 || iz < 0 || ix >= n || iz >= n) continue;
          const i = iz * n + ix;
          if (clear[i] < r) continue;
          const d = Math.hypot(xOf(i) - p.x, zOf(i) - p.z);
          if (d < bestD) [best, bestD] = [i, d];
        }
      }
      if (best >= 0) return best;
    }
    return -1;
  }

  // A* over the grid for a creature of radius r, then string-pulled into a
  // few straight legs. Returns waypoints after `from`, ending at `to` (or the
  // nearest spot it fits), or null when there's no way through. Spots with
  // less than `comfort` to spare cost extra, so routes keep off the furniture
  // where there's room instead of hugging it.
  function path(from, to, r, comfort = 0) {
    const start = nearestOpen(from, r);
    const goal = nearestOpen(to, r);
    if (start < 0 || goal < 0) return null;
    const gx = xOf(goal);
    const gz = zOf(goal);
    const h = (i) => {
      const dx = Math.abs(xOf(i) - gx);
      const dz = Math.abs(zOf(i) - gz);
      return Math.max(dx, dz) + (SQRT2 - 1) * Math.min(dx, dz);
    };
    const g = new Float32Array(n * n).fill(Infinity);
    const came = new Int32Array(n * n).fill(-1);
    const closed = new Uint8Array(n * n);
    const heap = [[h(start), start]];
    g[start] = 0;
    const push = (item) => {
      heap.push(item);
      for (let k = heap.length - 1; k > 0; ) {
        const parent = (k - 1) >> 1;
        if (heap[parent][0] <= heap[k][0]) break;
        [heap[parent], heap[k]] = [heap[k], heap[parent]];
        k = parent;
      }
    };
    const pop = () => {
      const top = heap[0];
      const last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        for (let k = 0; ; ) {
          const l = 2 * k + 1;
          const rr = l + 1;
          let m = k;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (rr < heap.length && heap[rr][0] < heap[m][0]) m = rr;
          if (m === k) break;
          [heap[m], heap[k]] = [heap[k], heap[m]];
          k = m;
        }
      }
      return top;
    };

    let found = false;
    while (heap.length) {
      const [, i] = pop();
      if (closed[i]) continue;
      if (i === goal) {
        found = true;
        break;
      }
      closed[i] = 1;
      const ix = i % n;
      const iz = Math.floor(i / n);
      for (let dz = -1; dz <= 1; dz += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (!dx && !dz) continue;
          const jx = ix + dx;
          const jz = iz + dz;
          if (jx < 0 || jz < 0 || jx >= n || jz >= n) continue;
          const j = jz * n + jx;
          if (closed[j] || clear[j] < r) continue;
          // No corner cutting past a blocked neighbor.
          if (dx && dz && (clear[iz * n + jx] < r || clear[jz * n + ix] < r)) continue;
          const squeeze = comfort > 0 ? Math.max(0, r + comfort - clear[j]) / comfort : 0;
          const cost = g[i] + (dx && dz ? SQRT2 : 1) * cell * (1 + 3 * squeeze);
          if (cost < g[j]) {
            g[j] = cost;
            came[j] = i;
            push([cost + h(j), j]);
          }
        }
      }
    }
    if (!found) return null;

    const cells = [];
    for (let i = goal; i >= 0; i = came[i]) cells.push({ x: xOf(i), z: zOf(i) });
    cells.reverse();
    const end = clearance(to.x, to.z) >= r && clearLine(cells[cells.length - 1], to, r) ? { x: to.x, z: to.z } : null;
    const pts = [{ x: from.x, z: from.z }, ...cells.slice(1), ...(end ? [end] : [])];

    const legs = [];
    const margin = r + comfort * 0.5; // shortcuts keep some of that room too
    for (let i = 0; i < pts.length - 1; ) {
      let j = pts.length - 1;
      while (j > i + 1 && !clearLine(pts[i], pts[j], margin)) j -= 1;
      legs.push(pts[j]);
      i = j;
    }
    return legs;
  }

  // Everywhere a creature of radius r can walk to from `seed`, as a test
  // function: open floor in a pocket it can't get out of doesn't count.
  function region(seed, r) {
    const inside = new Uint8Array(n * n);
    const first = nearestOpen(seed, r);
    if (first < 0) return () => false;
    const queue = [first];
    inside[first] = 1;
    while (queue.length) {
      const i = queue.pop();
      const ix = i % n;
      const iz = Math.floor(i / n);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const jx = ix + dx;
        const jz = iz + dz;
        if (jx < 0 || jz < 0 || jx >= n || jz >= n) continue;
        const j = jz * n + jx;
        if (inside[j] || clear[j] < r) continue;
        inside[j] = 1;
        queue.push(j);
      }
    }
    return (x, z) => inside[toCell(z) * n + toCell(x)] === 1;
  }

  // A random open spot (uniform over the platform) where `accept` agrees.
  function randomPoint(r, accept = () => true, random = Math.random, tries = 40) {
    for (let k = 0; k < tries; k += 1) {
      const a = random() * Math.PI * 2;
      const d = Math.sqrt(random()) * radius;
      const p = { x: d * Math.sin(a), z: d * Math.cos(a) };
      if (clearance(p.x, p.z) >= r && accept(p)) return p;
    }
    return null;
  }

  return { clearance, gradient, clearLine, path, region, randomPoint, exactClearance };
}
