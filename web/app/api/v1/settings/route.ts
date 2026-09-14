import { readDeps } from "@/lib/read-deps";
import { handleApiGetSettings, handleApiPatchSettings } from "@/lib/settings-handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = (request: Request) => handleApiGetSettings(request, readDeps());
export const PATCH = (request: Request) => handleApiPatchSettings(request, readDeps());
