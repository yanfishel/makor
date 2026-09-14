import { handleCreateInvitation, handleListInvitations } from "@/lib/invitations-handlers";
import { readDeps } from "@/lib/read-deps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = (request: Request) => handleListInvitations(request, readDeps());
export const POST = (request: Request) => handleCreateInvitation(request, readDeps());
