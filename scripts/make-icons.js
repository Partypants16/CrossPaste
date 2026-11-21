// Draws the app icons (home screen, install prompt) from public/favicon.svg.
// Run after changing the favicon: node scripts/make-icons.js
import sharp from 'sharp';
import fs from 'node:fs/promises';

const svg = await fs.readFile(new URL('../public/favicon.svg', import.meta.url));
const out = (name) => new URL(`../public/icons/${name}`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

for (const size of [192, 512]) {
  await sharp(svg, { density: 1200 }).resize(size, size).png().toFile(out(`icon-${size}.png`));
}
// "Maskable": the phone may crop it to a circle, so the drawing sits in the middle 70%.
const inner = Math.round(512 * 0.7);
const glyph = await sharp(svg, { density: 1200 }).resize(inner, inner).png().toBuffer();
await sharp({ create: { width: 512, height: 512, channels: 4, background: '#2563eb' } })
  .composite([{ input: glyph, gravity: 'center' }])
  .png()
  .toFile(out('icon-maskable-512.png'));
console.log('Icons written to public/icons/');
