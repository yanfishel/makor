import { readDeps } from "@/lib/read-deps";
import { handleRevokeKey } from "@/lib/keys-handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const DELETE = async (request: Request, { params }: Ctx) => handleRevokeKey(request, (await params).id, readDeps());
