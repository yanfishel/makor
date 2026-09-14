import type { Principal } from "@/lib/auth";
import { pendingWindowMs } from "@/lib/documents";
import { apiError, json, readJson } from "@/lib/http";
import { clerkErrorTag } from "@/lib/invitations";
import { requireSession } from "@/lib/keys-handlers";
import { parsePage } from "@/lib/paging";
import type { ReadDeps } from "@/lib/usage-handlers";
import { deleteUserData, getUser, listUsers, updateUser, userDetail, type Role } from "@/lib/users";

const now = (d: ReadDeps) => (d.now ?? (() => new Date()))();

/** Admin routes: a signed-in session (never an ak_ key) whose `users` row says admin. */
export function requireAdmin(request: Request, deps: ReadDeps, fn: (p: Principal) => Promise<Response> | Response) {
  return requireSession(request, deps, (p) => (getUser(deps.db, p.userId)?.role === "admin" ? fn(p) : apiError(403, "ADMIN_REQUIRED", "Admin role required")));
}

/** GET ?limit=&offset= — same paging contract as /api/v1/documents; `total` counts every registered user. */
export const handleListUsers = (request: Request, deps: ReadDeps) => requireAdmin(request, deps, () => {
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") ?? 50);
  const offset = Number(url.searchParams.get("offset") ?? 0);
  const page = listUsers(deps.db, now(deps), pendingWindowMs(deps.config.engineTimeoutMs), { limit: Number.isFinite(limit) ? limit : 50, offset: Number.isFinite(offset) ? offset : 0 });
  return json(200, { ...page, trial_docs: deps.config.trialDocs });
});

/** GET ?page= pages the user's recent documents (20 per page, clamped to the last page). */
export const handleGetUser = (request: Request, id: string, deps: ReadDeps) => requireAdmin(request, deps, () => {
  const page = parsePage(new URL(request.url).searchParams.get("page"));
  const detail = userDetail(deps.db, id, now(deps), pendingWindowMs(deps.config.engineTimeoutMs), { page });
  return detail ? json(200, detail) : apiError(404, "NOT_FOUND");
});

/** PATCH { role?: "admin" | "user", trial_unlimited?: boolean }. An admin cannot demote themselves. */
export const handlePatchUser = (request: Request, id: string, deps: ReadDeps) => requireAdmin(request, deps, async (p) => {
  const body = await readJson<{ role?: unknown; trial_unlimited?: unknown }>(request);
  if (!body) return apiError(400, "INVALID_BODY");
  const patch: { role?: Role; trialUnlimited?: boolean } = {};
  if (body.role !== undefined) {
    if (body.role !== "admin" && body.role !== "user") return apiError(400, "INVALID_BODY", "role must be admin or user");
    if (body.role === "user" && id === p.userId) return apiError(409, "SELF_DEMOTE", "Ask another admin to remove your admin role");
    patch.role = body.role;
  }
  if (body.trial_unlimited !== undefined) {
    if (typeof body.trial_unlimited !== "boolean") return apiError(400, "INVALID_BODY", "trial_unlimited must be boolean");
    patch.trialUnlimited = body.trial_unlimited;
  }
  if (!updateUser(deps.db, id, patch)) return apiError(404, "NOT_FOUND");
  const detail = userDetail(deps.db, id, now(deps), pendingWindowMs(deps.config.engineTimeoutMs));
  return json(200, detail);
});

/** DELETE — the Clerk account first (a failure deletes nothing), then everything the app holds for the user. Clerk mode only. */
export const handleDeleteUser = (request: Request, id: string, deps: ReadDeps) => requireAdmin(request, deps, async (p) => {
  const port = deps.config.authMode === "clerk" ? deps.clerkAdmin : undefined;
  if (!port) return apiError(404, "NOT_FOUND");
  if (id === p.userId) return apiError(409, "SELF_DELETE", "Ask another admin to delete your account");
  if (!getUser(deps.db, id)) return apiError(404, "NOT_FOUND");
  try {
    await port.deleteUser(id);
  } catch (err) {
    console.error(`users: Clerk did not delete ${id} (${clerkErrorTag(err)})`);
    return apiError(502, "USER_DELETE_FAILED", "Clerk did not delete the account; nothing was removed");
  }
  deleteUserData(deps.db, id);
  return new Response(null, { status: 204 });
});
