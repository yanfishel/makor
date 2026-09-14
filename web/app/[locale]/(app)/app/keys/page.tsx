import { getTranslations } from "next-intl/server";
import { KeysPanel } from "@/components/KeysPanel";
import { PageHeader } from "@/components/PageHeader";

export const dynamic = "force-dynamic";
export default async function KeysPage() {
  const t = await getTranslations("keys");
  return <div className="space-y-6"><PageHeader title={t("title")} description={t("intro")} /><KeysPanel /></div>;
}
