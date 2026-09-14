import { defineConfig } from "@playwright/test";

// Runs against an ALREADY RUNNING stack — `scripts/run.sh dev local` (engine :8000 +
// web :3000) with Ollama up; `webServer` is deliberately unset, so start the stack
// first and stop it with `scripts/stop.sh` afterwards. One extraction takes 15–40 s on
// the local backend, hence the generous timeout. Override the target with E2E_BASE_URL.
export default defineConfig({
  testDir: "./e2e",
  timeout: 180_000,
  use: { baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000" },
  reporter: "list",
});
