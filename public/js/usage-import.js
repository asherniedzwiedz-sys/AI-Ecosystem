// "Upload my data": turns a chat export or a list of counts into usage counts.
//
// Two kinds of input:
// - A chat history export for ONE AI (picked from the dropdown): the messages
//   you sent are that AI's count. ChatGPT's conversations.json is the main
//   one; Claude's export and plain {role: "user"} message lists work too.
// - Counts for any AIs at once: JSON like {"claude": 120, "chatgpt": 80}, or
//   CSV lines of `ai,count`. Keys that aren't one of the 8 AIs are skipped.
// Nothing here touches storage; the setup dialog shows the result first.
import { AIS, ORDER } from "./ais.js";

const squash = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");

// Other names people use for the same AIs.
const ALIASES = {
  anthropic: "claude",
  claudeai: "claude",
  openai: "chatgpt",
  gpt: "chatgpt",
  chatgptcom: "chatgpt",
  metaai: "muse",
  bard: "gemini",
  googlegemini: "gemini",
  microsoftcopilot: "copilot",
  bingchat: "copilot",
  xai: "grok",
  perplexityai: "perplexity",
  pplx: "perplexity",
};

const NAMES = new Map([
  ...ORDER.flatMap((id) => [
    [squash(id), id],
    [squash(AIS[id].name), id],
  ]),
  ...Object.entries(ALIASES),
]);

export function aiIdFor(key) {
  return NAMES.get(squash(key)) ?? null;
}

export class ImportError extends Error {}

// ChatGPT stores custom instructions as hidden "user" messages; they aren't
// messages you sent, so they don't count.
function isHiddenContext(message) {
  return (
    message.metadata?.is_visually_hidden_from_conversation === true ||
    message.content?.content_type === "user_editable_context"
  );
}

const fromUser = (m) =>
  m && typeof m === "object" && (m.author?.role === "user" || m.role === "user" || m.sender === "human");

// Counts the messages you sent in one conversation, or null if it isn't one.
function countConversation(conv) {
  if (!conv || typeof conv !== "object") return null;
  if (conv.mapping && typeof conv.mapping === "object") {
    // ChatGPT: a tree of nodes, each maybe holding a message.
    let n = 0;
    for (const node of Object.values(conv.mapping)) {
      const m = node?.message;
      if (m?.author?.role === "user" && !isHiddenContext(m)) n += 1;
    }
    return n;
  }
  const list = Array.isArray(conv.chat_messages) ? conv.chat_messages : Array.isArray(conv.messages) ? conv.messages : null;
  if (list) return list.filter(fromUser).length; // Claude export, or a generic chat
  return null;
}

// A chat history file -> { messages, conversations }, or null if it isn't one.
export function countHistory(data) {
  const convs = Array.isArray(data) ? data : Array.isArray(data?.conversations) ? data.conversations : data?.mapping ? [data] : null;
  if (!convs) return null;
  let messages = 0;
  let conversations = 0;
  let loose = 0; // a flat list of messages rather than conversations
  for (const item of convs) {
    const n = countConversation(item);
    if (n !== null) {
      conversations += 1;
      messages += n;
    } else if (fromUser(item)) loose += 1;
  }
  if (!conversations && !loose) return null;
  return { messages: messages + loose, conversations };
}

function addCount(counts, skipped, key, value) {
  const id = aiIdFor(key);
  const n = Number(String(value).replace(/[\s,_]/g, ""));
  if (!id || !Number.isFinite(n) || n < 0) {
    skipped.push(String(key));
    return;
  }
  counts[id] = Math.max(counts[id] ?? 0, Math.floor(n));
}

function countsFromObject(data) {
  const counts = {};
  const skipped = [];
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === "number" || (typeof value === "string" && value.trim())) addCount(counts, skipped, key, value);
    else skipped.push(key);
  }
  return { counts, skipped };
}

function countsFromCsv(text) {
  const counts = {};
  const skipped = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const [key = "", ...rest] = line.split(/[,;\t]/).map((s) => s.trim().replace(/^["']|["']$/g, ""));
    // "claude,1,200" is 1200 with a thousands comma; otherwise the 2nd column is the count.
    const grouped = rest.length > 1 && rest.every((f, i) => /^\d+$/.test(f) && (i === 0 || f.length === 3));
    const value = grouped ? rest.join("") : rest[0] ?? "";
    if (!/\d/.test(value)) continue; // a header row like "ai,count"
    addCount(counts, skipped, key, value);
  }
  return { counts, skipped };
}

/**
 * Reads pasted or uploaded text. `fromId` is the AI a chat history belongs to.
 * Returns { counts: {id: n}, kind: "history" | "counts", messages?, conversations?, skipped? }.
 * Throws ImportError with a message for people when nothing usable is found.
 */
export function parseImport(text, fromId) {
  const src = String(text ?? "").replace(/^﻿/, "").trim();
  if (!src) throw new ImportError("That's empty. Pick a file or paste some counts.");
  if (src.startsWith("PK")) {
    throw new ImportError("That's the whole export zip. Unzip it first, then pick conversations.json from inside.");
  }

  let data;
  let isJson = true;
  try {
    data = JSON.parse(src);
  } catch {
    isJson = false;
  }

  if (isJson) {
    const history = countHistory(data);
    if (history) {
      if (!history.messages) throw new ImportError("Found conversations, but no messages from you in them.");
      if (!AIS[fromId]) throw new ImportError("Pick which AI this history is from.");
      return { kind: "history", counts: { [fromId]: history.messages }, ...history };
    }
    if (data && typeof data === "object" && !Array.isArray(data)) {
      const { counts, skipped } = countsFromObject(data);
      if (Object.keys(counts).length) return { kind: "counts", counts, skipped };
    }
    throw new ImportError(
      'Couldn\'t find messages or counts in that. Use a chat export like conversations.json, or counts like {"claude": 120}.',
    );
  }

  const { counts, skipped } = countsFromCsv(src);
  if (Object.keys(counts).length) return { kind: "counts", counts, skipped };
  throw new ImportError('Couldn\'t read that. Use lines like "claude,120", counts like {"claude": 120}, or a chat export.');
}
