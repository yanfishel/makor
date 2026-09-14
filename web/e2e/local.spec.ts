import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

// Whatever documents happen to be in the git-ignored samples/ folder: they are real papers,
// so no file is named here and nothing is asserted about what they turn out to be. The spec
// skips itself where the folder is empty or absent (CI).
const SAMPLES = path.resolve(__dirname, "../../samples");
const firstWithExtension = (extensions: string[]): string | null => {
  if (!existsSync(SAMPLES)) return null;
  const name = readdirSync(SAMPLES).sort().find((f) => extensions.includes(path.extname(f).toLowerCase()));
  return name ? path.join(SAMPLES, name) : null;
};
const SAMPLE = firstWithExtension([".jpg", ".jpeg", ".png", ".webp"]);
const PDF = firstWithExtension([".pdf"]);
test.skip(!SAMPLE, "no document in samples/");

// The result's field table, told apart by its Confidence column: the extract page also shows
// the run's stage table, so a bare `table` locator matches two elements.
const resultTable = (page: Page) => page.getByRole("table").filter({ has: page.getByRole("columnheader", { name: /confidence/i }) });

// Click-to-zoom: clicking a region frames it on the bed. Regression guard — the bed used to
// capture the pointer on pointerdown, which retargets the click onto the bed itself, and the
// region never saw it. Only a page the detector split into regions has a box to click: a
// document photographed edge to edge, with no background around it, is read whole and draws
// none — which says nothing about the sample, so it is not a failure. Returns whether the
// guard ran.
async function zoomsOnRegionClick(page: Page): Promise<boolean> {
  const region = page.locator("[data-region]").first();
  if ((await region.count()) === 0) return false;
  const zoom = page.locator('[data-slot="scene-zoom"]');
  const fitScale = (await zoom.textContent())?.trim();
  await region.click();
  await expect(zoom).not.toHaveText(fitScale ?? "", { timeout: 5_000 });
  return true;
}

// The whole account surface in AUTH_MODE=none: upload -> stored row -> API key ->
// public API with that key -> session-only route refused -> revoke kills the key.
// The SQLite file survives between runs, so every assertion is scoped to the row this
// run created (unique key name) instead of counting rows globally.
test("local mode: extract → dashboard → key → API → revoke", async ({ page, request }) => {
  await page.goto("/app/settings");
  await page.getByRole("tab", { name: /storage/i }).click();
  const store = page.getByRole("switch").first(); // the store-results toggle; the backend selector uses radios
  await expect(store).toBeVisible();
  // Controlled switch: it only flips once PUT /api/settings comes back, so click and wait for the new state.
  if ((await store.getAttribute("aria-checked")) !== "true") {
    await store.click();
    await expect(store).toHaveAttribute("aria-checked", "true");
  }

  // Arrange the one precondition the UI cannot create for itself. Both controls below are
  // controlled by the EFFECTIVE value — the stored choice, else the engine's default — so
  // clicking whatever is already showing fires no change, stores nothing, and leaves the reset
  // button disabled. Since this test ends by resetting, every run after the first would start
  // in exactly that state. Storing a local model that differs from the default through the API
  // gives the select something real to change away from, and it does not depend on which models
  // happen to be pulled on this machine: a stored model that is not installed still makes the
  // select's value differ from the default option.
  // Every engine field is written, not just the one under test: the row survives between runs
  // and a previous run (or a person clicking around) may have left a backend pinned, which
  // would decide which radio renders checked below.
  const OTHER_LOCAL_MODEL = "qwen3-vl:30b-a3b-instruct";
  await page.request.put("/api/settings", { data: { backend: null, model: null, local_model: OTHER_LOCAL_MODEL } });

  // The local-model select exists when the backend is Ollama (the dev stack's default) and
  // offers the installed default model; the cloud select is not shown next to it.
  await page.goto("/app/settings?tab=engine");
  const ollamaRadio = page.getByRole("radio", { name: /ollama/i });
  await expect(ollamaRadio).toHaveAttribute("aria-checked", "true");
  const localSelect = page.getByRole("combobox").last();
  await expect(localSelect).toBeVisible();
  // The cloud select is not shown next to the local one while the backend is ollama.
  await expect(page.getByRole("combobox")).toHaveCount(1);

  // Picking a local model while the backend is "engine default" pins that model's backend
  // (ollama) in the same PUT — the choice must not be silently dropped (finding 1). The pin is
  // what the reset button reports: `aria-checked` on the ollama radio is true either way,
  // because ollama is the engine's own default, so only a reset that becomes ENABLED proves a
  // backend was actually stored.
  const reset = page.getByRole("button", { name: /reset to engine defaults/i });
  await localSelect.click();
  // Anchored: "server default (qwen3-vl:8b-instruct)" also matches an unanchored pattern.
  await page.getByRole("option", { name: /^Qwen3-VL 8B/ }).click();
  await expect(ollamaRadio).toHaveAttribute("aria-checked", "true");
  await expect(reset).toBeEnabled();

  // The reset clears the backend and both model choices and disables itself once nothing is
  // chosen any more — which also leaves the row as this test found it, so the next run starts
  // from the same place. Wait for the PUT to come back before moving on: the button is disabled
  // while a request is in flight as well as when nothing is chosen, so `toBeDisabled` alone is
  // satisfied by the busy state and would pass even if the write never landed — and the very
  // next line navigates away, which cancels it.
  await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/settings") && r.request().method() === "PUT" && r.ok()),
    reset.click(),
  ]);
  await expect(reset).toBeDisabled();
  await expect(await (await page.request.get("/api/settings")).json()).toMatchObject({ backend: null, model: null, local_model: null });

  await page.goto("/app/extract");
  await page.setInputFiles('input[type="file"]', SAMPLE!); // auto-submits on change
  await expect(page.locator('[data-stage="done"]')).toBeVisible({ timeout: 120_000 });
  let zoomed = await zoomsOnRegionClick(page);

  await expect(resultTable(page)).toBeVisible();
  await expect(page.locator("[data-doc-family]").first()).toBeVisible(); // whatever it is, it is published as a family

  if (PDF) {
    await page.getByRole("button", { name: /another document/i }).click();
    await page.setInputFiles('input[type="file"]', PDF);
    await expect(page.locator('[data-slot="scene"] img[src^="data:image/jpeg"]')).toBeVisible({ timeout: 30_000 }); // the engine's preview of the page it read
    await expect(page.locator('[data-stage="done"]')).toBeVisible({ timeout: 120_000 });
    zoomed = (await zoomsOnRegionClick(page)) || zoomed;
  }
  if (!zoomed) test.info().annotations.push({ type: "not run", description: "click-to-zoom: no upload was split into regions, every page was read whole" });

  await page.goto("/app");
  const stored = page.locator("tbody tr[data-href]").first(); // newest first; only stored rows open
  await expect(stored).toBeVisible();
  await stored.click();
  await expect(page).toHaveURL(/\/app\/documents\//);
  await expect(resultTable(page)).toBeVisible();
  await expect(page.locator("[data-doc-family]").first()).toBeVisible();

  const keyName = `e2e-${Date.now()}`;
  await page.goto("/app/keys");
  await page.getByPlaceholder(/name/i).fill(keyName);
  await page.getByRole("button", { name: /create/i }).click();
  const token = (await page.locator("code").first().textContent())!.trim();
  expect(token.startsWith("ak_")).toBe(true);

  const usage = await request.get("/api/v1/usage", { headers: { Authorization: `Bearer ${token}` } });
  expect(usage.status()).toBe(200);
  const keys = await request.get("/api/keys", { headers: { Authorization: `Bearer ${token}` } });
  expect(keys.status()).toBe(403); // session-only route, SESSION_REQUIRED

  const row = page.locator("tr", { hasText: keyName });
  await expect(row).toHaveCount(1);
  await row.getByRole("button", { name: /revoke/i }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: /revoke/i }).click();
  await expect(row).toHaveClass(/line-through/);

  const after = await request.get("/api/v1/usage", { headers: { Authorization: `Bearer ${token}` } });
  expect(after.status()).toBe(401);
});
