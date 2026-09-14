import { describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ensureAdminInvitation } from "@/lib/bootstrap-admin";
import { openDb } from "@/lib/db";
import { markRevoked, pendingInvitation, recordInvitation, type ClerkAdminPort } from "@/lib/invitations";
import { ensureUser } from "@/lib/users";

const fresh = () => openDb(path.join(mkdtempSync(path.join(tmpdir(), "makor-boot-")), "t.sqlite3"));
const T0 = new Date("2026-09-13T12:00:00Z");
const port = (fail = false) => {
  const calls: string[] = [];
  const p: ClerkAdminPort = { createInvitation: async (email, url) => { calls.push(`${email} ${url}`); if (fail) throw Object.assign(new Error("x"), { status: 503 }); return { id: `inv_${calls.length}` }; }, revokeInvitation: async () => {}, deleteUser: async () => {} };
  return { p, calls };
};

describe("ensureAdminInvitation", () => {
  it("invites the address once while there is no admin", async () => {
    const db = fresh();
    const c = port();
    expect(await ensureAdminInvitation(db, "admin@example.com", c.p, "https://makor.example", T0)).toBe("invited");
    expect(await ensureAdminInvitation(db, "admin@example.com", c.p, "https://makor.example", T0)).toBe("already-invited");
    expect(c.calls).toEqual(["admin@example.com https://makor.example/invite"]);
    expect(pendingInvitation(db, "admin@example.com")).toMatchObject({ invitedBy: "system" });
  });
  it("re-invites after the invitation expired or was revoked", async () => {
    const db = fresh();
    const c = port();
    const old = recordInvitation(db, { clerkInvitationId: "inv_old", email: "admin@example.com", invitedBy: "system" }, new Date("2026-08-01T00:00:00Z"));
    expect(await ensureAdminInvitation(db, "admin@example.com", c.p, "https://makor.example", T0)).toBe("invited");
    markRevoked(db, pendingInvitation(db, "admin@example.com")!.id);
    expect(await ensureAdminInvitation(db, "admin@example.com", c.p, "https://makor.example", T0)).toBe("invited");
    expect(old.id).not.toBe(pendingInvitation(db, "admin@example.com")!.id);
  });
  it("does nothing with an admin; logs without an address or when Clerk fails", async () => {
    const withAdmin = fresh();
    ensureUser(withAdmin, "user_admin", T0);
    const c = port();
    expect(await ensureAdminInvitation(withAdmin, "admin@example.com", c.p, "https://makor.example", T0)).toBe("has-admin");
    expect(c.calls).toEqual([]);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await ensureAdminInvitation(fresh(), null, c.p, "https://makor.example", T0)).toBe("no-address");
    const failing = fresh();
    expect(await ensureAdminInvitation(failing, "admin@example.com", port(true).p, "https://makor.example", T0)).toBe("failed");
    expect(pendingInvitation(failing, "admin@example.com")).toBeUndefined();
    expect(log.mock.calls.flat().join(" ")).not.toContain("admin@example.com");
    log.mockRestore();
  });
});
