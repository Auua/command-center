/**
 * Generates the PWA app icons (placeholder mark: white 2×2 widget grid on a
 * coral gradient — the dashboard motif, no font dependence) by rendering an
 * SVG in headless Chromium (already a devDependency via Playwright) and
 * screenshotting it at each target size.
 *
 * Run from apps/web:  node scripts/generate-icons.mjs
 * Outputs are committed; re-run only when the mark changes.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * @param {{ fullBleed: boolean }} options fullBleed icons (maskable, apple
 * touch) fill the square — the platform applies its own mask; the rest get
 * rounded corners with transparency outside.
 */
function iconSvg({ fullBleed }) {
  const cornerRadius = fullBleed ? 0 : 22;
  // 2×2 grid of rounded squares, centered; comfortably inside the maskable
  // safe zone (inner 80%).
  const squares = [
    { x: 27, y: 27, opacity: 1 },
    { x: 53, y: 27, opacity: 0.72 },
    { x: 27, y: 53, opacity: 1 },
    { x: 53, y: 53, opacity: 1 },
  ]
    .map(
      (square) =>
        `<rect x="${square.x}" y="${square.y}" width="20" height="20" rx="6" ` +
        `fill="#ffffff" fill-opacity="${square.opacity}"/>`,
    )
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100%" height="100%">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ef6a5e"/>
      <stop offset="1" stop-color="#d94a3f"/>
    </linearGradient>
  </defs>
  <rect width="100" height="100" rx="${cornerRadius}" fill="url(#bg)"/>
  ${squares}
</svg>`;
}

const targets = [
  { file: 'public/icons/icon-192.png', size: 192, fullBleed: false },
  { file: 'public/icons/icon-512.png', size: 512, fullBleed: false },
  { file: 'public/icons/icon-maskable-512.png', size: 512, fullBleed: true },
  // Apple touch icon: iOS applies its own corner mask, so full bleed.
  { file: 'app/apple-icon.png', size: 180, fullBleed: true },
];

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  for (const target of targets) {
    await page.setViewportSize({ width: target.size, height: target.size });
    await page.setContent(
      `<style>html,body{margin:0;padding:0;background:transparent}svg{display:block}</style>` +
        iconSvg(target),
    );
    const png = await page.screenshot({ omitBackground: true });
    const outPath = join(webRoot, target.file);
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, png);
    console.log(`wrote ${target.file} (${target.size}×${target.size})`);
  }
} finally {
  await browser.close();
}
