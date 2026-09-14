import { readDeps } from "@/lib/read-deps";
import { handleGetSettings, handlePutSettings } from "@/lib/settings-handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = (request: Request) => handleGetSettings(request, readDeps());
export const PUT = (request: Request) => handlePutSettings(request, readDeps());
