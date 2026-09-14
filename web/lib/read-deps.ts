import { getPrincipal } from "@/lib/auth";
import { clerkAdmin } from "@/lib/clerk-admin";
import { getConfig } from "@/lib/config";
import { getMasterKey } from "@/lib/crypto";
import { getDb } from "@/lib/db";
import { apiLimiter } from "@/lib/rate-limit";
import { getRegistriesDb } from "@/lib/registries/db";
import type { RegistriesDeps } from "@/lib/registries-handlers";
import type { ReadDeps } from "@/lib/usage-handlers";

export function readDeps(): ReadDeps {
  const config = getConfig();
  const clerk = config.authMode === "clerk" && config.clerkSecretKey ? clerkAdmin(config.clerkSecretKey) : undefined;
  return { db: getDb(), config, masterKey: getMasterKey(), principal: getPrincipal, registriesDb: getRegistriesDb, limiter: apiLimiter, clerkAdmin: clerk };
}

export function registriesDeps(): RegistriesDeps {
  return { ...readDeps(), registries: getRegistriesDb(), http: fetch };
}
