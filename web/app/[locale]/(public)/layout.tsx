import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { PublicHeader } from "@/components/public/PublicHeader";
import { getConfig } from "@/lib/config";

export default async function PublicLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const cfg = getConfig();
  const clerk = cfg.authMode === "clerk";
  // Public pages are served to signed-out visitors in clerk mode: they get Docs and Sign in only.
  const signedIn = !clerk || (await (await import("@/lib/clerk-session")).clerkSessionUserId()) !== null;
  const t = await getTranslations({ locale, namespace: "app" });
  return (
    <>
      <PublicHeader authMode={cfg.authMode} signedIn={signedIn} labels={{
        docs: t("docs"), signIn: t("signIn"), openApp: t("openApp"), localMode: t("localMode"), menu: t("menu"), language: t("language"),
        theme: { toggle: t("theme.toggle"), light: t("theme.light"), dark: t("theme.dark"), system: t("theme.system") },
      }} />
      {/* No column here: sections put their content in a `Container` themselves, so a section
          can paint its background edge to edge (the hero, Privacy) without escaping a wrapper. */}
      <main className="w-full pt-8">{children}</main>
    </>
  );
}
