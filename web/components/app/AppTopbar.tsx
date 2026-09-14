"use client";
import { Link, usePathname } from "@/i18n/routing";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { LanguageSwitch } from "@/components/LanguageSwitch";
import { ThemeToggle, type ThemeLabels } from "@/components/theme/ThemeToggle";
import type { NavItem } from "@/components/app/AppSidebar";

/**
 * The bar above every app page. It names the page only where the sidebar cannot (narrow
 * screens) or where there is a real trail to climb — a stored result under Documents; the
 * sidebar's logo is the home link, so there is no "Makor" root crumb.
 */
export function AppTopbar({ items, labels }: { items: NavItem[]; labels: { language: string; theme: ThemeLabels; documentTitle: string } }) {
  const pathname = usePathname();
  const section = items.find((it) => (it.href === "/app" ? pathname === "/app" : pathname.startsWith(it.href)));
  const nested = pathname.startsWith("/app/documents/") && section ? { parent: section, title: labels.documentTitle } : null;
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-background/85 px-4 backdrop-blur">
      <SidebarTrigger />
      {/* The vertical separator is `self-stretch` from the primitive, so a height would pin it
          to the top of the 56 px bar: the vertical margin is what centres it. */}
      <Separator orientation="vertical" className={nested ? "mx-1 my-4" : "mx-1 my-4 md:hidden"} />
      <Breadcrumb>
        <BreadcrumbList>
          {nested ? (
            <>
              <BreadcrumbItem><BreadcrumbLink asChild><Link href={nested.parent.href}>{nested.parent.label}</Link></BreadcrumbLink></BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem><BreadcrumbPage>{nested.title}</BreadcrumbPage></BreadcrumbItem>
            </>
          ) : (
            <BreadcrumbItem className="md:hidden"><BreadcrumbPage>{section?.label ?? ""}</BreadcrumbPage></BreadcrumbItem>
          )}
        </BreadcrumbList>
      </Breadcrumb>
      <div className="ms-auto flex items-center gap-1"><LanguageSwitch label={labels.language} /><ThemeToggle labels={labels.theme} /></div>
    </header>
  );
}
