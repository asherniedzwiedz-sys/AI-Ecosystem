import { test } from "node:test";
import assert from "node:assert/strict";
import { GET, POST } from "../api/route.js";

function post(body, ip = "203.0.113.1") {
  return new Request("http://localhost/api/route", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

test("POST without an API key answers 503 so the page uses offline rules", async () => {
  delete process.env.ANTHROPIC_API_KEY;
  const res = await POST(post({ prompt: "hi" }));
  assert.equal(res.status, 503);
});

test("POST validates the body", async () => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  try {
    assert.equal((await POST(post("not json", "203.0.113.2"))).status, 400);
    assert.equal((await POST(post({ prompt: "   " }, "203.0.113.2"))).status, 400);
    assert.equal((await POST(post({ prompt: 42 }, "203.0.113.2"))).status, 400);
    assert.equal((await POST(post({ prompt: "x".repeat(200_000) }, "203.0.113.2"))).status, 413);
  } finally {
    delete process.env.ANTHROPIC_API_KEY;
  }
});

test("POST rate-limits a single IP", async () => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  try {
    const statuses = [];
    for (let i = 0; i < 31; i += 1) statuses.push((await POST(post({ prompt: "" }, "198.51.100.7"))).status);
    assert.equal(statuses.at(-1), 429);
    assert.ok(statuses.slice(0, 30).every((s) => s === 400));
  } finally {
    delete process.env.ANTHROPIC_API_KEY;
  }
});

test("GET is a health check that never leaks the key", async () => {
  process.env.ANTHROPIC_API_KEY = "sk-secret";
  try {
    const res = GET();
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.configured, true);
    assert.doesNotMatch(JSON.stringify(body), /sk-secret/);
  } finally {
    delete process.env.ANTHROPIC_API_KEY;
  }
});
