"use client";
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { Button } from "@/components/ui/button";
import { DateRangeField } from "@/components/DateRangeField";
import { DOCUMENTS_PATH, STATUS_FILTERS } from "@/lib/document-filters";
import type { DocumentFacets, DocumentFilters as Filters } from "@/lib/documents";

/** A native select in the shadcn trigger's clothes: the filter bar submits its form on every change. */
const SELECT_CLASS = "h-8 w-full appearance-none rounded-lg border border-input bg-transparent pe-7 ps-2.5 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";
const CHEVRON = "pointer-events-none absolute end-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground"><span>{label}</span>{children}</label>;
}

/**
 * The list page's filter bar. A plain GET form: the URL is the state (shareable, back button works,
 * no JS needed), selects submit on change, the date range when its popover closes or a preset is picked.
 */
export function DocumentsFilters({ filters, facets, locale }: { filters: Filters; facets: DocumentFacets; locale: string }) {
  const t = useTranslations("documents");
  const td = useTranslations("dashboard");
  const tl = useTranslations("labels");
  const label = (ns: "docTypes" | "verdicts" | "statuses" | "engines" | "sources", v: string) => (tl.has(`${ns}.${v}`) ? tl(`${ns}.${v}`) : v);
  const active = Object.values(filters).some(Boolean);
  const submit = (e: React.ChangeEvent<HTMLSelectElement>) => e.currentTarget.form?.requestSubmit();
  /** Empty fields are left out of the URL (a disabled control is not submitted); the page re-renders from the server anyway. */
  const tidy = (e: React.FormEvent<HTMLFormElement>) => {
    for (const el of Array.from(e.currentTarget.elements)) if ((el instanceof HTMLSelectElement || el instanceof HTMLInputElement) && el.name && !el.value) el.disabled = true;
  };
  const select = (name: string, title: string, value: string | undefined, ns: Parameters<typeof label>[0], values: readonly string[]) => (
    <Field label={title}>
      <span className="relative">
        <select name={name} defaultValue={value ?? ""} onChange={submit} className={SELECT_CLASS} aria-label={title}>
          <option value="">{t("any")}</option>
          {values.map((v) => <option key={v} value={v}>{label(ns, v)}</option>)}
        </select>
        <svg className={CHEVRON} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
      </span>
    </Field>
  );
  return (
    <form method="get" onSubmit={tidy} className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-[repeat(5,minmax(0,1fr))_auto_auto] lg:items-end">
      {select("type", td("colType"), filters.family, "docTypes", facets.families)}
      {select("verdict", td("colVerdict"), filters.verdict, "verdicts", facets.verdicts)}
      {select("status", td("colStatus"), filters.status, "statuses", STATUS_FILTERS)}
      {select("engine", td("colBackend"), filters.backend, "engines", facets.backends)}
      {select("source", td("colSource"), filters.source, "sources", facets.sources)}
      <Field label={t("dates")}><DateRangeField from={filters.from} to={filters.to} locale={locale} /></Field>
      <div className="flex items-center">
        {active && <Button asChild variant="ghost" size="sm"><Link href={DOCUMENTS_PATH}>{t("reset")}</Link></Button>}
      </div>
    </form>
  );
}
