import { AIS, ORDER, sendTarget } from "./ais.js";
import { rulesPick } from "./rules.js";
import { ding, setSound, tick, unlockAudio } from "./audio.js";
import { randomSurprise } from "./surprises.js";
import { DEFAULT_THEME, THEMES, THEME_KEY, getTheme } from "./themes.js";
import { USAGE_KEY, emptyUsage, layoutBoard, parseUsage } from "./usage.js";
import { SETUP_DONE_KEY, createSetup } from "./setup.js";
import { store } from "./store.js";
import { formatSize, isTextKind, outgoingText, readAttachment, releaseAttachment, routerMeta } from "./attachment.js";

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
  setupDone: SETUP_DONE_KEY, // "true" once setup is done; only Redo setup shows it again
  legacySetup: "switchboard-setup", // what earlier versions stored instead
};

const $ = (id) => document.getElementById(id);
const els = {
  console: $("console"),
  prompt: $("prompt"),
  attachBtn: $("attach-btn"),
  fileInput: $("file-input"),
  attachment: $("attachment"),
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
const spares = []; // empty sockets that fill out the board's last row
let current = null; // last routing result
let busy = false;
let lastSurprise = null;
let usage = emptyUsage();
let themeId = DEFAULT_THEME;
let relayoutTimer;
let setup;
let attachment = null; // see attachment.js
let attachToken = 0; // ignores a slow read if another file was attached meanwhile
let mounted = null; // what the active theme's mount() returned (the 3D world), if anything
let mountToken = 0; // ignores a slow mount if the theme changed meanwhile

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

// Readable text on a colored chip: dark ink on light colors, white on dark ones.
function inkFor(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.19 ? "#15120e" : "#ffffff";
}

const colorOf = (id) => getTheme(themeId).colors?.[id] ?? AIS[id].color;

function paint(el, id) {
  const color = colorOf(id);
  el.style.setProperty("--c", color);
  el.style.setProperty("--c-ink", inkFor(color));
}

function renderBoard() {
  const theme = getTheme(themeId);
  els.board.dataset.skin = theme.id;
  const { items: layout, spare } = layoutBoard(usage, gridColumns());

  for (const { id, rank, count, tier } of layout) {
    const tile = tiles[id];
    paint(tile, id);
    tile.dataset.size = tier;
    tile.dataset.rank = String(rank); // 0 = not used yet
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
  const shown = [...els.board.children].filter((node) => node.classList.contains("tile"));
  const inOrder = layout.every(({ id }, i) => shown[i] === tiles[id]);
  if (!inOrder) els.board.append(...layout.map(({ id }) => tiles[id]));

  // Spare sockets fill the last row, so a little-used AI is never stretched
  // bigger than the ones you use more. The 3D world has no grid.
  const wanted = theme.mount ? 0 : spare;
  while (spares.length < wanted) spares.push(el("div", "tile-spare"));
  for (const node of spares.splice(wanted)) node.remove();
  if (spares.length) els.board.append(...spares);

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
  mounted?.sent?.(ids);
  scheduleRelayout(relayoutDelay);
}

// Tiles are real links (never popup-blocked, work in the installed app),
// so their hrefs track the prompt as you type.
function refreshLinks() {
  const prompt = outgoingText(els.prompt.value, attachment);
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
  link.href = sendTarget(id, outgoingText(els.prompt.value, attachment)).url;
  link.dataset.id = id;
  paint(link, id);
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

const canCopyImages = typeof ClipboardItem !== "undefined" && Boolean(navigator.clipboard?.write);

function copyImage(att) {
  return navigator.clipboard
    .write([new ClipboardItem({ "image/png": att.png })])
    .then(() => true, () => false);
}

// The attached image when it can go on the clipboard, else null.
function copyableImage() {
  return attachment?.png && canCopyImages ? attachment : null;
}

// What to tell people about a file that can't ride along on the link.
function fileFollowUp(where) {
  if (!attachment || attachment.inlineText) return "";
  if (copyableImage()) return " Then tap Copy image to add your picture.";
  return ` Attach ${attachment.name} ${where} too.`;
}

// Runs inside the link's click, so the clipboard write counts as a user gesture.
// The link itself opens the AI; we don't preventDefault.
function onSend(id) {
  const prompt = outgoingText(els.prompt.value, attachment);
  const name = AIS[id].name;
  recordSends([id]);
  const { prefilled } = sendTarget(id, prompt);
  const image = copyableImage();

  // The link carries the prompt, so the clipboard is free for the picture.
  if (image && (prefilled || !prompt)) {
    copyImage(image);
    toast(`Opening ${name}${prompt ? " with your prompt" : ""}. Image copied: paste it in.`);
    return;
  }
  if (!prompt) {
    toast(`Opening ${name}.${fileFollowUp("there")}`);
    return;
  }
  copyText(prompt);
  const opening = prefilled ? `Opening ${name} with your prompt. Also copied, just in case.` : `Copied. Paste it into ${name}.`;
  toast(opening + fileFollowUp("there"));
}

// Opens every line at once. Must stay synchronous: browsers only allow
// window.open inside the click itself, so no typewriter or awaits here.
function sendAll() {
  if (busy) return;
  unlockAudio();
  els.popupHint.hidden = true;

  // An attached file is something to send on its own, so only invent a prompt without one.
  if (!els.prompt.value.trim() && !attachment) {
    lastSurprise = randomSurprise(lastSurprise);
    els.prompt.value = lastSurprise;
    refreshLinks();
  }
  const prompt = outgoingText(els.prompt.value, attachment);
  const image = copyableImage();
  if (prompt) copyText(prompt);
  else if (image) copyImage(image);

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

  const copied = prompt ? " Prompt copied." : image ? " Image copied." : "";
  const followUp = prompt || !image ? fileFollowUp("in each tab") : "";
  if (blocked) {
    els.popupHint.textContent = `Your browser blocked ${blocked} of ${ORDER.length} tabs. Allow pop-ups for this site, then try again.`;
    els.popupHint.hidden = false;
    toast(`Opened ${ORDER.length - blocked} of ${ORDER.length}.${copied}${followUp}`);
  } else {
    toast(`Sent to all ${ORDER.length} lines.${copied}${followUp}`);
  }
}

let toastTimer;
function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove("show"), 2800);
}

/* ---------- attachments ---------- */

const ICONS = {
  file: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h4" /></svg>',
  media: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="m10 9.5 5 2.5-5 2.5z" /></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>',
};

async function attachFile(file) {
  if (!file) return;
  const token = ++attachToken;
  let att;
  try {
    att = await readAttachment(file);
  } catch {
    toast(`Couldn't read ${file.name || "that file"}.`);
    return;
  }
  if (token !== attachToken) {
    releaseAttachment(att);
    return;
  }
  releaseAttachment(attachment);
  attachment = att;
  renderAttachment();
  refreshLinks();
  els.popupHint.hidden = true;
}

function removeAttachment() {
  attachToken += 1;
  releaseAttachment(attachment);
  attachment = null;
  renderAttachment();
  refreshLinks();
  els.prompt.focus();
}

function attachmentNote(att) {
  if (att.inlineText) return "Its text goes along with your prompt.";
  if (isTextKind(att.kind)) return "Too long to send by link. Attach it on the AI's site.";
  if (att.png && canCopyImages) return "When you send, it's copied so you can paste it in.";
  return "Links can't carry files, so attach it on the AI's site after you send.";
}

function renderAttachment() {
  const att = attachment;
  els.attachment.hidden = !att;
  if (!att) {
    els.attachment.replaceChildren();
    return;
  }
  let thumb;
  if (att.preview) {
    thumb = el("img", "att-thumb");
    thumb.src = att.preview;
    thumb.alt = "";
  } else {
    thumb = el("span", "att-icon");
    thumb.innerHTML = att.kind === "audio" || att.kind === "video" ? ICONS.media : ICONS.file;
  }

  const actions = [];
  if (att.png && canCopyImages) {
    const copy = el("button", "btn btn-ghost", "Copy image");
    copy.type = "button";
    copy.addEventListener("click", async () => {
      toast((await copyImage(att)) ? "Image copied. Paste it into the AI." : "Couldn't copy the image here. Attach it on the AI's site.");
    });
    actions.push(copy);
  }
  if (navigator.canShare?.({ files: [att.file] })) {
    // On phones this hands the file (and prompt) straight to the AI's app.
    const share = el("button", "btn btn-ghost", "Share");
    share.type = "button";
    share.addEventListener("click", () => {
      navigator.share({ files: [att.file], text: els.prompt.value.trim() || undefined }).catch((err) => {
        if (err.name !== "AbortError") toast("Sharing isn't available here.");
      });
    });
    actions.push(share);
  }
  const remove = el("button", "icon-btn att-remove");
  remove.type = "button";
  remove.setAttribute("aria-label", `Remove ${att.name}`);
  remove.innerHTML = ICONS.close;
  remove.addEventListener("click", removeAttachment);
  actions.push(remove);

  els.attachment.replaceChildren(
    thumb,
    el("div", "att-text", [
      el("div", "att-name", [el("span", "att-file", att.name), el("span", "att-size", formatSize(att.size))]),
      el("div", "att-note", attachmentNote(att)),
    ]),
    el("div", "att-actions", actions),
  );
}

const draggingFiles = (e) => Array.from(e.dataTransfer?.types ?? []).includes("Files");

function wireAttachments() {
  els.attachBtn.addEventListener("click", () => els.fileInput.click());
  els.fileInput.addEventListener("change", () => {
    attachFile(els.fileInput.files[0]);
    els.fileInput.value = ""; // so picking the same file again still fires
  });

  // Drop a file anywhere on the page (and never let the browser navigate to it).
  let depth = 0;
  window.addEventListener("dragenter", (e) => {
    if (!draggingFiles(e)) return;
    e.preventDefault();
    depth += 1;
    els.console.classList.add("dropping");
  });
  window.addEventListener("dragover", (e) => {
    if (draggingFiles(e)) e.preventDefault();
  });
  window.addEventListener("dragleave", (e) => {
    if (!draggingFiles(e)) return;
    depth = Math.max(0, depth - 1);
    if (!depth) els.console.classList.remove("dropping");
  });
  window.addEventListener("drop", (e) => {
    if (!draggingFiles(e)) return;
    e.preventDefault();
    depth = 0;
    els.console.classList.remove("dropping");
    attachFile(e.dataTransfer.files[0]);
  });

  // Pasting a screenshot attaches it. Pasting text (even with a picture of it,
  // like copies from Word) stays a normal text paste.
  els.prompt.addEventListener("paste", (e) => {
    const file = e.clipboardData?.files?.[0];
    if (!file || e.clipboardData.getData("text/plain")) return;
    e.preventDefault();
    attachFile(file);
  });
}

/* ---------- routing ---------- */

async function fetchRoute(prompt, file) {
  if (!navigator.onLine) return { ...rulesPick(prompt, file), source: "rules", note: "offline" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt, attachment: file }),
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
    return { ...rulesPick(prompt, file), source: "rules", note: "router unreachable" };
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
  if (!prompt && !attachment) {
    els.quip.textContent = "Operator here. I'll need a prompt or a file first.";
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

  const result = await spin(fetchRoute(prompt, routerMeta(attachment)));

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
  if (mounted?.afterLanding) await mounted.afterLanding(result.pick);
  setBusy(false);
  if (mounted?.sendsAfterLanding) sendAfterLanding(result.pick);
}

// The 3D world sends as soon as the pick lands. Browsers only allow opening a
// tab shortly after a tap, so when routing took too long, ask for one more tap.
function sendAfterLanding(id) {
  if (navigator.userActivation?.isActive) {
    tiles[id].click();
  } else {
    toast(`${AIS[id].name} is ready. Tap it to send.`);
  }
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

async function applyTheme(id, { persist = true } = {}) {
  const theme = getTheme(id);
  themeId = theme.id;
  if (persist) store.set(KEYS.theme, themeId);
  for (const input of els.themePicker.querySelectorAll("input")) input.checked = input.value === themeId;
  document.body.dataset.skin = theme.id;

  const token = ++mountToken;
  mounted?.unmount();
  mounted = null;
  renderBoard();
  refreshLinks();
  if (!theme.mount) {
    delete els.board.dataset.loading;
    return;
  }
  els.board.dataset.loading = "";
  try {
    const handle = await theme.mount({
      board: els.board,
      tiles,
      ids: ORDER,
      layout: { shell: document.querySelector(".shell"), readout: $("readout") },
    });
    if (token !== mountToken) handle.unmount();
    else mounted = handle;
  } catch (err) {
    if (token !== mountToken) return;
    console.error("Theme failed to load:", err);
    toast(`The ${theme.name} theme couldn't load here, so you're seeing ${getTheme(DEFAULT_THEME).name}.`);
    applyTheme(DEFAULT_THEME, { persist: false }); // keep their choice for next time
  } finally {
    if (token === mountToken) delete els.board.dataset.loading;
  }
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

function saveUsage(next) {
  usage = next;
  store.set(KEYS.usage, JSON.stringify(usage));
  renderBoard();
  flashAll();
}

function initSetup() {
  setup = createSetup({
    currentUsage: () => usage,
    onChoose(choice) {
      store.set(KEYS.setupDone, "true");
      if (choice !== "fresh") return;
      saveUsage(emptyUsage());
      toast("Fresh start. Every AI is the same size and grows as you use it.");
    },
    onImport(counts) {
      saveUsage({ ...usage, ...counts });
      const top = layoutBoard(usage, gridColumns()).items[0];
      toast(top.count ? `Imported. ${AIS[top.id].name} leads with ${top.count.toLocaleString()}.` : "Imported.");
    },
    onClose() {
      // Closing it without choosing counts as done too, so it never nags.
      store.set(KEYS.setupDone, "true");
    },
  });
}

function setupDone() {
  if (store.get(KEYS.setupDone, null) === "true") return true;
  if (store.get(KEYS.legacySetup, null) === null) return false;
  store.set(KEYS.setupDone, "true"); // set up under an earlier version
  return true;
}

function wireControls() {
  wireAttachments();
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
  if (!setupDone()) setup.open();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch((err) => console.info("No service worker:", err.message));
  }
}

init();
