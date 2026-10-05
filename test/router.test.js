import { test } from "node:test";
import assert from "node:assert/strict";
import { ORDER } from "../public/js/ais.js";
import {
  DEFAULT_MODEL,
  MAX_PROMPT_CHARS,
  RouterError,
  SYSTEM_PROMPT,
  buildRequest,
  normalizeResult,
  routePrompt,
} from "../lib/router.js";

function fakeClient(response) {
  const calls = [];
  return {
    calls,
    beta: {
      messages: {
        async create(body, options) {
          calls.push({ body, options });
          return response;
        },
      },
    },
  };
}

function reply(json, extra = {}) {
  return {
    model: DEFAULT_MODEL,
    stop_reason: "end_turn",
    content: [
      { type: "thinking", thinking: "" },
      { type: "text", text: JSON.stringify(json) },
    ],
    ...extra,
  };
}

test("system prompt lists every line on the board", () => {
  for (const id of ORDER) assert.match(SYSTEM_PROMPT, new RegExp(`- ${id} \\(`));
});

test("buildRequest: default model, low effort, fallbacks, schema locked to board ids", () => {
  const req = buildRequest("hi");
  assert.equal(req.model, "claude-opus-5-5");
  assert.equal(req.output_config.effort, "low");
  assert.equal(req.fallbacks, "default");
  assert.deepEqual(req.betas, ["server-side-fallback-2026-07-01"]);
  assert.equal(req.thinking, undefined);
  const { schema } = req.output_config.format;
  assert.deepEqual(schema.properties.pick.enum, ORDER);
  assert.deepEqual(schema.properties.runnerUp.enum, ORDER);
  assert.deepEqual(schema.required, ["pick", "runnerUp", "quip", "reason"]);
  assert.equal(schema.additionalProperties, false);
  assert.match(req.messages[0].content, /^<prompt>\nhi\n<\/prompt>$/);
});

test("buildRequest: haiku skips effort and fallbacks", () => {
  const req = buildRequest("hi", "claude-haiku-4-5");
  assert.equal(req.fallbacks, undefined);
  assert.equal(req.betas, undefined);
  assert.equal(req.output_config.effort, undefined);
  assert.ok(req.output_config.format);
});

test("buildRequest clips very long prompts", () => {
  const req = buildRequest("a".repeat(MAX_PROMPT_CHARS + 500));
  assert.ok(req.messages[0].content.length < MAX_PROMPT_CHARS + 100);
  assert.match(req.messages[0].content, /\[\.\.\.prompt continues\]/);
});

test("normalizeResult repairs a duplicate runner-up and caps text", () => {
  const result = normalizeResult({ pick: "grok", runnerUp: "grok", quip: `  ${"q".repeat(500)} `, reason: "" });
  assert.equal(result.pick, "grok");
  assert.notEqual(result.runnerUp, "grok");
  assert.ok(ORDER.includes(result.runnerUp));
  assert.equal(result.quip.length, 140);
  assert.ok(result.reason.length > 0);
});

test("normalizeResult rejects unknown picks", () => {
  assert.throws(() => normalizeResult({ pick: "lechat", runnerUp: "claude" }), RouterError);
  assert.throws(() => normalizeResult(null), RouterError);
});

test("routePrompt returns the parsed pick", async () => {
  const client = fakeClient(
    reply({ pick: "muse", runnerUp: "perplexity", quip: "Muse on the line.", reason: "It books tables." }),
  );
  const result = await routePrompt("book a table", { client });
  assert.deepEqual(result, {
    pick: "muse",
    runnerUp: "perplexity",
    quip: "Muse on the line.",
    reason: "It books tables.",
    model: DEFAULT_MODEL,
  });
  assert.equal(client.calls[0].options.maxRetries, 1);
  assert.ok(client.calls[0].options.timeout > 0);
});

test("routePrompt surfaces refusals and bad JSON as RouterError", async () => {
  const refused = fakeClient({ stop_reason: "refusal", content: [], model: DEFAULT_MODEL });
  await assert.rejects(routePrompt("x", { client: refused }), RouterError);

  const garbled = fakeClient({ stop_reason: "end_turn", content: [{ type: "text", text: "{nope" }] });
  await assert.rejects(routePrompt("x", { client: garbled }), RouterError);

  const cutOff = fakeClient({ stop_reason: "max_tokens", content: [] });
  await assert.rejects(routePrompt("x", { client: cutOff }), RouterError);
});
