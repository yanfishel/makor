import { extractWithEngine } from "@/lib/engine";
import { handleExtract } from "@/lib/extract-handler";
import { readDeps } from "@/lib/read-deps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = (request: Request) => handleExtract(request, { ...readDeps(), engine: extractWithEngine });
