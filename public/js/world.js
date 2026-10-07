// World theme: a tiny isometric diorama in Three.js, loaded only when picked.
// Eight blob creatures run a vintage switchboard from their desks.
//
// This module only draws. It reads the same state the CSS themes style: classes
// on each AI's tile link (lit, picked, hop, flash, hover) and its data-size usage
// tier. Routing, sending and usage stay in app.js. Tapping a creature clicks its
// tile link, so sending works exactly like the other themes.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

const SIZE_SCALE = { sm: 1, md: 1.25, lg: 1.55 };
const FOV = 30;
const HOME_AZ = 0.72; // charming 3/4 angle (radians around the y axis)
const HOME_EL = 0.6; // ~34 degrees above the floor
const HOME_EL_TALL = 0.8; // looks down more when the free area is portrait (phones)
const ORBIT_AZ = 0.6; // how far a drag can swing either way
const EL_MIN = 0.32;
const EL_MAX = 0.98;
const PLATFORM_R = 6.0;
const CREATURE_R = 4.7;
const ARC = 3.8; // stations span this arc on the far side, so every creature faces the camera
const SWOOP_MS = 1100;
const HOP_MS = 750;
const HOME_MS = 900;
const RETURN_AFTER_MS = 2600;
const MIN_WORLD_PX = 300; // phones: the world keeps at least this much height below the cards

const MOODS = {
  day: {
    sky: 0xffffff, ground: 0xcbbfae, hemi: 2.2, sun: 0xffffff, sunI: 1.4,
    floor: 0xf2ede5, rim: 0xe2dacd, ring: 0xe7dfd3, desk: 0xfbfaf7, panel: 0x3a3f4b,
    shadow: 0.26, glow: 1, spot: 0.18,
  },
  dusk: {
    sky: 0xaaa6e6, ground: 0x41365a, hemi: 2.0, sun: 0xffbe90, sunI: 1.2,
    floor: 0x3d3857, rim: 0x2f2b45, ring: 0x4a4470, desk: 0xd9d5e8, panel: 0x24283a,
    shadow: 0.42, glow: 1.6, spot: 0.26,
  },
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a)); // to [-pi, pi]
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const smooth = (a, b, t) => clamp((t - a) / (b - a), 0, 1);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const at = (a, r, y = 0) => new THREE.Vector3(r * Math.sin(a), y, r * Math.cos(a));
const clampAz = (az) => HOME_AZ + clamp(wrap(az - HOME_AZ), -ORBIT_AZ, ORBIT_AZ);

// Soft round blob: used for contact shadows and the spotlight's floor pool.
function radialTexture(inner, outer) {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, inner);
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function mountWorld({ board, tiles, ids, palette, layout }) {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const darkQuery = matchMedia("(prefers-color-scheme: dark)");
  const sidebarQuery = matchMedia("(min-width: 1000px)");

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  const canvas = renderer.domElement;
  canvas.className = "world-canvas";
  canvas.setAttribute("aria-hidden", "true"); // the name-tag links are the accessible controls
  board.prepend(canvas);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.5, 400);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x888888, 2);
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(-5, 12, 7);
  scene.add(hemi, sun);

  const lambert = (color, extra) => new THREE.MeshLambertMaterial({ color, ...extra });
  const basic = (color, extra) => new THREE.MeshBasicMaterial({ color, ...extra });
  const pickables = [];

  /* ---------- the room ---------- */

  const floorMat = lambert(0xffffff);
  const rimMat = lambert(0xffffff);
  const ringMat = lambert(0xffffff);
  const deskMat = lambert(0xffffff);
  const panelMat = lambert(0xffffff);

  // A soft rounded platform: a disc with a torus for its bullnose edge.
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(PLATFORM_R, PLATFORM_R, 0.5, 64), floorMat);
  disc.position.y = -0.25;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(PLATFORM_R, 0.25, 10, 72), rimMat);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = -0.25;
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.55, 1.8, 48), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.004;
  scene.add(disc, rim, ring);

  const n = ids.length;
  const angleOf = ids.map((_, i) => HOME_AZ + Math.PI + ARC / 2 - (i * ARC) / (n - 1));
  // Everyone faces a spot out toward the camera, angled slightly inward, so
  // faces read from the default view while they still work the switchboard.
  const lookAt = at(HOME_AZ, 10);
  const stations = ids.map((_, i) => {
    const pos = at(angleOf[i], CREATURE_R);
    const yaw = Math.atan2(lookAt.x - pos.x, lookAt.z - pos.z);
    const ahead = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const desk = pos.clone().addScaledVector(ahead, 0.95);
    return { pos, yaw, desk, toward: Math.atan2(desk.x, desk.z) };
  });

  /* ---------- the switchboard console ---------- */

  const wood = lambert(0x8a5a3b);
  const woodDark = lambert(0x6e4630);
  const brass = lambert(0xc9a24a);
  const cream = lambert(0xefe3c8);
  const ink = lambert(0x231f1c);
  const hub = new THREE.Group();
  const faceTurn = HOME_AZ - Math.PI / 8; // puts a flat face toward the camera
  const octagon = (rTop, rBottom, h, mat, y) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBottom, h, 8), mat);
    m.position.y = y;
    m.rotation.y = faceTurn;
    hub.add(m);
    return m;
  };
  octagon(1.36, 1.42, 0.18, woodDark, 0.09); // plinth
  octagon(1.2, 1.2, 0.86, wood, 0.61); // cabinet
  octagon(1.28, 1.24, 0.12, brass, 1.1); // brass lip
  octagon(1.12, 1.12, 0.05, cream, 1.18); // lamp deck
  const crown = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), brass);
  crown.position.y = 1.36;
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 0.2, 10), brass);
  stem.position.y = 1.24;
  hub.add(crown, stem);

  // Jack plate on the face toward the camera: a cream panel of dark sockets.
  const apothem = 1.2 * Math.cos(Math.PI / 8);
  const plate = new THREE.Mesh(new RoundedBoxGeometry(0.95, 0.56, 0.04, 2, 0.02), cream);
  plate.position.copy(at(HOME_AZ, apothem + 0.02, 0.62));
  plate.rotation.y = HOME_AZ;
  hub.add(plate);
  const jackGeo = new THREE.CylinderGeometry(0.045, 0.045, 0.03, 10);
  jackGeo.rotateX(Math.PI / 2);
  const jacks = new THREE.InstancedMesh(jackGeo, ink, 8);
  const tmp = new THREE.Object3D();
  for (let k = 0; k < 8; k += 1) {
    const col = (k % 4) - 1.5;
    const row = Math.floor(k / 4) - 0.5;
    tmp.position.set(col * 0.2, row * 0.22, 0.03);
    tmp.position.applyAxisAngle(new THREE.Vector3(0, 1, 0), HOME_AZ).add(plate.position);
    tmp.rotation.set(0, HOME_AZ, 0);
    tmp.updateMatrix();
    jacks.setMatrixAt(k, tmp.matrix);
  }
  hub.add(jacks);
  scene.add(hub);

  // One lamp per line on the deck, pointing toward that creature's desk.
  const bulbGeo = new THREE.SphereGeometry(0.12, 14, 10);
  const bulbs = ids.map((id, i) => {
    const color = palette[id].ui;
    const bulb = new THREE.Mesh(bulbGeo, lambert(color, { emissive: color, emissiveIntensity: 0.12 }));
    bulb.position.copy(at(stations[i].toward, 0.8, 1.27));
    hub.add(bulb);
    return bulb;
  });

  /* ---------- desks and patch cords ---------- */

  const deskGeo = new RoundedBoxGeometry(1.5, 0.5, 0.62, 2, 0.08);
  const panelGeo = new RoundedBoxGeometry(0.84, 0.07, 0.3, 1, 0.03);
  const deskLampGeo = new THREE.SphereGeometry(0.055, 10, 8);
  const desks = new THREE.InstancedMesh(deskGeo, deskMat, n);
  const panels = new THREE.InstancedMesh(panelGeo, panelMat, n);
  const deskLamps = new THREE.InstancedMesh(deskLampGeo, basic(0xffffff), n);
  const yAxis = new THREE.Vector3(0, 1, 0);
  ids.forEach((id, i) => {
    const { desk, yaw, toward } = stations[i];
    tmp.position.copy(desk).setY(0.25);
    tmp.rotation.set(0, yaw, 0);
    tmp.updateMatrix();
    desks.setMatrixAt(i, tmp.matrix);
    // A small control board on the creature's side (local -z), tilted toward it.
    tmp.position.copy(desk).add(new THREE.Vector3(0, 0, -0.1).applyAxisAngle(yAxis, yaw)).setY(0.55);
    tmp.rotation.set(-0.35, yaw, 0, "YXZ");
    tmp.updateMatrix();
    panels.setMatrixAt(i, tmp.matrix);
    tmp.position.copy(desk).add(new THREE.Vector3(0.28, 0, -0.14).applyAxisAngle(yAxis, yaw)).setY(0.6);
    tmp.updateMatrix();
    deskLamps.setMatrixAt(i, tmp.matrix);
    deskLamps.setColorAt(i, new THREE.Color(palette[id].ui));

    // Patch cord from the console to the desk, sagging onto the floor.
    const reach = desk.length();
    const curve = new THREE.CatmullRomCurve3([
      at(toward, 1.22, 0.32),
      at(toward, 1.75, 0.05),
      at(toward, reach - 0.95, 0.05),
      at(toward, reach - 0.32, 0.42),
    ]);
    const cord = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.035, 5), lambert(palette[id].ui));
    scene.add(cord);
  });
  desks.userData.ids = ids;
  panels.userData.ids = ids;
  scene.add(desks, panels, deskLamps);
  pickables.push(desks, panels);

  /* ---------- plants, for charm ---------- */

  const potMat = lambert(0xcdbfae);
  const leafMat = lambert(0x6daa6b, { flatShading: true });
  const plantSpots = [at(HOME_AZ - 0.6, 5.0), at(HOME_AZ + 0.68, 4.8)];
  const leafGeo = new THREE.IcosahedronGeometry(0.28, 0);
  for (const spot of plantSpots) {
    const plant = new THREE.Group();
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.17, 0.34, 10), potMat);
    pot.position.y = 0.17;
    plant.add(pot);
    for (const [x, y, z, s] of [[0, 0.58, 0, 1], [0.14, 0.78, 0.05, 0.75], [-0.12, 0.74, -0.06, 0.7]]) {
      const leaf = new THREE.Mesh(leafGeo, leafMat);
      leaf.position.set(x, y, z);
      leaf.scale.setScalar(s);
      plant.add(leaf);
    }
    plant.position.copy(spot);
    scene.add(plant);
  }

  /* ---------- creatures ---------- */

  const geo = {
    body: new THREE.SphereGeometry(0.5, 22, 16),
    eye: new THREE.SphereGeometry(0.06, 10, 8),
    limb: new THREE.CapsuleGeometry(0.075, 0.16, 3, 8),
    tentacle: new THREE.CapsuleGeometry(0.055, 0.15, 3, 6),
    fin: new THREE.ConeGeometry(0.17, 0.42, 8),
    frill: new THREE.CircleGeometry(0.36, 5, -Math.PI / 3, (2 * Math.PI) / 3),
    streak: new THREE.TorusGeometry(0.515, 0.02, 4, 28, 2.4),
    lantern: new THREE.CylinderGeometry(0.075, 0.075, 0.15, 8),
    cap: new THREE.ConeGeometry(0.1, 0.08, 8),
    glowBulb: new THREE.SphereGeometry(0.075, 12, 10),
    stalk: new THREE.TubeGeometry(
      new THREE.QuadraticBezierCurve3(
        new THREE.Vector3(0, 0.96, 0.05),
        new THREE.Vector3(0, 1.3, 0.12),
        new THREE.Vector3(0, 1.22, 0.38),
      ),
      10, 0.018, 5,
    ),
  };
  const BODY_SHAPE = [1, 1.06, 0.94];

  // Rounded blob + eyes + one signature trait. Parts are merged into one mesh
  // per color, so each creature is 2-4 meshes. Front is local +z.
  function buildCreature(id, pal) {
    const root = new THREE.Group();
    const body = new THREE.Group(); // scales, bobs, hops and glances
    root.add(body);
    const materials = new Map();
    const parts = new Map(); // material -> part geometries in body space
    const paint = (color, glow = false) => {
      const key = `${glow}:${color}`;
      if (!materials.has(key)) {
        // Perplexity's frills are flat fans, so its skin draws both sides.
        const sides = id === "perplexity" ? { side: THREE.DoubleSide } : {};
        materials.set(key, glow ? basic(color) : lambert(color, sides));
      }
      return materials.get(key);
    };
    const add = (geometry, material, [x, y, z], setup) => {
      const part = new THREE.Object3D();
      part.position.set(x, y, z);
      setup?.(part);
      part.updateMatrix();
      if (!parts.has(material)) parts.set(material, []);
      parts.get(material).push(geometry.clone().applyMatrix4(part.matrix));
    };

    const skin = paint(pal.body);
    const shape = id === "muse" ? [1.08, 0.98, 1.02] : BODY_SHAPE; // Muse: plain and extra round
    add(geo.body, skin, [0, 0.5, 0], (m) => m.scale.set(...shape));
    const eyes = id === "grok" ? paint(pal.accent, true) : paint(id === "deepseek" ? 0xeaf2ff : 0x1c1b22);
    add(geo.eye, eyes, [-0.16, 0.62, 0.43]);
    add(geo.eye, eyes, [0.16, 0.62, 0.43]);

    switch (id) {
      case "claude": // stubby arms resting forward
        for (const side of [-1, 1]) {
          add(geo.limb, skin, [side * 0.46, 0.5, 0.16], (m) => m.rotation.set(-0.6, 0, side * 1.0));
        }
        break;
      case "chatgpt": // many small arms waving all around
        for (let k = 0; k < 7; k += 1) {
          const a = (k / 7) * Math.PI * 2 + 0.45;
          add(geo.tentacle, skin, [Math.sin(a) * 0.5, 0.6, Math.cos(a) * 0.47], (m) =>
            m.quaternion.setFromAxisAngle(new THREE.Vector3(Math.cos(a), 0, -Math.sin(a)), 1.25),
          );
        }
        break;
      case "gemini": // twin tail fins flaring out low behind
        for (const side of [-1, 1]) {
          add(geo.fin, paint(pal.accent), [side * 0.34, 0.3, -0.3], (m) => {
            m.rotation.set(-0.5, 0, side * -1.25);
            m.scale.set(1.15, 1.15, 0.3);
          });
        }
        break;
      case "copilot": // holding up a tiny glowing lantern
        add(geo.limb, skin, [0.48, 0.62, 0.12], (m) => m.rotation.set(-0.3, 0, -0.6));
        add(geo.lantern, paint(pal.accent, true), [0.62, 0.88, 0.2], (m) => m.scale.setScalar(1.35));
        add(geo.cap, paint(0x3a2a1e), [0.62, 1.04, 0.2], (m) => m.scale.setScalar(1.35));
        break;
      case "grok": // cyan streaks across a black body
        for (const r of [[0.35, 0.2, 0.7], [-0.45, 1.6, -0.3], [1.25, -0.6, 0.15]]) {
          add(geo.streak, eyes, [0, 0.5, 0], (m) => {
            m.rotation.set(...r);
            m.scale.set(...BODY_SHAPE);
          });
        }
        break;
      case "deepseek": // tiny lantern on its head
        add(geo.stalk, skin, [0, 0, 0]);
        add(geo.glowBulb, paint(pal.accent, true), [0, 1.2, 0.42], (m) => m.scale.setScalar(1.3));
        break;
      case "perplexity": // wing frills
        for (const side of [-1, 1]) {
          add(geo.frill, skin, [side * 0.42, 0.56, -0.06], (m) =>
            m.rotation.set(0, side > 0 ? 0.35 : Math.PI - 0.35, side * 0.25),
          );
        }
        break;
    }

    for (const [material, geometries] of parts) {
      const mesh = new THREE.Mesh(mergeGeometries(geometries), material);
      for (const g of geometries) g.dispose();
      mesh.userData.id = id;
      body.add(mesh);
      pickables.push(mesh);
    }
    return { root, body };
  }

  const creatures = {};
  ids.forEach((id, i) => {
    const a = angleOf[i];
    const { root, body } = buildCreature(id, palette[id]);
    root.position.copy(stations[i].pos);
    root.rotation.y = stations[i].yaw;
    scene.add(root);
    creatures[id] = {
      id, a, root, body, bulb: bulbs[i],
      scale: 1, target: 1, phase: i * 1.37,
      hopAt: null, hopY: 0, glance: null,
      lit: 0, litTarget: 0, picked: false, hopFlag: false, flashFlag: false, hovered: false,
    };
  });

  /* ---------- blob shadows and the spotlight ---------- */

  const shadowTex = radialTexture("rgba(0,0,0,0.55)", "rgba(0,0,0,0)");
  const shadowMat = basic(0xffffff, { map: shadowTex, transparent: true, depthWrite: false });
  const plane = new THREE.PlaneGeometry(1, 1);
  plane.rotateX(-Math.PI / 2);
  const staticShadows = [
    { p: new THREE.Vector3(0, 0, 0), sx: 3.2, sz: 3.2 },
    ...stations.map(({ desk, yaw }) => ({ p: desk, sx: 1.9, sz: 1.1, rot: yaw })),
    ...plantSpots.map((p) => ({ p, sx: 0.8, sz: 0.8 })),
  ];
  const shadows = new THREE.InstancedMesh(plane, shadowMat, staticShadows.length + n);
  shadows.renderOrder = 1;
  staticShadows.forEach(({ p, sx, sz, rot = 0 }, k) => {
    tmp.position.copy(p).setY(0.01);
    tmp.rotation.set(0, rot, 0);
    tmp.scale.set(sx, 1, sz);
    tmp.updateMatrix();
    shadows.setMatrixAt(n + k, tmp.matrix);
  });
  scene.add(shadows);

  const poolTex = radialTexture("rgba(255,246,214,0.9)", "rgba(255,246,214,0)");
  const cone = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 1.05, 3.4, 28, 1, true),
    basic(0xfff3d0, { transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  );
  const pool = new THREE.Mesh(
    new THREE.CircleGeometry(1.1, 32).rotateX(-Math.PI / 2),
    basic(0xffffff, { map: poolTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  cone.visible = pool.visible = false;
  scene.add(cone, pool);
  const spot = { id: null, v: 0, target: 0 };

  /* ---------- light and dark ---------- */

  let mood = MOODS.day;
  function applyMood() {
    const forced = document.documentElement.dataset.theme;
    mood = (forced ? forced === "dark" : darkQuery.matches) ? MOODS.dusk : MOODS.day;
    hemi.color.set(mood.sky);
    hemi.groundColor.set(mood.ground);
    sun.color.set(mood.sun);
    sun.intensity = mood.sunI;
    floorMat.color.set(mood.floor);
    rimMat.color.set(mood.rim);
    ringMat.color.set(mood.ring);
    deskMat.color.set(mood.desk);
    panelMat.color.set(mood.panel);
    shadowMat.opacity = mood.shadow / 0.55;
    invalidate();
  }

  /* ---------- camera ---------- */

  const orbit = { az: HOME_AZ, el: HOME_EL };
  let homeEl = HOME_EL;
  const fit = { cx: 0, cy: 0, w: 1, h: 1, dist: 40 }; // current framing (eases toward goal)
  const fitGoal = { cx: 0, cy: 0, w: 1, h: 1 };
  let W = 1;
  let H = 1;
  let mode = "home";
  let focusId = null;
  let tween = null;
  let landing = null;
  let returnTimer = 0;

  // The world shows in whatever the UI cards leave free: right of the sidebar on
  // wide screens, below the operator readout on phones.
  function freeRect() {
    if (sidebarQuery.matches) {
      const x = Math.max(0, layout.shell.getBoundingClientRect().right + 8);
      return { x, y: 0, w: Math.max(240, W - x), h: H };
    }
    const y = clamp(layout.readout.getBoundingClientRect().bottom + 8, 0, H - minWorld());
    return { x: 0, y, w: W, h: H - y };
  }

  const minWorld = () => Math.min(MIN_WORLD_PX, H * 0.45);

  // Phones: once a pick lands, the readout grows. If it would hide the world,
  // scroll the cards up just enough (the shell has bottom room for this).
  function makeRoom() {
    if (sidebarQuery.matches) return;
    const short = layout.readout.getBoundingClientRect().bottom + 8 - (H - minWorld());
    if (short > 1) window.scrollTo({ top: scrollY + short, behavior: reduced.matches ? "instant" : "smooth" });
  }

  function fitDistance(w, h) {
    const t = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    const needH = 2 * PLATFORM_R * Math.sin(orbit.el) + 2.8 * Math.cos(orbit.el);
    const needW = 2 * PLATFORM_R; // the rim may kiss the edges; the stations never do
    return Math.max((needH * H) / (2 * t * h), (needW * H) / (2 * t * w)) * 1.06;
  }

  function relayout(instant = false) {
    const w = Math.max(1, innerWidth);
    const h = Math.max(1, innerHeight);
    if (w !== W || h !== H) {
      W = w;
      H = h;
      renderer.setSize(W, H, false);
      camera.aspect = W / H;
    }
    const r = freeRect();
    Object.assign(fitGoal, { cx: r.x + r.w / 2, cy: r.y + r.h / 2, w: r.w, h: r.h });
    const el = r.h > r.w * 0.9 ? HOME_EL_TALL : HOME_EL;
    if (el !== homeEl) {
      homeEl = el;
      orbit.el = el;
    }
    if (instant || reduced.matches) Object.assign(fit, fitGoal);
    invalidate();
  }

  // Top of the head: the blob's local top (1.03) times the body's current scale.
  const headOf = (c, out) => out.copy(c.root.position).setY(c.body.position.y + 1.03 * c.body.scale.y);

  function homeView() {
    return { tx: 0, ty: 0.55, tz: 0, dist: fit.dist, az: orbit.az, el: orbit.el };
  }

  const v3 = new THREE.Vector3();
  function focusView(id) {
    const c = creatures[id];
    v3.copy(c.root.position);
    return {
      tx: v3.x, ty: 0.75 * c.target, tz: v3.z,
      dist: clamp(fit.dist * 0.6, 8, 22),
      az: HOME_AZ + clamp(wrap(c.root.rotation.y - HOME_AZ), -0.85, 0.85),
      el: 0.66,
    };
  }

  function currentView(now) {
    const to = mode === "focus" && focusId ? focusView(focusId) : homeView();
    if (!tween) return to;
    const t = ease(clamp((now - tween.start) / tween.dur, 0, 1));
    const f = tween.from;
    return {
      tx: f.tx + (to.tx - f.tx) * t,
      ty: f.ty + (to.ty - f.ty) * t,
      tz: f.tz + (to.tz - f.tz) * t,
      dist: f.dist + (to.dist - f.dist) * t,
      az: f.az + wrap(to.az - f.az) * t,
      el: f.el + (to.el - f.el) * t,
    };
  }

  // Eases the camera to the current mode's view. Resolves when it arrives or
  // when a newer move takes over.
  function goTo(dur) {
    tween?.resolve();
    tween = null;
    invalidate();
    if (reduced.matches || !dur) return Promise.resolve();
    return new Promise((resolve) => {
      const now = performance.now();
      tween = { from: currentView(now), start: now, dur, resolve };
    });
  }

  function goHome() {
    clearTimeout(returnTimer);
    mode = "home";
    focusId = null;
    return goTo(HOME_MS);
  }

  function startSwoop(id) {
    clearTimeout(returnTimer);
    makeRoom();
    mode = "focus";
    focusId = id;
    landing = goTo(SWOOP_MS)
      .then(() => {
        if (focusId !== id) return undefined;
        startHop(id);
        return wait(reduced.matches ? 0 : HOP_MS);
      })
      .then(() => {
        if (focusId === id) returnTimer = setTimeout(() => focusId === id && goHome(), RETURN_AFTER_MS);
      });
    return landing;
  }

  /* ---------- state from the tile links ---------- */

  let pulse = 0;

  function startHop(id, delay = 0) {
    if (reduced.matches) return;
    creatures[id].hopAt = performance.now() + delay;
    invalidate();
  }

  function sync(id) {
    const c = creatures[id];
    const cl = tiles[id].classList;
    c.litTarget = cl.contains("lit") || cl.contains("picked") || cl.contains("flash") ? 1 : 0;
    c.hovered = cl.contains("hover");
    c.target = SIZE_SCALE[tiles[id].dataset.size] ?? 1;

    const picked = cl.contains("picked");
    if (picked !== c.picked) {
      c.picked = picked;
      if (picked) {
        spot.id = id;
        spot.target = 1;
        makeRoom();
        if (!reduced.matches && focusId !== id) startSwoop(id);
      } else {
        if (spot.id === id) spot.target = 0;
        if (focusId === id) goHome();
      }
    }
    const hop = cl.contains("hop");
    if (hop && !c.hopFlag && focusId !== id) startHop(id); // the swoop does its own hop
    c.hopFlag = hop;
    const flash = cl.contains("flash");
    if (flash && !c.flashFlag) {
      startHop(id, Math.random() * 120);
      if (!reduced.matches) pulse = 1;
    }
    c.flashFlag = flash;

    if (reduced.matches) {
      c.scale = c.target;
      c.lit = c.litTarget;
      spot.v = spot.target;
    }
    invalidate();
  }

  const observer = new MutationObserver((records) => {
    for (const id of new Set(records.map((r) => r.target.dataset.id))) if (creatures[id]) sync(id);
  });
  for (const id of ids) observer.observe(tiles[id], { attributes: true, attributeFilter: ["class", "data-size"] });
  const modeObserver = new MutationObserver(applyMood);
  modeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  /* ---------- frame ---------- */

  let dirty = true;
  let raf = 0;
  let last = performance.now();
  let nextGlance = last + 2500;
  const label = new THREE.Vector3();
  const lastLabel = {};
  function invalidate() {
    dirty = true;
  }

  function step(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const still = reduced.matches;
    const k = (rate) => (still ? 1 : 1 - Math.exp(-dt * rate));

    // Framing eases as the UI above it changes size.
    for (const key of ["cx", "cy", "w", "h"]) fit[key] += (fitGoal[key] - fit[key]) * k(8);
    fit.dist = fitDistance(fit.w, fit.h);
    camera.setViewOffset(W, H, W / 2 - fit.cx, H / 2 - fit.cy, W, H);
    camera.updateProjectionMatrix();

    const view = currentView(now);
    if (tween && now - tween.start >= tween.dur) {
      const done = tween.resolve;
      tween = null;
      done();
    }
    const cosEl = Math.cos(view.el);
    camera.position.set(
      view.tx + view.dist * cosEl * Math.sin(view.az),
      view.ty + view.dist * Math.sin(view.el),
      view.tz + view.dist * cosEl * Math.cos(view.az),
    );
    camera.lookAt(view.tx, view.ty, view.tz);

    // Occasionally someone looks up at you.
    if (!still && now > nextGlance) {
      const idle = ids.filter((id) => !creatures[id].glance && creatures[id].hopAt === null && id !== focusId);
      const c = creatures[idle[Math.floor(Math.random() * idle.length)]];
      if (c) {
        const toCam = Math.atan2(camera.position.x - c.root.position.x, camera.position.z - c.root.position.z);
        c.glance = { start: now, dur: 2200, yaw: clamp(wrap(toCam - c.root.rotation.y), -0.9, 0.9) };
      }
      nextGlance = now + 2600 + Math.random() * 3400;
    }

    pulse *= still ? 0 : Math.exp(-dt * 3);
    hemi.intensity = mood.hemi * (1 + 0.6 * pulse);

    ids.forEach((id, i) => {
      const c = creatures[id];
      c.scale += (c.target - c.scale) * k(5);
      const s = c.scale;
      let y = still ? 0 : Math.sin(now * 0.0017 + c.phase) * 0.035 * s;
      let stretch = 1;
      c.hopY = 0;
      if (c.hopAt !== null && now >= c.hopAt) {
        const t = (now - c.hopAt) / HOP_MS;
        if (t >= 1) c.hopAt = null;
        else {
          c.hopY = 4 * 0.55 * s * t * (1 - t);
          stretch = 1 + 0.14 * Math.sin(Math.PI * t);
        }
      }
      y += c.hopY;
      c.body.position.y = y;
      const side = s / Math.sqrt(stretch);
      c.body.scale.set(side, s * stretch, side);
      if (c.glance) {
        const t = (now - c.glance.start) / c.glance.dur;
        c.body.rotation.y = t >= 1 ? 0 : c.glance.yaw * smooth(0, 0.18, t) * (1 - smooth(0.78, 1, t));
        if (t >= 1) c.glance = null;
      } else c.body.rotation.y = 0;

      c.lit += (c.litTarget - c.lit) * k(30);
      c.bulb.material.emissiveIntensity = 0.12 + c.lit * 1.7 * mood.glow;
      c.bulb.scale.setScalar(1 + 0.3 * c.lit);

      const lift = 1 - 0.45 * clamp(c.hopY / (0.55 * s), 0, 1);
      tmp.position.copy(c.root.position).setY(0.012);
      tmp.rotation.set(0, 0, 0);
      tmp.scale.set(1.15 * s * lift, 1, 1.15 * s * lift);
      tmp.updateMatrix();
      shadows.setMatrixAt(i, tmp.matrix);
    });
    shadows.instanceMatrix.needsUpdate = true;

    // Spotlight: a soft cone and a pool of light on the pick.
    spot.v += (spot.target - spot.v) * k(8);
    const lit = spot.v > 0.01 && spot.id;
    cone.visible = pool.visible = Boolean(lit);
    if (lit) {
      const c = creatures[spot.id];
      const s = c.scale;
      cone.position.copy(c.root.position).setY(1.7 * s + 0.4);
      cone.scale.set(s, s, s);
      cone.material.opacity = mood.spot * spot.v;
      pool.position.copy(c.root.position).setY(0.02);
      pool.scale.setScalar(s);
      pool.material.opacity = 0.75 * spot.v;
    }

    renderer.render(scene, camera);

    // Name tags (the tile links) float over each creature's head.
    for (const id of ids) {
      const c = creatures[id];
      headOf(c, label);
      label.y += 0.22;
      label.project(camera);
      const x = ((label.x + 1) / 2) * W;
      const y = ((1 - label.y) / 2) * H;
      const key = `${x.toFixed(1)},${y.toFixed(1)},${label.z < 1}`;
      if (lastLabel[id] === key) continue;
      lastLabel[id] = key;
      const tile = tiles[id];
      tile.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
      tile.style.visibility = label.z < 1 ? "" : "hidden";
    }
  }

  function loop(now) {
    raf = requestAnimationFrame(loop);
    const animating = !reduced.matches || tween;
    if (!animating && !dirty) return;
    dirty = false;
    step(now);
  }

  function start() {
    if (raf || document.hidden) return;
    last = performance.now();
    raf = requestAnimationFrame(loop);
  }
  function stop() {
    cancelAnimationFrame(raf);
    raf = 0;
  }

  /* ---------- input: drag to orbit, tap a creature to send ---------- */

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  function pickAt(clientX, clientY) {
    ndc.set((clientX / W) * 2 - 1, -(clientY / H) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObjects(pickables, false)[0];
    if (!hit) return null;
    return hit.object.userData.id ?? hit.object.userData.ids?.[hit.instanceId] ?? null;
  }

  let press = null;
  let dragged = false;
  let hoverId = null;
  function setHover(id) {
    if (id === hoverId) return;
    if (hoverId) tiles[hoverId].classList.remove("hover");
    hoverId = id;
    if (id) tiles[id].classList.add("hover");
    canvas.style.cursor = id ? "pointer" : "grab";
  }
  function onDown(e) {
    press = { x: e.clientX, y: e.clientY, az: orbit.az, el: orbit.el };
    dragged = false;
  }
  function onMove(e) {
    if (press && e.buttons) {
      const dx = e.clientX - press.x;
      const dy = e.clientY - press.y;
      if (!dragged && Math.hypot(dx, dy) > 6) {
        dragged = true;
        canvas.setPointerCapture?.(e.pointerId);
        if (mode === "focus") goHome();
      }
      if (dragged) {
        orbit.az = clampAz(press.az - dx * 0.006);
        orbit.el = clamp(press.el + dy * 0.004, EL_MIN, EL_MAX);
        invalidate();
      }
    } else if (e.pointerType === "mouse") {
      setHover(pickAt(e.clientX, e.clientY));
    }
  }
  function onUp() {
    press = null;
  }
  // A plain click (not the end of a drag) on a creature or its desk sends,
  // by clicking that AI's tile link: same prefill, clipboard and usage count.
  function onClick(e) {
    if (dragged) return;
    const id = pickAt(e.clientX, e.clientY);
    if (id) tiles[id].click();
  }
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);
  canvas.addEventListener("pointerleave", () => setHover(null));
  canvas.addEventListener("click", onClick);

  /* ---------- lifecycle ---------- */

  const onResize = () => relayout();
  const onVisibility = () => (document.hidden ? stop() : start());
  const onMotion = () => {
    if (reduced.matches) {
      tween?.resolve();
      tween = null;
      for (const id of ids) creatures[id].hopAt = null;
    }
    invalidate();
  };
  const resizeObserver = new ResizeObserver(onResize);
  resizeObserver.observe(layout.shell);
  window.addEventListener("resize", onResize);
  window.addEventListener("scroll", onResize, { passive: true });
  document.addEventListener("visibilitychange", onVisibility);
  darkQuery.addEventListener("change", applyMood);
  sidebarQuery.addEventListener("change", onResize);
  reduced.addEventListener("change", onMotion);

  applyMood();
  relayout(true);
  for (const id of ids) {
    sync(id);
    creatures[id].scale = creatures[id].target;
  }
  step(performance.now()); // draw right away, before the first animation frame
  start();

  return {
    // World routing: after the lamp race lands, swoop to the pick, spotlight it,
    // hop, then let the app send. Reduced motion cuts straight to the send.
    sendsAfterLanding: true,
    afterLanding(id) {
      if (reduced.matches || document.hidden || !creatures[id]) return Promise.resolve();
      if (focusId !== id || !landing) startSwoop(id);
      return Promise.race([landing, wait(SWOOP_MS + HOP_MS + 900)]);
    },
    unmount() {
      stop();
      clearTimeout(returnTimer);
      tween?.resolve();
      observer.disconnect();
      modeObserver.disconnect();
      resizeObserver.disconnect();
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
      darkQuery.removeEventListener("change", applyMood);
      sidebarQuery.removeEventListener("change", onResize);
      reduced.removeEventListener("change", onMotion);
      setHover(null);
      scene.traverse((o) => {
        if (o.isInstancedMesh) o.dispose();
        o.geometry?.dispose();
        for (const m of [].concat(o.material ?? [])) {
          m.map?.dispose();
          m.dispose();
        }
      });
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
      for (const id of ids) {
        tiles[id].style.transform = "";
        tiles[id].style.visibility = "";
      }
    },
  };
}
