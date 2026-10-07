# AI Switchboard

A hub for the main AI chatbots. Type a prompt, the operator (a Claude-backed router) picks the best AI for it, and one tap sends it there. Installs as an app on iPhone and desktop (PWA).

Lines on the board: Claude, ChatGPT, Muse, Gemini, Copilot, Grok, DeepSeek, Perplexity.

## How it works

- **Routing:** the page POSTs your prompt to `/api/route`, a Vercel function that asks Claude to pick. It answers `{pick, runnerUp, quip, reason}`. The API key lives only on the server.
- **Fallback:** if the router is unreachable (offline, no key, timeout after 10s), the page uses the keyword rules in `public/js/rules.js`. The readout says which one routed the call.
- **Sending:** tiles are links. Claude, ChatGPT, Perplexity, Grok and Copilot open with the prompt prefilled. Gemini, DeepSeek and Muse just open, and you paste (the prompt is always copied to your clipboard).
- **Attach a file:** the Attach file button, drag and drop, or pasting a screenshot. The router (and the offline rules) factor in the kind of file: a PDF leans Claude, a spreadsheet Copilot, a video Gemini. A link can't carry a file to another site, so on send: a text or code file's contents go along with the prompt; an image is copied so you can paste it in; anything else gets a reminder to attach it on the AI's site (on phones, Share sends it straight to the AI's app). Files stay on the device; the router only sees the name, type and size, plus the start of a text file.
- **Send to all:** copies the prompt once and opens all 8 AIs in new tabs (fills in a random prompt if the box is empty). Browsers often block extra tabs; the page says how many were blocked so you can allow pop-ups and retry.
- **Tile sizes:** every send counts toward that AI (stored in `switchboard-usage`). Your most-used AI gets a 2x2 tile, the next two get 2x1, the rest 1x1 (ties don't promote anyone). The first visit offers a head start: pick your regulars, start even, or a random board. Settings has Redo setup and Reset usage.
- **Themes:** tiles render through a theme. **Creatures** (default) shows each AI's mascot in a lamp-colored ring that bobs, and hops when routing lands on it; **Classic** is the original lamp tiles; **World** is a tiny 3D diorama (below). Pick one in Settings (stored in `switchboard-theme`).
- **World theme:** eight blob creatures run a vintage switchboard from their desks (Three.js 0.186.1 from jsDelivr via an import map, loaded only when World is picked, then cached for offline). Tap a creature (or its name tag) to send. Routing races the console lamps, swoops the camera to the pick, spotlights it and hops, then sends; browsers only allow opening a tab a few seconds after a tap, so if routing ran long it asks for one more tap instead. Usage sets each creature's size. Drag to look around (clamped). Light/dark switches between day and dusk; reduced motion makes the scene static and skips the swoop. If WebGL or the CDN isn't available, it falls back to Creatures.
- **Offline:** a service worker caches the app, so it opens with no signal and routes with the rules.

## Project layout

```
public/            static site (Vercel serves this folder)
  index.html
  styles.css
  js/app.js        UI: board, lamp roulette, sending, Send to all, settings
  js/ais.js        the AIs: order, URLs, colors, mascots, quips, router notes (shared with the API)
  js/themes.js     tile themes (THEMES registry: classic, creatures)
  js/usage.js      usage counts -> rank -> tile size tiers
  js/setup.js      first-run setup dialog
  js/attachment.js attached files: kind detection, reading, image prep
  js/world.js      the 3D World theme (Three.js scene; loaded on demand)
  js/rules.js      offline keyword router (rulesPick)
  js/audio.js      WebAudio ticks + ding
  js/surprises.js  "Surprise me" prompts
  mascots/         creature art, one <id>.webp per AI
  manifest.webmanifest, sw.js, icons/
api/route.js       POST /api/route (GET = health check)
lib/router.js      Claude call, prompt, JSON schema, validation
scripts/dev.js     local server that mimics Vercel
scripts/make-icons.js  re-render PNG icons from icons/icon.svg (needs Playwright)
test/              node:test suites
```

To add or remove an AI, edit `ORDER` and `AIS` in `public/js/ais.js` and add its keywords in `public/js/rules.js`. The router prompt is built from `ais.js`, so it picks up the change automatically.

**Mascots:** drop a square image at `public/mascots/<id>.webp` (about 640x640 keeps it light). Until a file exists, that tile shows the AI's initial on its lamp color.

**New theme:** add an entry to `THEMES` in `public/js/themes.js` with `id`, `name` and `renderTile(ai, rank, count)`, then style it under `.board[data-skin="<id>"]`. The contract (badge element, state classes) is in the comment at the top of that file; it shows up in Settings automatically.

## Run locally

Needs Node 22+.

```bash
npm install
cp .env.example .env.local   # paste your ANTHROPIC_API_KEY (optional: without it you get offline rules)
npm run dev                  # http://localhost:3000
npm test
```

## Deploy (Vercel, free tier)

1. On vercel.com: **Add New → Project**, import this repo. Leave the framework preset as **Other**; `vercel.json` already points it at `public/`.
2. **Settings → Environment Variables**: add `ANTHROPIC_API_KEY` (from console.anthropic.com). Optionally set `ROUTER_MODEL` (default `claude-opus-5-5`).
3. Redeploy, then open `https://<your-app>.vercel.app/api/route`. You should see `"configured": true`.
4. In the Anthropic Console, set a monthly spend limit. The endpoint is public; it has a per-IP rate limit (30/min), but the spend limit is the real cap.

The router runs `claude-opus-5-5` at low effort, with server-side fallbacks on. Each call is a short prompt plus a small JSON answer, so expect roughly a cent or less per routed prompt. Setting `ROUTER_MODEL=claude-haiku-4-5` is cheaper and faster.

## Install on iPhone

Open the deployed URL in **Safari → Share → Add to Home Screen**. It launches full-screen with its own icon. On desktop Chrome/Edge, use the install button in the top bar (or the install icon in the address bar).
