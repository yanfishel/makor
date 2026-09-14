"use client";
import { Menu } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "@/i18n/routing";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { LanguageSwitch } from "@/components/LanguageSwitch";
import { Logo } from "@/components/Logo";
import { ThemeToggle, type ThemeLabels } from "@/components/theme/ThemeToggle";
import { AuthNav } from "@/components/AuthNav";
import type { AuthMode } from "@/lib/config";
import { cn } from "@/lib/utils";

export interface HeaderLabels { docs: string; signIn: string; openApp: string; localMode: string; menu: string; language: string; theme: ThemeLabels }

export function PublicHeader({ authMode, signedIn, labels }: { authMode: AuthMode; signedIn: boolean; labels: HeaderLabels }) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  const account = authMode === "none"
    ? <Badge variant="outline" className="border-warning/30 bg-warning/10 text-warning">{labels.localMode}</Badge>
    : signedIn ? <Button asChild size="sm"><Link href="/app">{labels.openApp}</Link></Button>
    : <AuthNav signInLabel={labels.signIn} />;
  return (
    <header className={cn("sticky top-0 z-40 transition-colors", scrolled && "border-b bg-background/80 backdrop-blur")}>
      <nav className="mx-auto flex h-14 w-full max-w-6xl items-center gap-2 px-4 sm:px-6">
        <Link href="/" aria-label="Makor"><Logo /></Link>
        <div className="ms-auto hidden items-center gap-1 md:flex">
          <Button asChild variant="ghost" size="sm"><Link href="/api-reference">{labels.docs}</Link></Button>
          <LanguageSwitch label={labels.language} />
          <ThemeToggle labels={labels.theme} />
          {account}
        </div>
        <div className="ms-auto flex items-center gap-1 md:hidden">
          {account}
          <Sheet>
            <SheetTrigger asChild><Button variant="ghost" size="icon" aria-label={labels.menu}><Menu /></Button></SheetTrigger>
            <SheetContent>
              <SheetTitle><Logo /></SheetTitle>
              <div className="mt-6 flex flex-col gap-2">
                <Button asChild variant="ghost" className="justify-start"><Link href="/api-reference">{labels.docs}</Link></Button>
                <div className="flex gap-1"><LanguageSwitch label={labels.language} /><ThemeToggle labels={labels.theme} /></div>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </nav>
    </header>
  );
}
