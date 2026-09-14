import { chromium, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

const base = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const out = process.env.SCREENS_OUT ?? "e2e/screens";
const pages = process.env.SCREENS_PAGES
  ? process.env.SCREENS_PAGES.split(",")
  : ["/", "/about", "/api-reference", "/terms", "/privacy", "/app", "/app/extract", "/app/documents", "/app/keys", "/app/settings", "/app/users"];
mkdirSync(out, { recursive: true });

/** Scrolls the page so the landing's `whileInView` reveal animations fire before the
 * full-page screenshot, then returns to the top and settles. */
async function revealScroll(page: Page) {
  const height = await page.evaluate(() => document.body.scrollHeight);
  for (let y = 0; y < height; y += 500) {
    await page.evaluate((yy) => window.scrollTo(0, yy), y);
    await page.waitForTimeout(120);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(700);
}

/** True when a `motion.div` (Reveal) is still sitting at its pre-animation opacity —
 * i.e. it never hydrated/animated in. Checks computed style, not the inline string,
 * since the un-hydrated SSR markup and the animated-in markup format the `style`
 * attribute differently ("opacity:0" vs "opacity: 1; transform: none;"). */
async function hasUnrevealed(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const els = document.querySelectorAll<HTMLElement>('[style*="opacity"]');
    for (const el of els) {
      if (getComputedStyle(el).opacity === "0") return true;
    }
    return false;
  });
}

const browser = await chromium.launch();
for (const scheme of ["light", "dark"] as const) {
  for (const width of [1440, 390]) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    for (const locale of ["", "/he"]) {
      for (const p of pages) {
        const url = `${base}${locale}${p === "/" ? "" : p}`;
        await page.goto(url, { waitUntil: "networkidle" });
        await page.waitForTimeout(600);
        await revealScroll(page);
        // Dev-server HMR can corrupt a JS chunk mid-navigation (Turbopack "Fast Refresh
        // rebuilding" racing the page load), leaving React unhydrated and every Reveal
        // frozen at opacity 0. A single reload clears it; this is a dev-only flake, not
        // a real render bug (production `next build` has no HMR).
        if (await hasUnrevealed(page)) {
          await page.reload({ waitUntil: "networkidle" });
          await page.waitForTimeout(600);
          await revealScroll(page);
        }
        const name = `${scheme}-${width}-${locale ? "he" : "en"}-${p === "/" ? "landing" : p.replace(/\//g, "_")}.png`;
        await page.screenshot({ path: `${out}/${name}`, fullPage: true });
      }
    }
    await ctx.close();
  }
}
await browser.close();
