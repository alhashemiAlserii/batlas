/**
 * Generates the PWA / home-screen icons from the Batlas logo (assets/batlas-logo.jpg, 1024x1024).
 *   npx tsx scripts/make-pwa-icons.ts
 * any-purpose icons: the logo cropped to its content with a small margin;
 * maskable: logo scaled into the central 80% safe circle on the logo's own background colour;
 * apple-touch-icon: opaque 180x180 (iOS adds its own rounded corners).
 */
import sharp from 'sharp';
import path from 'node:path';
import fs from 'node:fs';
import { SERVER_ROOT } from '../src/config.js';

const ROOT = path.resolve(SERVER_ROOT, '..');
const SRC = path.join(ROOT, 'assets', 'batlas-logo.jpg');
const OUT = path.join(ROOT, 'web', 'public', 'img', 'icons');
export const BG = { r: 0, g: 15, b: 48 }; // #000f30, the logo's background
fs.mkdirSync(OUT, { recursive: true });

// content box of the logo artwork (wave + wordmark), measured once: x 106..921, y 185..801
const content = { left: 106, top: 185, width: 816, height: 617 };
const square = { left: 73, top: 53, width: 880, height: 880 }; // centred on the content, small margin

const png = (s: ReturnType<typeof sharp>) => s.png({ compressionLevel: 9, palette: false });
for (const size of [192, 512]) {
  await png(sharp(SRC).extract(square).resize(size, size)).toFile(path.join(OUT, `icon-${size}.png`));
  // maskable: content's diagonal must fit in the 80% safe-zone circle
  const diag = Math.hypot(content.width, content.height);
  const w = Math.floor((content.width * size * 0.8) / diag);
  const art = await sharp(SRC).extract(content).resize(w).png().toBuffer();
  const meta = await sharp(art).metadata();
  await png(sharp({ create: { width: size, height: size, channels: 3, background: BG } })
    .composite([{ input: art, left: Math.round((size - meta.width!) / 2), top: Math.round((size - meta.height!) / 2) }]))
    .toFile(path.join(OUT, `maskable-${size}.png`));
}
await png(sharp(SRC).extract(square).resize(180, 180).flatten({ background: BG })).toFile(path.join(OUT, 'apple-touch-icon-180.png'));
fs.copyFileSync(path.join(OUT, 'apple-touch-icon-180.png'), path.join(ROOT, 'web', 'public', 'apple-touch-icon.png'));
for (const f of fs.readdirSync(OUT)) console.log(f, fs.statSync(path.join(OUT, f)).size, 'bytes');
