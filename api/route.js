// POST /api/route  { prompt }  ->  { pick, runnerUp, quip, reason, model, source }
// The Anthropic key lives in the ANTHROPIC_API_KEY env var on the server only.
import Anthropic from "@anthropic-ai/sdk";
import { DEFAULT_MODEL, RouterError, routePrompt } from "../lib/router.js";

const MODEL = process.env.ROUTER_MODEL || DEFAULT_MODEL;
const MAX_BODY_CHARS = 100_000;

// Best-effort per-IP limit. Each warm instance keeps its own window, so this
// stops casual abuse; set a spend limit in the Anthropic Console for the rest.
const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60_000;
const hits = new Map();

function rateLimited(ip) {
  const now = Date.now();
  const entry = hits.get(ip);
  if (!entry || now > entry.reset) {
    if (hits.size > 5000) hits.clear();
    hits.set(ip, { count: 1, reset: now + RATE_WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_LIMIT;
}

function json(body, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

let client;

export async function POST(request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return json({ error: "Router not configured: set ANTHROPIC_API_KEY." }, 503);
  }

  const ip = (request.headers.get("x-forwarded-for") || "local").split(",")[0].trim();
  if (rateLimited(ip)) return json({ error: "Too many calls. Give the operator a minute." }, 429);

  let prompt;
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_CHARS) return json({ error: "Prompt too long." }, 413);
    prompt = JSON.parse(raw).prompt;
  } catch {
    return json({ error: "Send JSON like {\"prompt\": \"...\"}." }, 400);
  }
  if (typeof prompt !== "string" || !prompt.trim()) {
    return json({ error: "Prompt is empty." }, 400);
  }

  client ??= new Anthropic();
  try {
    const result = await routePrompt(prompt.trim(), { client, model: MODEL });
    return json({ ...result, source: "llm" });
  } catch (err) {
    // Log the failure, never the prompt.
    if (err instanceof RouterError) {
      console.error(`router: ${err.message}`);
      return json({ error: err.message }, err.status);
    }
    if (err instanceof Anthropic.RateLimitError) {
      console.error("router: Anthropic rate limit");
      return json({ error: "Router is busy. Try again shortly." }, 429);
    }
    if (err instanceof Anthropic.APIError) {
      console.error(`router: Anthropic API error ${err.status ?? "(no status)"}: ${err.message}`);
      return json({ error: "Router unavailable." }, 502);
    }
    console.error("router: unexpected error", err);
    return json({ error: "Router unavailable." }, 500);
  }
}

// Health check: open /api/route in a browser to confirm the deploy is wired up.
export function GET() {
  return json({ ok: true, configured: Boolean(process.env.ANTHROPIC_API_KEY), model: MODEL });
}
