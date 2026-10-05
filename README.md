# AI Switchboard

A hub for the main AI chatbots. Type a prompt, the operator (a Claude-backed router) picks the best AI for it, and one tap sends it there. Installs as an app on iPhone and desktop (PWA).

Lines on the board: Claude, ChatGPT, Muse, Gemini, Copilot, Grok, DeepSeek, Perplexity.

## How it works

- **Routing:** the page POSTs your prompt to `/api/route`, a Vercel function that asks Claude to pick. It answers `{pick, runnerUp, quip, reason}`. The API key lives only on the server.
- **Fallback:** if the router is unreachable (offline, no key, timeout after 10s), the page uses the keyword rules in `public/js/rules.js`. The readout says which one routed the call.
- **Sending:** tiles are links. Claude, ChatGPT, Perplexity, Grok and Copilot open with the prompt prefilled. Gemini, DeepSeek and Muse just open, and you paste (the prompt is always copied to your clipboard).
- **Offline:** a service worker caches the app, so it opens with no signal and routes with the rules.

## Project layout

```
public/            static site (Vercel serves this folder)
  index.html
  styles.css
  js/app.js        UI: board, lamp roulette, sending, toggles
  js/ais.js        the AIs: order, URLs, colors, quips, router notes (shared with the API)
  js/rules.js      offline keyword router (rulesPick)
  js/audio.js      WebAudio ticks + ding
  js/surprises.js  "Surprise me" prompts
  manifest.webmanifest, sw.js, icons/
api/route.js       POST /api/route (GET = health check)
lib/router.js      Claude call, prompt, JSON schema, validation
scripts/dev.js     local server that mimics Vercel
scripts/make-icons.js  re-render PNG icons from icons/icon.svg (needs Playwright)
test/              node:test suites
```

To add or remove an AI, edit `ORDER` and `AIS` in `public/js/ais.js` and add its keywords in `public/js/rules.js`. The router prompt is built from `ais.js`, so it picks up the change automatically.

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
