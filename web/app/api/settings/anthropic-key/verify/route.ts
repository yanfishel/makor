import { readDeps } from "@/lib/read-deps";
import { handleVerifyAnthropicKey } from "@/lib/settings-handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = (request: Request) => handleVerifyAnthropicKey(request, readDeps());
