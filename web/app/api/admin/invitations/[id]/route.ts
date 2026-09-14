import { handleRevokeInvitation } from "@/lib/invitations-handlers";
import { readDeps } from "@/lib/read-deps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };
export const DELETE = async (request: Request, ctx: Ctx) => handleRevokeInvitation(request, (await ctx.params).id, readDeps());
