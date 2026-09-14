import type { ReactNode } from "react";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";
import { getConfig } from "@/lib/config";
import { fontClasses } from "@/lib/fonts";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { ClerkThemed } from "@/components/theme/ClerkThemed";
import { DirectionProvider } from "@/components/ui/direction";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import "../globals.css";
import type { Metadata, Viewport } from "next";
import { getTranslations } from "next-intl/server";
import { SITE_NAME } from "@/lib/seo";

/** No pinch zoom: the app is laid out for its breakpoints, and a zoomed viewport is what broke it. */
export const viewport: Viewport = {
  width: "device-width", initialScale: 1, maximumScale: 1, userScalable: false,
  // The two --background tokens of globals.css, in hex: the browser chrome matches the page.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f7f9" },
    { media: "(prefers-color-scheme: dark)", color: "#091123" },
  ],
};

/**
 * What every page inherits: the absolute base for og:image and canonical URLs (NEXT_PUBLIC_SITE_URL,
 * read per request like the rest of the config), the `%s · Makor` title template and the default
 * description. Public pages add their own through `pageMetadata`. A none-mode instance is one
 * person's local tool, so it asks not to be indexed at all.
 */
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "meta" });
  const cfg = getConfig();
  return {
    metadataBase: new URL(cfg.siteUrl),
    applicationName: SITE_NAME,
    title: { default: SITE_NAME, template: `%s · ${SITE_NAME}` },
    description: t("description"),
    keywords: t("keywords"),
    formatDetection: { telephone: false, email: false, address: false },
    appleWebApp: { title: SITE_NAME, capable: true, statusBarStyle: "default" },
    ...(cfg.authMode === "none" ? { robots: { index: false, follow: false } } : {}),
  };
}

/** Clerk's context is mounted in clerk mode only — none mode runs without any Clerk key. */
function MaybeClerk({ publishableKey, children }: { publishableKey: string | null; children: ReactNode }) {
  if (!publishableKey) return children;
  return <ClerkThemed publishableKey={publishableKey}>{children}</ClerkThemed>;
}

export default async function LocaleLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const dir = locale === "he" ? "rtl" : "ltr";
  const cfg = getConfig();
  return (
    <html lang={locale} dir={dir} className={fontClasses} suppressHydrationWarning>
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        <NextIntlClientProvider>
          <ThemeProvider>
            <MaybeClerk publishableKey={cfg.authMode === "clerk" ? cfg.clerkPublishableKey : null}>
              <DirectionProvider dir={dir}>
                <TooltipProvider>{children}</TooltipProvider>
                {/* 72 px: clear of the 56 px app topbar plus a gap. */}
                <Toaster position="top-center" offset={{ top: 72 }} mobileOffset={{ top: 72 }} />
              </DirectionProvider>
            </MaybeClerk>
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
