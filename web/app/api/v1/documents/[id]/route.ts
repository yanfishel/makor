import { readDeps } from "@/lib/read-deps";
import { handleDeleteDocument, handleGetDocument } from "@/lib/usage-handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const GET = async (request: Request, { params }: Ctx) => handleGetDocument(request, (await params).id, readDeps());
export const DELETE = async (request: Request, { params }: Ctx) => handleDeleteDocument(request, (await params).id, readDeps());
