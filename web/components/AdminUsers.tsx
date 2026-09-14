"use client";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { InvitationsPanel } from "@/components/InvitationsPanel";
import { LineTab, LineTabs, LineTabsContent, LineTabsList } from "@/components/LineTabs";
import { UsersPanel } from "@/components/UsersPanel";
import type { AuthMode } from "@/lib/config";

export type UsersTab = "users" | "invitations";

/** Which tabs the users page has (invitations exist in clerk mode only) and which one `?tab=` lands on. */
export function resolveUsersTabs(requested: string | null, authMode: AuthMode): { tabs: readonly UsersTab[]; initialTab: UsersTab } {
  const tabs: readonly UsersTab[] = authMode === "clerk" ? ["users", "invitations"] : ["users"];
  const initialTab = (tabs as readonly string[]).includes(requested ?? "") ? (requested as UsersTab) : "users";
  return { tabs, initialTab };
}

export function AdminUsers({ selfId, locale, authMode }: { selfId: string; locale: string; authMode: AuthMode }) {
  const t = useTranslations("users");
  const { tabs, initialTab } = resolveUsersTabs(useSearchParams().get("tab"), authMode);
  if (tabs.length === 1) return <UsersPanel selfId={selfId} locale={locale} authMode={authMode} />;
  return (
    <LineTabs defaultValue={initialTab} className="gap-6">
      <LineTabsList>{tabs.map((tab) => <LineTab key={tab} value={tab}>{t(`tabs.${tab}`)}</LineTab>)}</LineTabsList>
      <LineTabsContent value="users"><UsersPanel selfId={selfId} locale={locale} authMode={authMode} /></LineTabsContent>
      <LineTabsContent value="invitations"><InvitationsPanel locale={locale} /></LineTabsContent>
    </LineTabs>
  );
}
