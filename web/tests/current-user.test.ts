import { beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const h = vi.hoisted(() => ({ db: null as unknown, redirect: vi.fn<(args: unknown) => never>(() => { throw new Error("NEXT_REDIRECT"); }) }));
vi.mock("@/lib/clerk-session", () => ({ clerkSessionUserId: async () => "user_x", clerkUserEmails: async () => [{ email: "stranger@example.com", verified: true }] }));
vi.mock("@/i18n/routing", () => ({ redirect: (args: unknown) => h.redirect(args) }));
vi.mock("next-intl/server", () => ({ getLocale: async () => "he" }));
vi.mock("@/lib/db", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/db")>()), getDb: () => h.db }));

import { openDb } from "@/lib/db";
import { currentUser } from "@/lib/current-user";
import { getUser } from "@/lib/users";

describe("currentUser in clerk mode", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_MODE", "clerk");
    vi.stubEnv("MAKOR_MASTER_KEY", Buffer.alloc(32).toString("base64"));
    vi.stubEnv("ENGINE_SECRET", "s");
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_test_x");
    vi.stubEnv("CLERK_SECRET_KEY", "sk_test_y");
    h.db = openDb(path.join(mkdtempSync(path.join(tmpdir(), "makor-cu-")), "t.sqlite3"));
  });
  it("sends an uninvited account to /no-access in its locale and registers nothing", async () => {
    await expect(currentUser()).rejects.toThrow("NEXT_REDIRECT");
    expect(h.redirect).toHaveBeenCalledWith({ href: "/no-access", locale: "he" });
    expect(getUser(h.db as never, "user_x")).toBeUndefined();
  });
});
