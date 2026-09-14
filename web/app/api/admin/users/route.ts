import { handleListUsers } from "@/lib/admin-handlers";
import { readDeps } from "@/lib/read-deps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = (request: Request) => handleListUsers(request, readDeps());
