import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openDb } from "@/lib/db";
import { invitations } from "@/lib/db/schema";
import {
  admitSessionUser, clerkErrorTag, effectiveStatus, getInvitation, inviteRedirectUrl, isValidEmail, listInvitations,
  markResent, markRevoked, normalizeEmail, pendingInvitation, recordInvitation,
} from "@/lib/invitations";
import { ensureUser, getUser, setUserEmail } from "@/lib/users";

const fresh = () => openDb(path.join(mkdtempSync(path.join(tmpdir(), "makor-inv-")), "t.sqlite3"));
const T0 = new Date("2026-09-13T12:00:00Z");
const days = (n: number) => new Date(T0.getTime() + n * 86_400_000);
const verified = (email: string) => [{ email, verified: true }];

describe("e-mail rules", () => {
  it("normalizes and validates loosely", () => {
    expect(normalizeEmail("  Invitee@Example.COM ")).toBe("invitee@example.com");
    expect(isValidEmail("invitee@example.com")).toBe(true);
    for (const bad of ["", "invitee", "invitee@", "@example.com", "in vitee@example.com", "invitee@example", `${"a".repeat(250)}@example.com`]) expect(isValidEmail(bad)).toBe(false);
  });
  it("the redirect lands on /invite and a Clerk error is tagged without its message", () => {
    expect(inviteRedirectUrl("https://makor.example")).toBe("https://makor.example/invite");
    expect(clerkErrorTag(Object.assign(new Error("invitee@example.com exists"), { status: 422, errors: [{ code: "duplicate_record" }] }))).toBe("422 duplicate_record");
    expect(clerkErrorTag(new TypeError("fetch failed"))).toBe("? TypeError");
  });
});

describe("invitation rows", () => {
  it("records a pending row that expires in 30 days and lists it with the inviter's e-mail", () => {
    const db = fresh();
    ensureUser(db, "user_admin", T0);
    setUserEmail(db, "user_admin", "admin@example.com");
    const row = recordInvitation(db, { clerkInvitationId: "inv_1", email: "invitee@example.com", invitedBy: "user_admin" }, T0);
    expect(row).toMatchObject({ status: "pending", createdAt: T0.toISOString(), expiresAt: days(30).toISOString() });
    expect(pendingInvitation(db, "invitee@example.com")?.id).toBe(row.id);
    expect(listInvitations(db, T0)).toEqual([{ id: row.id, email: "invitee@example.com", invitedBy: "user_admin", invitedByEmail: "admin@example.com", createdAt: T0.toISOString(), expiresAt: days(30).toISOString(), status: "pending", acceptedAt: null }]);
    expect(listInvitations(db, days(31))[0].status).toBe("expired");
  });
  it("a new invitation to an address with an expired pending one revokes the old row", () => {
    const db = fresh();
    const old = recordInvitation(db, { clerkInvitationId: "inv_1", email: "invitee@example.com", invitedBy: "system" }, T0);
    const next = recordInvitation(db, { clerkInvitationId: "inv_2", email: "invitee@example.com", invitedBy: "system" }, days(31));
    expect(getInvitation(db, old.id)?.status).toBe("revoked");
    expect(pendingInvitation(db, "invitee@example.com")?.id).toBe(next.id);
  });
  it("the index refuses a second pending row for one address", () => {
    const db = fresh();
    recordInvitation(db, { clerkInvitationId: "inv_1", email: "invitee@example.com", invitedBy: "system" }, T0);
    expect(() => db.insert(invitations).values({ id: "x", clerkInvitationId: "inv_x", email: "invitee@example.com", invitedBy: "system", createdAt: T0.toISOString(), expiresAt: days(30).toISOString(), status: "pending" }).run()).toThrow();
  });
  it("resend moves the dates and the Clerk id; revoke closes the row", () => {
    const db = fresh();
    const row = recordInvitation(db, { clerkInvitationId: "inv_1", email: "invitee@example.com", invitedBy: "system" }, T0);
    markResent(db, row.id, "inv_2", days(40));
    expect(getInvitation(db, row.id)).toMatchObject({ clerkInvitationId: "inv_2", createdAt: days(40).toISOString(), expiresAt: days(70).toISOString(), status: "pending" });
    markRevoked(db, row.id);
    expect(getInvitation(db, row.id)?.status).toBe("revoked");
  });
  it("effectiveStatus only turns a pending row expired", () => {
    expect(effectiveStatus({ status: "pending", expiresAt: days(1).toISOString() }, T0)).toBe("pending");
    expect(effectiveStatus({ status: "pending", expiresAt: T0.toISOString() }, T0)).toBe("expired");
    expect(effectiveStatus({ status: "accepted", expiresAt: T0.toISOString() }, days(5))).toBe("accepted");
  });
});

describe("admitSessionUser", () => {
  it("admits a verified address with a pending invitation and accepts it in the same step", () => {
    const db = fresh();
    const inv = recordInvitation(db, { clerkInvitationId: "inv_1", email: "invitee@example.com", invitedBy: "system" }, T0);
    const user = admitSessionUser(db, "user_new", [{ email: "Invitee@Example.com", verified: true }], null, days(1));
    expect(user).toMatchObject({ userId: "user_new", role: "user", email: "invitee@example.com" });
    expect(getInvitation(db, inv.id)).toMatchObject({ status: "accepted", acceptedUserId: "user_new", acceptedAt: days(1).toISOString() });
  });
  it("refuses an unverified address, an expired or revoked invitation, and no invitation — writing nothing", () => {
    const db = fresh();
    recordInvitation(db, { clerkInvitationId: "inv_1", email: "invitee@example.com", invitedBy: "system" }, T0);
    expect(admitSessionUser(db, "user_a", [{ email: "invitee@example.com", verified: false }], null, days(1))).toBeNull();
    expect(admitSessionUser(db, "user_b", verified("invitee@example.com"), null, days(30))).toBeNull();
    expect(admitSessionUser(db, "user_c", verified("stranger@example.com"), null, days(1))).toBeNull();
    const revoked = recordInvitation(db, { clerkInvitationId: "inv_2", email: "other@example.com", invitedBy: "system" }, T0);
    markRevoked(db, revoked.id);
    expect(admitSessionUser(db, "user_d", verified("other@example.com"), null, days(1))).toBeNull();
    for (const id of ["user_a", "user_b", "user_c", "user_d"]) expect(getUser(db, id)).toBeUndefined();
    expect(pendingInvitation(db, "invitee@example.com")?.status).toBe("pending");
  });
  it("the bootstrap admin address becomes admin, with or without its invitation", () => {
    const db = fresh();
    const inv = recordInvitation(db, { clerkInvitationId: "inv_1", email: "admin@example.com", invitedBy: "system" }, T0);
    expect(admitSessionUser(db, "user_admin", verified("admin@example.com"), "admin@example.com", days(1))).toMatchObject({ role: "admin", email: "admin@example.com" });
    expect(getInvitation(db, inv.id)?.status).toBe("accepted");
    expect(admitSessionUser(fresh(), "user_admin2", verified("admin@example.com"), "admin@example.com", T0)).toMatchObject({ role: "admin" });
  });
  it("the admin address only admits as admin while the instance has no admin", () => {
    const db = fresh();
    ensureUser(db, "user_admin", T0);
    expect(admitSessionUser(db, "user_second", verified("admin@example.com"), "admin@example.com", days(1))).toBeNull();
    expect(getUser(db, "user_second")).toBeUndefined();
    const inv = recordInvitation(db, { clerkInvitationId: "inv_1", email: "admin@example.com", invitedBy: "system" }, days(1));
    expect(admitSessionUser(db, "user_second", verified("admin@example.com"), "admin@example.com", days(2))).toMatchObject({ role: "user", email: "admin@example.com" });
    expect(getInvitation(db, inv.id)?.status).toBe("accepted");
  });
  it("an existing row is returned untouched", () => {
    const db = fresh();
    ensureUser(db, "user_old", T0);
    expect(admitSessionUser(db, "user_old", verified("stranger@example.com"), null, days(1))).toMatchObject({ userId: "user_old" });
  });
});
