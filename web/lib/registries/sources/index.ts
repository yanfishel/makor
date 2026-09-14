import { boiAccounts, boiSevere } from "@/lib/registries/sources/boi";
import { companies } from "@/lib/registries/sources/companies";
import { nbctfIndividuals, nbctfOrgs } from "@/lib/registries/sources/nbctf";
import type { SourceDef } from "@/lib/registries/sources/types";

/** Refresh order = SOURCE_IDS order: the quick files first, the 730 k-row companies registry last. */
export const SOURCES: readonly SourceDef[] = [boiAccounts, boiSevere, nbctfIndividuals, nbctfOrgs, companies];
