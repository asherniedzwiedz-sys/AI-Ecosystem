// Renders public/icons/icon.svg to the PNGs the manifest and iOS need.
// Only needed when the icon changes. Requires Playwright with a Chromium build:
//   npx playwright install chromium   (or use an existing install)
//   node scripts/make-icons.js
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const iconsDir = fileURLToPath(new URL("../public/icons/", import.meta.url));
const svg = await readFile(`${iconsDir}icon.svg`, "utf8");

// rounded: keep the SVG's own corner radius (browsers/Android show it as-is).
// fullBleed: square background for iOS and maskable icons, which get cropped by the OS.
// artScale: shrinks the artwork into the maskable safe zone.
const outputs = [
  { file: "icon-192.png", size: 192, rounded: true },
  { file: "icon-512.png", size: 512, rounded: true },
  { file: "icon-maskable-512.png", size: 512, rounded: false, artScale: 0.8 },
  { file: "apple-touch-icon.png", size: 180, rounded: false },
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const { file, size, rounded, artScale = 1 } of outputs) {
  let markup = svg;
  if (!rounded) markup = markup.replace('rx="112"', 'rx="0"');
  if (artScale !== 1) {
    const offset = (512 * (1 - artScale)) / 2;
    markup = markup.replace('<g id="art">', `<g id="art" transform="translate(${offset} ${offset}) scale(${artScale})">`);
  }
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${markup}`,
  );
  await page.screenshot({ path: `${iconsDir}${file}`, omitBackground: rounded });
  console.log(`wrote icons/${file}`);
}
await browser.close();
