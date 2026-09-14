import { extractStreamWithEngine } from "@/lib/engine";
import { handleExtractStream } from "@/lib/extract-stream-handler";
import { readDeps } from "@/lib/read-deps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = (request: Request) => handleExtractStream(request, { ...readDeps(), engineStream: extractStreamWithEngine });
