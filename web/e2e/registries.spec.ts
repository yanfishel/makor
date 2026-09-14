import { expect, test } from "@playwright/test";

// Against a running dev stack. Never presses "Refresh all": that would download the live
// registries. Asserts only what holds whether or not they were downloaded.
test("registries: the search page and the settings tab render", async ({ page }) => {
  await page.goto("/app/registries");
  await expect(page.getByRole("heading", { name: "Registries", level: 1 })).toBeVisible();
  for (const label of ["ID / company number", "Bank", "Branch", "Account", "Name"]) await expect(page.getByText(label, { exact: true }).first()).toBeVisible();

  await page.goto("/app/settings?tab=registries");
  await expect(page.getByText("Check extracted documents against the registries")).toBeVisible();
  await expect(page.getByRole("button", { name: /Refresh all|Refreshing/ })).toBeVisible();
  for (const source of ["Bank of Israel: restricted accounts", "NBCTF: designated individuals", "Registrar of Companies"]) {
    await expect(page.getByRole("cell", { name: source })).toBeVisible();
  }
});
