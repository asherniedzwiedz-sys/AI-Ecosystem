import { AIS, ORDER, sendTarget } from "./ais.js";
import { rulesPick } from "./rules.js";
import { ding, setSound, tick, unlockAudio } from "./audio.js";
import { randomSurprise } from "./surprises.js";

const API_URL = "/api/route";
const API_TIMEOUT_MS = 10_000;
const MIN_SPIN_MS = 900; // even an instant answer gets a little roulette
const FAST_STEP_MS = 60;
const SLOWEST_STEP_MS = 320;
const TYPE_MS = 14; // "Surprise me" typewriter speed per character

const $ = (id) => document.getElementById(id);
const els = {
  prompt: $("prompt"),
  routeBtn: $("route-btn"),
  surpriseBtn: $("surprise-btn"),
  board: $("board"),
  quip: $("quip"),
  whyLine: $("why-line"),
  reason: $("reason"),
  actions: $("readout-actions"),
  sendPick: $("send-pick"),
  sendAlt: $("send-alt"),
  source: $("source"),
  counter: $("counter"),
  soundBtn: $("sound-btn"),
  themeBtn: $("theme-btn"),
  installBtn: $("install-btn"),
  toast: $("toast"),
};
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const tiles = {};
let current = null; // last routing result
let busy = false;
let lastSurprise = null;

// localStorage can throw (private mode, blocked storage): treat it as optional.
const store = {
  get(key, fallback) {
    try {
      return localStorage.getItem(`switchboard.${key}`) ?? fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(`switchboard.${key}`, value);
    } catch {}
  },
};

function el(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (typeof content === "string") node.textContent = content;
  else if (content) node.append(...content);
  return node;
}

/* ---------- board ---------- */

function buildBoard() {
  ORDER.forEach((id, i) => {
    const ai = AIS[id];
    const tile = el("a", "tile", [
      el("div", "tile-top", [el("span", "lamp"), el("span", "line-no", `LINE ${String(i + 1).padStart(2, "0")}`)]),
      el("div", "tile-name", ai.name),
      el("div", "tile-tag", ai.tagline),
      el("div", "tile-foot", [
        el("span", "maker", ai.maker),
        el("span", ai.prefill ? "fill-chip auto" : "fill-chip", ai.prefill ? "auto-fill" : "paste"),
      ]),
      el("span", "badge", "Pick"),
    ]);
    tile.dataset.id = id;
    tile.target = "_blank";
    tile.rel = "noopener";
    tile.style.setProperty("--c", ai.color);
    tile.addEventListener("click", () => onSend(id));
    els.board.append(tile);
    tiles[id] = tile;
  });
  refreshLinks();
}

// Tiles are real links (never popup-blocked, work in the installed app),
// so their hrefs track the prompt as you type.
function refreshLinks() {
  const prompt = els.prompt.value;
  for (const id of ORDER) {
    const { url, prefilled } = sendTarget(id, prompt);
    tiles[id].href = url;
    tiles[id].setAttribute("aria-label", `Send to ${AIS[id].name}${prefilled ? "" : " (you'll paste the prompt)"}`);
  }
  if (current) {
    setSendLink(els.sendPick, current.pick, `Send to ${AIS[current.pick].name}`);
    setSendLink(els.sendAlt, current.runnerUp, `Runner-up: ${AIS[current.runnerUp].name}`);
  }
}

function setSendLink(link, id, label) {
  link.href = sendTarget(id, els.prompt.value).url;
  link.dataset.id = id;
  link.style.setProperty("--c", AIS[id].color);
  link.replaceChildren(el("span", "dot"), el("span", "", label), el("span", "", "↗"));
}

function light(id) {
  for (const key of ORDER) tiles[key].classList.toggle("lit", key === id);
}

function clearPicks() {
  els.board.classList.remove("has-pick");
  for (const id of ORDER) tiles[id].classList.remove("lit", "picked", "alt");
}

function land(pick, runnerUp) {
  clearPicks();
  tiles[pick].classList.add("picked");
  tiles[pick].querySelector(".badge").textContent = "Pick";
  tiles[runnerUp].classList.add("alt");
  tiles[runnerUp].querySelector(".badge").textContent = "Alt";
  els.board.classList.add("has-pick");
}

/* ---------- sending ---------- */

function copyText(text) {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).catch(() => legacyCopy(text));
  } else {
    legacyCopy(text);
  }
}

function legacyCopy(text) {
  const area = el("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.cssText = "position:fixed;opacity:0;pointer-events:none";
  document.body.append(area);
  area.select();
  try {
    document.execCommand("copy");
  } catch {}
  area.remove();
}

// Runs inside the link's click, so the clipboard write counts as a user gesture.
// The link itself opens the AI; we don't preventDefault.
function onSend(id) {
  const prompt = els.prompt.value.trim();
  const name = AIS[id].name;
  if (!prompt) {
    toast(`Opening ${name}.`);
    return;
  }
  copyText(prompt);
  const { prefilled } = sendTarget(id, prompt);
  toast(prefilled ? `Opening ${name} with your prompt. Also copied, just in case.` : `Copied. Paste it into ${name}.`);
}

let toastTimer;
function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove("show"), 2800);
}

/* ---------- routing ---------- */

async function fetchRoute(prompt) {
  if (!navigator.onLine) return { ...rulesPick(prompt), source: "rules", note: "offline" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`router answered ${res.status}`);
    const data = await res.json();
    if (!AIS[data.pick] || !AIS[data.runnerUp] || data.pick === data.runnerUp) {
      throw new Error("router sent an unusable pick");
    }
    return { ...data, source: "llm" };
  } catch (err) {
    console.info(`Using offline rules: ${err.message}`);
    return { ...rulesPick(prompt), source: "rules", note: "router unreachable" };
  } finally {
    clearTimeout(timer);
  }
}

// Lamps race around the board in a clockwise ring, whatever the grid shape.
function ringOrder() {
  const centers = ORDER.map((id) => {
    const r = tiles[id].getBoundingClientRect();
    return { id, x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  const cx = centers.reduce((sum, c) => sum + c.x, 0) / centers.length;
  const cy = centers.reduce((sum, c) => sum + c.y, 0) / centers.length;
  return centers
    .map((c) => ({ id: c.id, angle: Math.atan2(c.y - cy, c.x - cx) }))
    .sort((a, b) => a.angle - b.angle)
    .map((c) => c.id);
}

// Spin fast until the router answers, then decelerate like a roulette wheel
// and land on the pick. Resolves with the result once it has landed.
function spin(resultPromise) {
  if (reducedMotion.matches) {
    return resultPromise.then((result) => {
      ding();
      return result;
    });
  }

  return new Promise((resolve) => {
    const ring = ringOrder();
    let pos = Math.floor(Math.random() * ring.length);
    let result = null;
    const started = performance.now();
    resultPromise.then((r) => (result = r));

    const advance = () => {
      pos = (pos + 1) % ring.length;
      light(ring[pos]);
    };

    const slowDown = () => {
      const target = ring.indexOf(result.pick);
      const steps = ((target - pos + ring.length) % ring.length) + ring.length; // one more lap
      let k = 0;
      const step = () => {
        k += 1;
        advance();
        if (k >= steps) {
          ding();
          resolve(result);
          return;
        }
        const t = k / steps;
        tick(t);
        setTimeout(step, FAST_STEP_MS + (SLOWEST_STEP_MS - FAST_STEP_MS) * t ** 2.6);
      };
      step();
    };

    const fast = () => {
      if (result && performance.now() - started >= MIN_SPIN_MS) {
        slowDown();
        return;
      }
      advance();
      tick(0);
      setTimeout(fast, FAST_STEP_MS);
    };

    light(ring[pos]);
    setTimeout(fast, FAST_STEP_MS);
  });
}

function setBusy(on) {
  busy = on;
  document.body.classList.toggle("routing", on);
  els.routeBtn.disabled = on;
  els.surpriseBtn.disabled = on;
  els.routeBtn.firstElementChild.textContent = on ? "Routing…" : "Route call";
}

async function route() {
  const prompt = els.prompt.value.trim();
  if (busy) return;
  if (!prompt) {
    els.quip.textContent = "Operator here. I'll need a prompt first.";
    els.prompt.focus();
    return;
  }

  unlockAudio();
  // On phones, drop the keyboard so the board (and the lamp race) is in view.
  if (matchMedia("(pointer: coarse)").matches) els.prompt.blur();
  setBusy(true);
  current = null;
  clearPicks();
  els.whyLine.hidden = true;
  els.actions.hidden = true;
  els.quip.textContent = "Ringing the lines…";

  const result = await spin(fetchRoute(prompt));

  current = result;
  land(result.pick, result.runnerUp);
  els.quip.textContent = result.quip;
  els.reason.textContent = result.reason;
  els.whyLine.hidden = false;
  els.source.textContent =
    result.source === "llm" ? `routed by ${result.model || "Claude"}` : `offline rules · ${result.note}`;
  refreshLinks();
  els.actions.hidden = false;
  bumpCounter();
  setBusy(false);
}

async function surprise() {
  if (busy) return;
  unlockAudio();
  const text = randomSurprise(lastSurprise);
  lastSurprise = text;
  if (reducedMotion.matches) {
    els.prompt.value = text;
  } else {
    setBusy(true);
    els.prompt.value = "";
    for (let i = 1; i <= text.length; i += 1) {
      els.prompt.value = text.slice(0, i);
      if (i % 3 === 0) tick(0.6);
      await new Promise((r) => setTimeout(r, TYPE_MS));
    }
    setBusy(false);
  }
  refreshLinks();
  route();
}

/* ---------- counter, sound, theme, install ---------- */

function renderCounter(count) {
  els.counter.textContent = String(count).padStart(4, "0");
}

function bumpCounter() {
  const count = Number(store.get("calls", "0")) + 1;
  store.set("calls", String(count));
  renderCounter(count);
  els.counter.classList.remove("bump");
  void els.counter.offsetWidth; // restart the animation
  els.counter.classList.add("bump");
}

function applySound(on) {
  setSound(on);
  els.soundBtn.setAttribute("aria-pressed", String(on));
  els.soundBtn.setAttribute("aria-label", on ? "Sound on" : "Sound off");
}

function resolvedTheme() {
  const forced = document.documentElement.dataset.theme;
  if (forced) return forced;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function syncThemeColor() {
  const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) meta.content = bg;
}

function wireControls() {
  els.prompt.addEventListener("input", refreshLinks);
  els.prompt.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      route();
    }
  });
  els.routeBtn.addEventListener("click", route);
  els.surpriseBtn.addEventListener("click", surprise);
  for (const link of [els.sendPick, els.sendAlt]) {
    link.addEventListener("click", () => onSend(link.dataset.id));
  }

  els.soundBtn.addEventListener("click", () => {
    const on = els.soundBtn.getAttribute("aria-pressed") !== "true";
    applySound(on);
    store.set("sound", on ? "on" : "off");
    if (on) {
      unlockAudio();
      ding();
    }
  });

  els.themeBtn.addEventListener("click", () => {
    const next = resolvedTheme() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    store.set("theme", next);
    syncThemeColor();
  });

  let installPrompt = null;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    installPrompt = e;
    els.installBtn.hidden = false;
  });
  els.installBtn.addEventListener("click", async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    els.installBtn.hidden = true;
  });
}

function init() {
  buildBoard();
  wireControls();
  renderCounter(Number(store.get("calls", "0")));
  applySound(store.get("sound", "on") === "on");
  if (document.documentElement.dataset.theme) syncThemeColor();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch((err) => console.info("No service worker:", err.message));
  }
}

init();
