"use client";
import { useClerk, useUser } from "@clerk/nextjs";
import { BookOpen, ChevronRight, ExternalLink, Info, KeyRound, LogOut, Sparkles, UserRound, Wallet, Zap } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "@/i18n/routing";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar";
import { useDirection } from "@/components/ui/direction";
import type { AuthMode } from "@/lib/config";
import type { ModeSummary } from "@/lib/mode-summary";
import type { Role } from "@/lib/users";
import { cn } from "@/lib/utils";

export interface ModeLabels { local: string; localHint: string; byok: string; byokHint: string; unlimited: string; unlimitedHint: string; trial: string; trialLeft: string }
export interface UserCardLabels { mode: ModeLabels; localUser: string; admin: string; menu: string; manageAccount: string; signOut: string; apiReference: string; about: string }
export interface UserCardProps { authMode: AuthMode; role: Role; email: string | null; mode: ModeSummary; labels: UserCardLabels }

/** The sidebar's footer: one card for who you are and what you run on; opens the account menu. */
export function UserCard(props: UserCardProps) {
  return props.authMode === "clerk" ? <ClerkUserCard {...props} /> : <LocalUserCard {...props} />;
}

/** Clerk mode: name and avatar from the client session, account actions through Clerk's own API — no <UserButton>. */
function ClerkUserCard(props: UserCardProps) {
  const { user } = useUser();
  const { openUserProfile, signOut } = useClerk();
  const email = user?.primaryEmailAddress?.emailAddress ?? props.email ?? "";
  const name = user?.fullName ?? user?.username ?? email;
  const picture = user?.imageUrl
    // eslint-disable-next-line @next/next/no-img-element -- Clerk's CDN, a 40 px avatar; next/image gains nothing
    ? <img src={user.imageUrl} alt="" className={cn(AVATAR, "object-cover")} />
    : <Initials text={name} />;
  return (
    <UserCardFrame {...props} picture={picture} title={name} subtitle={name === email ? null : email}
      items={<DropdownMenuItem onSelect={() => openUserProfile()}><UserRound />{props.labels.manageAccount}</DropdownMenuItem>}
      footer={<DropdownMenuItem variant="destructive" onSelect={() => void signOut({ redirectUrl: "/" })}><LogOut />{props.labels.signOut}</DropdownMenuItem>} />
  );
}

/** None mode: the implicit local user — no account, no sign-out; the menu holds only the public pages. */
function LocalUserCard(props: UserCardProps) {
  const picture = <span className={cn(AVATAR, "grid place-items-center bg-sidebar-foreground/15 text-sidebar-foreground")}><UserRound className="size-5" /></span>;
  return <UserCardFrame {...props} picture={picture} title={props.labels.localUser} subtitle={null} />;
}

/** 40 px in the card and the menu header; 32 px when the sidebar is collapsed to icons (the button is 32 px then). */
const AVATAR = "size-10 shrink-0 rounded-full group-data-[collapsible=icon]:size-8";

function Initials({ text }: { text: string }) {
  const letters = text.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("");
  return <span className={cn(AVATAR, "grid place-items-center bg-sidebar-foreground/15 text-sm font-semibold text-sidebar-foreground")}>{letters || "?"}</span>;
}

function AdminBadge({ label, ink }: { label: string; ink?: boolean }) {
  return <Badge variant="destructive" className={cn("h-5 shrink-0 px-2 text-[11px]", ink && "border border-sidebar-foreground/30 bg-transparent text-sidebar-foreground dark:bg-transparent")}>{label}</Badge>;
}

/** One icon and one accent colour per mode; the text is plain, not a chip — chips read as clutter at this size. */
const MODE = {
  local: { Icon: Zap, tone: "text-muted-foreground" },
  byok: { Icon: KeyRound, tone: "text-success" },
  unlimited: { Icon: Sparkles, tone: "text-primary" },
  trial: { Icon: Wallet, tone: "text-warning" },
} as const;

/** Same accents, legible on the ink-coloured sidebar card instead of the menu's paper surface. */
const MODE_INK_TONE = {
  local: "text-sidebar-foreground/60",
  byok: "text-success",
  unlimited: "text-highlight",
  trial: "text-warning",
} as const;

function modeText(mode: ModeSummary, labels: ModeLabels): string {
  return mode.kind === "trial" ? labels.trial : labels[mode.kind];
}

function trialPercent(mode: ModeSummary): number {
  return mode.kind !== "trial" || mode.total === 0 ? 0 : ((mode.total - mode.left) / mode.total) * 100;
}

/** The card's second line: icon, mode name, and for the trial the counter at the far end. */
function ModeLine({ mode, labels }: { mode: ModeSummary; labels: ModeLabels }) {
  const { Icon } = MODE[mode.kind];
  return (
    <span className="flex items-center gap-1.5 text-xs text-sidebar-foreground/70">
      <Icon className={cn("size-3.5 shrink-0", MODE_INK_TONE[mode.kind])} aria-hidden />
      <span className="truncate">{modeText(mode, labels)}</span>
      {mode.kind === "trial" && <span className="ms-auto tabular-nums" dir="ltr">{mode.left} / {mode.total}</span>}
    </span>
  );
}

/** The menu header's mode block: name, hint, and the trial bar, on a quiet surface. */
function ModeBlock({ mode, labels, hint }: { mode: ModeSummary; labels: ModeLabels; hint: string }) {
  const { Icon, tone } = MODE[mode.kind];
  return (
    <div className="mt-2 flex items-start gap-2 rounded-md bg-muted/60 px-2.5 py-2 text-xs">
      <Icon className={cn("mt-0.5 size-4 shrink-0", tone)} aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="font-medium text-foreground">{modeText(mode, labels)}</span>
        <span className="text-muted-foreground">{hint}</span>
        {mode.kind === "trial" && <Progress value={trialPercent(mode)} className="mt-1 h-1" />}
      </div>
    </div>
  );
}

/** Name at the start, the admin badge at the far end of the same row; the name truncates between them. */
function NameRow({ title, isAdmin, label, ink }: { title: string; isAdmin: boolean; label: string; ink?: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{title}</span>
      {isAdmin && <AdminBadge label={label} ink={ink} />}
    </div>
  );
}

/** The card shows who and on what; the e-mail lives only in the menu header (`subtitle`) and the collapsed tooltip. */
function UserCardFrame({ picture, title, subtitle, role, mode, labels, items, footer }: UserCardProps & { picture: ReactNode; title: string; subtitle: string | null; items?: ReactNode; footer?: ReactNode }) {
  const { isMobile } = useSidebar();
  const dir = useDirection();
  const isAdmin = role === "admin";
  const hint = mode.kind === "trial" ? labels.mode.trialLeft : labels.mode[`${mode.kind}Hint`];
  const endSide = dir === "rtl" ? "left" : "right";
  const tooltip = (
    <div className="space-y-0.5">
      <div className="font-medium">{title}{isAdmin && <span className="ms-1 text-destructive">· {labels.admin}</span>}</div>
      {subtitle && <div dir="ltr" className="opacity-80">{subtitle}</div>}
      <div className="opacity-80">{modeText(mode, labels.mode)} · {hint}</div>
    </div>
  );
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg" aria-label={labels.menu} tooltip={{ side: endSide, children: tooltip }}
              className="h-auto rounded-lg border border-sidebar-border bg-[color-mix(in_oklch,var(--sidebar),white_6%)] py-2 hover:bg-[color-mix(in_oklch,var(--sidebar),white_10%)] data-open:bg-[color-mix(in_oklch,var(--sidebar),white_10%)] data-open:text-sidebar-accent-foreground group-data-[collapsible=icon]:h-8! group-data-[collapsible=icon]:rounded-full group-data-[collapsible=icon]:border-0 group-data-[collapsible=icon]:bg-transparent">
              {picture}
              <div className="flex min-w-0 flex-1 flex-col gap-1 text-start leading-tight">
                <NameRow title={title} isAdmin={isAdmin} label={labels.admin} ink />
                <ModeLine mode={mode} labels={labels.mode} />
                {mode.kind === "trial" && <Progress value={trialPercent(mode)} className="h-1 bg-sidebar-foreground/20 [&>[data-slot=progress-indicator]]:bg-sidebar-foreground" />}
              </div>
              <ChevronRight className="ms-auto size-4 shrink-0 text-sidebar-foreground/60 rtl:rotate-180" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent side={isMobile ? "bottom" : endSide} align="end" sideOffset={8} className="w-64 shadow-xl">
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="px-2 py-2">
                <div className="flex items-start gap-3">
                  <span className="[&_span]:bg-primary/10 [&_span]:text-primary">{picture}</span>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-start leading-tight">
                    <NameRow title={title} isAdmin={isAdmin} label={labels.admin} />
                    {subtitle && <span className="truncate text-xs text-muted-foreground rtl:text-right" dir="ltr">{subtitle}</span>}
                  </div>
                </div>
                <ModeBlock mode={mode} labels={labels.mode} hint={hint} />
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {items}
            {/* The public pages, outside the app: they open in a new tab, and the trailing arrow says so. */}
            <DropdownMenuItem asChild><Link href="/api-reference" target="_blank" rel="noopener"><BookOpen />{labels.apiReference}<ExternalLink className="ms-auto size-3 opacity-60" /></Link></DropdownMenuItem>
            <DropdownMenuItem asChild><Link href="/about" target="_blank" rel="noopener"><Info />{labels.about}<ExternalLink className="ms-auto size-3 opacity-60" /></Link></DropdownMenuItem>
            {footer && <><DropdownMenuSeparator />{footer}</>}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
