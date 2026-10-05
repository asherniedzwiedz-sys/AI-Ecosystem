import { AIS, ORDER, sendTarget } from "./ais.js";
import { rulesPick } from "./rules.js";
import { ding, setSound, tick, unlockAudio } from "./audio.js";
import { randomSurprise } from "./surprises.js";
import { DEFAULT_THEME, THEMES, THEME_KEY, getTheme } from "./themes.js";
import { USAGE_KEY, emptyUsage, layoutBoard, parseUsage } from "./usage.js";
import { SETUP_KEY, createSetup } from "./setup.js";

const API_URL = "/api/route";
const API_TIMEOUT_MS = 10_000;
const MIN_SPIN_MS = 900; // even an instant answer gets a little roulette
const FAST_STEP_MS = 60;
const SLOWEST_STEP_MS = 320;
const TYPE_MS = 14; // "Surprise me" typewriter speed per character
const RELAYOUT_DELAY_MS = 350; // let a tap finish before tiles resize
const FLASH_MS = 1000; // Send to all lamp flash

const KEYS = {
  calls: "switchboard.calls",
  sound: "switchboard.sound",
  mode: "switchboard.mode", // light / dark
  theme: THEME_KEY,
  usage: USAGE_KEY,
  setup: SETUP_KEY,
};

const $ = (id) => document.getElementById(id);
const els = {
  prompt: $("prompt"),
  routeBtn: $("route-btn"),
  surpriseBtn: $("surprise-btn"),
  sendAllBtn: $("send-all-btn"),
  popupHint: $("popup-hint"),
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
  modeBtn: $("mode-btn"),
  settingsBtn: $("settings-btn"),
  settings: $("settings"),
  themePicker: $("theme-picker"),
  redoSetup: $("redo-setup"),
  resetUsage: $("reset-usage"),
  installBtn: $("install-btn"),
  toast: $("toast"),
};
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const tiles = {};
const renderedHtml = {}; // last renderTile output per AI
let current = null; // last routing result
let busy = false;
let lastSurprise = null;
let usage = emptyUsage();
let themeId = DEFAULT_THEME;
let relayoutTimer;
let setup;

// localStorage can throw (private mode, blocked storage): treat it as optional.
const store = {
  get(key, fallback) {
    try {
      return localStorage.getItem(key) ?? fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
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

// One persistent link per AI; the theme fills its inside, usage sets its size.
function buildBoard() {
  for (const id of ORDER) {
    const tile = el("a", "tile");
    tile.dataset.id = id;
    tile.target = "_blank";
    tile.rel = "noopener";
    tile.style.setProperty("--c", AIS[id].color);
    tile.addEventListener("click", () => onSend(id));
    tiles[id] = tile;
  }
  // A missing mascot image hides itself so the theme's fallback shows.
  els.board.addEventListener(
    "error",
    (e) => {
      if (e.target instanceof HTMLImageElement) e.target.hidden = true;
    },
    true,
  );
  refreshLinks();
}

function gridColumns() {
  return getComputedStyle(els.board).gridTemplateColumns.split(" ").filter(Boolean).length || 4;
}

function renderBoard() {
  const theme = getTheme(themeId);
  els.board.dataset.skin = theme.id;
  const layout = layoutBoard(usage, gridColumns());

  for (const { id, rank, count, tier, colSpan } of layout) {
    const tile = tiles[id];
    tile.dataset.size = tier;
    tile.style.gridColumn = colSpan ? `span ${colSpan}` : "";
    // Only swap the inside when the theme's output changed: rebuilding would
    // recreate the mascot image, which flashes while it decodes again.
    const html = theme.renderTile({ id, ...AIS[id] }, rank, count);
    if (renderedHtml[id] !== html) {
      tile.innerHTML = html;
      renderedHtml[id] = html;
    }
  }

  // DOM order follows rank so tab order matches what you see. Only move
  // nodes when the order changed, since moving restarts their animations.
  const inOrder = layout.every(({ id }, i) => els.board.children[i] === tiles[id]);
  if (!inOrder) els.board.append(...layout.map(({ id }) => tiles[id]));

  if (current) labelBadges(current.pick, current.runnerUp);
}

function scheduleRelayout(delay) {
  clearTimeout(relayoutTimer);
  relayoutTimer = setTimeout(function relayout() {
    if (busy) {
      relayoutTimer = setTimeout(relayout, RELAYOUT_DELAY_MS);
      return;
    }
    renderBoard();
  }, delay);
}

function recordSends(ids, relayoutDelay = RELAYOUT_DELAY_MS) {
  for (const id of ids) usage[id] += 1;
  store.set(KEYS.usage, JSON.stringify(usage));
  scheduleRelayout(relayoutDelay);
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

function labelBadges(pick, runnerUp) {
  tiles[pick].querySelector(".badge").textContent = "Pick";
  tiles[runnerUp].querySelector(".badge").textContent = "Alt";
}

function land(pick, runnerUp) {
  clearPicks();
  tiles[pick].classList.add("picked");
  tiles[runnerUp].classList.add("alt");
  labelBadges(pick, runnerUp);
  els.board.classList.add("has-pick");
}

// Replays a one-shot animation class on a tile (the theme decides what it looks like).
function pulseClass(tile, className, ms) {
  tile.classList.remove(className);
  void tile.offsetWidth; // restart the animation
  tile.classList.add(className);
  setTimeout(() => tile.classList.remove(className), ms);
}

function celebrate(id) {
  pulseClass(tiles[id], "hop", 900);
}

function flashAll() {
  for (const id of ORDER) pulseClass(tiles[id], "flash", FLASH_MS);
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
  recordSends([id]);
  if (!prompt) {
    toast(`Opening ${name}.`);
    return;
  }
  copyText(prompt);
  const { prefilled } = sendTarget(id, prompt);
  toast(prefilled ? `Opening ${name} with your prompt. Also copied, just in case.` : `Copied. Paste it into ${name}.`);
}

// Opens every line at once. Must stay synchronous: browsers only allow
// window.open inside the click itself, so no typewriter or awaits here.
function sendAll() {
  if (busy) return;
  unlockAudio();
  els.popupHint.hidden = true;

  if (!els.prompt.value.trim()) {
    lastSurprise = randomSurprise(lastSurprise);
    els.prompt.value = lastSurprise;
    refreshLinks();
  }
  const prompt = els.prompt.value.trim();
  copyText(prompt);

  let blocked = 0;
  for (const id of ORDER) {
    // No "noopener" feature here: with it, window.open always returns null and
    // we couldn't tell a blocked tab from an opened one. Cut the link by hand.
    const win = window.open(sendTarget(id, prompt).url, "_blank");
    if (win) win.opener = null;
    else blocked += 1;
  }

  recordSends(ORDER, FLASH_MS); // resize after the flash, not in the middle of it
  bumpCounter(ORDER.length);
  flashAll();
  ding();

  if (blocked) {
    els.popupHint.textContent = `Your browser blocked ${blocked} of ${ORDER.length} tabs. Allow pop-ups for this site, then try again.`;
    els.popupHint.hidden = false;
    toast(`Opened ${ORDER.length - blocked} of ${ORDER.length}. Prompt copied.`);
  } else {
    toast(`Sent to all ${ORDER.length} lines. Prompt copied.`);
  }
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
  els.sendAllBtn.disabled = on;
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
  els.popupHint.hidden = true;
  els.whyLine.hidden = true;
  els.actions.hidden = true;
  els.quip.textContent = "Ringing the lines…";

  const result = await spin(fetchRoute(prompt));

  current = result;
  land(result.pick, result.runnerUp);
  celebrate(result.pick);
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

/* ---------- counter, sound, light/dark, install ---------- */

function renderCounter(count) {
  els.counter.textContent = String(count).padStart(4, "0");
}

function bumpCounter(by = 1) {
  const count = Number(store.get(KEYS.calls, "0")) + by;
  store.set(KEYS.calls, String(count));
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

function resolvedMode() {
  const forced = document.documentElement.dataset.theme;
  if (forced) return forced;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function syncThemeColor() {
  const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) meta.content = bg;
}

/* ---------- settings + setup ---------- */

function applyTheme(id) {
  themeId = getTheme(id).id;
  store.set(KEYS.theme, themeId);
  for (const input of els.themePicker.querySelectorAll("input")) input.checked = input.value === themeId;
  renderBoard();
}

function buildThemePicker() {
  for (const theme of Object.values(THEMES)) {
    const input = el("input");
    input.type = "radio";
    input.name = "tile-theme";
    input.value = theme.id;
    input.id = `theme-${theme.id}`;
    input.addEventListener("change", () => applyTheme(theme.id));
    const label = el("label", "", [input, el("span", "", theme.name)]);
    els.themePicker.append(label);
  }
}

function resetUsage() {
  usage = emptyUsage();
  store.set(KEYS.usage, JSON.stringify(usage));
  store.set(KEYS.calls, "0");
  renderCounter(0);
  renderBoard();
}

// Two taps to reset, so a stray tap can't wipe your history.
let resetArmed = null;
function onResetClick() {
  if (!resetArmed) {
    els.resetUsage.textContent = "Tap again to reset";
    els.resetUsage.classList.add("armed");
    resetArmed = setTimeout(disarmReset, 3000);
    return;
  }
  disarmReset();
  resetUsage();
  toast("Usage reset. Every line is back to the same size.");
}
function disarmReset() {
  clearTimeout(resetArmed);
  resetArmed = null;
  els.resetUsage.textContent = "Reset usage";
  els.resetUsage.classList.remove("armed");
}

const SETUP_TOASTS = {
  regulars: "Your regulars are up front. Tiles keep growing as you use them.",
  even: "All lines start even. Tiles grow as you use them.",
  surprise: "The operator shuffled the board. Tiles grow as you use them.",
};

function initSetup() {
  setup = createSetup({
    onApply(choice, seeded) {
      usage = seeded;
      store.set(KEYS.usage, JSON.stringify(usage));
      store.set(KEYS.setup, choice);
      renderBoard();
      flashAll();
      toast(SETUP_TOASTS[choice]);
    },
    onCancel() {
      // Dismissing the first-run setup counts as "start even", so it doesn't nag.
      if (!store.get(KEYS.setup, null)) store.set(KEYS.setup, "even");
    },
  });
}

function wireControls() {
  els.prompt.addEventListener("input", () => {
    refreshLinks();
    els.popupHint.hidden = true;
  });
  els.prompt.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      route();
    }
  });
  els.routeBtn.addEventListener("click", route);
  els.surpriseBtn.addEventListener("click", surprise);
  els.sendAllBtn.addEventListener("click", sendAll);
  for (const link of [els.sendPick, els.sendAlt]) {
    link.addEventListener("click", () => onSend(link.dataset.id));
  }

  els.soundBtn.addEventListener("click", () => {
    const on = els.soundBtn.getAttribute("aria-pressed") !== "true";
    applySound(on);
    store.set(KEYS.sound, on ? "on" : "off");
    if (on) {
      unlockAudio();
      ding();
    }
  });

  els.modeBtn.addEventListener("click", () => {
    const next = resolvedMode() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    store.set(KEYS.mode, next);
    syncThemeColor();
  });

  els.settingsBtn.addEventListener("click", () => els.settings.showModal());
  els.settings.addEventListener("close", disarmReset);
  els.redoSetup.addEventListener("click", () => {
    els.settings.close();
    setup.open();
  });
  els.resetUsage.addEventListener("click", onResetClick);

  // Column count changes at the phone breakpoint, so redo the gap filling.
  matchMedia("(max-width: 760px)").addEventListener("change", renderBoard);

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
  usage = parseUsage(store.get(KEYS.usage, "{}"));
  themeId = getTheme(store.get(KEYS.theme, DEFAULT_THEME)).id;
  buildThemePicker();
  buildBoard();
  applyTheme(themeId);
  wireControls();
  initSetup();
  renderCounter(Number(store.get(KEYS.calls, "0")));
  applySound(store.get(KEYS.sound, "on") === "on");
  if (document.documentElement.dataset.theme) syncThemeColor();
  if (!store.get(KEYS.setup, null)) setup.open();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch((err) => console.info("No service worker:", err.message));
  }
}

init();
