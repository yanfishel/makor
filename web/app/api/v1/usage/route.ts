import { readDeps } from "@/lib/read-deps";
import { handleUsage } from "@/lib/usage-handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = (request: Request) => handleUsage(request, readDeps());
