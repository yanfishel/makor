import { readDeps } from "@/lib/read-deps";
import { handleDeleteAllResults, handleListDocuments } from "@/lib/usage-handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = (request: Request) => handleListDocuments(request, readDeps());
export const DELETE = (request: Request) => handleDeleteAllResults(request, readDeps());
