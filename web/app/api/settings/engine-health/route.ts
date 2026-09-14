import { readDeps } from "@/lib/read-deps";
import { handleEngineHealth } from "@/lib/settings-handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = (request: Request) => handleEngineHealth(request, readDeps());
