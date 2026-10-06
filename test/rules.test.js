import { test } from "node:test";
import assert from "node:assert/strict";
import { AIS, ORDER, sendTarget } from "../public/js/ais.js";
import { rulesPick } from "../public/js/rules.js";
import { SURPRISES } from "../public/js/surprises.js";

const cases = [
  ["Book a table for 4 at a ramen place Friday at 7", "muse"],
  ["Negotiate my phone bill down", "muse"],
  ["Write an Excel formula with XLOOKUP across two sheets", "copilot"],
  ["Latest news on the Fed rate decision, with sources", "perplexity"],
  ["Prove that there are infinitely many primes", "deepseek"],
  ["What's trending on Twitter right now?", "grok"],
  ["Summarize this YouTube video for me", "gemini"],
  ["Debug my Python script, it throws a KeyError", "claude"],
  ["Generate an image of a cat in a spacesuit", "chatgpt"],
];

for (const [prompt, expected] of cases) {
  test(`rulesPick: "${prompt}" -> ${expected}`, () => {
    assert.equal(rulesPick(prompt).pick, expected);
  });
}

test("rulesPick falls back to the generalist when nothing matches", () => {
  const result = rulesPick("hello there");
  assert.equal(result.pick, "chatgpt");
  assert.equal(result.runnerUp, "claude");
});

test("rulesPick always returns the API's shape with two different AIs", () => {
  for (const prompt of [...SURPRISES, ...cases.map(([p]) => p), "hello", "∫ x dx"]) {
    const result = rulesPick(prompt);
    assert.deepEqual(Object.keys(result).sort(), ["pick", "quip", "reason", "runnerUp"]);
    assert.ok(AIS[result.pick], `unknown pick for "${prompt}"`);
    assert.ok(AIS[result.runnerUp], `unknown runnerUp for "${prompt}"`);
    assert.notEqual(result.pick, result.runnerUp);
    assert.ok(result.quip && result.reason);
  }
});

test("offline rules send 'Surprise me' calls to every line", () => {
  const picked = new Set(SURPRISES.map((p) => rulesPick(p).pick));
  assert.deepEqual([...picked].sort(), [...ORDER].sort());
});

test("sendTarget prefills where supported and falls back to paste", () => {
  assert.deepEqual(sendTarget("claude", "hi there"), {
    url: "https://claude.ai/new?q=hi%20there",
    prefilled: true,
  });
  assert.deepEqual(sendTarget("gemini", "hi"), { url: AIS.gemini.home, prefilled: false });
  assert.deepEqual(sendTarget("chatgpt", "   "), { url: AIS.chatgpt.home, prefilled: false });
  assert.equal(sendTarget("perplexity", "x".repeat(20_000)).prefilled, false);
});

test("rulesPick: an attached file steers the pick", () => {
  assert.equal(rulesPick("", { kind: "pdf" }).pick, "claude");
  assert.equal(rulesPick("summarize this", { kind: "video" }).pick, "gemini");
  assert.equal(rulesPick("", { kind: "sheet" }).pick, "copilot");
  assert.equal(rulesPick("", { kind: "code" }).pick, "claude");
  const image = rulesPick("what is this?", { kind: "image" });
  assert.deepEqual([image.pick, image.runnerUp], ["chatgpt", "gemini"]);
});

test("rulesPick: strong keywords still beat a file nudge", () => {
  // Muse's booking keywords (3 + 2) outweigh the PDF's pull toward Claude (3).
  assert.equal(rulesPick("book a table and order the wine from this menu", { kind: "pdf" }).pick, "muse");
});

test("rulesPick: reasons mention the file", () => {
  assert.equal(rulesPick("", { kind: "pdf" }).reason, "PDF attached: Claude handles those well.");
  assert.match(rulesPick("debug this", { kind: "code" }).reason, /"debug" plus the code file points to Claude/);
});
