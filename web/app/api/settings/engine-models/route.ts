import { readDeps } from "@/lib/read-deps";
import { handleEngineModels } from "@/lib/settings-handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = (request: Request) => handleEngineModels(request, readDeps());
