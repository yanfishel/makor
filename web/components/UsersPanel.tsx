"use client";
import { BarChart3, MoreHorizontal, Shield, ShieldOff, Sparkles, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BarList } from "@/components/BarList";
import { DocumentsTable } from "@/components/DocumentsTable";
import { Pagination } from "@/components/Pagination";
import { StatTiles } from "@/components/StatTiles";
import type { AuthMode } from "@/lib/config";
import { ApiError, api, jsonBody } from "@/lib/client-api";
import { docIcon } from "@/lib/doc-icons";
import { docFamily, familyBarClass } from "@/lib/doc-types";
import { formatCost, formatDateTime, formatMs } from "@/lib/format";
import { PAGE_SIZE, pageCount, parsePage } from "@/lib/paging";
import type { AdminUserDetail, AdminUserSummary } from "@/lib/users";

const ERROR_KEYS: Record<string, string> = { SELF_DEMOTE: "selfDemote", SELF_DELETE: "selfDelete", USER_DELETE_FAILED: "deleteFailed" };

const displayName = (u: { email: string | null; userId: string }) => u.email ?? u.userId;

export function UsersPanel({ selfId, locale, authMode }: { selfId: string; locale: string; authMode: AuthMode }) {
  const t = useTranslations("users");
  const ta = useTranslations("app");
  const page = parsePage(useSearchParams().get("page"));
  const [users, setUsers] = useState<AdminUserSummary[] | null>(null);
  const [total, setTotal] = useState(0);
  const [trialDocs, setTrialDocs] = useState(0);
  const [detail, setDetail] = useState<AdminUserDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [roleChange, setRoleChange] = useState<{ u: AdminUserSummary; role: "admin" | "user" } | null>(null);
  const [deleting, setDeleting] = useState<AdminUserSummary | null>(null);

  const load = useCallback(async () => {
    const body = await api<{ users: AdminUserSummary[]; total: number; trial_docs: number }>(`/api/admin/users?limit=${PAGE_SIZE}&offset=${(page - 1) * PAGE_SIZE}`);
    setUsers(body.users);
    setTotal(body.total);
    setTrialDocs(body.trial_docs);
  }, [page]);

  useEffect(() => {
    load().catch(() => setError("loadFailed"));
  }, [load]);

  /** One admin action with the shared busy/error handling; the list is reloaded on success. */
  async function run(action: () => Promise<void>) {
    setError(null); setBusy(true);
    try { await action(); await load(); }
    catch (err) { setError((err instanceof ApiError && err.code && ERROR_KEYS[err.code]) || "updateFailed"); }
    finally { setBusy(false); }
  }

  function setRole(u: AdminUserSummary, role: "admin" | "user") {
    void run(async () => { await api(`/api/admin/users/${encodeURIComponent(u.userId)}`, jsonBody("PATCH", { role })); });
  }
  function setExempt(u: AdminUserSummary, trialUnlimited: boolean) {
    void run(async () => { await api(`/api/admin/users/${encodeURIComponent(u.userId)}`, jsonBody("PATCH", { trial_unlimited: trialUnlimited })); });
  }
  function removeUser(u: AdminUserSummary) {
    void run(async () => {
      await api(`/api/admin/users/${encodeURIComponent(u.userId)}`, { method: "DELETE" });
      toast.success(t("deleted", { user: displayName(u) }));
    });
  }
  const fetchDetail = (userId: string, docsPage = 1) => api<AdminUserDetail>(`/api/admin/users/${encodeURIComponent(userId)}?page=${docsPage}`);
  function openStats(u: AdminUserSummary) {
    void run(async () => { setDetail(await fetchDetail(u.userId)); });
  }
  /** Turns the modal's recent-documents page in place; a failed fetch keeps the page shown. */
  function turnDocsPage(userId: string, docsPage: number) {
    void run(async () => { setDetail(await fetchDetail(userId, docsPage)); });
  }

  const trialCell = (u: AdminUserSummary) => u.hasAnthropicKey ? t("byok")
    : u.role === "admin" ? t("unlimited")
    : u.trialUnlimited ? t("exempt")
    : t("ofN", { used: u.trialUsed, n: trialDocs });

  if (!users) return <p className="text-sm text-muted-foreground">{error ? t(error) : t("loading")}</p>;
  return (
    <div className="space-y-4">
      {error && <Alert variant="destructive"><AlertTitle>{t(error)}</AlertTitle></Alert>}
      <div className="overflow-x-auto border-t border-foreground">
        <Table>
          <TableHeader><TableRow>{[t("colUser"), t("colRole"), t("colTrial"), t("colDocs"), t("colMonth"), t("colLastSeen")].map((h) => <TableHead key={h}>{h}</TableHead>)}<TableHead className="text-end">{t("actions")}</TableHead></TableRow></TableHeader>
          <TableBody>
            {users.map((u) => (
              <TableRow key={u.userId}>
                <TableCell>
                  <span dir="ltr">{displayName(u)}</span>
                  {u.userId === selfId && <Badge variant="secondary" className="ms-2">{t("you")}</Badge>}
                  {u.email && <div className="font-mono text-xs text-muted-foreground"><bdi>{u.userId}</bdi></div>}
                </TableCell>
                <TableCell>{u.role === "admin" ? <Badge variant="outline" className="rounded-sm">{t("roleAdmin")}</Badge> : <span className="text-muted-foreground">{t("roleUser")}</span>}</TableCell>
                <TableCell>{u.hasAnthropicKey || u.role === "admin" || u.trialUnlimited ? <Badge variant="outline">{trialCell(u)}</Badge> : trialCell(u)}</TableCell>
                <TableCell className="tabular-nums">{u.docsTotal}</TableCell>
                <TableCell className="tabular-nums">{u.docsThisMonth}</TableCell>
                <TableCell className="whitespace-nowrap">{formatDateTime(u.lastSeenAt, locale)}</TableCell>
                <TableCell className="text-end">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" disabled={busy} aria-label={t("actions")}><MoreHorizontal /></Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-auto whitespace-nowrap">
                      <DropdownMenuItem onClick={() => openStats(u)}><BarChart3 />{t("stats")}</DropdownMenuItem>
                      {u.role === "admin"
                        ? u.userId !== selfId && <DropdownMenuItem variant="destructive" onClick={() => setRoleChange({ u, role: "user" })}><ShieldOff />{t("revokeAdmin")}</DropdownMenuItem>
                        : <>
                          <DropdownMenuItem onClick={() => setRoleChange({ u, role: "admin" })}><Shield />{t("makeAdmin")}</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setExempt(u, !u.trialUnlimited)}><Sparkles />{t(u.trialUnlimited ? "restoreLimit" : "liftLimit")}</DropdownMenuItem>
                        </>}
                      {authMode === "clerk" && u.userId !== selfId && (
                        <DropdownMenuItem variant="destructive" onClick={() => setDeleting(u)}><Trash2 />{t("deleteUser")}</DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <Pagination page={page} total={total} pageSize={PAGE_SIZE} hrefFor={(n) => (n === 1 ? "/app/users" : `/app/users?page=${n}`)}
        labels={{ prev: t("prev"), next: t("next"), pageOf: t("pageOf", { page, pages: pageCount(total, PAGE_SIZE) }) }} />
      <AlertDialog open={roleChange !== null} onOpenChange={(o) => { if (!o) setRoleChange(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{roleChange?.role === "admin" ? t("makeAdmin") : t("revokeAdmin")}</AlertDialogTitle>
            <AlertDialogDescription>{roleChange && t(roleChange.role === "admin" ? "confirmMakeAdmin" : "confirmRevokeAdmin", { user: displayName(roleChange.u) })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{ta("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (roleChange) setRole(roleChange.u, roleChange.role); setRoleChange(null); }}>{roleChange?.role === "admin" ? t("makeAdmin") : t("revokeAdmin")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={deleting !== null} onOpenChange={(o) => { if (!o) setDeleting(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteUser")}</AlertDialogTitle>
            <AlertDialogDescription>{deleting && t("confirmDelete", { user: displayName(deleting), n: deleting.docsTotal })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{ta("cancel")}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => { if (deleting) removeUser(deleting); setDeleting(null); }}>{t("deleteUser")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <UserStatsDialog detail={detail} locale={locale} busy={busy} onClose={() => setDetail(null)} onDocsPage={(n) => detail && turnDocsPage(detail.userId, n)} />
    </div>
  );
}

function UserStatsDialog({ detail, locale, busy, onClose, onDocsPage }: { detail: AdminUserDetail | null; locale: string; busy: boolean; onClose: () => void; onDocsPage: (page: number) => void }) {
  const t = useTranslations("users");
  const tl = useTranslations("labels");
  const label = (ns: "docTypes" | "verdicts", key: string) => (tl.has(`${ns}.${key}`) ? tl(`${ns}.${key}`) : key);
  return (
    <Dialog open={detail !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
        {detail && (
          <>
            <DialogHeader>
              <DialogTitle>{t("modalTitle")}</DialogTitle>
              <DialogDescription className="flex flex-wrap items-baseline gap-x-2"><bdi>{detail.email ?? detail.userId}</bdi>{detail.email && <bdi className="font-mono text-xs">{detail.userId}</bdi>}</DialogDescription>
            </DialogHeader>
            <StatTiles tiles={[
              { label: t("total"), value: String(detail.stats.total) },
              { label: t("last30"), value: String(detail.stats.last30Days) },
              { label: t("okThisMonth"), value: String(detail.usage.okThisMonth), hint: detail.usage.month },
              { label: t("failedThisMonth"), value: String(detail.usage.failedThisMonth), hint: detail.usage.month },
            ]} />
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-6">
              {([[t("signedUp"), formatDateTime(detail.createdAt, locale)], [t("lastDocument"), detail.lastDocumentAt ? formatDateTime(detail.lastDocumentAt, locale) : t("never")], [t("storeResults"), detail.storeResults ? t("yes") : t("no")], [t("model"), detail.model ?? t("serverDefault")], [t("medianLatency"), formatMs(detail.stats.medianLatencyMs)], [t("cost"), detail.stats.costUsd.total == null ? formatCost(null) : `${formatCost(detail.stats.costUsd.last30Days ?? 0, 2)} / ${formatCost(detail.stats.costUsd.total, 2)}`]] as [string, string][]).map(([k, v]) => (
                <div key={k}><dt className="text-xs text-muted-foreground">{k}</dt><dd>{v}</dd></div>
              ))}
            </dl>
            <div className="grid gap-4 md:grid-cols-2">
              <Card size="sm"><CardHeader><CardTitle>{t("byType")}</CardTitle></CardHeader><CardContent><BarList rows={detail.stats.byType} icon={docIcon} label={(k) => label("docTypes", k)} barClass={(k) => familyBarClass(docFamily(k))} /></CardContent></Card>
              <Card size="sm"><CardHeader><CardTitle>{t("byVerdict")}</CardTitle></CardHeader><CardContent><BarList rows={detail.stats.byVerdict} byTone label={(k) => label("verdicts", k)} /></CardContent></Card>
            </div>
            <section className="min-w-0 space-y-3">
              <h3 className="text-sm font-medium text-muted-foreground">{t("recent")}</h3>
              {/* hasResult is forced off: a stored result belongs to its owner, the admin sees metadata only. */}
              <DocumentsTable rows={detail.recent.map((r) => ({ ...r, hasResult: false }))} locale={locale}
 />
              <div className={busy ? "pointer-events-none opacity-50" : ""}>
                <Pagination page={detail.recentPage} total={detail.recentTotal} pageSize={PAGE_SIZE} onPage={onDocsPage}
                  labels={{ prev: t("prev"), next: t("next"), pageOf: t("pageOf", { page: detail.recentPage, pages: pageCount(detail.recentTotal, PAGE_SIZE) }) }} />
              </div>
            </section>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
