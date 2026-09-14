import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { AdminUsers } from "@/components/AdminUsers";
import { PageHeader } from "@/components/PageHeader";
import { getConfig } from "@/lib/config";
import { currentUser } from "@/lib/current-user";

export const dynamic = "force-dynamic";

/** Admin only: a plain user gets the same 404 as a missing page — the nav never links here for them. */
export default async function UsersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const user = await currentUser();
  if (user.role !== "admin") notFound();
  const t = await getTranslations("users");
  return <div className="space-y-6"><PageHeader title={t("title")} description={t("intro", { n: getConfig().trialDocs })} /><AdminUsers selfId={user.userId} locale={locale} authMode={getConfig().authMode} /></div>;
}
