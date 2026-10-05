import { test } from "node:test";
import assert from "node:assert/strict";
import { AIS, ORDER, mascotSrc } from "../public/js/ais.js";
import { DEFAULT_THEME, THEMES, getTheme } from "../public/js/themes.js";

const ai = (id) => ({ id, ...AIS[id] });

test("creatures is the default theme and unknown ids fall back to it", () => {
  assert.equal(DEFAULT_THEME, "creatures");
  assert.equal(getTheme("nope").id, "creatures");
  assert.equal(getTheme("classic").id, "classic");
});

for (const theme of Object.values(THEMES)) {
  test(`${theme.id}: every tile has exactly one badge and the AI's name`, () => {
    for (const id of ORDER) {
      const html = theme.renderTile(ai(id), 1, 3);
      assert.equal(html.match(/class="badge"/g)?.length, 1, `${theme.id}/${id}`);
      assert.match(html, new RegExp(`>${AIS[id].name}<`));
    }
  });
}

test("creatures: each tile shows its own mascot; paste-only AIs get a paste chip", () => {
  for (const id of ORDER) {
    const html = THEMES.creatures.renderTile(ai(id), 1, 0);
    assert.ok(html.includes(`src="${mascotSrc(id)}"`), id);
    assert.equal(html.includes("creature-chip"), !AIS[id].prefill, id);
  }
});

test("classic: keeps the lamp and fixed line numbers", () => {
  const html = THEMES.classic.renderTile(ai("grok"), 1, 9);
  assert.match(html, /class="lamp"/);
  assert.match(html, /LINE 06/);
});

test("renderTile escapes text", () => {
  const evil = { ...ai("claude"), name: '<img src=x onerror="alert(1)">', tagline: "a & b" };
  for (const theme of Object.values(THEMES)) {
    const html = theme.renderTile(evil, 1, 0);
    assert.doesNotMatch(html, /<img src=x/);
    assert.match(html, /a &amp; b/);
  }
});
