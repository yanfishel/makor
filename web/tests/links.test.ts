import { describe, expect, it } from "vitest";
import { CONTACT_EMAIL, REQUEST_ACCESS_SUBJECT, authHref, localePath, mailtoHref } from "@/lib/links";

describe("links", () => {
  it("localePath prefixes only the non-default locale", () => {
    expect(localePath("en", "/api-reference")).toBe("/api-reference");
    expect(localePath("he", "/api-reference")).toBe("/he/api-reference");
  });
  it("authHref points at the landing with the modal query, per locale", () => {
    expect(authHref("en", "sign-in")).toBe("/?sign-in=1");
    expect(authHref("he", "sign-in")).toBe("/he?sign-in=1");
  });
});

describe("mailtoHref", () => {
  it("targets the contact address with an encoded subject", () => {
    expect(mailtoHref("Makor feedback")).toBe(`mailto:${CONTACT_EMAIL}?subject=Makor%20feedback`);
  });

  it("the request-access mailto carries its subject", () => {
    expect(mailtoHref(REQUEST_ACCESS_SUBJECT)).toBe(`mailto:${CONTACT_EMAIL}?subject=Makor%20access%20request`);
  });
});
