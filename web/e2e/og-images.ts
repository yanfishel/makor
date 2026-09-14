// Renders the link-preview images (og:image / twitter:image) from the landing itself: the hero at
// 1200 × 630 in the dark theme, one per locale, into public/og/makor-<locale>.png.
// Run against a signed-out clerk-mode server, so the header and the CTA are what a visitor sees:
//   AUTH_MODE=clerk npm run dev -- -p 3100 &   E2E_BASE_URL=http://localhost:3100 node e2e/og-images.ts
import { chromium } from "@playwright/test";
import sharp from "sharp";

const base = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const WIDTH = 1200;
const HEIGHT = 630;

const browser = await chromium.launch();
// Twice the pixels, then downscaled: the type stays crisp after a feed's own resampling.
const ctx = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, colorScheme: "dark", deviceScaleFactor: 2 });
const page = await ctx.newPage();
for (const locale of ["en", "he"]) {
  await page.goto(`${base}${locale === "en" ? "/" : `/${locale}`}`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  // The dev server's Next.js indicator sits in a <nextjs-portal>; it is not part of the page.
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  // HeroFan replays its scan every 12 s; the frame worth sharing is the end of the first pass,
  // when "verified" — the ledger's last element to fade in — is fully opaque. (Reduced motion is
  // no shortcut: the ledger rows then never appear.)
  await page.waitForFunction(() => {
    const el = [...document.querySelectorAll("div")].find((d) => d.textContent === "verified");
    return el !== undefined && getComputedStyle(el).opacity === "1";
  }, undefined, { timeout: 11_000 });
  await page.waitForTimeout(300);
  const shot = await page.screenshot({ clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT } });
  const path = `public/og/makor-${locale}.png`;
  await sharp(shot).resize(WIDTH, HEIGHT).png({ compressionLevel: 9 }).toFile(path);
  console.log(path);
}
await browser.close();
