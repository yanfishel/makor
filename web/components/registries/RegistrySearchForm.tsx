"use client";
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Search } from "lucide-react";
import { Link } from "@/i18n/routing";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BANK_CODES, bankLabel } from "@/lib/registries/banks";
import type { Field } from "@/lib/registries/db";

/** The documents filter bar's native select, in the same clothes. */
const SELECT_CLASS = "h-8 w-full appearance-none rounded-lg border border-input bg-transparent pe-7 ps-2.5 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";
const CHEVRON = "pointer-events-none absolute end-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground";

function FieldBox({ label, children }: { label: string; children: ReactNode }) {
  return <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground"><span>{label}</span>{children}</label>;
}

/** One kind of lookup: its fields, and the registries that carry them. */
function FieldGroup({ title, sources, children }: { title: string; sources: string; children: ReactNode }) {
  return (
    <fieldset className="min-w-0 space-y-3 rounded-lg border border-border px-3 pb-3">
      <legend className="px-1 text-sm font-medium">{title}</legend>
      <p className="-mt-2 text-xs text-muted-foreground">{sources}</p>
      {children}
    </fieldset>
  );
}

/**
 * Every field at once, ANDed. A plain GET form: the URL is the query, so a search is a link;
 * empty fields are disabled on submit and stay out of the URL. The fields are grouped by the
 * registries that carry them — a number or name, or a bank account — so a reader sees which
 * fields go together before a search says no registry has them all.
 */
export function RegistrySearchForm({ values, locale }: { values: Record<Field, string>; locale: string }) {
  const t = useTranslations("registries");
  const tidy = (e: React.FormEvent<HTMLFormElement>) => {
    for (const el of Array.from(e.currentTarget.elements)) if ((el instanceof HTMLSelectElement || el instanceof HTMLInputElement) && el.name && !el.value) el.disabled = true;
  };
  const any = Object.values(values).some(Boolean);
  const digits = (name: Exclude<Field, "bank" | "name">) => (
    <FieldBox label={t(`fields.${name}`)}>
      <Input name={name} defaultValue={values[name]} inputMode="numeric" autoComplete="off" dir="ltr" lang="en" className="h-8 font-mono" />
    </FieldBox>
  );
  return (
    <form method="get" onSubmit={tidy} className="space-y-3">
      <div className="grid gap-3 md:grid-cols-2">
        <FieldGroup title={t("groups.who.title")} sources={t("groups.who.sources")}>
          {/* One row on a wide screen; stacked, the number keeps half the width. */}
          <div className="grid gap-3 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <div className="sm:w-1/2 xl:w-auto">{digits("id")}</div>
            <FieldBox label={t("fields.name")}>
              <Input name="name" defaultValue={values.name} autoComplete="off" className="h-8" />
            </FieldBox>
          </div>
        </FieldGroup>
        <FieldGroup title={t("groups.account.title")} sources={t("groups.account.sources")}>
          {/* One row on a wide screen; stacked, the bank takes its own line above branch and account. */}
          <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-3 xl:grid-cols-[minmax(0,5fr)_minmax(0,2fr)_minmax(0,3fr)]">
            <div className="col-span-2 xl:col-span-1">
              <FieldBox label={t("fields.bank")}>
                <span className="relative">
                  <select name="bank" defaultValue={values.bank} className={SELECT_CLASS} aria-label={t("fields.bank")}>
                    <option value="">{t("anyBank")}</option>
                    {BANK_CODES.map((code) => <option key={code} value={String(code)}>{bankLabel(code, locale)}</option>)}
                  </select>
                  <svg className={CHEVRON} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
                </span>
              </FieldBox>
            </div>
            {digits("branch")}
            {digits("account")}
          </div>
        </FieldGroup>
      </div>
      <div className="flex justify-end gap-2">
        {any && <Button asChild variant="ghost" className="h-8"><Link href="/app/registries">{t("reset")}</Link></Button>}
        <Button type="submit" variant="highlight" className="h-8"><Search />{t("search")}</Button>
      </div>
    </form>
  );
}
