// The AIs on the board. Shared by the page (tiles, links, quips) and the
// router function (its system prompt), so this file is the single source of truth.

// Tile order on the board. 2x4 on desktop, 4x2 on phones.
export const ORDER = [
  "claude",
  "chatgpt",
  "muse",
  "gemini",
  "copilot",
  "grok",
  "deepseek",
  "perplexity",
];

export const AIS = {
  claude: {
    name: "Claude",
    maker: "Anthropic",
    tagline: "Writing · code · docs",
    color: "#E8875C",
    home: "https://claude.ai/new",
    prefill: (q) => `https://claude.ai/new?q=${q}`,
    routerNotes:
      "Long-form writing and editing, coding and debugging, analyzing long documents or PDFs, careful nuanced reasoning, explaining technical concepts in depth, thoughtful advice.",
    quips: [
      "Patching you through to Claude. Bring your longest document.",
      "Claude on line one. It'll think before it speaks.",
      "Connecting you to Claude, the careful one.",
    ],
  },
  chatgpt: {
    name: "ChatGPT",
    maker: "OpenAI",
    tagline: "All-rounder · images",
    color: "#19C37D",
    home: "https://chatgpt.com/",
    prefill: (q) => `https://chatgpt.com/?q=${q}`,
    routerNotes:
      "The best generalist for everyday questions, brainstorming, quick explanations, recipes, plans and lists; also image generation and editing, and voice chat.",
    quips: [
      "ChatGPT on the line. The everything desk.",
      "Putting you through to ChatGPT. It's heard it all.",
      "One generalist, coming right up.",
    ],
  },
  muse: {
    name: "Muse",
    maker: "Meta",
    tagline: "Agent · books · buys",
    color: "#F062A8",
    home: "https://muse.ai",
    prefill: null,
    routerNotes:
      "Meta's agent that DOES real-world tasks instead of just answering: booking restaurants or appointments, filling out forms, scheduling, shopping and ordering, negotiating or cancelling bills. US only, 18+. Pick it only when the user wants something acted on, not just explained.",
    quips: [
      "Muse on the line. It doesn't just talk, it does.",
      "Dispatching Muse. Consider it handled.",
      "Connecting to Muse. Errands, meet your agent.",
    ],
  },
  gemini: {
    name: "Gemini",
    maker: "Google",
    tagline: "Gmail · YouTube · Maps",
    color: "#9B87F5",
    home: "https://gemini.google.com/app",
    prefill: null,
    routerNotes:
      "Anything in the Google ecosystem: Gmail, Docs, Drive, Calendar, YouTube videos, Google Maps and travel planning, Android. Strong with long video or audio and other multimodal input.",
    quips: [
      "Gemini on the line, with all of Google behind it.",
      "Patching into Gemini. It knows where your inbox lives.",
      "Google's operator, connecting now.",
    ],
  },
  copilot: {
    name: "Copilot",
    maker: "Microsoft",
    tagline: "Excel · Word · Windows",
    color: "#C6DD4A",
    home: "https://copilot.microsoft.com/",
    prefill: (q) => `https://copilot.microsoft.com/?q=${q}`,
    routerNotes:
      "The Microsoft ecosystem: Excel formulas and spreadsheets, Word, PowerPoint, Outlook, Teams, OneDrive, and Windows troubleshooting. Bing-backed answers.",
    quips: [
      "Copilot on the line. Excel fears it.",
      "Putting you through to Copilot. Office hours are open.",
      "Connecting to Copilot. Spreadsheets, stand by.",
    ],
  },
  grok: {
    name: "Grok",
    maker: "xAI",
    tagline: "Live X pulse · hot takes",
    color: "#E7E5E4",
    home: "https://grok.com/",
    prefill: (q) => `https://grok.com/?q=${q}`,
    routerNotes:
      "Real-time pulse of X/Twitter: what people are saying right now, trending topics, memes, viral posts, hot takes, and unfiltered humor or roasts.",
    quips: [
      "Grok on the line. Things may get spicy.",
      "Patching into the X firehose.",
      "Connecting to Grok. It's been doomscrolling for you.",
    ],
  },
  deepseek: {
    name: "DeepSeek",
    maker: "DeepSeek",
    tagline: "Math · proofs · puzzles",
    color: "#5B7BFF",
    home: "https://chat.deepseek.com/",
    prefill: null,
    routerNotes:
      "Hard math and step-by-step quantitative reasoning: proofs, calculus, competition math, algorithm and LeetCode puzzles, homework-style problem solving. Free.",
    quips: [
      "DeepSeek on the line. Show your work.",
      "Routing to DeepSeek. Pencils down, proofs up.",
      "Connecting you to the math desk.",
    ],
  },
  perplexity: {
    name: "Perplexity",
    maker: "Perplexity",
    tagline: "Research · sources",
    color: "#22B8C9",
    home: "https://www.perplexity.ai/",
    prefill: (q) => `https://www.perplexity.ai/search?q=${q}`,
    routerNotes:
      "Web research with cited sources: current news, fact-checking, looking things up, comparing products or prices, \"what's the latest on X\".",
    quips: [
      "Perplexity on the line, sources attached.",
      "Routing to Perplexity. Citations incoming.",
      "Connecting to research. Footnotes included.",
    ],
  },
};

// Past this, a prefill URL risks being rejected, so we just open the site and paste.
const MAX_PREFILL_URL = 7000;

// Where a tile sends the prompt. `prefilled` is false when the user has to paste.
export function sendTarget(id, prompt) {
  const ai = AIS[id];
  const text = prompt.trim();
  if (text && ai.prefill) {
    const url = ai.prefill(encodeURIComponent(text));
    if (url.length <= MAX_PREFILL_URL) return { url, prefilled: true };
  }
  return { url: ai.home, prefilled: false };
}

export function randomQuip(id) {
  const quips = AIS[id].quips;
  return quips[Math.floor(Math.random() * quips.length)];
}
