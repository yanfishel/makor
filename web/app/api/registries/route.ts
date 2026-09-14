import { handleRegistriesStatus } from "@/lib/registries-handlers";
import { registriesDeps } from "@/lib/read-deps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = (request: Request) => handleRegistriesStatus(request, registriesDeps());
