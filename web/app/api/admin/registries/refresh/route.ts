import { handleRegistriesRefresh } from "@/lib/registries-handlers";
import { registriesDeps } from "@/lib/read-deps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = (request: Request) => handleRegistriesRefresh(request, registriesDeps());
