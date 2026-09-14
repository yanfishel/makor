import { ArrowRight } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { BarList } from "@/components/BarList";
import { DocumentsTable } from "@/components/DocumentsTable";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { StatTiles } from "@/components/StatTiles";
import { ExtractCta } from "@/components/app/ExtractCta";
import { Link } from "@/i18n/routing";
import { getConfig } from "@/lib/config";
import { currentUser } from "@/lib/current-user";
import { getDb } from "@/lib/db";
import { docIcon } from "@/lib/doc-icons";
import { docFamily, familyBarClass } from "@/lib/doc-types";
import { DOCUMENTS_PATH } from "@/lib/document-filters";
import { dashboardStats, listDocuments, pendingWindowMs, trialUsed } from "@/lib/documents";
import { formatCost, formatMs } from "@/lib/format";
import { modeSummary } from "@/lib/mode-summary";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

/** The dashboard shows the newest RECENT_LIMIT documents; the full, filterable list is /app/documents. */
const RECENT_LIMIT = 10;

export default async function Dashboard({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations("dashboard");
  const tl = await getTranslations("labels");
  const ta = await getTranslations("app");
  const label = (ns: "docTypes" | "verdicts", key: string) => (tl.has(`${ns}.${key}`) ? tl(`${ns}.${key}`) : key);
  const cfg = getConfig();
  const { userId, unlimited } = await currentUser();
  const db = getDb();
  const stats = dashboardStats(db, userId);
  const { items } = listDocuments(db, userId, { limit: RECENT_LIMIT });
  const settings = getSettings(db, userId);
  const mode = modeSummary({ authMode: cfg.authMode, hasKey: Boolean(settings.anthropicKeyEnc), unlimited, trialDocs: cfg.trialDocs, trialUsed: trialUsed(db, userId, new Date(), pendingWindowMs(cfg.engineTimeoutMs)) });
  const modeTile = mode.kind === "local" ? { label: t("mode"), value: t("localMode"), hint: t("localHint"), text: true }
    : mode.kind === "byok" ? { label: t("mode"), value: t("byokActive"), hint: t("byokHint"), text: true }
    : mode.kind === "unlimited" ? { label: t("mode"), value: t("unlimited"), hint: t("unlimitedHint"), text: true }
    : { label: t("trialLeft"), value: String(mode.left), hint: t("ofN", { n: mode.total }) };
  const cta = <ExtractCta label={t("extractCta")} short={ta("extract")} />;
  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} actions={cta} />
      <StatTiles tiles={[
        { label: t("total"), value: String(stats.total) },
        { label: t("last30"), value: String(stats.last30Days) },
        modeTile,
        { label: t("medianLatency"), value: formatMs(stats.medianLatencyMs) },
        { label: t("cost30"), value: formatCost(stats.costUsd.last30Days, 2), hint: stats.costUsd.total == null ? undefined : t("costTotal", { total: formatCost(stats.costUsd.total, 2) }) },
      ]} />
      <div className="grid gap-8 md:grid-cols-2">
        <section className="space-y-3"><h2 className="text-sm font-medium">{t("byType")}</h2><BarList rows={stats.byType} icon={docIcon} label={(k) => label("docTypes", k)} barClass={(k) => familyBarClass(docFamily(k))} /></section>
        <section className="space-y-3"><h2 className="text-sm font-medium">{t("byVerdict")}</h2><BarList rows={stats.byVerdict} byTone label={(k) => label("verdicts", k)} /></section>
      </div>
      <section className="space-y-3">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-sm font-medium">{t("recent")}</h2>
          <Link href={DOCUMENTS_PATH} className="inline-flex items-center gap-1 text-sm text-highlight hover:underline">{t("allDocuments")}<ArrowRight className="size-3.5 rtl:rotate-180" /></Link>
        </div>
        {items.length === 0
          ? <EmptyState title={t("empty")} action={cta} />
          : <DocumentsTable rows={items} locale={locale} />}
      </section>
    </div>
  );
}
