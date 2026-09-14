import { readDeps } from "@/lib/read-deps";
import { handleCreateKey, handleListKeys } from "@/lib/keys-handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = async (request: Request) => handleListKeys(request, readDeps());
export const POST = async (request: Request) => handleCreateKey(request, readDeps());
