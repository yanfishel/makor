import createMiddleware from "next-intl/middleware";
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { routing } from "./i18n/routing";

export type AuthMode = "clerk" | "none";

const intl = createMiddleware(routing);
// /api is in the matcher so clerkMiddleware runs before route handlers (auth() needs it),
// but next-intl must never see those paths: with localePrefix "as-needed" it would rewrite
// /api/keys to /en/api/keys. API routes are never redirected — getPrincipal answers 401 JSON.
// Segment-exact: "/api(.*)" would also match the /api-reference page and skip its locale.
const isApi = createRouteMatcher(["/api", "/api/(.*)", "/trpc", "/trpc/(.*)"]);
const isAppPage = createRouteMatcher(["/app(.*)", "/:locale/app(.*)"]);

// signInUrl: without it auth.protect() sends signed-out visitors to Clerk's hosted account
// portal. There are no sign-in pages: the landing opens Clerk's modal when it sees
// `?sign-in=1` (AuthModalOpener). The redirect is unprefixed, i.e. the default locale.
const withClerk = clerkMiddleware(async (auth, req) => {
  if (isApi(req)) return NextResponse.next();
  if (isAppPage(req)) await auth.protect();
  return intl(req);
}, { signInUrl: "/?sign-in=1" });

const withoutClerk = (req: NextRequest) => (isApi(req) ? NextResponse.next() : intl(req));

export function middlewareFor(mode: AuthMode) {
  return mode === "clerk" ? withClerk : withoutClerk;
}

// The mode is read on every request, not at module load: the Node runtime sees the
// container's environment, so one image serves AUTH_MODE=none and AUTH_MODE=clerk.
export default function middleware(req: NextRequest, ev: NextFetchEvent) {
  return middlewareFor(process.env.AUTH_MODE === "clerk" ? "clerk" : "none")(req, ev);
}

export const config = { matcher: ["/((?!_next|.*\\..*).*)", "/(api|trpc)(.*)"], runtime: "nodejs" };
