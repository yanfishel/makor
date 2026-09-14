"use client";
import { FileText, KeyRound, Landmark, LayoutDashboard, ScanText, Settings, Users } from "lucide-react";
import { Link, usePathname } from "@/i18n/routing";
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarRail, useSidebar } from "@/components/ui/sidebar";
import { Logo } from "@/components/Logo";
import { UserCard, type UserCardProps } from "@/components/app/UserCard";

export const NAV_ICONS = { dashboard: LayoutDashboard, extract: ScanText, documents: FileText, registries: Landmark, keys: KeyRound, settings: Settings, users: Users } as const;
export interface NavItem { href: "/app" | "/app/extract" | "/app/documents" | "/app/registries" | "/app/keys" | "/app/settings" | "/app/users"; label: string; icon: keyof typeof NAV_ICONS }

export function AppSidebar({ items, locale, user }: { items: NavItem[]; locale: string; user: UserCardProps }) {
  const pathname = usePathname();
  // On a phone the sidebar is a sheet: a page link closes it. The user card's menu does not —
  // its items open Clerk's dialogs or leave the app.
  const { setOpenMobile } = useSidebar();
  const close = () => setOpenMobile(false);
  /* Two groups under a rule: the work pages (dashboard, extract, documents, registries), the account pages.
     The API reference and About leave the app, so they live in the user menu. */
  const groups: NavItem[][] = [[]];
  for (const it of items) {
    groups[groups.length - 1].push(it);
    if (it.icon === "registries") groups.push([]);
  }
  return (
    <Sidebar collapsible="icon" side={locale === "he" ? "right" : "left"}>
      <SidebarHeader className="h-14 justify-center border-b border-sidebar-border px-3"><Link href="/app" onClick={close}><Logo collapsible tone="ink" /></Link></SidebarHeader>
      <SidebarContent>
        {groups.map((group, i) => (
          <SidebarGroup key={i} className={i > 0 ? "border-t border-sidebar-border" : undefined}>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.map((it) => {
                  const Icon = NAV_ICONS[it.icon];
                  const active = it.href === "/app" ? pathname === "/app" : pathname.startsWith(it.href);
                  return (
                    <SidebarMenuItem key={it.href}>
                      <SidebarMenuButton asChild isActive={active} tooltip={it.label}>
                        <Link href={it.href} onClick={close}><Icon />{it.label}</Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter>
        <UserCard {...user} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
