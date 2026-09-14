import { handleDeleteUser, handleGetUser, handlePatchUser } from "@/lib/admin-handlers";
import { readDeps } from "@/lib/read-deps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };
export const GET = async (request: Request, ctx: Ctx) => handleGetUser(request, (await ctx.params).id, readDeps());
export const PATCH = async (request: Request, ctx: Ctx) => handlePatchUser(request, (await ctx.params).id, readDeps());
export const DELETE = async (request: Request, ctx: Ctx) => handleDeleteUser(request, (await ctx.params).id, readDeps());
