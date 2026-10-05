// Offline router: keyword rules. Used when the API router is unreachable
// (offline, not deployed, timed out). Same output shape as the API.
import { AIS, ORDER, randomQuip } from "./ais.js";

// [pattern, weight]. Weight 3 = near-certain signal, 1 = weak hint.
const RULES = {
  muse: [
    [/\b(book|reserve|reservation|appointment|table for)\b/, 3],
    [/\b(fill (out|in)|sign me up|register me|apply for me)\b/, 3],
    [/\b(negotiate|cancel my|refund|dispute)\b/, 3],
    [/\b(order|buy|purchase|reorder|checkout)\b/, 2],
    [/\b(schedule|reschedule)\b/, 2],
    [/\b(bill|subscription|tickets?|delivery)\b/, 1],
  ],
  perplexity: [
    [/\b(latest|news|headlines|this week|today)\b/, 3],
    [/\b(sources?|citations?|cite|fact[- ]?check|is it true)\b/, 3],
    [/\b(research|look up|compare|vs\.?|versus|reviews?)\b/, 2],
    [/\b(price of|best .* (under|for)|statistics|who won)\b/, 2],
    [/\b(current|recent|20\d\d)\b/, 1],
  ],
  grok: [
    [/\b(twitter|tweets?|x\.com|on x)\b/, 3],
    [/\b(trending|viral|memes?|ratio(ed)?)\b/, 3],
    [/\b(roast|hot take|unhinged|spicy|savage)\b/, 3],
    [/\b(what are people saying|everyone saying|elon)\b/, 2],
  ],
  gemini: [
    [/\b(gmail|google (docs?|drive|sheets|calendar|maps)|youtube|android|pixel)\b/, 3],
    [/\b(my (inbox|email|calendar)|maps)\b/, 2],
    [/\b(video|itinerary|road trip|travel|trip)\b/, 1],
  ],
  copilot: [
    [/\b(excel|spreadsheet|vlookup|xlookup|pivot table|vba|macro)\b/, 3],
    [/\b(word doc|powerpoint|outlook|teams|onedrive|sharepoint|windows)\b/, 3],
    [/\b(formula|cells?|columns?|slides?)\b/, 1],
  ],
  deepseek: [
    [/\b(prove|proof|theorem|lemma|olympiad|leetcode)\b/, 3],
    [/\b(integral|derivative|calculus|eigen\w*|matrix|differential equation|laplace|fourier)\b/, 3],
    [/(∫|∑|√|\d\s*[\^*/]\s*\d)/, 2],
    [/\b(math|solve|equation|algebra|probability|algorithm|complexity)\b/, 2],
    [/\b(kvl|kcl|thevenin|norton|op[- ]?amp|transfer function|bode)\b/, 2],
  ],
  claude: [
    [/\b(debug|refactor|bug|stack trace|code|script|function|regex)\b/, 3],
    [/\b(python|javascript|typescript|c\+\+|rust|java|arduino|verilog|sql)\b/, 3],
    [/\b(essay|rewrite|edit|proofread|cover letter|resume|draft)\b/, 3],
    [/\b(summari[sz]e|analy[sz]e|this (pdf|document|paper)|explain)\b/, 2],
    [/\b(write|story|poem|email)\b/, 1],
  ],
  chatgpt: [
    [/\b(image|picture|draw|illustrat\w*|logo|sticker|wallpaper)\b/, 3],
    [/\b(brainstorm|ideas?|names? for|recipe|workout|gift)\b/, 2],
    [/\b(quick question|what should i|advice|joke|fun fact)\b/, 1],
  ],
};

// Nothing matched: the generalist takes the call.
const DEFAULT_PICK = "chatgpt";
const DEFAULT_RUNNER_UP = "claude";

export function rulesPick(prompt) {
  const text = prompt.toLowerCase();
  const scores = ORDER.map((id) => {
    let score = 0;
    const hits = [];
    for (const [pattern, weight] of RULES[id]) {
      const match = text.match(pattern);
      if (match) {
        score += weight;
        hits.push(match[0].trim());
      }
    }
    return { id, score, hits };
  });

  // Stable sort keeps ORDER as the tiebreaker.
  const ranked = scores.filter((s) => s.score > 0).sort((a, b) => b.score - a.score);

  if (ranked.length === 0) {
    return {
      pick: DEFAULT_PICK,
      runnerUp: DEFAULT_RUNNER_UP,
      quip: randomQuip(DEFAULT_PICK),
      reason: "No strong signals, so the generalist takes this one.",
    };
  }

  const [best, second] = ranked;
  const runnerUp = second ? second.id : best.id === DEFAULT_PICK ? DEFAULT_RUNNER_UP : DEFAULT_PICK;
  const words = [...new Set(best.hits)].slice(0, 3).map((w) => `"${w}"`).join(", ");
  return {
    pick: best.id,
    runnerUp,
    quip: randomQuip(best.id),
    reason: `Keyword match: ${words} points to ${AIS[best.id].name}.`,
  };
}
