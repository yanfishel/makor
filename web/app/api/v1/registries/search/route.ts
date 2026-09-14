import { readDeps } from "@/lib/read-deps";
import { getRegistriesDb } from "@/lib/registries/db";
import { handleApiRegistriesSearch } from "@/lib/registries-handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = (request: Request) => handleApiRegistriesSearch(request, { ...readDeps(), registriesDb: getRegistriesDb });
