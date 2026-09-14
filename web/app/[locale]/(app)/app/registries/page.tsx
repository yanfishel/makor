import { Settings } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { RegistryResults } from "@/components/registries/RegistryResults";
import { RegistrySearchForm } from "@/components/registries/RegistrySearchForm";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/routing";
import { currentUser } from "@/lib/current-user";
import { getRegistriesDb, listSources } from "@/lib/registries/db";
import { parseQuery, searchRegistries } from "@/lib/registries/search";

export const dynamic = "force-dynamic";

/** Search over the downloaded registries; the query lives in the URL (`lib/registries/search.ts` parseQuery). Nothing about a query is logged. */
export default async function RegistriesPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { locale } = await params;
  const parsed = parseQuery(await searchParams);
  const t = await getTranslations("registries");
  const user = await currentUser();
  const db = getRegistriesDb();
  const anyLoaded = listSources(db).some((s) => s.fetchedAt !== null);
  const result = anyLoaded && parsed.valid ? searchRegistries(db, parsed, new Date().toISOString().slice(0, 10)) : null;
  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("intro")} />
      <RegistrySearchForm values={parsed.values} locale={locale} />
      {!anyLoaded ? (
        <EmptyState title={t("neverLoaded")} text={t("neverLoadedHint")}
          action={user.role === "admin" ? <Button asChild variant="outline"><Link href={{ pathname: "/app/settings", query: { tab: "registries" } }}><Settings />{t("openSettings")}</Link></Button> : undefined} />
      ) : !parsed.empty && !parsed.valid ? (
        <p className="text-sm text-muted-foreground">{t("tooShort")}</p>
      ) : result ? (
        <>
          {result.groups.length === 0 && <p className="text-sm text-muted-foreground">{t("noSourceCarries")}</p>}
          <RegistryResults result={result} locale={locale} />
        </>
      ) : null}
    </div>
  );
}
