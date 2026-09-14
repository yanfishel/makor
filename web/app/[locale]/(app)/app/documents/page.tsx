import { getTranslations } from "next-intl/server";
import { DocumentsFilters } from "@/components/DocumentsFilters";
import { DocumentsTable } from "@/components/DocumentsTable";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { Pagination } from "@/components/Pagination";
import { ExtractCta } from "@/components/app/ExtractCta";
import { currentUser } from "@/lib/current-user";
import { getDb } from "@/lib/db";
import { filtersHref, parseFilters } from "@/lib/document-filters";
import { documentFacets, listDocuments } from "@/lib/documents";
import { PAGE_SIZE, clampPage, pageCount, parsePage } from "@/lib/paging";

export const dynamic = "force-dynamic";

/** Every document of the caller, newest first, filtered and paged through the URL (`lib/document-filters.ts`). */
export default async function DocumentsPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { locale } = await params;
  const query = await searchParams;
  const filters = parseFilters(query);
  const t = await getTranslations("documents");
  const td = await getTranslations("dashboard");
  const ta = await getTranslations("app");
  const { userId } = await currentUser();
  const db = getDb();
  const facets = documentFacets(db, userId);
  const total = listDocuments(db, userId, { limit: 1, filters }).total;
  const page = clampPage(parsePage(query.page), total);
  const { items } = listDocuments(db, userId, { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE, filters });
  const active = Object.values(filters).some(Boolean);
  const cta = <ExtractCta label={td("extractCta")} short={ta("extract")} />;
  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("intro")} actions={cta} />
      <DocumentsFilters filters={filters} facets={facets} locale={locale} />
      <section className="space-y-3">
        <p className="font-mono text-xs text-muted-foreground">{t("count", { n: total })}</p>
        {items.length === 0
          ? <EmptyState title={active ? t("noMatch") : td("empty")} action={active ? undefined : cta} />
          : <>
            <DocumentsTable rows={items} locale={locale} />
            <Pagination page={page} total={total} pageSize={PAGE_SIZE} hrefFor={(n) => filtersHref(filters, n)}
              labels={{ prev: td("prev"), next: td("next"), pageOf: td("pageOf", { page, pages: pageCount(total) }) }} />
          </>}
      </section>
    </div>
  );
}
