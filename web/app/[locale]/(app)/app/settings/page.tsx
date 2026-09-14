import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/PageHeader";
import { SettingsPanel } from "@/components/SettingsPanel";
import { getConfig } from "@/lib/config";
import { currentUser } from "@/lib/current-user";

export const dynamic = "force-dynamic";
export default async function SettingsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations("settings");
  const user = await currentUser();
  return <div className="space-y-6"><PageHeader title={t("title")} /><SettingsPanel authMode={getConfig().authMode} isAdmin={user.role === "admin"} locale={locale} /></div>;
}
