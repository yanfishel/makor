// Renders the PNG icons from app/icon.svg (the favicon mark): the Apple touch icon and the web
// app manifest's icons. Run from web/ after changing the mark: node scripts/brand-icons.mjs
import { readFileSync, writeFileSync } from "node:fs";
import sharp from "sharp";

const svg = readFileSync("app/icon.svg", "utf8");
const TILE = /<rect[^>]*fill="([^"]+)"[^>]*\/>/;
const tile = svg.match(TILE)?.[1];
if (!tile) throw new Error("app/icon.svg: no background <rect> found");
const glyph = svg.replace(TILE, "").replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");

/** The glyph on a full-bleed square tile, scaled to `scale` of the side: platforms that round or
 * mask the icon themselves (iOS, Android maskable) need no transparent corners and a safe margin. */
function square(scale) {
  const inset = (24 * (1 - scale)) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" fill="${tile}"/>`
    + `<g fill="none" transform="translate(${inset} ${inset}) scale(${scale})">${glyph}</g></svg>`;
}

const out = [
  // The rounded tile as drawn, for browsers and "any"-purpose manifest icons.
  ["public/icons/icon-192.png", svg, 192],
  ["public/icons/icon-512.png", svg, 512],
  // Maskable: Android crops to a circle of 80 % of the side, so the glyph keeps inside it.
  ["public/icons/icon-maskable-512.png", square(0.72), 512],
  // app/apple-icon.png: Next links it as apple-touch-icon; iOS rounds the corners itself.
  ["app/apple-icon.png", square(0.86), 180],
];
for (const [path, source, size] of out) {
  const png = await sharp(Buffer.from(source), { density: (72 * size) / 24 }).resize(size, size).png({ compressionLevel: 9 }).toBuffer();
  writeFileSync(path, png);
  console.log(path, size, `${png.length} B`);
}
