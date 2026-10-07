import { test } from "node:test";
import assert from "node:assert/strict";
import { ImportError, aiIdFor, parseImport } from "../public/js/usage-import.js";

// A trimmed-down ChatGPT conversations.json: a tree of nodes per conversation.
const chatgptExport = [
  {
    title: "Recipe ideas",
    mapping: {
      root: { message: null, children: ["sys"] },
      sys: { message: { author: { role: "system" }, content: { content_type: "text", parts: [""] } } },
      ctx: {
        message: {
          author: { role: "user" },
          content: { content_type: "user_editable_context", user_profile: "I like food" },
          metadata: { is_visually_hidden_from_conversation: true },
        },
      },
      u1: { message: { author: { role: "user" }, content: { content_type: "text", parts: ["dinner?"] } } },
      a1: { message: { author: { role: "assistant" }, content: { content_type: "text", parts: ["Pasta."] } } },
      u2: { message: { author: { role: "user" }, content: { content_type: "text", parts: ["vegan?"] } } },
    },
  },
  {
    title: "Trip",
    mapping: {
      u1: { message: { author: { role: "user" }, content: { content_type: "text", parts: ["Lisbon"] } } },
      t1: { message: { author: { role: "tool" }, content: { content_type: "text", parts: ["..."] } } },
    },
  },
];

test("ChatGPT conversations.json: counts the messages you sent, for the AI you picked", () => {
  const result = parseImport(JSON.stringify(chatgptExport), "chatgpt");
  assert.equal(result.kind, "history");
  assert.deepEqual(result.counts, { chatgpt: 3 }); // hidden custom instructions don't count
  assert.equal(result.conversations, 2);
  assert.deepEqual(parseImport(JSON.stringify(chatgptExport), "deepseek").counts, { deepseek: 3 });
});

test("Claude's export and plain message lists count too", () => {
  const claude = [{ name: "x", chat_messages: [{ sender: "human" }, { sender: "assistant" }, { sender: "human" }] }];
  assert.deepEqual(parseImport(JSON.stringify(claude), "claude").counts, { claude: 2 });
  const generic = { conversations: [{ messages: [{ role: "user" }, { role: "assistant" }] }] };
  assert.deepEqual(parseImport(JSON.stringify(generic), "grok").counts, { grok: 1 });
});

test("JSON counts set several AIs at once and skip anything else", () => {
  const result = parseImport('{"claude": 120, "ChatGPT": "80", "Le Chat": 9, "perplexity": 4.6}', "chatgpt");
  assert.equal(result.kind, "counts");
  assert.deepEqual(result.counts, { claude: 120, chatgpt: 80, perplexity: 4 });
  assert.deepEqual(result.skipped, ["Le Chat"]);
});

test("CSV lines of ai,count, with a header, aliases and thousands commas", () => {
  const csv = 'ai,count\nClaude,150\n"chatgpt", 90\nopenai,95\nDeepSeek;12\nbard\t7\nclaude,1,200\nmystery,3\n';
  const result = parseImport(csv, "chatgpt");
  assert.deepEqual(result.counts, { claude: 1200, chatgpt: 95, deepseek: 12, gemini: 7 });
  assert.deepEqual(result.skipped, ["mystery"]);
});

test("names and aliases map to the 8 ids", () => {
  assert.equal(aiIdFor("Microsoft Copilot"), "copilot");
  assert.equal(aiIdFor("x.ai"), "grok");
  assert.equal(aiIdFor("Perplexity AI"), "perplexity");
  assert.equal(aiIdFor("mistral"), null);
});

test("unusable input explains itself", () => {
  const fails = (text, pattern) => assert.throws(() => parseImport(text, "chatgpt"), (e) => e instanceof ImportError && pattern.test(e.message));
  fails("", /empty/);
  fails("PK\u0003\u0004 zipdata", /zip/);
  fails('{"lechat": 9}', /Couldn't find/);
  fails("[1, 2, 3]", /Couldn't find/);
  fails('[{"mapping": {"a": {"message": {"author": {"role": "assistant"}}}}}]', /no messages from you/);
  fails("hello there", /Couldn't read/);
});
