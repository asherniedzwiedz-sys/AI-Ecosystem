import { test } from "node:test";
import assert from "node:assert/strict";
import {
  INLINE_TEXT_CHARS,
  ROUTER_EXCERPT_CHARS,
  classify,
  formatSize,
  isTextKind,
  outgoingText,
  routerMeta,
} from "../public/js/attachment.js";

test("classify: extension first, then MIME type", () => {
  const cases = [
    ["main.py", "", "code"],
    ["blink.ino", "", "code"],
    ["adder.v", "", "code"],
    ["filter.cir", "", "code"],
    ["notes.md", "", "text"],
    ["data.json", "application/json", "text"],
    ["grades.csv", "text/csv", "data"],
    ["budget.xlsx", "", "sheet"],
    ["pitch.pptx", "", "slides"],
    ["essay.docx", "", "doc"],
    ["REPORT.PDF", "", "pdf"],
    ["scan", "application/pdf", "pdf"],
    ["IMG_0042.jpg", "image/jpeg", "image"],
    ["image.png", "image/png", "image"],
    ["memo.m4a", "audio/mp4", "audio"],
    ["lecture.mp4", "video/mp4", "video"],
    ["README", "text/plain", "text"],
    ["archive.zip", "application/zip", "other"],
    ["", "", "other"],
  ];
  for (const [name, type, kind] of cases) assert.equal(classify(name, type), kind, `${name} (${type})`);
});

test("only text, code and data files are read as text", () => {
  assert.ok(isTextKind("code") && isTextKind("text") && isTextKind("data"));
  assert.ok(!isTextKind("pdf") && !isTextKind("image") && !isTextKind("sheet"));
});

test("formatSize", () => {
  assert.equal(formatSize(512), "512 B");
  assert.equal(formatSize(4096), "4 KB");
  assert.equal(formatSize(2.34 * 1024 * 1024), "2.3 MB");
});

test("outgoingText: a text file's contents ride along with the prompt", () => {
  const att = { name: "main.py", inlineText: "print('hi')" };
  assert.equal(outgoingText("  fix this  ", null), "fix this");
  assert.equal(outgoingText("fix this", att), "fix this\n\n----- main.py -----\nprint('hi')");
  assert.equal(outgoingText("", att), "----- main.py -----\nprint('hi')");
  // Files that can't be inlined (images, PDFs, very long text) don't change the text.
  assert.equal(outgoingText("what is this", { name: "cat.png" }), "what is this");
});

test("routerMeta sends metadata and a short excerpt, never the file", () => {
  assert.equal(routerMeta(null), null);
  const text = "x".repeat(INLINE_TEXT_CHARS);
  const meta = routerMeta({ file: {}, name: "log.txt", type: "text/plain", size: 9, kind: "text", text, inlineText: text });
  assert.deepEqual(Object.keys(meta).sort(), ["excerpt", "kind", "name", "size", "type"]);
  assert.equal(meta.excerpt.length, ROUTER_EXCERPT_CHARS);
  const image = routerMeta({ file: {}, name: "cat.png", type: "image/png", size: 9, kind: "image", png: {}, preview: "blob:x" });
  assert.deepEqual(image, { name: "cat.png", type: "image/png", size: 9, kind: "image" });
});
