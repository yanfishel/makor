import { describe, expect, it } from "vitest";
import { resolveUsersTabs } from "@/components/AdminUsers";
import { inviteErrorKey } from "@/components/InvitationsPanel";
import en from "@/messages/en.json";

describe("users page tabs", () => {
  it("clerk mode has the invitations tab; none mode has none; unknown tab falls back to users", () => {
    expect(resolveUsersTabs("invitations", "clerk")).toEqual({ tabs: ["users", "invitations"], initialTab: "invitations" });
    expect(resolveUsersTabs("invitations", "none")).toEqual({ tabs: ["users"], initialTab: "users" });
    expect(resolveUsersTabs("bogus", "clerk").initialTab).toBe("users");
  });
  it("every invitation error code has a message, anything else the generic one", () => {
    for (const c of ["EMAIL_INVALID", "ALREADY_REGISTERED", "ALREADY_INVITED", "INVITE_SEND_FAILED", "INVITATION_CLOSED", "INVITE_REVOKE_FAILED"]) {
      const key = inviteErrorKey(c);
      expect(key).toBe(`inviteErrors.${c}`);
      expect((en.users.inviteErrors as Record<string, string>)[c]).toBeTruthy();
    }
    expect(inviteErrorKey("NOPE")).toBe("inviteErrors.generic");
    expect(inviteErrorKey(undefined)).toBe("inviteErrors.generic");
  });
});
