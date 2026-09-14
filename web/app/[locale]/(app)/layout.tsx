import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { getMessages, getTranslations } from "next-intl/server";
import { AppSidebar, type NavItem } from "@/components/app/AppSidebar";
import { AppTopbar } from "@/components/app/AppTopbar";
import { Signature, type SignatureLabels } from "@/components/Signature";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { getConfig } from "@/lib/config";
import { currentUser } from "@/lib/current-user";
import { getDb } from "@/lib/db";
import { pendingWindowMs, trialUsed } from "@/lib/documents";
import { modeSummary } from "@/lib/mode-summary";
import { NOINDEX } from "@/lib/seo";
import { getSettings } from "@/lib/settings";

/** The app is behind sign-in; it never belongs in a search index. */
export const metadata = NOINDEX;

export default async function AppLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const cfg = getConfig();
  const user = await currentUser();
  const db = getDb();
  const settings = getSettings(db, user.userId);
  const mode = modeSummary({
    authMode: cfg.authMode, hasKey: Boolean(settings.anthropicKeyEnc), unlimited: user.unlimited, trialDocs: cfg.trialDocs,
    trialUsed: trialUsed(db, user.userId, new Date(), pendingWindowMs(cfg.engineTimeoutMs)),
  });
  const t = await getTranslations({ locale, namespace: "app" });
  const td = await getTranslations({ locale, namespace: "document" });
  const items: NavItem[] = [
    { href: "/app", label: t("dashboard"), icon: "dashboard" },
    { href: "/app/extract", label: t("extract"), icon: "extract" },
    { href: "/app/documents", label: t("documents"), icon: "documents" },
    { href: "/app/registries", label: t("registries"), icon: "registries" },
    { href: "/app/keys", label: t("keys"), icon: "keys" },
    { href: "/app/settings", label: t("settings"), icon: "settings" },
    ...(user.role === "admin" ? [{ href: "/app/users", label: t("users"), icon: "users" } as NavItem] : []),
  ];
  const theme = { toggle: t("theme.toggle"), light: t("theme.light"), dark: t("theme.dark"), system: t("theme.system") };
  const modeLabels = { local: t("mode.local"), localHint: t("mode.localHint"), byok: t("mode.byok"), byokHint: t("mode.byokHint"), unlimited: t("mode.unlimited"), unlimitedHint: t("mode.unlimitedHint"), trial: t("mode.trial"),
    trialLeft: mode.kind === "trial" ? t("mode.trialLeft", { left: mode.left, total: mode.total }) : "" };
  const userCard = { authMode: cfg.authMode, role: user.role, email: user.email, mode,
    labels: { mode: modeLabels, localUser: t("localUser"), admin: t("user.admin"), menu: t("user.menu"), manageAccount: t("user.manageAccount"), signOut: t("user.signOut"), apiReference: t("docs"), about: t("about") } };
  const defaultOpen = (await cookies()).get("sidebar_state")?.value !== "false";
  const signature = (await getMessages()).signature as SignatureLabels;
  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <AppSidebar items={items} locale={locale} user={userCard} />
      {/* min-w-0: a flex item's automatic minimum is its content's min width, so a wide table would push
          the page past the viewport instead of scrolling inside its own overflow-x-auto wrapper. */}
      <SidebarInset className="min-w-0">
        <AppTopbar items={items} labels={{ language: t("language"), theme, documentTitle: td("title") }} />
        <div className="mx-auto w-full min-w-0 max-w-6xl p-4 sm:p-6">{children}</div>
        <Signature labels={signature} locale={locale} className="mt-auto" />
      </SidebarInset>
    </SidebarProvider>
  );
}
