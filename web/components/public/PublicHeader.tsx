"use client";
import { Menu } from "lucide-react";
import { useLocale } from "next-intl";
import { useEffect, useState } from "react";
import { Link, usePathname } from "@/i18n/routing";
import { GITHUB_URL, LANDING_SECTIONS, localePath, type LandingSection as Section } from "@/lib/links";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { GithubIcon } from "@/components/icons";
import { LanguageSwitch } from "@/components/LanguageSwitch";
import { Logo } from "@/components/Logo";
import { ThemeToggle, type ThemeLabels } from "@/components/theme/ThemeToggle";
import { AuthNav } from "@/components/AuthNav";
import type { AuthMode } from "@/lib/config";
import { cn } from "@/lib/utils";

export interface HeaderLabels {
  docs: string; signIn: string; openApp: string; localMode: string; menu: string; language: string; theme: ThemeLabels;
  sections: Record<Section, string>; terms: string; privacy: string;
}

/** The paths that render the landing, where a section link stays on the page instead of loading `/`. */
const LANDING_PATHS = new Set(["/", "/about"]);

const MENU_LINK = "flex items-center gap-2 rounded-md px-3 py-2 text-foreground transition-colors hover:bg-muted";

export function PublicHeader({ authMode, signedIn, labels }: { authMode: AuthMode; signedIn: boolean; labels: HeaderLabels }) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  const locale = useLocale();
  const pathname = usePathname();
  const p = (x: string) => localePath(locale, x);
  // `/` sends the local user and a signed-in session to the app: their landing is `/about`.
  const landing = signedIn ? p("/about") : locale === "en" ? "/" : `/${locale}`;
  const sectionHref = (id: Section) => (LANDING_PATHS.has(pathname) ? `#${id}` : `${landing}#${id}`);
  const account = authMode === "none"
    ? <Badge variant="outline" className="border-warning/30 bg-warning/10 text-warning">{labels.localMode}</Badge>
    : signedIn ? <Button asChild size="sm"><Link href="/app">{labels.openApp}</Link></Button>
    : <AuthNav signInLabel={labels.signIn} />;
  return (
    <header className={cn("sticky top-0 z-40 transition-colors", scrolled && "border-b bg-background/80 backdrop-blur")}>
      <nav className="mx-auto flex h-14 w-full max-w-6xl items-center gap-2 px-4 sm:px-6">
        {/* Below 400 px the lockup's frame narrows to the tile: the language, theme, account and
            menu buttons leave no room for the wordmark on a 320 px screen. */}
        <Link href="/" aria-label="Makor" className="shrink-0"><Logo className="max-[400px]:w-7" /></Link>
        <div className="ms-auto flex items-center gap-1">
          <Button asChild variant="ghost" size="sm" className="max-md:hidden"><Link href="/api-reference">{labels.docs}</Link></Button>
          <LanguageSwitch label={labels.language} />
          <ThemeToggle labels={labels.theme} />
          <span className="ms-1 flex">{account}</span>
          <Sheet>
            <SheetTrigger asChild><Button variant="ghost" size="icon" aria-label={labels.menu} className="md:hidden"><Menu /></Button></SheetTrigger>
            {/* The sheet slides in from the end side: right in English, left in Hebrew. */}
            <SheetContent side={locale === "he" ? "left" : "right"} aria-describedby={undefined} className="w-72 max-w-[85vw] gap-0">
              <SheetHeader className="h-14 shrink-0 justify-center border-b px-4 py-0">
                <SheetTitle><Logo /></SheetTitle>
              </SheetHeader>
              <div className="flex-1 overflow-y-auto px-2 py-3 text-base">
                <ul>
                  {LANDING_SECTIONS.map((id) => (
                    <li key={id}><SheetClose asChild><a href={sectionHref(id)} className={MENU_LINK}>{labels.sections[id]}</a></SheetClose></li>
                  ))}
                </ul>
                <ul className="mt-3 border-t pt-3">
                  <li><SheetClose asChild><Link href="/api-reference" className={MENU_LINK}>{labels.docs}</Link></SheetClose></li>
                  <li><a href={GITHUB_URL} className={MENU_LINK}><GithubIcon className="size-4 text-muted-foreground" />GitHub</a></li>
                </ul>
              </div>
              <SheetFooter className="shrink-0 flex-row flex-wrap gap-x-4 gap-y-1 border-t px-5 py-4 text-[13px] text-muted-foreground">
                <a href={p("/terms")} className="hover:text-foreground">{labels.terms}</a>
                <a href={p("/privacy")} className="hover:text-foreground">{labels.privacy}</a>
              </SheetFooter>
            </SheetContent>
          </Sheet>
        </div>
      </nav>
    </header>
  );
}
