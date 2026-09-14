import { readDeps } from "@/lib/read-deps";
import { handleDeleteAnthropicKey, handlePutAnthropicKey } from "@/lib/settings-handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const PUT = (request: Request) => handlePutAnthropicKey(request, readDeps());
export const DELETE = (request: Request) => handleDeleteAnthropicKey(request, readDeps());
